import {
  Body, Controller, Delete, Get, HttpCode, HttpException, HttpStatus, Injectable, Logger, Module, NotFoundException, Param, Patch, Post, Query,
  ServiceUnavailableException, UnprocessableEntityException, UseGuards
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel, MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Model, type QueryFilter } from 'mongoose';
import { AdminGuard } from '../access/access';
import { claudeFetch } from '../audit/claude';
import { UserId } from '../auth/auth.decorators';
import { LibraryWord, LibraryWordSchema } from '../library/library.schema';
import { ProfileModule } from '../profile/profile.module';
import { ProfileService } from '../profile/profile.service';
import { User, UserSchema } from '../users/user.schema';
import { Word, WordSchema } from '../words/word.schema';

/* ---------- data ---------- */

export interface UsagePattern { pattern: string; ex: string; vi: string }
export interface UsageMistake { wrong: string; right: string; why: string }
export interface UsageRelated { word: string; pos: string; vi: string; note: string }

/**
 * How to use a word (structures, collocations, grammar notes, common mistakes, look-alikes), written by AI and shared
 * by everyone: one record per word (key = the word in lowercase), whoever's word book, library entry or course it's in.
 */
@Schema({ collection: 'word_usages', versionKey: false })
export class WordUsage {
  @Prop({ required: true, unique: true }) key: string;
  @Prop({ required: true }) word: string;
  /** The meaning it was written for; when the library's meaning changes, the record goes stale. */
  @Prop({ type: Object, default: () => ({ pos: '', vi: '' }) }) basedOn: { pos: string; vi: string };
  @Prop({ type: [Object], default: [] }) patterns: UsagePattern[];
  @Prop({ type: [String], default: [] }) collocations: string[];
  @Prop({ type: [String], default: [] }) notes: string[];
  @Prop({ type: [Object], default: [] }) mistakes: UsageMistake[];
  @Prop({ type: [Object], default: [] }) related: UsageRelated[];
  /** 'ai' (as written) or 'admin' (edited by an admin). */
  @Prop({ enum: ['ai', 'admin'], default: 'ai' }) source: string;
  /** unreviewed → approved by an admin; stale = the word's meaning changed, written again on the next open. */
  @Prop({ enum: ['unreviewed', 'approved', 'stale'], default: 'unreviewed', index: true }) status: string;
  @Prop({ default: '' }) model: string;
  @Prop({ default: '' }) createdBy: string;
  @Prop({ default: () => new Date() }) createdAt: Date;
  @Prop({ default: () => new Date() }) updatedAt: Date;
  /** Open "this is wrong" reports from learners. */
  @Prop({ default: 0 }) reports: number;
}
export const WordUsageSchema = SchemaFactory.createForClass(WordUsage);

/** A learner's "this usage is wrong" report, for the admins. */
@Schema({ collection: 'usage_reports', versionKey: false })
export class UsageReport {
  @Prop({ required: true, index: true }) key: string;
  @Prop({ required: true }) word: string;
  @Prop({ required: true }) user: string;
  @Prop({ default: '' }) userName: string;
  @Prop({ default: '' }) note: string;
  @Prop({ enum: ['open', 'resolved'], default: 'open', index: true }) status: string;
  @Prop({ default: () => new Date() }) at: Date;
}
export const UsageReportSchema = SchemaFactory.createForClass(UsageReport);

/* ---------- AI ---------- */

const SYSTEM = `You write the "How to use" section of a word in a vocabulary app for Vietnamese office workers and software developers learning professional English.
Return ONLY a JSON object:
- "patterns": 2-4 common structures with the word, the most useful first. Each {"pattern": short pattern like "on a/your device" or "announce sth (to sb)", "ex": one natural workplace / IT example sentence using it, "vi": its Vietnamese translation}
- "collocations": 3-6 frequent word combinations (lowercase), e.g. "make an announcement"
- "notes": 1-3 short grammar or register notes IN VIETNAMESE (countable or not, preposition, formal / informal, which form to use)
- "mistakes": 1-3 mistakes Vietnamese learners really make with this word. Each {"wrong": a wrong sentence, "right": the corrected sentence, "why": short reason IN VIETNAMESE}
- "related": 0-3 easily confused or related words or idioms. Each {"word", "pos" (noun / verb / adjective / adverb / idiom / phrase), "vi": short Vietnamese meaning, "note": short Vietnamese note, at most 60 characters}
Write for the meaning given (the first Vietnamese meaning is the one used at work). When the word has several parts of speech, start each pattern with the part of speech in brackets, e.g. "(verb) release sth". Only standard, common English; never invent rules. If the input is not a real English word or phrase, return {"error":"unknown"}.`;

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Checks and trims what the AI returned; null when nothing usable came back. */
export function cleanUsage(o: Record<string, unknown>): Pick<WordUsage, 'patterns' | 'collocations' | 'notes' | 'mistakes' | 'related'> | null {
  const patterns = arr(o.patterns).slice(0, 4).map((p) => { const x = p as Record<string, unknown>; return { pattern: str(x.pattern, 80), ex: str(x.ex, 220), vi: str(x.vi, 220) }; }).filter((p) => p.pattern && p.ex);
  const collocations = arr(o.collocations).map((c) => str(c, 60)).filter(Boolean).slice(0, 6);
  const notes = arr(o.notes).map((n) => str(n, 200)).filter(Boolean).slice(0, 3);
  const mistakes = arr(o.mistakes).slice(0, 3).map((m) => { const x = m as Record<string, unknown>; return { wrong: str(x.wrong, 200), right: str(x.right, 200), why: str(x.why, 200) }; }).filter((m) => m.wrong && m.right && m.wrong !== m.right);
  const related = arr(o.related).slice(0, 3).map((r) => { const x = r as Record<string, unknown>; return { word: str(x.word, 60), pos: str(x.pos, 20), vi: str(x.vi, 80), note: str(x.note, 80) }; }).filter((r) => r.word);
  if (!patterns.length && !mistakes.length) return null;
  return { patterns, collocations, notes, mistakes, related };
}

async function aiUsage(key: string, model: string, w: { word: string; pos: string; vi: string; meaning: string }) {
  const res = await claudeFetch('usage', key, {
    model, max_tokens: 1400, system: SYSTEM,
    messages: [{ role: 'user', content: 'Word: ' + w.word + (w.pos ? ' (' + w.pos + ')' : '') + (w.vi ? '\nVietnamese: ' + w.vi : '') + (w.meaning ? '\nMeaning: ' + w.meaning : '') }]
  }, { signal: AbortSignal.timeout(30_000), detail: w.word });
  if (!res.ok) throw new Error('status ' + res.status);
  const body = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (body.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  const o = JSON.parse(a >= 0 && b > a ? text.slice(a, b + 1) : '{}') as Record<string, unknown>;
  if (o.error) return null;
  return cleanUsage(o);
}

/* ---------- service ---------- */

export const keyOf = (word: string) => word.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
const PAGE = 30;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class UsageView {
  key: string; word: string; basedOn: { pos: string; vi: string };
  patterns: UsagePattern[]; collocations: string[]; notes: string[]; mistakes: UsageMistake[]; related: UsageRelated[];
  source: string; status: string; reports: number; updatedAt: number;
}
const view = (u: WordUsage): UsageView => ({
  key: u.key, word: u.word, basedOn: u.basedOn, patterns: u.patterns, collocations: u.collocations, notes: u.notes, mistakes: u.mistakes, related: u.related,
  source: u.source, status: u.status, reports: u.reports ?? 0, updatedAt: new Date(u.updatedAt ?? u.createdAt).getTime()
});

@Injectable()
export class UsageService {
  private readonly log = new Logger('Usage');
  /** Words being written right now, so two quick opens don't both call AI. */
  private readonly writing = new Map<string, Promise<WordUsage | null>>();

  constructor(
    @InjectModel(WordUsage.name) private readonly usages: Model<WordUsage>,
    @InjectModel(UsageReport.name) private readonly reports: Model<UsageReport>,
    @InjectModel(Word.name) private readonly words: Model<Word>,
    @InjectModel(LibraryWord.name) private readonly library: Model<LibraryWord>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly profile: ProfileService,
    private readonly config: ConfigService
  ) {}

  private get aiKey() { return this.config.get<string>('ANTHROPIC_API_KEY'); }
  private get model() { return this.config.get<string>('ANTHROPIC_MODEL', 'claude-haiku-4-5'); }

  /** The meaning to write for: the library's (shared), else the user's own word. */
  private async meaningOf(key: string, user?: string) {
    const lib = await this.library.findOne({ wordLower: key }, { word: 1, pos: 1, vi: 1, meaning: 1 }).lean();
    if (lib) return { word: lib.word, pos: lib.pos, vi: lib.vi, meaning: lib.meaning };
    const mine = user ? await this.words.findOne({ user, word: { $regex: '^' + esc(key) + '$', $options: 'i' } }, { word: 1, pos: 1, vi: 1, meaning: 1 }).lean() : null;
    return mine ? { word: mine.word, pos: mine.pos, vi: mine.vi, meaning: mine.meaning } : null;
  }

  /** Writes (or rewrites) the record with AI. Callers count the quota. */
  private async write(key: string, user: string, given?: { word: string; pos: string; vi: string; meaning: string }): Promise<WordUsage | null> {
    const running = this.writing.get(key);
    if (running) return running;
    const job = (async () => {
      const ai = this.aiKey;
      if (!ai) throw new ServiceUnavailableException('AI isn’t set up yet.');
      const m = given ?? (await this.meaningOf(key, user)) ?? { word: key, pos: '', vi: '', meaning: '' };
      const u = await aiUsage(ai, this.model, m);
      if (!u) return null;
      const now = new Date();
      return this.usages.findOneAndUpdate(
        { key },
        { $set: { ...u, word: m.word, basedOn: { pos: m.pos, vi: m.vi }, source: 'ai', status: 'unreviewed', model: this.model, updatedAt: now }, $setOnInsert: { key, createdBy: user, createdAt: now, reports: 0 } },
        { upsert: true, new: true }
      ).lean();
    })().finally(() => this.writing.delete(key));
    this.writing.set(key, job);
    return job;
  }

  /**
   * The word's usage. A missing or stale record is written with AI only when `generate` is set, using one of the
   * user's daily "Usage" allowance (reading an existing one is free).
   */
  async get(user: string, word: string, generate: boolean) {
    const key = keyOf(word);
    if (!key) throw new NotFoundException('No word.');
    const found = await this.usages.findOne({ key }).lean();
    const quota = () => this.profile.dailyStatus(user, 'usage');
    if (found && found.status !== 'stale') return { usage: view(found), quota: await quota() };
    // Being written right now (e.g. the word was just added): wait for it instead of paying again.
    const running = this.writing.get(key);
    if (running && generate) { const u = await running.catch(() => null); if (u) return { usage: view(u), quota: await quota() }; }
    if (!generate) return { usage: found ? view(found) : null, stale: !!found, writing: !!running, ai: !!this.aiKey, quota: await quota() };
    if (!this.aiKey) throw new ServiceUnavailableException('AI isn’t set up yet, so there’s no usage for this word.');
    if (!(await this.profile.useDaily(user, 'usage'))) {
      const { limit } = await quota();
      throw new HttpException({
        statusCode: 429, error: 'Daily limit reached',
        message: limit ? 'You’ve used all ' + limit + ' usage look-ups for today. Words that already have one stay free to read.' : 'Usage look-ups aren’t included in your plan.'
      }, HttpStatus.TOO_MANY_REQUESTS);
    }
    let u: WordUsage | null;
    try {
      u = await this.write(key, user);
    } catch (e) {
      await this.profile.refundDaily(user, 'usage');
      if (e instanceof HttpException) throw e;
      this.log.warn('Usage failed for "' + key + '": ' + String(e));
      throw new UnprocessableEntityException('AI couldn’t write the usage right now. Please try again.');
    }
    if (!u) {
      await this.profile.refundDaily(user, 'usage');
      throw new UnprocessableEntityException('There’s no usage for “' + word.trim() + '” (AI didn’t recognise it).');
    }
    return { usage: view(u), quota: await quota() };
  }

  /**
   * A word was just added to my vocabulary: write its usage in the background when it has none yet and I have
   * allowance left. Never fails the add.
   */
  ensureForNewWord(user: string, w: { word: string; pos: string; vi: string; meaning: string }): void {
    const key = keyOf(w.word);
    if (!key || !this.aiKey) return;
    void (async () => {
      const found = await this.usages.findOne({ key }, { status: 1 }).lean();
      if (found && found.status !== 'stale') return;
      if (!(await this.profile.useDaily(user, 'usage').catch(() => false))) return;
      try {
        // The library's meaning wins (shared); the new word's own meaning otherwise.
        const m = (await this.meaningOf(key)) ?? w;
        if (!(await this.write(key, user, m))) await this.profile.refundDaily(user, 'usage');
      } catch (e) {
        await this.profile.refundDaily(user, 'usage');
        this.log.warn('Background usage failed for "' + key + '": ' + String(e));
      }
    })().catch(() => undefined);
  }

  async report(user: string, word: string, note: string) {
    const key = keyOf(word);
    const u = await this.usages.findOne({ key }, { word: 1 }).lean();
    if (!u) throw new NotFoundException('This word has no usage yet.');
    // One open report per learner and word.
    if (await this.reports.exists({ key, user, status: 'open' })) return { ok: true };
    const name = (await this.users.findById(user, { name: 1 }).lean())?.name ?? '';
    await this.reports.create({ key, word: u.word, user, userName: name, note: note.trim().slice(0, 300) });
    await this.usages.updateOne({ key }, { $inc: { reports: 1 } });
    return { ok: true };
  }

  /* ---------- admin ---------- */

  async adminList(q: { q?: string; status?: string; page?: number }) {
    const filter: QueryFilter<WordUsage> = {};
    if (q.q) filter.key = { $regex: '^' + esc(q.q.toLowerCase()) };
    if (q.status === 'reported') filter.reports = { $gt: 0 };
    else if (q.status) filter.status = q.status;
    const page = q.page ?? 1;
    const [total, list, counts] = await Promise.all([
      this.usages.countDocuments(filter),
      this.usages.find(filter).sort({ reports: -1, updatedAt: -1 }).skip((page - 1) * PAGE).limit(PAGE).lean(),
      this.usages.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }])
    ]);
    const reported = await this.usages.countDocuments({ reports: { $gt: 0 } });
    const reportsOpen = await this.reports.find({ key: { $in: list.map((u) => u.key) }, status: 'open' }).sort({ at: -1 }).lean();
    return {
      total, page, pages: Math.max(1, Math.ceil(total / PAGE)),
      counts: { ...Object.fromEntries(counts.map((c) => [c._id, c.n])), reported },
      items: list.map((u) => ({ ...view(u), openReports: reportsOpen.filter((r) => r.key === u.key).map((r) => ({ id: String(r._id), by: r.userName, note: r.note, at: r.at.getTime() })) }))
    };
  }

  /** The admin's edit: saved as approved, open reports resolved. */
  async adminPatch(key: string, dto: UsagePatchDto) {
    const clean = cleanUsage(dto as unknown as Record<string, unknown>);
    if (!clean) throw new UnprocessableEntityException('Keep at least one pattern or one mistake.');
    const u = await this.usages.findOneAndUpdate({ key }, { $set: { ...clean, source: 'admin', status: 'approved', reports: 0, updatedAt: new Date() } }, { new: true }).lean();
    if (!u) throw new NotFoundException('Usage not found.');
    await this.reports.updateMany({ key, status: 'open' }, { $set: { status: 'resolved' } });
    return view(u);
  }

  async adminApprove(key: string) {
    const u = await this.usages.findOneAndUpdate({ key }, { $set: { status: 'approved', reports: 0, updatedAt: new Date() } }, { new: true }).lean();
    if (!u) throw new NotFoundException('Usage not found.');
    await this.reports.updateMany({ key, status: 'open' }, { $set: { status: 'resolved' } });
    return view(u);
  }

  /** Written again by AI (no learner quota); open reports are resolved. */
  async adminRegenerate(admin: string, key: string) {
    if (!this.aiKey) throw new ServiceUnavailableException('AI isn’t set up yet.');
    const u = await this.write(key, admin).catch((e) => { throw e instanceof HttpException ? e : new UnprocessableEntityException('AI couldn’t write it right now.'); });
    if (!u) throw new UnprocessableEntityException('AI didn’t recognise this word.');
    await this.usages.updateOne({ key }, { $set: { reports: 0 } });
    await this.reports.updateMany({ key, status: 'open' }, { $set: { status: 'resolved' } });
    return view({ ...u, reports: 0 });
  }

  async adminDelete(key: string) {
    const r = await this.usages.deleteOne({ key });
    if (!r.deletedCount) throw new NotFoundException('Usage not found.');
    await this.reports.deleteMany({ key });
  }

  /** Library words without a usage, written in the background, one at a time (no learner quota). */
  async adminGenerateLibrary(admin: string, limit: number) {
    if (!this.aiKey) throw new ServiceUnavailableException('AI isn’t set up yet.');
    const have = new Set((await this.usages.find({}, { key: 1 }).lean()).map((u) => u.key));
    const todo = (await this.library.find({}, { word: 1, wordLower: 1, pos: 1, vi: 1, meaning: 1 }).sort({ saves: -1, sharedAt: 1 }).lean())
      .filter((w) => !have.has(w.wordLower)).slice(0, limit);
    void (async () => {
      for (const w of todo) {
        await this.write(w.wordLower, admin, { word: w.word, pos: w.pos, vi: w.vi, meaning: w.meaning }).catch((e) => this.log.warn('Library usage failed for "' + w.word + '": ' + String(e)));
      }
      this.log.log('Wrote usage for ' + todo.length + ' library words.');
    })();
    return { started: todo.length, remaining: Math.max(0, (await this.library.countDocuments()) - have.size - todo.length) };
  }
}

/* ---------- DTOs ---------- */

export class UsageQuery {
  @IsOptional() @IsIn(['0', '1']) generate?: string;
}
export class UsageReportDto {
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}
export class UsageAdminQuery {
  @IsOptional() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @IsIn(['unreviewed', 'approved', 'stale', 'reported']) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
}
class PatternDto { @IsString() @MaxLength(80) pattern: string; @IsString() @MaxLength(220) ex: string; @IsString() @MaxLength(220) vi: string; }
class MistakeDto { @IsString() @MaxLength(200) wrong: string; @IsString() @MaxLength(200) right: string; @IsString() @MaxLength(200) why: string; }
class RelatedDto { @IsString() @MaxLength(60) word: string; @IsString() @MaxLength(20) pos: string; @IsString() @MaxLength(80) vi: string; @IsString() @MaxLength(80) note: string; }
export class UsagePatchDto {
  @IsArray() @ArrayMaxSize(4) @ValidateNested({ each: true }) @Type(() => PatternDto) patterns: PatternDto[];
  @IsArray() @ArrayMaxSize(6) @IsString({ each: true }) @MaxLength(60, { each: true }) collocations: string[];
  @IsArray() @ArrayMaxSize(3) @IsString({ each: true }) @MaxLength(200, { each: true }) notes: string[];
  @IsArray() @ArrayMaxSize(3) @ValidateNested({ each: true }) @Type(() => MistakeDto) mistakes: MistakeDto[];
  @IsArray() @ArrayMaxSize(3) @ValidateNested({ each: true }) @Type(() => RelatedDto) related: RelatedDto[];
}
export class GenerateLibraryDto {
  @IsOptional() @IsInt() @Min(1) @Max(200) limit?: number;
}

/* ---------- controllers ---------- */

@ApiTags('usage')
@ApiBearerAuth()
@Controller('usage')
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  /** How to use a word: GET /api/usage/:word (?generate=1 writes it with AI when missing, using the daily Usage allowance). */
  @Get(':word')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  get(@UserId() user: string, @Param('word') word: string, @Query() q: UsageQuery) {
    return this.usage.get(user, decodeURIComponent(word).slice(0, 80), q.generate === '1');
  }

  /** "This is wrong": goes to the admins. */
  @Post(':word/report')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  report(@UserId() user: string, @Param('word') word: string, @Body() dto: UsageReportDto) {
    return this.usage.report(user, decodeURIComponent(word).slice(0, 80), dto.note ?? '');
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/usage')
export class UsageAdminController {
  constructor(private readonly usage: UsageService) {}

  @Get() list(@Query() q: UsageAdminQuery) { return this.usage.adminList(q); }
  @Patch(':key') patch(@Param('key') key: string, @Body() dto: UsagePatchDto) { return this.usage.adminPatch(keyOf(decodeURIComponent(key)), dto); }
  @Post(':key/approve') @HttpCode(200) approve(@Param('key') key: string) { return this.usage.adminApprove(keyOf(decodeURIComponent(key))); }
  @Post(':key/regenerate') @HttpCode(200) regenerate(@UserId() me: string, @Param('key') key: string) { return this.usage.adminRegenerate(me, keyOf(decodeURIComponent(key))); }
  @Delete(':key') @HttpCode(204) async remove(@Param('key') key: string) { await this.usage.adminDelete(keyOf(decodeURIComponent(key))); }
  /** Writes the usage of library words that have none (most saved first), in the background. */
  @Post('generate-library') @HttpCode(200) generateLibrary(@UserId() me: string, @Body() dto: GenerateLibraryDto) { return this.usage.adminGenerateLibrary(me, dto.limit ?? 50); }
}

@Module({
  imports: [
    ProfileModule,
    MongooseModule.forFeature([
      { name: WordUsage.name, schema: WordUsageSchema }, { name: UsageReport.name, schema: UsageReportSchema },
      { name: Word.name, schema: WordSchema }, { name: LibraryWord.name, schema: LibraryWordSchema }, { name: User.name, schema: UserSchema }
    ])
  ],
  controllers: [UsageController, UsageAdminController],
  providers: [UsageService],
  exports: [UsageService]
})
export class UsageModule {}
