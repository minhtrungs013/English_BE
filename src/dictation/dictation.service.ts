import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Model } from 'mongoose';
import { todayKey } from '../common/day';
import { DictationItem, DictationLevel, DictationSet, SETS, SET_BY_ID } from './dictation.content';
import { DictationResult, gradeDictation } from './dictation.grade';

/** One answer: the typed line, or one typed text per passage sentence; how often it was played and hints used (3 = revealed). */
export interface DictationAnswer { id: string; typed?: string; typedSentences?: string[]; plays?: number; hints?: number }

/** Mastery looks at this many recent answers per set. */
const RECENT = 20;
/** Fewer answers than this can't reach 100%. */
const MIN_FOR_FULL = 10;
export const PRACTICE_SIZE = 10;
/** A passage practice set has at most this many passages; a mix has at most one. */
const MAX_PASSAGES = 3;
const MAX_PASSAGES_IN_MIX = 1;
/** Hint 3 shows the whole sentence: the item then counts as not passed. */
const REVEAL_HINT = 3;

/** One learner's answers for one set: the recent ones decide the mastery. */
@Schema({ collection: 'dictation_progress', timestamps: true })
export class DictationProgress {
  @Prop({ required: true, index: true }) user: string;
  @Prop({ required: true }) set: string;
  /** Most recent last: "set:i" (a line) or "set:i#k" (a passage sentence) and whether it was right. */
  @Prop({ type: [{ id: String, ok: Boolean, _id: false }], default: [] }) recent: { id: string; ok: boolean }[];
  @Prop({ default: 0 }) attempts: number;
  @Prop({ default: 0 }) correct: number;
  @Prop({ type: Date, default: null }) lastAt: Date | null;
}
export type DictationProgressDocument = HydratedDocument<DictationProgress>;
export const DictationProgressSchema = SchemaFactory.createForClass(DictationProgress);
DictationProgressSchema.index({ user: 1, set: 1 }, { unique: true });

/** 0–100 from the recent answers. */
export function mastery(p?: Pick<DictationProgress, 'recent'> | null): number {
  const r = p?.recent ?? [];
  if (!r.length) return 0;
  return Math.round((100 * r.filter((x) => x.ok).length) / Math.max(MIN_FOR_FULL, r.length));
}

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

const itemId = (set: string, i: number) => set + ':' + i;

/** An item by its id ("numbers-prices:3"). */
function findItem(id: string): { set: DictationSet; item: DictationItem } | null {
  const k = id.lastIndexOf(':');
  if (k < 0) return null;
  const set = SET_BY_ID.get(id.slice(0, k));
  const idx = id.slice(k + 1);
  const item = /^\d+$/.test(idx) ? set?.items[Number(idx)] : undefined;
  return set && item ? { set, item } : null;
}

@Injectable()
export class DictationService {
  constructor(@InjectModel(DictationProgress.name) private readonly progress: Model<DictationProgress>) {}

  /** What the device needs to speak the item (the UI hides text / vi until it is checked). */
  private question(id: string) {
    const { item } = findItem(id)!;
    if (item.kind === 'passage') return { id, kind: item.kind, level: item.level, title: item.title, sentences: item.sentences.map((s) => ({ text: s.text, vi: s.vi })) };
    return { id, kind: item.kind, level: item.level, text: item.text, vi: item.vi, ...(item.focus ? { focus: item.focus } : {}) };
  }

  /** Grades one answer; `parts` are the mastery entries (one per line / per passage sentence). */
  private grade(a: DictationAnswer) {
    const f = findItem(a.id);
    if (!f) throw new BadRequestException('Unknown item “' + a.id + '”.');
    const { set, item } = f;
    const plays = a.plays ?? 0;
    const hints = a.hints ?? 0;
    const revealed = hints >= REVEAL_HINT;
    const common = { id: a.id, set: set.id, kind: item.kind, plays, hints };
    if (item.kind === 'passage') {
      const sentences = item.sentences.map((s, k) => ({ text: s.text, vi: s.vi, grade: gradeDictation(s.text, a.typedSentences?.[k] ?? '') }));
      const passed = !revealed && sentences.every((s) => s.grade.passed);
      const score = sentences.length ? Math.round(sentences.reduce((sum, s) => sum + s.grade.score, 0) / sentences.length) : 0;
      return {
        result: { ...common, passed, score, title: item.title, sentences },
        parts: sentences.map((s, k) => ({ id: a.id + '#' + k, ok: s.grade.passed && !revealed }))
      };
    }
    const grade: DictationResult = gradeDictation(item.text, a.typed ?? '');
    const passed = grade.passed && !revealed;
    return {
      result: { ...common, passed, score: grade.score, text: item.text, vi: item.vi, ...(item.focus ? { focus: item.focus } : {}), grade },
      parts: [{ id: a.id, ok: passed }]
    };
  }

  /** Adds graded answers to each set's recent history; returns the new mastery per set. */
  private async record(user: string, graded: { result: { set: string }; parts: { id: string; ok: boolean }[] }[]) {
    const bySet = new Map<string, { id: string; ok: boolean }[]>();
    for (const g of graded) bySet.set(g.result.set, [...(bySet.get(g.result.set) ?? []), ...g.parts]);
    const masteryNow: Record<string, number> = {};
    for (const [set, rs] of bySet) {
      const p = await this.progress.findOneAndUpdate(
        { user, set },
        { $push: { recent: { $each: rs, $slice: -RECENT } }, $inc: { attempts: rs.length, correct: rs.filter((x) => x.ok).length }, $set: { lastAt: new Date() } },
        { upsert: true, returnDocument: 'after' }
      );
      masteryNow[set] = mastery(p);
    }
    return masteryNow;
  }

  private async mine(user: string) {
    return new Map((await this.progress.find({ user }).lean()).map((p) => [p.set, p]));
  }

  /** The sets with my mastery of each. */
  async list(user: string) {
    const mine = await this.mine(user);
    const today = todayKey();
    return {
      practisedToday: [...mine.values()].some((p) => p.lastAt && todayKey(new Date(p.lastAt)) === today),
      sets: SETS.map((s) => {
        const p = mine.get(s.id);
        return {
          id: s.id, group: s.group, name: s.name, vi: s.vi, summary: s.summary, items: s.items.length,
          mastery: mastery(p), attempts: p?.attempts ?? 0, lastAt: p?.lastAt ? new Date(p.lastAt).getTime() : null
        };
      })
    };
  }

  /** One set (without its items) and my mastery of it. */
  async set(user: string, id: string) {
    const s = SET_BY_ID.get(id);
    if (!s) throw new NotFoundException('No dictation set “' + id + '”.');
    const p = await this.progress.findOne({ user, set: id }).lean();
    const { items, ...rest } = s;
    return { ...rest, tips: s.tips, itemCount: items.length, mastery: mastery(p), attempts: p?.attempts ?? 0 };
  }

  /**
   * A practice set: one set, "mix" (the weaker the set, the more of its items) or "daily" (recently missed items
   * first, then a mix). Items answered recently are left out when possible. For the passages set, n counts passages (max 3).
   */
  async practice(user: string, modeArg: string, n = PRACTICE_SIZE) {
    let mode = modeArg;
    const mine = await this.mine(user);
    const recentIds = new Set([...mine.values()].flatMap((p) => p.recent.map((r) => r.id.split('#')[0])));
    const ids: string[] = [];
    const taken = new Set<string>();
    let passages = 0;
    const take = (id: string) => {
      ids.push(id);
      taken.add(id);
      if (findItem(id)?.item.kind === 'passage') passages++;
    };
    const pickFrom = (setId: string) => {
      const s = SET_BY_ID.get(setId)!;
      const all = s.items.map((_, i) => itemId(setId, i)).filter((id) => !taken.has(id));
      const fresh = all.filter((id) => !recentIds.has(id));
      return shuffle(fresh.length ? fresh : all)[0] as string | undefined;
    };
    if (mode === 'daily') {
      // Items I got wrong lately first (up to 4, a passage counts once), then the weaker sets more often.
      const missed: string[] = [];
      for (const p of [...mine.values()].sort((a, b) => +new Date(b.lastAt ?? 0) - +new Date(a.lastAt ?? 0))) {
        for (const r of [...p.recent].reverse()) {
          const id = r.id.split('#')[0];
          if (!r.ok && findItem(id) && !missed.includes(id)) missed.push(id);
        }
      }
      for (const id of missed) {
        if (ids.length >= Math.min(4, n)) break;
        if (findItem(id)!.item.kind === 'passage' && passages >= MAX_PASSAGES_IN_MIX) continue;
        take(id);
      }
      mode = 'mix';
    }
    if (mode === 'mix') {
      // Weight = 110 − mastery: a set at 0% comes up about 11 times as often as one at 100%.
      const weights = SETS.filter((s) => s.items.length).map((s) => ({ id: s.id, passages: s.group === 'passages', w: 110 - mastery(mine.get(s.id)) }));
      for (let guard = 0; ids.length < n && guard < n * 20; guard++) {
        const open = weights.filter((x) => !x.passages || passages < MAX_PASSAGES_IN_MIX);
        if (!open.length) break;
        const total = open.reduce((a, b) => a + b.w, 0);
        let r = Math.random() * total;
        const t = open.find((x) => (r -= x.w) < 0)?.id ?? open[0].id;
        const id = pickFrom(t);
        if (id) take(id);
      }
    } else {
      const s = SET_BY_ID.get(mode);
      if (!s?.items.length) throw new BadRequestException('There is no dictation practice for “' + mode + '”.');
      const size = s.group === 'passages' ? Math.min(n, MAX_PASSAGES) : n;
      // Easier items first while the set is new; harder ones once it's going well.
      const m = mastery(mine.get(mode));
      const order: DictationLevel[] = m < 40 ? ['easy', 'medium', 'hard'] : m < 75 ? ['medium', 'easy', 'hard'] : ['hard', 'medium', 'easy'];
      const all = s.items.map((it, i) => ({ id: itemId(mode, i), level: it.level }));
      const pool = shuffle(all).sort((a, b) => Number(recentIds.has(a.id)) - Number(recentIds.has(b.id)) || order.indexOf(a.level) - order.indexOf(b.level));
      ids.push(...pool.slice(0, size).map((x) => x.id));
    }
    return { mode: modeArg, items: shuffle(ids).map((id) => this.question(id)) };
  }

  /** Grades answers (one or a whole set) and updates the mastery of each set in it. */
  async submit(user: string, answers: DictationAnswer[]) {
    if (!answers.length) throw new BadRequestException('No answers.');
    const graded = answers.map((a) => this.grade(a));
    const masteryNow = await this.record(user, graded);
    const results = graded.map((g) => g.result);
    return { results, passed: results.filter((r) => r.passed).length, total: results.length, mastery: masteryNow };
  }

  /** Stateless grading of any sentences (level S: sentences from the learner's own words). */
  gradeMany(items: { text: string; typed: string }[]) {
    return { results: items.map((x) => gradeDictation(x.text, x.typed)) };
  }

  async deleteForUser(user: string): Promise<void> {
    await this.progress.deleteMany({ user });
  }
}
