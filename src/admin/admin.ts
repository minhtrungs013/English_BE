import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsMongoId, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { ConfigService } from '@nestjs/config';
import { Model, type QueryFilter } from 'mongoose';
import { AccessService, AdminGuard } from '../access/access';
import { AuditLog } from '../audit/audit';
import { PlanService } from '../plans/plans';
import { DataModule, DataService } from '../data/data';
import { SentenceAttempt, SentenceAttemptSchema, SentenceSuggestion, SentenceSuggestionSchema } from '../practice/sentence-grade';
import { UserId } from '../auth/auth.decorators';
import { LEVELS, POS_LIST } from '../common/constants';
import { FAMILY_MAX, FamilyMemberDto, cleanFamily } from '../common/family';
import { aiLookup } from '../lookup/ai';
import { todayKey } from '../common/day';
import { Course, CourseSchema, Enrollment, EnrollmentSchema } from '../courses/course.schema';
import { BankItem, BankItemSchema } from '../courses/homework.schema';
import { sentenceKey } from '../courses/sentence-rules';
import { TENSES } from '../courses/tense';
import { LibraryWord, LibraryWordSchema, MeaningSuggestion, MeaningSuggestionSchema, TOPICS } from '../library/library.schema';
import { Profile, ProfileSchema } from '../profile/profile.schema';
import { WordSentence, WordSentenceSchema } from '../sentence-bank/sentence-bank';
import { User, UserSchema } from '../users/user.schema';
import { Word, WordSchema } from '../words/word.schema';

const PAGE = 30;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class PageQuery {
  @IsOptional() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
}
export class SentenceQuery extends PageQuery {
  @IsOptional() @IsIn([...TENSES, 'none']) tense?: string;
}
export class RoleDto {
  @IsIn(['user', 'admin']) role: 'user' | 'admin';
}
export class SentencePatchDto {
  @IsOptional() @IsString() @MaxLength(300) sentence?: string;
  @IsOptional() @IsIn([...TENSES, '']) tense?: string;
  @IsOptional() @IsString() @MaxLength(80) verb?: string;
  @IsOptional() @IsString() @MaxLength(40) base?: string;
  @IsOptional() @IsString() @MaxLength(20) context?: string;
}
export class LibraryPatchDto {
  @IsOptional() @IsString() @MaxLength(80) word?: string;
  @IsOptional() @IsString() @MaxLength(80) ipa?: string;
  @IsOptional() @IsIn(POS_LIST) pos?: string;
  @IsOptional() @IsString() @MaxLength(300) meaning?: string;
  @IsOptional() @IsString() @MaxLength(300) vi?: string;
  @IsOptional() @IsString() @MaxLength(300) ex?: string;
  @IsOptional() @IsIn(LEVELS) level?: string;
  @IsOptional() @IsIn(TOPICS) topic?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) @MaxLength(60, { each: true }) syn?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) @MaxLength(60, { each: true }) ant?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(FAMILY_MAX) @ValidateNested({ each: true }) @Type(() => FamilyMemberDto) family?: FamilyMemberDto[];
}

/** Fields of a library word that are copied to learners' saved words when an admin changes them. */
const SYNC_FIELDS = ['word', 'ipa', 'pos', 'meaning', 'vi', 'ex', 'syn', 'ant', 'level', 'family'] as const;
/** A field value in a form that compares equal however it was stored (family members without their empty keys). */
const norm = (v: unknown): string => JSON.stringify(Array.isArray(v)
  ? v.map((x) => (x && typeof x === 'object' ? { word: x.word, pos: x.pos, vi: x.vi, ex: x.ex || undefined, note: x.note || undefined } : x))
  : v ?? '');
const blank = (v: unknown) => v == null || v === '' || (Array.isArray(v) && !v.length);
export const AUDIT_ACTIONS = ['chat', 'lookup', 'lookup-family', 'library-regenerate', 'tense-questions', 'dialogue', 'sentence-check', 'homework-sentence', 'recap'] as const;
export class AuditQuery extends PageQuery {
  @IsOptional() @IsIn(AUDIT_ACTIONS) action?: string;
  @IsOptional() @IsIn(['ok', 'failed']) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(90) days?: number;
}
export class PlanDto {
  @IsString() @IsNotEmpty() @MaxLength(40) name: string;
  @IsInt() @Min(0) @Max(10_000) chat: number;
  @IsInt() @Min(0) @Max(10_000) autofill: number;
  @IsInt() @Min(0) @Max(10_000) courseAi: number;
  @IsInt() @Min(0) @Max(10_000) sentence: number;
  @IsInt() @Min(0) @Max(10_000) usage: number;
  @IsInt() @Min(0) @Max(100_000_000) tokens: number;
}
export class PlanPatchDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(40) name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) chat?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) autofill?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) courseAi?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) sentence?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) usage?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) tokens?: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}
export class UserPlanDto {
  /** A plan id, or "" for the default plan. */
  @IsString() @ValidateIf((o: UserPlanDto) => o.plan !== '') @IsMongoId() plan: string;
}
export class InsightQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) days?: number;
}
export class SuggestionApproveDto {
  /** The sentence, when the admin edited it before approving. */
  @IsOptional() @IsString() @MaxLength(300) sentence?: string;
}
export class MeaningApproveDto {
  /** The library word's whole Vietnamese field after approving (the admin may reorder or edit it). */
  @IsString() @IsNotEmpty() @MaxLength(200) vi: string;
}
export class IdParam {
  @IsMongoId() id: string;
}

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(AuditLog.name) private readonly audit: Model<AuditLog>,
    private readonly plans: PlanService,
    private readonly data: DataService,
    @InjectModel(Course.name) private readonly courses: Model<Course>,
    @InjectModel(Enrollment.name) private readonly enrollments: Model<Enrollment>,
    @InjectModel(BankItem.name) private readonly bank: Model<BankItem>,
    @InjectModel(LibraryWord.name) private readonly library: Model<LibraryWord>,
    @InjectModel(WordSentence.name) private readonly sentences: Model<WordSentence>,
    @InjectModel(SentenceSuggestion.name) private readonly suggestions: Model<SentenceSuggestion>,
    @InjectModel(MeaningSuggestion.name) private readonly meanings: Model<MeaningSuggestion>,
    @InjectModel(SentenceAttempt.name) private readonly attempts: Model<SentenceAttempt>,
    @InjectModel(Profile.name) private readonly profiles: Model<Profile>,
    @InjectModel(Word.name) private readonly words: Model<Word>,
    private readonly config: ConfigService,
    private readonly access: AccessService
  ) {}

  async stats() {
    const week = new Date(Date.now() - 7 * 86_400_000);
    const [users, admins, newUsers, activeToday, courses, enrollments, pending, library, sentences, words] = await Promise.all([
      this.users.countDocuments(), this.users.countDocuments({ role: 'admin' }), this.users.countDocuments({ createdAt: { $gte: week } }),
      this.profiles.countDocuments({ 'progress.reviewedDay': todayKey() }),
      this.courses.countDocuments(), this.enrollments.countDocuments(), this.bank.countDocuments({ status: 'pending' }),
      this.library.countDocuments(), this.sentences.countDocuments(), this.words.countDocuments()
    ]);
    return { users, admins, newUsers, activeToday, courses, enrollments, pendingQuestions: pending, libraryWords: library, bankSentences: sentences, savedWords: words };
  }

  async listUsers(q: PageQuery) {
    const filter: QueryFilter<User> = q.q ? { $or: [{ name: { $regex: esc(q.q), $options: 'i' } }, { email: { $regex: esc(q.q), $options: 'i' } }] } : {};
    const page = q.page ?? 1;
    const [total, list] = await Promise.all([this.users.countDocuments(filter), this.users.find(filter, { passwordHash: 0 }).sort({ createdAt: -1 }).skip((page - 1) * PAGE).limit(PAGE).lean()]);
    const ids = list.map((u) => String(u._id));
    const [words, joined] = await Promise.all([
      this.words.aggregate<{ _id: string; n: number }>([{ $match: { user: { $in: ids } } }, { $group: { _id: '$user', n: { $sum: 1 } } }]),
      this.enrollments.aggregate<{ _id: string; n: number }>([{ $match: { user: { $in: ids } } }, { $group: { _id: '$user', n: { $sum: 1 } } }])
    ]);
    const w = new Map(words.map((x) => [x._id, x.n])), j = new Map(joined.map((x) => [x._id, x.n]));
    const tokens = await this.plans.tokensTodayFor(ids);
    return {
      total, page, pages: Math.max(1, Math.ceil(total / PAGE)),
      items: list.map((u) => ({
        id: String(u._id), name: u.name, email: u.email, role: u.role === 'admin' ? 'admin' : 'user',
        createdAt: (u as { createdAt?: Date }).createdAt?.getTime() ?? null, words: w.get(String(u._id)) ?? 0, courses: j.get(String(u._id)) ?? 0,
        plan: u.plan ?? '', tokensToday: tokens.get(String(u._id)) ?? 0
      }))
    };
  }

  /** Deletes a learner's account and everything it owns (same as the learner deleting it). Not your own, and not the last admin. */
  async deleteUser(me: string, id: string) {
    if (id === me) throw new BadRequestException('You can’t delete your own account here. Use Settings instead.');
    const u = await this.users.findById(id, { role: 1 }).lean();
    if (!u) throw new NotFoundException('User not found.');
    if (u.role === 'admin') throw new BadRequestException('Remove the admin role first, then delete the account.');
    await this.data.deleteAccount(id);
  }

  async setRole(me: string, id: string, role: 'user' | 'admin') {
    if (id === me && role !== 'admin') throw new BadRequestException('You can’t remove your own admin role.');
    const u = await this.users.findByIdAndUpdate(id, { $set: { role } }, { new: true, projection: { passwordHash: 0 } });
    if (!u) throw new NotFoundException('User not found.');
    this.access.forget(id);
    return { id, role };
  }

  async listCourses() {
    const list = await this.courses.find({}, { title: 1, ownerName: 1, visibility: 1, totalDays: 1, days: 1, joinCode: 1, createdAt: 1 }).sort({ createdAt: -1 }).lean();
    const ids = list.map((c) => String(c._id));
    const [members, pending] = await Promise.all([
      this.enrollments.aggregate<{ _id: string; n: number }>([{ $match: { courseId: { $in: ids } } }, { $group: { _id: '$courseId', n: { $sum: 1 } } }]),
      this.bank.aggregate<{ _id: string; n: number }>([{ $match: { courseId: { $in: ids }, status: 'pending' } }, { $group: { _id: '$courseId', n: { $sum: 1 } } }])
    ]);
    const m = new Map(members.map((x) => [x._id, x.n])), p = new Map(pending.map((x) => [x._id, x.n]));
    return list.map((c) => ({
      id: String(c._id), title: c.title, ownerName: c.ownerName, visibility: c.visibility, joinCode: c.joinCode, totalDays: c.totalDays,
      readyDays: (c.days ?? []).filter((d) => d.words?.length).length, members: m.get(String(c._id)) ?? 0, pending: p.get(String(c._id)) ?? 0,
      createdAt: (c as { createdAt?: Date }).createdAt?.getTime() ?? null
    }));
  }

  async listSentences(q: SentenceQuery) {
    const filter: QueryFilter<WordSentence> = {};
    if (q.q) filter.$or = [{ word: { $regex: '^' + esc(q.q), $options: 'i' } }, { sentence: { $regex: esc(q.q), $options: 'i' } }];
    if (q.tense) filter.tense = q.tense === 'none' ? '' : q.tense;
    const page = q.page ?? 1;
    const [total, list] = await Promise.all([this.sentences.countDocuments(filter), this.sentences.find(filter).sort({ word: 1 }).skip((page - 1) * PAGE).limit(PAGE).lean()]);
    return { total, page, pages: Math.max(1, Math.ceil(total / PAGE)), items: list.map(({ _id, key: _k, ...s }) => ({ id: String(_id), ...s })) };
  }

  async patchSentence(id: string, dto: SentencePatchDto) {
    const s = await this.sentences.findById(id);
    if (!s) throw new NotFoundException('Sentence not found.');
    const next = { sentence: dto.sentence?.replace(/\s+/g, ' ').trim() ?? s.sentence, verb: dto.verb?.trim() ?? s.verb };
    if (next.verb && !next.sentence.includes(next.verb)) throw new BadRequestException('The verb phrase must appear in the sentence exactly.');
    Object.assign(s, { ...dto, ...next, key: sentenceKey(next.sentence) });
    await s.save().catch((e: { code?: number }) => { throw e?.code === 11000 ? new BadRequestException('This sentence is already in the bank.') : e; });
    const { _id, key: _k, ...rest } = s.toObject();
    return { id: String(_id), ...rest };
  }

  /** AI example sentences from Write a sentence, waiting to be added to the bank. */
  async listSuggestions(q: PageQuery) {
    const filter: QueryFilter<SentenceSuggestion> = { status: 'pending' };
    if (q.q) filter.$or = [{ word: { $regex: '^' + esc(q.q), $options: 'i' } }, { sentence: { $regex: esc(q.q), $options: 'i' } }];
    const page = q.page ?? 1;
    const [total, list] = await Promise.all([this.suggestions.countDocuments(filter), this.suggestions.find(filter).sort({ at: -1 }).skip((page - 1) * PAGE).limit(PAGE).lean()]);
    return { total, page, pages: Math.max(1, Math.ceil(total / PAGE)), items: list.map((x) => ({ id: String(x._id), word: x.word, sentence: x.sentence, vi: x.vi, at: x.at.getTime() })) };
  }

  /** Adds the suggestion to the sentence bank (the admin can then set its tense in the Sentence bank tab). */
  async approveSuggestion(id: string, sentence?: string) {
    const x = await this.suggestions.findById(id);
    if (!x || x.status !== 'pending') throw new NotFoundException('Suggestion not found.');
    const text = (sentence ?? x.sentence).replace(/\s+/g, ' ').trim();
    if (!text) throw new BadRequestException('The sentence is empty.');
    const lib = await this.library.findById(x.libraryWordId).lean();
    if (!lib) { x.status = 'rejected'; await x.save(); throw new NotFoundException('That library word no longer exists.'); }
    const key = sentenceKey(text);
    if (!(await this.sentences.exists({ key }))) {
      await this.sentences.create({ wordId: String(lib._id), word: lib.word, sentence: text, key, level: lib.level, topic: lib.topic, source: 'ai' });
    }
    x.status = 'approved';
    await x.save();
  }

  async rejectSuggestion(id: string) {
    const r = await this.suggestions.updateOne({ _id: id, status: 'pending' }, { $set: { status: 'rejected' } });
    if (!r.matchedCount) throw new NotFoundException('Suggestion not found.');
  }

  /** Vietnamese meanings learners suggested for library words, with the word's current meanings. */
  async listMeanings(q: PageQuery) {
    const filter: QueryFilter<MeaningSuggestion> = { status: 'pending' };
    if (q.q) filter.word = { $regex: '^' + esc(q.q), $options: 'i' };
    const page = q.page ?? 1;
    const [total, list] = await Promise.all([this.meanings.countDocuments(filter), this.meanings.find(filter).sort({ at: -1 }).skip((page - 1) * PAGE).limit(PAGE).lean()]);
    const libs = await this.library.find({ _id: { $in: list.map((x) => x.libraryWordId) } }, { vi: 1, meaning: 1 }).lean();
    const byId = new Map(libs.map((l) => [String(l._id), l]));
    return {
      total, page, pages: Math.max(1, Math.ceil(total / PAGE)),
      items: list.map((x) => ({ id: String(x._id), libraryWordId: x.libraryWordId, word: x.word, vi: x.vi, current: byId.get(x.libraryWordId)?.vi ?? '', meaning: byId.get(x.libraryWordId)?.meaning ?? '', by: x.userName, at: x.at.getTime() }))
    };
  }

  /** Saves the library word's Vietnamese field (with the new meaning, as the admin arranged it). */
  async approveMeaning(id: string, vi: string) {
    const x = await this.meanings.findById(id);
    if (!x || x.status !== 'pending') throw new NotFoundException('Suggestion not found.');
    const r = await this.library.updateOne({ _id: x.libraryWordId }, { $set: { vi: vi.replace(/\s+/g, ' ').trim() } });
    const lib = r.matchedCount ? await this.library.findById(x.libraryWordId, { wordLower: 1, pos: 1, vi: 1 }).lean() : null;
    if (lib) await this.staleUsage(lib.wordLower, lib.pos, lib.vi);
    x.status = r.matchedCount ? 'approved' : 'rejected';
    await x.save();
    if (!r.matchedCount) throw new NotFoundException('That library word no longer exists.');
  }

  async rejectMeaning(id: string) {
    const r = await this.meanings.updateOne({ _id: id, status: 'pending' }, { $set: { status: 'rejected' } });
    if (!r.matchedCount) throw new NotFoundException('Suggestion not found.');
  }

  /** What learners get wrong in Write a sentence and homework: mistakes by kind, hardest words, scores. */
  async insights(q: InsightQuery) {
    const since = new Date(Date.now() - (q.days ?? 30) * 86400_000);
    const match = { at: { $gte: since } };
    const [totals, byType, hardWords, bySource, pending] = await Promise.all([
      this.attempts.aggregate<{ attempts: number; users: string[]; avg: number; withMistakes: number }>([
        { $match: match },
        { $group: { _id: null, attempts: { $sum: 1 }, users: { $addToSet: '$user' }, avg: { $avg: '$score' }, withMistakes: { $sum: { $cond: [{ $gt: [{ $size: '$mistakes' }, 0] }, 1, 0] } } } }
      ]),
      this.attempts.aggregate<{ _id: string; count: number; users: string[] }>([
        { $match: match }, { $unwind: '$mistakes' },
        { $group: { _id: '$mistakes.type', count: { $sum: 1 }, users: { $addToSet: '$user' } } }, { $sort: { count: -1 } }
      ]),
      this.attempts.aggregate<{ _id: string; attempts: number; avg: number; mistakes: number }>([
        { $match: match },
        { $group: { _id: { $toLower: '$word' }, attempts: { $sum: 1 }, avg: { $avg: '$score' }, mistakes: { $sum: { $size: '$mistakes' } } } },
        { $match: { attempts: { $gte: 2 } } }, { $sort: { avg: 1, attempts: -1 } }, { $limit: 15 }
      ]),
      this.attempts.aggregate<{ _id: string; n: number }>([{ $match: match }, { $group: { _id: '$source', n: { $sum: 1 } } }]),
      this.suggestions.countDocuments({ status: 'pending' })
    ]);
    const t = totals[0];
    return {
      attempts: t?.attempts ?? 0, users: t?.users.length ?? 0, avg: t ? Math.round(t.avg * 10) / 10 : null, withMistakes: t?.withMistakes ?? 0,
      practice: bySource.find((x) => x._id === 'practice' || !x._id)?.n ?? 0, homework: bySource.find((x) => x._id === 'homework')?.n ?? 0,
      byType: byType.map((x) => ({ type: x._id, count: x.count, users: x.users.length })),
      hardWords: hardWords.map((x) => ({ word: x._id, attempts: x.attempts, avg: Math.round(x.avg * 10) / 10, mistakes: x.mistakes })),
      pendingSuggestions: pending
    };
  }

  async deleteSentence(id: string) {
    const r = await this.sentences.deleteOne({ _id: id });
    if (!r.deletedCount) throw new NotFoundException('Sentence not found.');
  }

  async listLibrary(q: PageQuery) {
    const filter: QueryFilter<LibraryWord> = q.q ? { $or: [{ wordLower: { $regex: '^' + esc(q.q.toLowerCase()) } }, { vi: { $regex: esc(q.q), $options: 'i' } }] } : {};
    const page = q.page ?? 1;
    const [total, list] = await Promise.all([this.library.countDocuments(filter), this.library.find(filter, { family: 0 }).sort({ wordLower: 1 }).skip((page - 1) * PAGE).limit(PAGE).lean()]);
    return {
      total, page, pages: Math.max(1, Math.ceil(total / PAGE)),
      items: list.map((w) => ({ id: String(w._id), word: w.word, ipa: w.ipa, pos: w.pos, meaning: w.meaning, vi: w.vi, ex: w.ex, level: w.level, topic: w.topic, authorName: w.authorName, saves: w.saves }))
    };
  }

  /** The word's "How to use" was written for another meaning: write it again on its next open. */
  private async staleUsage(key: string, pos: string, vi: string) {
    await this.library.db.collection('word_usages').updateOne(
      { key, status: { $ne: 'stale' }, $or: [{ 'basedOn.pos': { $ne: pos } }, { 'basedOn.vi': { $ne: vi } }] },
      { $set: { status: 'stale' } }
    ).catch(() => undefined);
  }

  async patchLibrary(id: string, dto: LibraryPatchDto) {
    const before = await this.library.findById(id).lean();
    if (!before) throw new NotFoundException('Word not found.');
    const set: Record<string, unknown> = { ...dto };
    if (dto.word) { set.word = dto.word.trim(); set.wordLower = dto.word.trim().toLowerCase(); }
    if (dto.syn) set.syn = dto.syn.map((x) => x.trim()).filter(Boolean);
    if (dto.ant) set.ant = dto.ant.map((x) => x.trim()).filter(Boolean);
    if (dto.family) set.family = cleanFamily(dto.family);
    const w = await this.library.findByIdAndUpdate(id, { $set: set }, { new: true }).lean()
      .catch((e: { code?: number }) => { throw e?.code === 11000 ? new BadRequestException('Another library word is already spelled like this.') : e; });
    if (!w) throw new NotFoundException('Word not found.');
    await this.staleUsage(w.wordLower, w.pos, w.vi);
    const synced = await this.syncSavedWords(before, w);
    return { ...this.libRow(w), syn: w.syn, ant: w.ant, family: w.family ?? [], synced };
  }

  private libRow(w: LibraryWord & { _id: unknown }) {
    return { id: String(w._id), word: w.word, ipa: w.ipa, pos: w.pos, meaning: w.meaning, vi: w.vi, ex: w.ex, level: w.level, topic: w.topic, authorName: w.authorName, saves: w.saves };
  }

  /**
   * Copies a library word's changes to learners' saved copies of it. A field is copied only when the learner
   * left it as the library had it (or empty), so their own edits stay. Returns how many saved words changed.
   */
  private async syncSavedWords(before: LibraryWord, after: LibraryWord): Promise<number> {
    const changed = SYNC_FIELDS.filter((k) => norm(before[k]) !== norm(after[k]));
    if (!changed.length) return 0;
    const saved = await this.words.find({ wordLower: before.wordLower }, Object.fromEntries(changed.map((k) => [k, 1]))).lean();
    const ops = [];
    for (const uw of saved) {
      const set: Partial<Word> = {};
      for (const k of changed) if (blank(uw[k]) || norm(uw[k]) === norm(before[k])) (set as Record<string, unknown>)[k] = after[k];
      if (set.word) set.wordLower = after.wordLower;
      if (Object.keys(set).length) ops.push({ updateOne: { filter: { _id: uw._id }, update: { $set: set } } });
    }
    if (!ops.length) return 0;
    // A learner who already has a word spelled like a renamed one keeps both as they were.
    const res = await this.words.bulkWrite(ops, { ordered: false }).catch((e: { result?: { modifiedCount?: number } }) => e.result ?? null);
    return res?.modifiedCount ?? 0;
  }

  /** AI writes the library word again, as for a new word. Nothing is saved: the admin picks what to keep. */
  async regenerateLibrary(id: string) {
    const w = await this.library.findById(id).lean();
    if (!w) throw new NotFoundException('Word not found.');
    const key = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!key) throw new BadRequestException('AI isn’t set up on the server (ANTHROPIC_API_KEY).');
    const ai = await aiLookup(w.word, key, this.config.get<string>('ANTHROPIC_MODEL', 'claude-haiku-4-5'), 'library-regenerate');
    if (!ai) throw new BadRequestException('AI gave no result for “' + w.word + '”. Please try again.');
    const pick = (x: { ipa: string; pos: string; meaning: string; vi: string; ex: string; syn: string[]; ant: string[]; level: string; topic: string; family?: unknown[] }) =>
      ({ ipa: x.ipa, pos: x.pos, meaning: x.meaning, vi: x.vi, ex: x.ex, syn: x.syn ?? [], ant: x.ant ?? [], level: x.level, topic: x.topic, family: x.family ?? [] });
    return { word: w.word, current: pick(w), proposal: pick(ai) };
  }

  /**
   * AI calls, newest first, with a summary of the same filter: calls, failures, tokens, average time, per action.
   * `q` matches the user's email, the route or the detail (e.g. the looked-up word).
   */
  async listAudit(q: AuditQuery) {
    const since = new Date(Date.now() - (q.days ?? 7) * 86400_000);
    const filter: QueryFilter<AuditLog> = { at: { $gte: since } };
    if (q.action) filter.action = q.action;
    if (q.status) filter.ok = q.status === 'ok';
    if (q.q) { const r = { $regex: esc(q.q), $options: 'i' }; filter.$or = [{ email: r }, { detail: r }, { route: r }]; }
    const page = q.page ?? 1;
    const [total, list, sum, byAction] = await Promise.all([
      this.audit.countDocuments(filter),
      this.audit.find(filter).sort({ at: -1 }).skip((page - 1) * PAGE).limit(PAGE).lean(),
      this.audit.aggregate<{ calls: number; failed: number; inTokens: number; outTokens: number; ms: number; users: string[] }>([
        { $match: filter },
        { $group: { _id: null, calls: { $sum: 1 }, failed: { $sum: { $cond: ['$ok', 0, 1] } }, inTokens: { $sum: '$inTokens' }, outTokens: { $sum: '$outTokens' }, ms: { $avg: '$ms' }, users: { $addToSet: '$userId' } } }
      ]),
      this.audit.aggregate<{ _id: string; calls: number; failed: number; tokens: number }>([
        { $match: filter },
        { $group: { _id: '$action', calls: { $sum: 1 }, failed: { $sum: { $cond: ['$ok', 0, 1] } }, tokens: { $sum: { $add: ['$inTokens', '$outTokens'] } } } },
        { $sort: { calls: -1 } }
      ])
    ]);
    const t = sum[0];
    return {
      total, page, pages: Math.max(1, Math.ceil(total / PAGE)),
      summary: {
        calls: t?.calls ?? 0, failed: t?.failed ?? 0, inTokens: t?.inTokens ?? 0, outTokens: t?.outTokens ?? 0,
        avgMs: Math.round(t?.ms ?? 0), users: (t?.users ?? []).filter(Boolean).length,
        byAction: byAction.map((a) => ({ action: a._id, calls: a.calls, failed: a.failed, tokens: a.tokens }))
      },
      items: list.map((e) => ({
        id: String(e._id), at: e.at.getTime(), action: e.action, email: e.email, route: e.route, model: e.model, ok: e.ok, status: e.status,
        ms: e.ms, inTokens: e.inTokens, outTokens: e.outTokens, detail: e.detail, error: e.error
      }))
    };
  }

  async deleteLibrary(id: string) {
    const r = await this.library.deleteOne({ _id: id });
    if (!r.deletedCount) throw new NotFoundException('Word not found.');
    await this.sentences.deleteMany({ wordId: id });
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService, private readonly plans: PlanService) {}

  @Get('stats') stats() { return this.admin.stats(); }
  @Get('audit') audit(@Query() q: AuditQuery) { return this.admin.listAudit(q); }
  @Get('plans') listPlans() { return this.plans.list(); }
  @Post('plans') createPlan(@Body() dto: PlanDto) { return this.plans.create(dto); }
  @Patch('plans/:id') patchPlan(@Param() p: IdParam, @Body() dto: PlanPatchDto) { return this.plans.update(p.id, dto); }
  @Delete('plans/:id') deletePlan(@Param() p: IdParam) { return this.plans.remove(p.id); }
  @Delete('users/:id') @HttpCode(204) async deleteUser(@UserId() me: string, @Param() p: IdParam) { await this.admin.deleteUser(me, p.id); }
  @Patch('users/:id/plan') @HttpCode(204) async setUserPlan(@Param() p: IdParam, @Body() dto: UserPlanDto) { await this.plans.setUserPlan(p.id, dto.plan); }
  @Get('users') users(@Query() q: PageQuery) { return this.admin.listUsers(q); }
  @Patch('users/:id') setRole(@UserId() me: string, @Param() p: IdParam, @Body() dto: RoleDto) { return this.admin.setRole(me, p.id, dto.role); }
  @Get('courses') courses() { return this.admin.listCourses(); }
  @Get('sentences') sentences(@Query() q: SentenceQuery) { return this.admin.listSentences(q); }
  @Patch('sentences/:id') patchSentence(@Param() p: IdParam, @Body() dto: SentencePatchDto) { return this.admin.patchSentence(p.id, dto); }
  @Delete('sentences/:id') @HttpCode(204) async deleteSentence(@Param() p: IdParam) { await this.admin.deleteSentence(p.id); }
  @Get('suggestions') suggestions(@Query() q: PageQuery) { return this.admin.listSuggestions(q); }
  @Post('suggestions/:id/approve') @HttpCode(204) async approve(@Param() p: IdParam, @Body() dto: SuggestionApproveDto) { await this.admin.approveSuggestion(p.id, dto.sentence); }
  @Post('suggestions/:id/reject') @HttpCode(204) async reject(@Param() p: IdParam) { await this.admin.rejectSuggestion(p.id); }
  @Get('meanings') meanings(@Query() q: PageQuery) { return this.admin.listMeanings(q); }
  @Post('meanings/:id/approve') @HttpCode(204) async approveMeaning(@Param() p: IdParam, @Body() dto: MeaningApproveDto) { await this.admin.approveMeaning(p.id, dto.vi); }
  @Post('meanings/:id/reject') @HttpCode(204) async rejectMeaning(@Param() p: IdParam) { await this.admin.rejectMeaning(p.id); }
  @Get('insights') insights(@Query() q: InsightQuery) { return this.admin.insights(q); }
  @Get('library') library(@Query() q: PageQuery) { return this.admin.listLibrary(q); }
  @Post('library/:id/regenerate') regenerateLibrary(@Param() p: IdParam) { return this.admin.regenerateLibrary(p.id); }
  @Patch('library/:id') patchLibrary(@Param() p: IdParam, @Body() dto: LibraryPatchDto) { return this.admin.patchLibrary(p.id, dto); }
  @Delete('library/:id') @HttpCode(204) async deleteLibrary(@Param() p: IdParam) { await this.admin.deleteLibrary(p.id); }
}

@Module({
  imports: [
    DataModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema }, { name: Course.name, schema: CourseSchema }, { name: Enrollment.name, schema: EnrollmentSchema },
      { name: BankItem.name, schema: BankItemSchema }, { name: LibraryWord.name, schema: LibraryWordSchema }, { name: WordSentence.name, schema: WordSentenceSchema },
      { name: SentenceSuggestion.name, schema: SentenceSuggestionSchema }, { name: MeaningSuggestion.name, schema: MeaningSuggestionSchema }, { name: SentenceAttempt.name, schema: SentenceAttemptSchema },
      { name: Profile.name, schema: ProfileSchema }, { name: Word.name, schema: WordSchema }
    ])
  ],
  controllers: [AdminController],
  providers: [AdminService]
})
export class AdminModule {}
