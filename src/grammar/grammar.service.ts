import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Model } from 'mongoose';
import { normalizeAnswer } from '../courses/homework.service';
import { todayKey } from '../common/day';
import { TENSE_LABEL, type Tense } from '../courses/tense';
import { Drill, Group, LESSONS, LESSON_BY_ID, Lesson } from './grammar.content';

/** Practice modes besides a single lesson: mixed sets over everything or over one group. */
const MIX_MODES: Record<string, Group | null> = { mix: null, 'mix-tenses': 'tenses', 'mix-foundations': 'foundations' };

/** What a drill's result is called: its topic (Foundations) or the tense of its answer (Tenses). */
const drillLabel = (l: Lesson, d: Drill) => d.topic ?? (d.tense ? TENSE_LABEL[d.tense] : TENSE_LABEL[l.id as Tense] ?? l.name);

/** One answer to a question: typed/picked text, the word picked (fixError) or one text per blank (cloze). */
export interface PracticeAnswer { id: string; answer?: string; pick?: number; answers?: string[] }

/** The words of a sentence, as the learner taps them (fixError). */
const tokensOf = (prompt: string) => prompt.split(/\s+/).filter(Boolean);
/** Indexes of the words that make up the wrong phrase of a fixError drill. */
function wrongTokens(d: Drill): number[] {
  const at = d.prompt.indexOf(d.wrong ?? '\u0000');
  if (at < 0) return [];
  const end = at + (d.wrong ?? '').length;
  const out: number[] = [];
  let pos = 0;
  tokensOf(d.prompt).forEach((t, i) => {
    const start = d.prompt.indexOf(t, pos);
    pos = start + t.length;
    if (start < end && pos > at) out.push(i);
  });
  return out;
}
const sameAs = (given: string, answer: string, accept: string[] = []) => {
  const g = normalizeAnswer(given ?? '');
  return !!g && [answer, ...accept].some((x) => normalizeAnswer(x) === g);
};
/** The sentence with the [[highlight]] markers of an identify drill removed. */
const plain = (p: string) => p.replace(/\[\[|\]\]/g, '');

/** Placement test: a fixed set, so results compare across learners and over time. */
const PLACEMENT_PER_TENSE = ['medium', 'hard'] as const;

/** A learner's placement test results. */
@Schema({ collection: 'grammar_placement', timestamps: true })
export class GrammarPlacement {
  @Prop({ required: true, index: true }) user: string;
  /** Lesson id → right / asked. */
  @Prop({ type: Object, default: {} }) scores: Record<string, { correct: number; total: number }>;
  /** The lessons to start with (weakest first). */
  @Prop({ type: [String], default: [] }) recommended: string[];
}
export const GrammarPlacementSchema = SchemaFactory.createForClass(GrammarPlacement);

/** Mastery looks at this many recent answers per tense. */
const RECENT = 20;
/** Fewer answers than this can't reach 100% (one lucky answer isn't mastery). */
const MIN_FOR_FULL = 10;
export const PRACTICE_SIZE = 10;

/** One learner's answers for one tense: the recent ones decide the mastery. */
@Schema({ collection: 'grammar_progress', timestamps: true })
export class GrammarProgress {
  @Prop({ required: true, index: true }) user: string;
  @Prop({ required: true }) tense: string;
  /** Most recent last: drill id and whether it was right. */
  @Prop({ type: [{ id: String, ok: Boolean, _id: false }], default: [] }) recent: { id: string; ok: boolean }[];
  @Prop({ default: 0 }) attempts: number;
  @Prop({ default: 0 }) correct: number;
  @Prop({ type: Date, default: null }) lastAt: Date | null;
}
export type GrammarProgressDocument = HydratedDocument<GrammarProgress>;
export const GrammarProgressSchema = SchemaFactory.createForClass(GrammarProgress);
GrammarProgressSchema.index({ user: 1, tense: 1 }, { unique: true });

/** 0–100 from the recent answers. */
export function mastery(p?: Pick<GrammarProgress, 'recent'> | null): number {
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

const drillId = (tense: string, i: number) => tense + ':' + i;

/** A drill by its id ("present-perfect:12"). */
function findDrill(id: string): { lesson: Lesson; drill: Drill } | null {
  const k = id.lastIndexOf(':');
  const lesson = LESSON_BY_ID.get(id.slice(0, k));
  const drill = lesson?.drills[Number(id.slice(k + 1))];
  return lesson && drill ? { lesson, drill } : null;
}

@Injectable()
export class GrammarService {
  constructor(
    @InjectModel(GrammarProgress.name) private readonly progress: Model<GrammarProgress>,
    @InjectModel(GrammarPlacement.name) private readonly placements: Model<GrammarPlacement>
  ) {}

  /** What the learner sees of a question (never the answer). */
  private question(id: string) {
    const { drill: d } = findDrill(id)!;
    const base = { id, kind: d.kind, level: d.level };
    if (d.kind === 'identify') {
      const opts = shuffle(d.choices);
      return { ...base, prompt: d.prompt, choices: opts, labels: opts.map((c) => TENSE_LABEL[c as Tense] ?? c) };
    }
    if (d.kind === 'fixError') return { ...base, prompt: d.prompt, tokens: tokensOf(d.prompt), choices: [] };
    if (d.kind === 'cloze') return { ...base, title: d.title ?? '', prompt: d.prompt, blanks: d.blanks?.length ?? 0, choices: [] };
    return { ...base, prompt: d.prompt, choices: d.kind === 'tenseChoice' ? shuffle(d.choices) : [] };
  }

  /** Grades one answer; `parts` are the per-answer results that count toward mastery (one per cloze blank). */
  private grade(a: PracticeAnswer) {
    const f = findDrill(a.id);
    if (!f) throw new BadRequestException('Unknown question “' + a.id + '”.');
    const { lesson, drill: d } = f;
    // `tense` is the lesson to review for it: the tense of the answer on tense drills, else the lesson itself.
    const review = d.tense ?? lesson.id;
    const common = { id: a.id, kind: d.kind, lesson: lesson.id, tense: review, tenseLabel: drillLabel(lesson, d), explain: d.explain };
    if (d.kind === 'cloze') {
      const blanks = (d.blanks ?? []).map((b, k) => {
        const given = a.answers?.[k] ?? '';
        const t = b.tense;
        return { yourAnswer: given, answer: b.answer, correct: sameAs(given, b.answer, b.accept), tense: t ?? '', tenseLabel: t ? TENSE_LABEL[t] : '', explain: b.explain };
      });
      const right = blanks.filter((b) => b.correct).length;
      return {
        result: { ...common, title: d.title ?? '', prompt: d.prompt, yourAnswer: '', answer: '', correct: right === blanks.length, score: { correct: right, total: blanks.length }, blanks },
        parts: blanks.map((b, k) => ({ id: a.id + '#' + k, ok: b.correct }))
      };
    }
    if (d.kind === 'fixError') {
      const wrong = wrongTokens(d);
      const pickRight = typeof a.pick === 'number' && wrong.includes(a.pick);
      const fixRight = sameAs(a.answer ?? '', d.answer, d.accept);
      const correct = pickRight && fixRight;
      return {
        result: { ...common, prompt: d.prompt, tokens: tokensOf(d.prompt), wrongTokens: wrong, wrong: d.wrong ?? '', pick: a.pick ?? null, pickRight, fixRight, yourAnswer: a.answer ?? '', answer: d.answer, correct },
        parts: [{ id: a.id, ok: correct }]
      };
    }
    if (d.kind === 'identify') {
      const correct = normalizeAnswer(a.answer ?? '') === normalizeAnswer(d.answer);
      return {
        result: { ...common, prompt: plain(d.prompt), highlight: d.prompt, yourAnswer: a.answer ?? '', yourLabel: TENSE_LABEL[a.answer as Tense] ?? a.answer ?? '', answer: d.answer, answerLabel: TENSE_LABEL[d.answer as Tense] ?? d.answer, correct },
        parts: [{ id: a.id, ok: correct }]
      };
    }
    const correct = sameAs(a.answer ?? '', d.answer, d.accept);
    return { result: { ...common, prompt: d.prompt, yourAnswer: a.answer ?? '', answer: d.answer, correct }, parts: [{ id: a.id, ok: correct }] };
  }

  /** Adds graded answers to each lesson's recent history; returns the new mastery per lesson. */
  private async record(user: string, graded: { result: { lesson: string }; parts: { id: string; ok: boolean }[] }[]) {
    const byLesson = new Map<string, { id: string; ok: boolean }[]>();
    for (const g of graded) byLesson.set(g.result.lesson, [...(byLesson.get(g.result.lesson) ?? []), ...g.parts]);
    const masteryNow: Record<string, number> = {};
    for (const [lesson, rs] of byLesson) {
      const p = await this.progress.findOneAndUpdate(
        { user, tense: lesson },
        { $push: { recent: { $each: rs, $slice: -RECENT } }, $inc: { attempts: rs.length, correct: rs.filter((x) => x.ok).length }, $set: { lastAt: new Date() } },
        { upsert: true, returnDocument: 'after' }
      );
      masteryNow[lesson] = mastery(p);
    }
    return masteryNow;
  }

  private async mine(user: string) {
    return new Map((await this.progress.find({ user }).lean()).map((p) => [p.tense, p]));
  }

  /** The tenses with my mastery of each. */
  async list(user: string) {
    const mine = await this.mine(user);
    const today = todayKey();
    const place = await this.placements.findOne({ user }).sort({ createdAt: -1 }).lean<GrammarPlacement & { createdAt?: Date }>();
    return {
      practisedToday: [...mine.values()].some((p) => p.lastAt && todayKey(new Date(p.lastAt)) === today),
      placement: place ? { at: place.createdAt ? new Date(place.createdAt).getTime() : null, recommended: place.recommended, scores: place.scores } : null,
      tenses: LESSONS.map((l) => {
        const p = mine.get(l.id);
        return {
          id: l.id, group: l.group, name: l.name, vi: l.vi, summary: l.summary, drills: l.drills.length,
          mastery: mastery(p), attempts: p?.attempts ?? 0, lastAt: p?.lastAt ? new Date(p.lastAt).getTime() : null
        };
      })
    };
  }

  /** One lesson (without its drills) and my mastery of it. */
  async lesson(user: string, tense: string) {
    const l = LESSON_BY_ID.get(tense);
    if (!l) throw new NotFoundException('No lesson for “' + tense + '”.');
    const p = await this.progress.findOne({ user, tense }).lean();
    const { drills, ...rest } = l;
    return {
      ...rest, compareName: l.compare ? LESSON_BY_ID.get(l.compare.with)?.name ?? '' : '', drillCount: drills.length,
      mastery: mastery(p), attempts: p?.attempts ?? 0
    };
  }

  /**
   * A practice set: one tense, or "mix" (the weaker the tense, the more of its drills). Drills answered
   * recently are left out when possible. Answers aren't included — POST the answers to be graded.
   */
  async practice(user: string, modeArg: string, n = PRACTICE_SIZE) {
    let mode = modeArg;
    const mine = await this.mine(user);
    const recentIds = new Set([...mine.values()].flatMap((p) => p.recent.map((r) => r.id)));
    const pickFrom = (lessonId: string, taken: Set<string>) => {
      const l = LESSON_BY_ID.get(lessonId)!;
      const all = l.drills.map((_, i) => drillId(lessonId, i)).filter((id) => !taken.has(id));
      const fresh = all.filter((id) => !recentIds.has(id));
      return shuffle(fresh.length ? fresh : all)[0];
    };
    const ids: string[] = [];
    const taken = new Set<string>();
    if (mode === 'daily') {
      // Today's practice: drills I got wrong lately first (up to 4), then the weaker lessons more often.
      const missed: string[] = [];
      for (const p of [...mine.values()].sort((a, b) => +new Date(b.lastAt ?? 0) - +new Date(a.lastAt ?? 0))) {
        for (const r of [...p.recent].reverse()) {
          const id = r.id.split('#')[0];
          if (!r.ok && findDrill(id) && !missed.includes(id)) missed.push(id);
        }
      }
      for (const id of missed.slice(0, 4)) { ids.push(id); taken.add(id); }
      mode = 'mix';
    }
    if (mode in MIX_MODES) {
      // Weight = 110 − mastery: a lesson at 0% comes up about 11 times as often as one at 100%.
      const group = MIX_MODES[mode];
      const weights = LESSONS.filter((l) => l.drills.length && (!group || l.group === group)).map((l) => ({ id: l.id, w: 110 - mastery(mine.get(l.id)) }));
      const total = weights.reduce((a, b) => a + b.w, 0);
      for (let guard = 0; ids.length < n && guard < n * 20; guard++) {
        let r = Math.random() * total;
        const t = weights.find((x) => (r -= x.w) < 0)?.id ?? weights[0].id;
        const id = pickFrom(t, taken);
        if (id) { ids.push(id); taken.add(id); }
      }
    } else {
      if (!LESSON_BY_ID.get(mode)?.drills.length) throw new BadRequestException('There is no practice for “' + mode + '”.');
      // Easier drills first while the tense is new; harder ones once it's going well.
      const m = mastery(mine.get(mode));
      const order: Drill['level'][] = m < 40 ? ['easy', 'medium', 'hard'] : m < 75 ? ['medium', 'easy', 'hard'] : ['hard', 'medium', 'easy'];
      const l = LESSON_BY_ID.get(mode)!;
      const all = l.drills.map((d, i) => ({ id: drillId(mode, i), level: d.level }));
      const fresh = all.filter((x) => !recentIds.has(x.id));
      const pool = [...shuffle(fresh), ...shuffle(all.filter((x) => recentIds.has(x.id)))]
        .sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level) || Number(recentIds.has(a.id)) - Number(recentIds.has(b.id)));
      ids.push(...pool.slice(0, n).map((x) => x.id));
    }
    // No tense in the questions: shown before answering, it would give the answer away (especially in a mix).
    return { mode: modeArg, questions: shuffle(ids).map((id) => this.question(id)) };
  }

  /** Grades a practice set and updates the mastery of each lesson in it. */
  async submit(user: string, answers: PracticeAnswer[]) {
    if (!answers.length) throw new BadRequestException('No answers.');
    const graded = answers.map((a) => this.grade(a));
    const masteryNow = await this.record(user, graded);
    const results = graded.map((g) => g.result);
    return { results, correct: results.filter((r) => r.correct).length, total: results.length, mastery: masteryNow };
  }

  /* ---------- placement test ---------- */

  /** The fixed placement set: a medium and a hard drill of each tense, a medium one of each Foundations lesson. */
  private placementIds(): string[] {
    const ids: string[] = [];
    for (const l of LESSONS.filter((x) => x.drills.length && x.id !== 'mixed')) {
      const levels = l.group === 'tenses' ? PLACEMENT_PER_TENSE : (['medium'] as const);
      for (const lv of levels) {
        const i = l.drills.findIndex((d) => d.level === lv && (d.kind === 'tense' || d.kind === 'tenseChoice') && (!d.tense || d.tense === l.id));
        if (i >= 0) ids.push(drillId(l.id, i));
      }
    }
    return ids;
  }

  async placement(user: string) {
    const last = await this.placements.findOne({ user }).sort({ createdAt: -1 }).lean<GrammarPlacement & { createdAt?: Date }>();
    return {
      questions: this.placementIds().map((id) => this.question(id)),
      last: last ? { at: last.createdAt ? new Date(last.createdAt).getTime() : null, recommended: last.recommended, scores: last.scores } : null
    };
  }

  /** Grades the placement test, starts each lesson's mastery from it and recommends the 3 weakest lessons. */
  async submitPlacement(user: string, answers: PracticeAnswer[]) {
    const allowed = new Set(this.placementIds());
    if (!answers.length || answers.some((a) => !allowed.has(a.id))) throw new BadRequestException('These aren’t the placement questions.');
    const graded = answers.map((a) => this.grade(a));
    const scores: Record<string, { correct: number; total: number }> = {};
    for (const g of graded) {
      const sc = (scores[g.result.lesson] ??= { correct: 0, total: 0 });
      sc.total++;
      if (g.result.correct) sc.correct++;
    }
    const order = LESSONS.map((l) => l.id);
    const recommended = Object.entries(scores)
      .sort((a, b) => a[1].correct / a[1].total - b[1].correct / b[1].total || order.indexOf(a[0]) - order.indexOf(b[0]))
      .slice(0, 3).map(([id]) => id);
    const masteryNow = await this.record(user, graded);
    await this.placements.create({ user, scores, recommended });
    const results = graded.map((g) => g.result);
    return { results, correct: results.filter((r) => r.correct).length, total: results.length, scores, recommended, mastery: masteryNow };
  }

  async deleteForUser(user: string): Promise<void> {
    await Promise.all([this.progress.deleteMany({ user }), this.placements.deleteMany({ user })]);
  }
}
