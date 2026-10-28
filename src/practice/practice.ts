import { Body, Controller, Get, HttpCode, Injectable, Module, Post, Query } from '@nestjs/common';
import { InjectModel, MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Model } from 'mongoose';
import { UserId } from '../auth/auth.decorators';
import { Enrollment, EnrollmentSchema } from '../courses/course.schema';
import { CoursesModule } from '../courses/courses.module';
import { BankItem, BankItemSchema, QUESTION_KINDS } from '../courses/homework.schema';
import { SentenceGrammarService, type GrammarView } from '../courses/sentence-grammar';
import { fullSentence, sentenceKey } from '../courses/sentence-rules';
import { TENSE_LABEL, type Tense } from '../courses/tense';
import { questionFrom, SentenceBankModule, SentenceBankService } from '../sentence-bank/sentence-bank';
import { Word } from '../words/word.schema';
import { ProfileModule } from '../profile/profile.module';
import { WordsModule } from '../words/words.module';
import { SentenceCheckController, SentenceCheckService } from './sentence-check';
import { SentenceAttempt, SentenceAttemptSchema, SentenceSuggestion, SentenceSuggestionSchema } from './sentence-grade';
import { LibraryWord, LibraryWordSchema } from '../library/library.schema';

/** Which sentences a learner has practised, so the next session prefers fresh ones. */
@Schema({ collection: 'sentence_seen', timestamps: false })
export class SentenceSeen {
  @Prop({ required: true }) user: string;
  @Prop({ required: true }) key: string;
  @Prop({ default: 0 }) n: number;
  @Prop({ default: 0 }) ok: number;
  /** The last answer: a sentence I got wrong comes back first. */
  @Prop({ type: Boolean, default: null }) lastOk: boolean | null;
  @Prop({ type: Date, default: () => new Date() }) lastAt: Date;
}
export const SentenceSeenSchema = SchemaFactory.createForClass(SentenceSeen);
SentenceSeenSchema.index({ user: 1, key: 1 }, { unique: true });

/** The practice modes whose answers are counted per word. */
export const PRACTICE_WORD_MODES = ['mc', 'trans', 'listen', 'wordform', 'fill', 'tense', 'dictation'] as const;
export type PracticeWordMode = (typeof PRACTICE_WORD_MODES)[number];
const DAY_MS = 86_400_000;
/** How many recent wrong answers a record keeps (for "wrong this week"). */
const RECENT_WRONG = 20;

/**
 * How a learner stands with one of their words in one practice mode. mistakes: still to fix (+1 wrong,
 * −1 right, 0 after two right in a row) — the weak words come back in the next sessions until they're fixed.
 */
@Schema({ collection: 'practice_words', versionKey: false })
export class PracticeWord {
  @Prop({ required: true }) user: string;
  @Prop({ required: true }) wordId: string;
  @Prop({ required: true, enum: PRACTICE_WORD_MODES }) mode: string;
  @Prop({ default: 0 }) mistakes: number;
  @Prop({ default: 0 }) streak: number;
  @Prop({ default: 0 }) wrong: number;
  @Prop({ default: 0 }) right: number;
  /** Wrong answers that were almost right (one letter off). */
  @Prop({ default: 0 }) spelling: number;
  @Prop({ type: Date, default: null }) lastAt: Date | null;
  @Prop({ type: Date, default: null }) lastWrongAt: Date | null;
  /** When its mistakes were last all fixed. */
  @Prop({ type: Date, default: null }) fixedAt: Date | null;
  @Prop({ type: [Date], default: [] }) recentWrong: Date[];
}
export const PracticeWordSchema = SchemaFactory.createForClass(PracticeWord);
PracticeWordSchema.index({ user: 1, wordId: 1, mode: 1 }, { unique: true });

export class PracticeResultDto {
  @IsString() @MaxLength(40) wordId: string;
  @IsIn(PRACTICE_WORD_MODES) mode: PracticeWordMode;
  @IsBoolean() ok: boolean;
  /** Wrong, but only one letter off. */
  @IsOptional() @IsBoolean() spelling?: boolean;
}
export class PracticeResultsDto {
  @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => PracticeResultDto) items: PracticeResultDto[];
}

export const PRACTICE_SENTENCE_MODES = ['fill', 'tense', 'dictation', 'flash'] as const;
type Mode = (typeof PRACTICE_SENTENCE_MODES)[number];

export class PracticeSentencesQuery {
  @IsIn(PRACTICE_SENTENCE_MODES) mode: Mode;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) n?: number;
  /** Only these words (my word ids, comma separated), e.g. the cards of a flashcard session. */
  @IsOptional() @IsString() @MaxLength(2000) words?: string;
}
export class SeenItemDto {
  @IsString() @MaxLength(400) key: string;
  @IsOptional() @IsBoolean() ok?: boolean;
}
export class SeenDto {
  @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => SeenItemDto) items: SeenItemDto[];
}

interface Candidate { key: string; sentence: string; form: string; verb: string; base: string; tense: string; bank: boolean }

/** One practice item: a sentence for one of my words (and, for tense practice, the question made from it). */
export interface PracticeSentence {
  wordId: string; word: string; vi: string; key: string; sentence: string;
  /** fill: the word as it appears in the sentence (the blank). */
  form?: string;
  /** tense: typed prompt "___ (base)", the answer, other accepted answers and 4 choices (empty: typed only). */
  question?: { prompt: string; answer: string; accept: string[]; choices: string[]; tense: string; tenseLabel: string };
  grammar: GrammarView | null;
}

const shuffle = <T,>(a: T[]): T[] => a.map((x) => [Math.random(), x] as const).sort((p, q) => p[0] - q[0]).map(([, x]) => x);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordCount = (s: string) => s.trim().split(/\s+/).length;

/** The word (or a simple inflection of it) as written in the sentence, or ''. */
function formIn(sentence: string, word: string): string {
  const m = new RegExp('\\b' + esc(word) + '(?:s|es|ed|d|ing)?\\b', 'i').exec(sentence);
  return m ? m[0] : '';
}

/**
 * Sentences for practising my own words: the word sentence bank (about 4 per library word) plus each word's own
 * example. Each session prefers sentences I haven't seen (or not for a long time), and leaves out the questions of
 * the courses I take, so practice never gives away homework answers.
 */
@Injectable()
export class PracticeService {
  constructor(
    @InjectModel(Word.name) private readonly words: Model<Word>,
    @InjectModel(Enrollment.name) private readonly enrollments: Model<Enrollment>,
    @InjectModel(BankItem.name) private readonly bank: Model<BankItem>,
    @InjectModel(SentenceSeen.name) private readonly seen: Model<SentenceSeen>,
    @InjectModel(PracticeWord.name) private readonly records: Model<PracticeWord>,
    private readonly sentenceBank: SentenceBankService,
    private readonly grammar: SentenceGrammarService
  ) {}

  /** Sentence keys used as questions in the courses I take. */
  private async courseKeys(user: string): Promise<Set<string>> {
    const courseIds = (await this.enrollments.find({ user }, { courseId: 1 }).lean()).map((e) => e.courseId);
    if (!courseIds.length) return new Set();
    const items = await this.bank.find({ courseId: { $in: courseIds }, kind: { $in: QUESTION_KINDS }, status: 'approved' }, { prompt: 1, answer: 1 }).lean();
    return new Set(items.map((b) => sentenceKey(fullSentence({ type: 'tense', prompt: b.prompt, answer: b.answer }))));
  }

  async sentences(user: string, mode: Mode, n = 10, only?: string[]): Promise<{ items: PracticeSentence[] }> {
    const filter: Record<string, unknown> = { user };
    if (only?.length) filter._id = { $in: only.filter((x) => /^[a-f0-9]{24}$/i.test(x)) };
    const all = await this.words.find(filter, { word: 1, ex: 1, vi: 1 }).lean();
    if (!all.length) return { items: [] };
    const [byWord, blocked, seenList, recs] = await Promise.all([
      this.sentenceBank.forWords(all.map((w) => w.word)),
      this.courseKeys(user),
      this.seen.find({ user }, { key: 1, ok: 1, lastOk: 1, lastAt: 1 }).lean(),
      mode === 'flash' ? Promise.resolve([]) : this.records.find({ user, mode }, { wordId: 1, mistakes: 1, lastAt: 1, lastWrongAt: 1 }).lean()
    ]);
    // Words: the weak ones in this mode first (up to 40%), then the ones I haven't practised for the longest time.
    const mine = mode === 'flash' ? shuffle(all) : orderWords(all, (w) => String(w._id), new Map(recs.map((r) => [r.wordId, { errors: r.mistakes, lastAt: r.lastAt, lastWrongAt: r.lastWrongAt }])), n);
    const seen = new Map(seenList.map((s) => [s.key, s]));
    /** Lower is better: a sentence I got wrong last time first, then never seen, then the longest ago; right twice waits 3 more days. */
    const score = (key: string) => {
      const s = seen.get(key);
      if (!s) return 0;
      if (s.lastOk === false) return -1;
      return s.lastAt.getTime() + (s.ok >= 2 ? 3 * DAY_MS : 0);
    };

    const picked: { w: (typeof mine)[number]; c: Candidate }[] = [];
    const limit = mode === 'flash' ? mine.length : n;
    for (const w of mine) {
      if (picked.length >= limit) break;
      const own: Candidate[] = w.ex?.trim() ? [{ key: sentenceKey(w.ex), sentence: w.ex.trim(), form: formIn(w.ex, w.word), verb: '', base: '', tense: '', bank: false }] : [];
      const fromBank: Candidate[] = (byWord.get(w.word.toLowerCase()) ?? []).map((s) => ({ key: s.key, sentence: s.sentence, form: s.form, verb: s.verb, base: s.base, tense: s.tense, bank: true }));
      const usable = [...own, ...fromBank].filter((c) => !blocked.has(c.key) && (
        mode === 'fill' ? !!c.form && new RegExp('\\b' + esc(c.form) + '\\b', 'i').test(c.sentence)
          : mode === 'tense' ? c.bank && !!questionFrom(c)
            : mode === 'dictation' ? c.sentence.length <= 160 && wordCount(c.sentence) >= 4 && wordCount(c.sentence) <= 18
              : true));
      if (!usable.length) continue;
      picked.push({ w, c: shuffle(usable).sort((a, b) => score(a.key) - score(b.key))[0] });
    }
    const [views, explains] = await Promise.all([
      this.grammar.views(picked.map((p) => ({ text: p.c.sentence }))),
      mode === 'tense' ? this.grammar.explains(picked.map((p) => p.c.sentence)) : Promise.resolve(new Map<string, { explain: string; subject: string }>())
    ]);
    return {
      items: picked.map(({ w, c }, i) => {
        const item: PracticeSentence = { wordId: String(w._id), word: w.word, vi: w.vi, key: c.key, sentence: c.sentence, grammar: views[i] };
        if (mode === 'fill') item.form = c.form;
        if (mode === 'tense') {
          const q = questionFrom(c, explains.get(c.key)?.subject)!;
          item.question = {
            prompt: q.prompt, answer: q.answer, accept: q.accept, tense: c.tense, tenseLabel: TENSE_LABEL[c.tense as Tense] ?? '',
            choices: q.canChoose ? shuffle([q.answer, ...shuffle(q.choices).slice(0, 3)]) : []
          };
        }
        return item;
      })
    };
  }

  /** Records practised sentences (and whether I got them right). */
  async markSeen(user: string, items: { key: string; ok?: boolean }[]): Promise<void> {
    if (!items.length) return;
    const now = new Date();
    await this.seen.bulkWrite(items.map((x) => ({
      updateOne: { filter: { user, key: x.key }, update: { $inc: { n: 1, ok: x.ok ? 1 : 0 }, $set: { lastAt: now, lastOk: !!x.ok } }, upsert: true }
    })), { ordered: false });
  }

  /** Records answers (in order): a wrong one adds a mistake to fix, a right one takes one off, two right in a row clear them. */
  async record(user: string, items: PracticeResultDto[]): Promise<void> {
    const ids = [...new Set(items.map((x) => x.wordId).filter((x) => /^[a-f0-9]{24}$/i.test(x)))];
    if (!ids.length) return;
    const owned = new Set((await this.words.find({ user, _id: { $in: ids } }, { _id: 1 }).lean()).map((w) => String(w._id)));
    const now = new Date();
    for (const x of items) {
      if (!owned.has(x.wordId)) continue;
      const r = await this.records.findOne({ user, wordId: x.wordId, mode: x.mode });
      const d = r ?? new this.records({ user, wordId: x.wordId, mode: x.mode });
      if (x.ok) {
        const had = d.mistakes;
        d.right++; d.streak++;
        d.mistakes = d.streak >= 2 ? 0 : Math.max(0, d.mistakes - 1);
        if (had > 0 && d.mistakes === 0) d.fixedAt = now;
      } else {
        d.wrong++; d.streak = 0; d.mistakes++;
        if (x.spelling) d.spelling++;
        d.lastWrongAt = now;
        d.recentWrong = [...(d.recentWrong ?? []), now].slice(-RECENT_WRONG);
      }
      d.lastAt = now;
      await d.save();
    }
  }

  /**
   * What practice knows about my words: every record (to build sessions), the weak words (mistakes still to fix,
   * with the modes they're weak in), how many per mode, and this week's fixed words and wrong answers.
   */
  async stats(user: string) {
    const [recs, words] = await Promise.all([
      this.records.find({ user }).lean(),
      this.words.find({ user }, { word: 1, vi: 1 }).lean()
    ]);
    const byId = new Map(words.map((w) => [String(w._id), w]));
    const live = recs.filter((r) => byId.has(r.wordId));
    const weekAgo = Date.now() - 7 * DAY_MS;
    const weak = new Map<string, { wordId: string; word: string; vi: string; errors: number; lastWrongAt: number; modes: { mode: string; errors: number; wrong: number; spelling: number }[] }>();
    for (const r of live) {
      if (r.mistakes <= 0) continue;
      const w = byId.get(r.wordId)!;
      const x = weak.get(r.wordId) ?? { wordId: r.wordId, word: w.word, vi: w.vi, errors: 0, lastWrongAt: 0, modes: [] };
      x.errors += r.mistakes;
      x.lastWrongAt = Math.max(x.lastWrongAt, r.lastWrongAt ? new Date(r.lastWrongAt).getTime() : 0);
      x.modes.push({ mode: r.mode, errors: r.mistakes, wrong: r.wrong, spelling: r.spelling });
      weak.set(r.wordId, x);
    }
    const byMode: Record<string, number> = {};
    for (const r of live) if (r.mistakes > 0) byMode[r.mode] = (byMode[r.mode] ?? 0) + 1;
    const fixed = new Set(live.filter((r) => r.fixedAt && new Date(r.fixedAt).getTime() >= weekAgo && !weak.has(r.wordId)).map((r) => r.wordId)).size;
    const wrong = live.reduce((n, r) => n + (r.recentWrong ?? []).filter((t) => new Date(t).getTime() >= weekAgo).length, 0);
    return {
      records: live.map((r) => ({ wordId: r.wordId, mode: r.mode, errors: r.mistakes, lastAt: r.lastAt ? new Date(r.lastAt).getTime() : 0, lastWrongAt: r.lastWrongAt ? new Date(r.lastWrongAt).getTime() : 0 })),
      weak: [...weak.values()].sort((a, b) => b.errors - a.errors || b.lastWrongAt - a.lastWrongAt).map((x) => ({ ...x, modes: x.modes.sort((a, b) => b.errors - a.errors) })),
      byMode, week: { fixed, wrong }
    };
  }

  async deleteForUser(user: string): Promise<void> {
    await Promise.all([this.seen.deleteMany({ user }), this.records.deleteMany({ user })]);
  }
}

/**
 * Practice order for a session of n: the weak words (mistakes still to fix) first, at most 40% of it, most mistakes
 * first; then the words not practised for the longest time (never first). Ties are random.
 */
export function orderWords<T>(items: T[], idOf: (x: T) => string, recs: Map<string, { errors: number; lastAt: Date | null; lastWrongAt: Date | null }>, n: number): T[] {
  const ms = (d: Date | null | undefined) => (d ? new Date(d).getTime() : 0);
  const list = shuffle(items);
  const weak = list.filter((x) => (recs.get(idOf(x))?.errors ?? 0) > 0)
    .sort((a, b) => recs.get(idOf(b))!.errors - recs.get(idOf(a))!.errors || ms(recs.get(idOf(b))!.lastWrongAt) - ms(recs.get(idOf(a))!.lastWrongAt))
    .slice(0, Math.max(1, Math.ceil(n * 0.4)));
  const rest = list.filter((x) => !weak.includes(x)).sort((a, b) => ms(recs.get(idOf(a))?.lastAt) - ms(recs.get(idOf(b))?.lastAt));
  return [...weak, ...rest];
}

@ApiTags('practice')
@ApiBearerAuth()
@Controller('practice/sentences')
export class PracticeController {
  constructor(private readonly practice: PracticeService) {}

  /** Sentences for practising my words: GET /api/practice/sentences?mode=fill|tense|dictation|flash */
  @Get()
  list(@UserId() user: string, @Query() q: PracticeSentencesQuery) {
    return this.practice.sentences(user, q.mode, q.n ?? 10, q.words ? q.words.split(',') : undefined);
  }

  /** Marks sentences as practised (ok = answered correctly). */
  @Post('seen')
  @HttpCode(204)
  async seen(@UserId() user: string, @Body() dto: SeenDto) {
    await this.practice.markSeen(user, dto.items);
  }
}

@ApiTags('practice')
@ApiBearerAuth()
@Controller('practice/words')
export class PracticeWordsController {
  constructor(private readonly practice: PracticeService) {}

  /** My practice records, weak words and this week's numbers. */
  @Get('stats')
  stats(@UserId() user: string) {
    return this.practice.stats(user);
  }

  /** Records practice answers (in the order given). */
  @Post('results')
  @HttpCode(204)
  async results(@UserId() user: string, @Body() dto: PracticeResultsDto) {
    await this.practice.record(user, dto.items);
  }
}

@Module({
  imports: [
    WordsModule, SentenceBankModule, CoursesModule, ProfileModule,
    MongooseModule.forFeature([
      { name: SentenceSeen.name, schema: SentenceSeenSchema }, { name: PracticeWord.name, schema: PracticeWordSchema }, { name: SentenceAttempt.name, schema: SentenceAttemptSchema },
      { name: SentenceSuggestion.name, schema: SentenceSuggestionSchema }, { name: LibraryWord.name, schema: LibraryWordSchema }, { name: Enrollment.name, schema: EnrollmentSchema }, { name: BankItem.name, schema: BankItemSchema }
    ])
  ],
  controllers: [PracticeController, PracticeWordsController, SentenceCheckController],
  providers: [PracticeService, SentenceCheckService],
  exports: [PracticeService, SentenceCheckService]
})
export class PracticeModule {}
