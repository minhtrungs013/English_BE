import { Body, Controller, Get, HttpCode, Injectable, Module, Post, Query } from '@nestjs/common';
import { InjectModel, MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Model } from 'mongoose';
import { UserId } from '../auth/auth.decorators';
import { Enrollment, EnrollmentSchema } from '../courses/course.schema';
import { CoursesModule } from '../courses/courses.module';
import { BankItem, BankItemSchema, TENSE_KINDS } from '../courses/homework.schema';
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
  @Prop({ type: Date, default: () => new Date() }) lastAt: Date;
}
export const SentenceSeenSchema = SchemaFactory.createForClass(SentenceSeen);
SentenceSeenSchema.index({ user: 1, key: 1 }, { unique: true });

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
    private readonly sentenceBank: SentenceBankService,
    private readonly grammar: SentenceGrammarService
  ) {}

  /** Sentence keys used as questions in the courses I take. */
  private async courseKeys(user: string): Promise<Set<string>> {
    const courseIds = (await this.enrollments.find({ user }, { courseId: 1 }).lean()).map((e) => e.courseId);
    if (!courseIds.length) return new Set();
    const items = await this.bank.find({ courseId: { $in: courseIds }, kind: { $in: TENSE_KINDS }, status: 'approved' }, { prompt: 1, answer: 1 }).lean();
    return new Set(items.map((b) => sentenceKey(fullSentence({ type: 'tense', prompt: b.prompt, answer: b.answer }))));
  }

  async sentences(user: string, mode: Mode, n = 10, only?: string[]): Promise<{ items: PracticeSentence[] }> {
    const filter: Record<string, unknown> = { user };
    if (only?.length) filter._id = { $in: only.filter((x) => /^[a-f0-9]{24}$/i.test(x)) };
    const mine = shuffle(await this.words.find(filter, { word: 1, ex: 1, vi: 1 }).lean());
    if (!mine.length) return { items: [] };
    const [byWord, blocked, seenList] = await Promise.all([
      this.sentenceBank.forWords(mine.map((w) => w.word)),
      this.courseKeys(user),
      this.seen.find({ user }, { key: 1, ok: 1, lastAt: 1 }).lean()
    ]);
    const seen = new Map(seenList.map((s) => [s.key, s]));
    /** Lower is better: never seen first, then the longest ago; sentences I got right twice wait 3 more days. */
    const score = (key: string) => { const s = seen.get(key); return s ? s.lastAt.getTime() + (s.ok >= 2 ? 3 * 86_400_000 : 0) : 0; };

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
      updateOne: { filter: { user, key: x.key }, update: { $inc: { n: 1, ok: x.ok ? 1 : 0 }, $set: { lastAt: now } }, upsert: true }
    })), { ordered: false });
  }

  async deleteForUser(user: string): Promise<void> {
    await this.seen.deleteMany({ user });
  }
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

@Module({
  imports: [
    WordsModule, SentenceBankModule, CoursesModule, ProfileModule,
    MongooseModule.forFeature([
      { name: SentenceSeen.name, schema: SentenceSeenSchema }, { name: SentenceAttempt.name, schema: SentenceAttemptSchema },
      { name: SentenceSuggestion.name, schema: SentenceSuggestionSchema }, { name: LibraryWord.name, schema: LibraryWordSchema }, { name: Enrollment.name, schema: EnrollmentSchema }, { name: BankItem.name, schema: BankItemSchema }
    ])
  ],
  controllers: [PracticeController, SentenceCheckController],
  providers: [PracticeService, SentenceCheckService],
  exports: [PracticeService, SentenceCheckService]
})
export class PracticeModule {}
