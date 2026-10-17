import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsMongoId, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Model, type QueryFilter } from 'mongoose';
import { AccessService, AdminGuard } from '../access/access';
import { UserId } from '../auth/auth.decorators';
import { LEVELS, POS_LIST } from '../common/constants';
import { todayKey } from '../common/day';
import { Course, CourseSchema, Enrollment, EnrollmentSchema } from '../courses/course.schema';
import { BankItem, BankItemSchema } from '../courses/homework.schema';
import { sentenceKey } from '../courses/sentence-rules';
import { TENSES } from '../courses/tense';
import { LibraryWord, LibraryWordSchema, TOPICS } from '../library/library.schema';
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
}
export class IdParam {
  @IsMongoId() id: string;
}

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Course.name) private readonly courses: Model<Course>,
    @InjectModel(Enrollment.name) private readonly enrollments: Model<Enrollment>,
    @InjectModel(BankItem.name) private readonly bank: Model<BankItem>,
    @InjectModel(LibraryWord.name) private readonly library: Model<LibraryWord>,
    @InjectModel(WordSentence.name) private readonly sentences: Model<WordSentence>,
    @InjectModel(Profile.name) private readonly profiles: Model<Profile>,
    @InjectModel(Word.name) private readonly words: Model<Word>,
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
    return {
      total, page, pages: Math.max(1, Math.ceil(total / PAGE)),
      items: list.map((u) => ({
        id: String(u._id), name: u.name, email: u.email, role: u.role === 'admin' ? 'admin' : 'user',
        createdAt: (u as { createdAt?: Date }).createdAt?.getTime() ?? null, words: w.get(String(u._id)) ?? 0, courses: j.get(String(u._id)) ?? 0
      }))
    };
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

  async patchLibrary(id: string, dto: LibraryPatchDto) {
    const set: Record<string, unknown> = { ...dto };
    if (dto.word) { set.word = dto.word.trim(); set.wordLower = dto.word.trim().toLowerCase(); }
    const w = await this.library.findByIdAndUpdate(id, { $set: set }, { new: true }).lean()
      .catch((e: { code?: number }) => { throw e?.code === 11000 ? new BadRequestException('Another library word is already spelled like this.') : e; });
    if (!w) throw new NotFoundException('Word not found.');
    return { id: String(w._id), word: w.word, ipa: w.ipa, pos: w.pos, meaning: w.meaning, vi: w.vi, ex: w.ex, level: w.level, topic: w.topic, authorName: w.authorName, saves: w.saves };
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
  constructor(private readonly admin: AdminService) {}

  @Get('stats') stats() { return this.admin.stats(); }
  @Get('users') users(@Query() q: PageQuery) { return this.admin.listUsers(q); }
  @Patch('users/:id') setRole(@UserId() me: string, @Param() p: IdParam, @Body() dto: RoleDto) { return this.admin.setRole(me, p.id, dto.role); }
  @Get('courses') courses() { return this.admin.listCourses(); }
  @Get('sentences') sentences(@Query() q: SentenceQuery) { return this.admin.listSentences(q); }
  @Patch('sentences/:id') patchSentence(@Param() p: IdParam, @Body() dto: SentencePatchDto) { return this.admin.patchSentence(p.id, dto); }
  @Delete('sentences/:id') @HttpCode(204) async deleteSentence(@Param() p: IdParam) { await this.admin.deleteSentence(p.id); }
  @Get('library') library(@Query() q: PageQuery) { return this.admin.listLibrary(q); }
  @Patch('library/:id') patchLibrary(@Param() p: IdParam, @Body() dto: LibraryPatchDto) { return this.admin.patchLibrary(p.id, dto); }
  @Delete('library/:id') @HttpCode(204) async deleteLibrary(@Param() p: IdParam) { await this.admin.deleteLibrary(p.id); }
}

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema }, { name: Course.name, schema: CourseSchema }, { name: Enrollment.name, schema: EnrollmentSchema },
      { name: BankItem.name, schema: BankItemSchema }, { name: LibraryWord.name, schema: LibraryWordSchema }, { name: WordSentence.name, schema: WordSentenceSchema },
      { name: Profile.name, schema: ProfileSchema }, { name: Word.name, schema: WordSchema }
    ])
  ],
  controllers: [AdminController],
  providers: [AdminService]
})
export class AdminModule {}
