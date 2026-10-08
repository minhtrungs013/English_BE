import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Model } from 'mongoose';
import { normalizeAnswer } from '../courses/homework.service';
import { TENSE_LABEL, type Tense } from '../courses/tense';
import { Drill, LESSONS, LESSON_BY_ID } from './grammar.content';

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
function findDrill(id: string): { tense: Tense; drill: Drill } | null {
  const k = id.lastIndexOf(':');
  const lesson = LESSON_BY_ID.get(id.slice(0, k) as Tense);
  const drill = lesson?.drills[Number(id.slice(k + 1))];
  return lesson && drill ? { tense: lesson.id, drill } : null;
}

@Injectable()
export class GrammarService {
  constructor(@InjectModel(GrammarProgress.name) private readonly progress: Model<GrammarProgress>) {}

  private async mine(user: string) {
    return new Map((await this.progress.find({ user }).lean()).map((p) => [p.tense, p]));
  }

  /** The tenses with my mastery of each. */
  async list(user: string) {
    const mine = await this.mine(user);
    return {
      tenses: LESSONS.map((l) => {
        const p = mine.get(l.id);
        return {
          id: l.id, name: l.name, vi: l.vi, summary: l.summary, drills: l.drills.length,
          mastery: mastery(p), attempts: p?.attempts ?? 0, lastAt: p?.lastAt ? new Date(p.lastAt).getTime() : null
        };
      })
    };
  }

  /** One lesson (without its drills) and my mastery of it. */
  async lesson(user: string, tense: string) {
    const l = LESSON_BY_ID.get(tense as Tense);
    if (!l) throw new NotFoundException('No lesson for “' + tense + '”.');
    const p = await this.progress.findOne({ user, tense }).lean();
    const { drills, ...rest } = l;
    return {
      ...rest, compareName: LESSON_BY_ID.get(l.compare.with)?.name ?? '', drillCount: drills.length,
      mastery: mastery(p), attempts: p?.attempts ?? 0
    };
  }

  /**
   * A practice set: one tense, or "mix" (the weaker the tense, the more of its drills). Drills answered
   * recently are left out when possible. Answers aren't included — POST the answers to be graded.
   */
  async practice(user: string, mode: string, n = PRACTICE_SIZE) {
    const mine = await this.mine(user);
    const recentIds = new Set([...mine.values()].flatMap((p) => p.recent.map((r) => r.id)));
    const pickFrom = (tense: Tense, taken: Set<string>) => {
      const l = LESSON_BY_ID.get(tense)!;
      const all = l.drills.map((_, i) => drillId(tense, i)).filter((id) => !taken.has(id));
      const fresh = all.filter((id) => !recentIds.has(id));
      return shuffle(fresh.length ? fresh : all)[0];
    };
    const ids: string[] = [];
    const taken = new Set<string>();
    if (mode === 'mix') {
      // Weight = 110 − mastery: a tense at 0% comes up about 11 times as often as one at 100%.
      const weights = LESSONS.map((l) => ({ id: l.id, w: 110 - mastery(mine.get(l.id)) }));
      const total = weights.reduce((a, b) => a + b.w, 0);
      while (ids.length < n) {
        let r = Math.random() * total;
        const t = weights.find((x) => (r -= x.w) < 0)?.id ?? weights[0].id;
        const id = pickFrom(t, taken);
        if (id) { ids.push(id); taken.add(id); }
      }
    } else {
      if (!LESSON_BY_ID.has(mode as Tense)) throw new BadRequestException('Unknown tense “' + mode + '”.');
      // Easier drills first while the tense is new; harder ones once it's going well.
      const m = mastery(mine.get(mode));
      const order: Drill['level'][] = m < 40 ? ['easy', 'medium', 'hard'] : m < 75 ? ['medium', 'easy', 'hard'] : ['hard', 'medium', 'easy'];
      const l = LESSON_BY_ID.get(mode as Tense)!;
      const all = l.drills.map((d, i) => ({ id: drillId(mode, i), level: d.level }));
      const fresh = all.filter((x) => !recentIds.has(x.id));
      const pool = [...shuffle(fresh), ...shuffle(all.filter((x) => recentIds.has(x.id)))]
        .sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level) || Number(recentIds.has(a.id)) - Number(recentIds.has(b.id)));
      ids.push(...pool.slice(0, n).map((x) => x.id));
    }
    return {
      mode,
      questions: shuffle(ids).map((id) => {
        // No tense here: shown before answering, it would give the answer away (especially in a mix).
        const { drill } = findDrill(id)!;
        return { id, kind: drill.kind, level: drill.level, prompt: drill.prompt, choices: drill.kind === 'tenseChoice' ? shuffle(drill.choices) : [] };
      })
    };
  }

  /** Grades a practice set and updates the mastery of each tense in it. */
  async submit(user: string, answers: { id: string; answer: string }[]) {
    if (!answers.length) throw new BadRequestException('No answers.');
    const results = answers.map((a) => {
      const f = findDrill(a.id);
      if (!f) throw new BadRequestException('Unknown question “' + a.id + '”.');
      const given = normalizeAnswer(a.answer ?? '');
      const correct = !!given && [f.drill.answer, ...(f.drill.accept ?? [])].some((x) => normalizeAnswer(x) === given);
      // Mastery goes to the lesson the drill belongs to; the label names the tense of the answer.
      const answerTense = f.drill.tense ?? f.tense;
      return { id: a.id, lesson: f.tense, tense: answerTense, tenseLabel: TENSE_LABEL[answerTense], prompt: f.drill.prompt, yourAnswer: a.answer ?? '', answer: f.drill.answer, correct, explain: f.drill.explain };
    });
    const byTense = new Map<string, { id: string; ok: boolean }[]>();
    for (const r of results) byTense.set(r.lesson, [...(byTense.get(r.lesson) ?? []), { id: r.id, ok: r.correct }]);
    const masteryNow: Record<string, number> = {};
    for (const [tense, rs] of byTense) {
      const p = await this.progress.findOneAndUpdate(
        { user, tense },
        {
          $push: { recent: { $each: rs, $slice: -RECENT } },
          $inc: { attempts: rs.length, correct: rs.filter((x) => x.ok).length },
          $set: { lastAt: new Date() }
        },
        { upsert: true, returnDocument: 'after' }
      );
      masteryNow[tense] = mastery(p);
    }
    return { results, correct: results.filter((r) => r.correct).length, total: results.length, mastery: masteryNow };
  }

  async deleteForUser(user: string): Promise<void> {
    await this.progress.deleteMany({ user });
  }
}
