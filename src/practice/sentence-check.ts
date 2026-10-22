import { BadRequestException, Body, Controller, Get, HttpCode, HttpException, HttpStatus, Injectable, Logger, Post, Query, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsMongoId, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Model } from 'mongoose';
import { UserId } from '../auth/auth.decorators';
import { sentenceKey } from '../courses/sentence-rules';
import { LibraryWord } from '../library/library.schema';
import { ProfileService } from '../profile/profile.service';
import { WordsService } from '../words/words.service';
import { containsWord, gradeSentence, MISTAKE_TYPES, SentenceAttempt, SentenceSuggestion, type SentenceGrade } from './sentence-grade';

export { MISTAKE_TYPES };

const MAX_LEN = 200;
const DAY = 86_400_000;
/** Weeks shown in the progress chart. */
const WEEKS = 8;

export class SentenceCheckDto {
  @IsMongoId() wordId: string;
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value))
  @IsString() @MinLength(8, { message: 'Please write a full sentence.' }) @MaxLength(MAX_LEN, { message: 'Please keep the sentence under ' + MAX_LEN + ' characters.' })
  sentence: string;
}

export class MistakesQuery {
  @IsOptional() @IsIn(MISTAKE_TYPES) type?: string;
}
export class DrillQuery extends MistakesQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) n?: number;
}

export type SentenceResult = SentenceGrade & { quota: { used: number; limit: number } };

/** A practice question made from one of my own mistakes: the corrected sentence with the fixed part blanked. */
export interface MistakeDrill { id: string; word: string; type: string; prompt: string; choices: string[]; answer: string; wrong: string; explainVi: string; sentence: string }

const shuffle = <T>(a: T[]): T[] => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Monday of the week of `t` (UTC), as a day timestamp. */
const weekStart = (t: number) => { const d = new Date(t); const dow = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow); };

@Injectable()
export class SentenceCheckService {
  private readonly log = new Logger('SentenceCheck');

  constructor(
    @InjectModel(SentenceAttempt.name) private readonly attempts: Model<SentenceAttempt>,
    @InjectModel(SentenceSuggestion.name) private readonly suggestions: Model<SentenceSuggestion>,
    @InjectModel(LibraryWord.name) private readonly library: Model<LibraryWord>,
    private readonly words: WordsService,
    private readonly profile: ProfileService,
    private readonly config: ConfigService
  ) {}

  async check(user: string, dto: SentenceCheckDto): Promise<SentenceResult> {
    const w = await this.words.findOne(user, dto.wordId);
    const family = (w.toObject().family ?? []).map((m: { word: string }) => m.word);
    if (dto.sentence.split(' ').length < 3) throw new BadRequestException('Please write a full sentence (at least 3 words).');
    if (!containsWord(dto.sentence, w.word, family)) throw new BadRequestException('Your sentence doesn’t use “' + w.word + '” yet.');
    const key = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!key) throw new ServiceUnavailableException('AI isn’t set up yet.');
    if (!(await this.profile.useDaily(user, 'sentence'))) {
      const { limit } = await this.profile.dailyStatus(user, 'sentence');
      throw new HttpException({
        statusCode: 429, error: 'Daily limit reached',
        message: limit ? 'You’ve used all ' + limit + ' sentence checks for today. Try again tomorrow.' : 'Sentence checks aren’t included in your plan.'
      }, HttpStatus.TOO_MANY_REQUESTS);
    }

    let g: SentenceGrade;
    try {
      g = await gradeSentence(key, this.config.get<string>('ANTHROPIC_MODEL', 'claude-haiku-4-5'), { word: w.word, pos: w.pos, meaning: w.meaning, vi: w.vi }, dto.sentence);
    } catch (e) {
      this.log.warn('Sentence check failed: ' + String(e));
      await this.profile.refundDaily(user, 'sentence');
      throw new UnprocessableEntityException('AI couldn’t check your sentence right now. Please try again.');
    }
    await this.attempts.create({
      user, wordId: String(w._id), word: w.word, sentence: dto.sentence, score: g.score, corrected: g.corrected, lesson: g.lesson?.id ?? '', mistakes: g.mistakes, source: 'practice'
    }).catch((e) => this.log.warn('Could not save the attempt: ' + String(e)));
    await this.suggest(w.word, g);
    return { ...g, quota: await this.profile.dailyStatus(user, 'sentence') };
  }

  /** The AI's example sentence for a library word goes to the admins' review queue (never the learner's own sentence). */
  async suggest(word: string, g: Pick<SentenceGrade, 'better' | 'betterVi'>): Promise<void> {
    if (!g.better || !containsWord(g.better, word)) return;
    const lib = await this.library.findOne({ wordLower: word.trim().toLowerCase() }, { _id: 1, word: 1 }).lean().catch(() => null);
    if (!lib) return;
    const key = sentenceKey(g.better);
    await this.suggestions.updateOne({ key }, { $setOnInsert: { key, libraryWordId: String(lib._id), word: lib.word, sentence: g.better, vi: g.betterVi, status: 'pending', at: new Date() } }, { upsert: true })
      .catch(() => undefined);
  }

  status(user: string) {
    return this.profile.dailyStatus(user, 'sentence');
  }

  /**
   * My mistake notebook: totals, mistakes by type (this week vs last week), weekly progress and the latest
   * sentences with mistakes (optionally of one type).
   */
  async mistakes(user: string, q: MistakesQuery) {
    const now = Date.now();
    const since = new Date(weekStart(now) - (WEEKS - 1) * 7 * DAY);
    const all = await this.attempts.find({ user, at: { $gte: since } }).sort({ at: -1 }).lean();
    const week = now - 7 * DAY, prevWeek = now - 14 * DAY;
    const byType = new Map<string, { type: string; count: number; last7: number; prev7: number }>();
    for (const a of all) for (const m of a.mistakes) {
      const r = byType.get(m.type) ?? { type: m.type, count: 0, last7: 0, prev7: 0 };
      r.count++;
      const t = a.at.getTime();
      if (t >= week) r.last7++; else if (t >= prevWeek) r.prev7++;
      byType.set(m.type, r);
    }
    const weeks = Array.from({ length: WEEKS }, (_, i) => {
      const start = weekStart(now) - (WEEKS - 1 - i) * 7 * DAY;
      const list = all.filter((a) => { const t = a.at.getTime(); return t >= start && t < start + 7 * DAY; });
      return {
        week: start, attempts: list.length,
        avg: list.length ? Math.round((list.reduce((s, a) => s + a.score, 0) / list.length) * 10) / 10 : null,
        mistakes: list.reduce((s, a) => s + a.mistakes.length, 0)
      };
    });
    const recent = all.filter((a) => a.mistakes.length && (!q.type || a.mistakes.some((m) => m.type === q.type))).slice(0, 40).map((a) => ({
      id: String(a._id), at: a.at.getTime(), word: a.word, sentence: a.sentence, corrected: a.corrected, score: a.score, source: a.source ?? 'practice',
      mistakes: a.mistakes.filter((m) => !q.type || m.type === q.type)
    }));
    return {
      attempts: all.length,
      avg: all.length ? Math.round((all.reduce((s, a) => s + a.score, 0) / all.length) * 10) / 10 : null,
      withMistakes: all.filter((a) => a.mistakes.length).length,
      byType: [...byType.values()].sort((a, b) => b.count - a.count),
      weeks, recent,
      drillable: (await this.drill(user, { type: q.type, n: 20 })).length
    };
  }

  /** Practice questions from my own mistakes: the corrected sentence with the fixed part blanked; pick the right version. */
  async drill(user: string, q: DrillQuery): Promise<MistakeDrill[]> {
    const filter: Record<string, unknown> = { user, 'mistakes.0': { $exists: true } };
    if (q.type) filter['mistakes.type'] = q.type;
    const list = await this.attempts.find(filter).sort({ at: -1 }).limit(200).lean();
    const out: MistakeDrill[] = [];
    const seen = new Set<string>();
    for (const a of list) {
      for (const [k, m] of a.mistakes.entries()) {
        if (q.type && m.type !== q.type) continue;
        const fix = m.fix.trim(), wrong = m.wrong.trim();
        if (!fix || !wrong || fix.toLowerCase() === wrong.toLowerCase()) continue;
        const re = new RegExp(escapeRe(fix), 'i');
        const hit = re.exec(a.corrected);
        if (!hit) continue;
        const prompt = a.corrected.slice(0, hit.index) + '___' + a.corrected.slice(hit.index + hit[0].length);
        const dedupe = prompt.toLowerCase();
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        out.push({ id: String(a._id) + ':' + k, word: a.word, type: m.type, prompt, answer: hit[0], wrong, choices: [hit[0], wrong], explainVi: m.explainVi ?? '', sentence: a.corrected });
      }
    }
    // A third choice: another fix of the same kind, when there is one that differs.
    const n = q.n ?? 10;
    const picked = shuffle(out).slice(0, n);
    for (const d of picked) {
      const extra = out.find((o) => o.type === d.type && ![d.answer, d.wrong].some((c) => c.toLowerCase() === o.answer.toLowerCase()) && o.answer.split(' ').length <= 3);
      d.choices = shuffle(extra ? [...d.choices, extra.answer] : d.choices);
    }
    return picked;
  }

  async deleteForUser(user: string): Promise<void> {
    await this.attempts.deleteMany({ user });
  }
}

@ApiTags('practice')
@ApiBearerAuth()
@Controller('practice')
export class SentenceCheckController {
  constructor(private readonly svc: SentenceCheckService) {}

  /** Today's checks and the plan's limit: GET /api/practice/sentence-check */
  @Get('sentence-check')
  status(@UserId() user: string) {
    return this.svc.status(user);
  }

  /** AI grades one sentence the learner wrote with one of their words: POST /api/practice/sentence-check */
  @Post('sentence-check')
  @HttpCode(200)
  check(@UserId() user: string, @Body() dto: SentenceCheckDto) {
    return this.svc.check(user, dto);
  }

  /** My mistake notebook: GET /api/practice/mistakes?type= */
  @Get('mistakes')
  mistakes(@UserId() user: string, @Query() q: MistakesQuery) {
    return this.svc.mistakes(user, q);
  }

  /** Questions made from my mistakes: GET /api/practice/mistakes/drill?type=&n= */
  @Get('mistakes/drill')
  async drill(@UserId() user: string, @Query() q: DrillQuery) {
    return { items: await this.svc.drill(user, q) };
  }
}
