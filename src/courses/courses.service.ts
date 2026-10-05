import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomInt } from 'crypto';
import { Model } from 'mongoose';
import { todayKey } from '../common/day';
import type { Topic } from '../library/library.schema';
import { LibraryService } from '../library/library.service';
import { LookupService } from '../lookup/lookup';
import { ProfileService } from '../profile/profile.service';
import { Tag, normalizeTag } from '../tags/tags';
import { User } from '../users/user.schema';
import { WordsService } from '../words/words.service';
import { Course, CourseDocument, CourseWord, Enrollment, EnrollmentDocument, TOTAL_DAYS, currentDay } from './course.schema';
import { CourseWordDto, CreateCourseDto, UpdateCourseDto } from './courses.dto';
import { HomeworkService } from './homework.service';
import { QuestionsService } from './questions.service';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I, easy to read out

@Injectable()
export class CoursesService {
  constructor(
    @InjectModel(Course.name) private readonly courses: Model<Course>,
    @InjectModel(Enrollment.name) private readonly enrollments: Model<Enrollment>,
    @InjectModel(Tag.name) private readonly tags: Model<Tag>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly words: WordsService,
    private readonly library: LibraryService,
    private readonly lookup: LookupService,
    private readonly profile: ProfileService,
    private readonly homework: HomeworkService,
    private readonly questions: QuestionsService
  ) {}

  /* ---------- views ---------- */

  private async memberCounts(ids: string[]): Promise<Record<string, number>> {
    if (!ids.length) return {};
    const rows = await this.enrollments.aggregate<{ _id: string; n: number }>([{ $match: { courseId: { $in: ids } } }, { $group: { _id: '$courseId', n: { $sum: 1 } } }]);
    return Object.fromEntries(rows.map((r) => [r._id, r.n]));
  }

  private enrollmentView(e: EnrollmentDocument | null, c: CourseDocument) {
    if (!e) return null;
    return { startDay: e.startDay, currentDay: currentDay(e, c.totalDays), learned: e.learned.map((l) => l.day).sort((a, b) => a - b) };
  }

  /** Card data for course lists. */
  private summary(c: CourseDocument, user: string, members: number, e: EnrollmentDocument | null) {
    const isOwner = c.ownerId === user;
    return {
      id: String(c._id), title: c.title, description: c.description, ownerId: c.ownerId, ownerName: c.ownerName, isOwner,
      visibility: c.visibility, wordsPerDay: c.wordsPerDay, totalDays: c.totalDays, tag: c.tag,
      readyDays: c.days.filter((d) => d.words.length > 0).length, members,
      ...(isOwner ? { joinCode: c.joinCode } : {}),
      enrollment: this.enrollmentView(e, c)
    };
  }

  /**
   * Full course. The owner sees every day's words; a learner sees the words of the days that are open
   * for them (future days show only how many words they have).
   */
  private detail(
    c: CourseDocument, user: string, members: number, e: EnrollmentDocument | null,
    scores = new Map<number, number>(), bank?: Map<number, { pending: number; approved: number }>
  ) {
    const base = this.summary(c, user, members, e);
    const open = base.isOwner ? c.totalDays : e ? currentDay(e, c.totalDays) : 0;
    // Plain objects (spreading Mongoose subdocuments doesn't copy their fields).
    const byDay = new Map(c.toObject().days.map((d) => [d.day, d.words]));
    const days = Array.from({ length: c.totalDays }, (_, i) => {
      const n = i + 1;
      const words = byDay.get(n) ?? [];
      return {
        day: n, count: words.length, words: n <= open ? words : null, myScore: scores.get(n) ?? null,
        // Owner only: tense questions / recap waiting for approval and approved.
        ...(bank ? { bank: bank.get(n) ?? { pending: 0, approved: 0 } } : {})
      };
    });
    return { ...base, days };
  }

  /* ---------- access ---------- */

  private async load(id: string): Promise<CourseDocument> {
    const c = await this.courses.findById(id);
    if (!c) throw new NotFoundException('Course not found.');
    return c;
  }

  private async loadOwned(user: string, id: string): Promise<CourseDocument> {
    const c = await this.load(id);
    if (c.ownerId !== user) throw new ForbiddenException('Only the course owner can change it.');
    return c;
  }

  /* ---------- lists ---------- */

  async list(user: string, scope = 'joined') {
    let list: CourseDocument[];
    const mine = await this.enrollments.find({ user });
    const myEnrollment = new Map(mine.map((e) => [e.courseId, e]));
    if (scope === 'mine') list = await this.courses.find({ ownerId: user }).sort({ createdAt: -1 });
    else if (scope === 'public') list = await this.courses.find({ visibility: 'public' }).sort({ createdAt: -1 }).limit(100);
    else list = await this.courses.find({ _id: { $in: mine.map((e) => e.courseId) } }).sort({ updatedAt: -1 });
    const counts = await this.memberCounts(list.map((c) => String(c._id)));
    return list.map((c) => this.summary(c, user, counts[String(c._id)] ?? 0, myEnrollment.get(String(c._id)) ?? null));
  }

  async get(user: string, id: string) {
    const c = await this.load(id);
    const e = await this.enrollments.findOne({ user, courseId: id });
    // Private courses are only visible to their owner and learners who joined with the code.
    if (c.visibility !== 'public' && c.ownerId !== user && !e) throw new NotFoundException('Course not found.');
    const counts = await this.memberCounts([id]);
    return this.detail(c, user, counts[id] ?? 0, e, e ? await this.homework.myScores(user, id) : undefined, c.ownerId === user ? await this.questions.counts(id) : undefined);
  }

  /* ---------- owner: create & edit ---------- */

  private async newCode(): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const code = Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
      if (!(await this.courses.exists({ joinCode: code }))) return code;
    }
    throw new ConflictException('Could not create a join code, please try again.');
  }

  async create(user: string, dto: CreateCourseDto) {
    const u = await this.users.findById(user);
    const slug = normalizeTag(dto.title).replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
    const c = await this.courses.create({
      ownerId: user, ownerName: u?.name ?? '', title: dto.title, description: dto.description?.trim() ?? '',
      wordsPerDay: dto.wordsPerDay ?? 5, totalDays: TOTAL_DAYS, visibility: dto.visibility ?? 'private',
      joinCode: await this.newCode(), tag: 'course-' + (slug || 'words'), days: []
    });
    return this.detail(c, user, 0, null);
  }

  async update(user: string, id: string, dto: UpdateCourseDto) {
    const c = await this.loadOwned(user, id);
    if (dto.title !== undefined) c.title = dto.title;
    if (dto.description !== undefined) c.description = dto.description.trim();
    if (dto.visibility !== undefined) c.visibility = dto.visibility;
    if (dto.wordsPerDay !== undefined) {
      const most = Math.max(0, ...c.days.map((d) => d.words.length));
      if (dto.wordsPerDay < most) throw new BadRequestException('Some days already have ' + most + ' words. Remove words first, or choose at least ' + most + '.');
      c.wordsPerDay = dto.wordsPerDay;
    }
    await c.save();
    return this.get(user, id);
  }

  async remove(user: string, id: string): Promise<void> {
    await this.loadOwned(user, id);
    await Promise.all([this.courses.deleteOne({ _id: id }), this.enrollments.deleteMany({ courseId: id }), this.homework.removeCourse(id), this.questions.removeCourses([id])]);
  }

  /** Replaces the words of one day. */
  async setDay(user: string, id: string, day: number, words: CourseWordDto[]) {
    const c = await this.loadOwned(user, id);
    if (!Number.isInteger(day) || day < 1 || day > c.totalDays) throw new BadRequestException('Day must be between 1 and ' + c.totalDays + '.');
    if (words.length > c.wordsPerDay) throw new BadRequestException('This course has ' + c.wordsPerDay + ' words per day.');
    const seen = new Set<string>();
    const clean: CourseWord[] = [];
    for (const w of words) {
      const key = w.word.trim().toLowerCase();
      if (seen.has(key)) throw new BadRequestException('“' + w.word + '” is in this day twice.');
      seen.add(key);
      clean.push({
        word: w.word.trim(), ipa: w.ipa ?? '', pos: w.pos ?? 'Noun', meaning: w.meaning ?? '', vi: w.vi ?? '', ex: w.ex ?? '',
        syn: w.syn ?? [], ant: w.ant ?? [], level: w.level ?? 'B1', libraryId: w.libraryId ?? '', source: w.source ?? 'manual'
      });
    }
    const others = c.days.filter((d) => d.day !== day);
    c.days = (clean.length ? [...others, { day, words: clean }] : others).sort((a, b) => a.day - b.day);
    await c.save();
    return this.get(user, id);
  }

  /**
   * Details for a word to put in a course: the library's entry when there is one (free);
   * otherwise AI (or the free dictionaries), limited per user per day.
   */
  async aiWord(user: string, raw: string) {
    const word = raw.trim();
    const lib = await this.library.findByWord(word.toLowerCase());
    if (lib) {
      return {
        source: 'library' as const, quota: await this.profile.dailyStatus(user, 'courseAi'),
        word: { word: lib.word, ipa: lib.ipa, pos: lib.pos, meaning: lib.meaning, vi: lib.vi, ex: lib.ex, syn: lib.syn, ant: lib.ant, level: lib.level, libraryId: String(lib._id), source: 'library' }
      };
    }
    if (!(await this.profile.useDaily(user, 'courseAi'))) {
      const { limit } = await this.profile.dailyStatus(user, 'courseAi');
      throw new HttpException({ statusCode: 429, error: 'Daily limit reached', message: 'You’ve generated ' + limit + ' words with AI today. Add the rest by hand, or try again tomorrow.' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const r = await this.lookup.external(word);
    const quota = await this.profile.dailyStatus(user, 'courseAi');
    if (!r) throw new NotFoundException({ statusCode: 404, error: 'Not Found', message: 'No details found for “' + word + '”.', quota });
    return {
      source: r.source === 'ai' ? ('ai' as const) : ('online' as const), quota,
      word: { word, ipa: r.ipa ?? '', pos: r.pos ?? 'Noun', meaning: r.meaning ?? '', vi: r.vi ?? '', ex: r.ex ?? '', syn: r.syn ?? [], ant: r.ant ?? [], level: r.level ?? 'B1', libraryId: '', source: 'ai' }
    };
  }

  /** Adds one of the course's own words to the shared library (the owner chooses to). */
  async shareWord(user: string, id: string, day: number, index: number, topic: Topic = 'other') {
    const c = await this.loadOwned(user, id);
    const d = c.days.find((x) => x.day === day);
    const w = d?.words[index];
    if (!d || !w) throw new NotFoundException('Word not found in this day.');
    if (!w.libraryId) {
      const existing = await this.library.findByWord(w.word.toLowerCase());
      w.libraryId = String((existing ?? (await this.library.shareData(user, w, topic)))._id);
      c.markModified('days');
      await c.save();
    }
    return this.get(user, id);
  }

  /* ---------- learners ---------- */

  async join(user: string, id: string, code?: string) {
    const c = await this.load(id);
    const ok = c.visibility === 'public' || c.ownerId === user || (!!code && code.toUpperCase() === c.joinCode);
    if (!ok) throw new NotFoundException('Course not found.');
    await this.enrollments.updateOne({ user, courseId: id }, { $setOnInsert: { user, courseId: id, startDay: todayKey(), learned: [] } }, { upsert: true });
    return this.get(user, id);
  }

  async joinByCode(user: string, code: string) {
    const c = await this.courses.findOne({ joinCode: code });
    if (!c) throw new NotFoundException('No course has the code ' + code + '.');
    return this.join(user, String(c._id), code);
  }

  async leave(user: string, id: string): Promise<void> {
    await Promise.all([this.enrollments.deleteOne({ user, courseId: id }), this.homework.removeLearner(user, id)]);
  }

  /**
   * Learns an open day: its words go into My Vocabulary (tagged with the course tag);
   * words already there are kept as they are.
   */
  async learn(user: string, id: string, day: number) {
    const c = await this.load(id);
    const e = await this.enrollments.findOne({ user, courseId: id });
    if (!e) throw new ForbiddenException('Join the course first.');
    if (day < 1 || day > currentDay(e, c.totalDays)) throw new ForbiddenException('Day ' + day + ' isn’t open yet.');
    const words = c.days.find((d) => d.day === day)?.words ?? [];
    if (!words.length) throw new BadRequestException('Day ' + day + ' has no words yet.');
    await this.tags.updateOne({ user, name: c.tag }, { $setOnInsert: { user, name: c.tag } }, { upsert: true });
    const added = [];
    const skipped: string[] = [];
    for (const w of words) {
      if (await this.words.findByWord(user, w.word)) { skipped.push(w.word); continue; }
      const created = await this.words.create(user, { word: w.word, ipa: w.ipa, pos: w.pos, meaning: w.meaning, vi: w.vi, ex: w.ex, syn: w.syn, ant: w.ant, level: w.level, tags: [c.tag] });
      added.push(created.toJSON());
    }
    if (!e.learned.some((l) => l.day === day)) {
      e.learned.push({ day, at: new Date() });
      await e.save();
    }
    return { added, skipped, tag: c.tag, course: await this.get(user, id) };
  }

  /** Account deletion: the user's courses (with everyone's enrollments and homework in them) and the user's own enrollments and homework. */
  async deleteForUser(user: string): Promise<void> {
    const owned = (await this.courses.find({ ownerId: user }, { _id: 1 }).lean()).map((c) => String(c._id));
    await Promise.all([
      this.courses.deleteMany({ ownerId: user }),
      this.enrollments.deleteMany({ $or: [{ user }, { courseId: { $in: owned } }] }),
      this.homework.deleteForUser(user, owned),
      this.questions.removeCourses(owned)
    ]);
  }
}
