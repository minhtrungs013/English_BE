import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProfileService } from '../profile/profile.service';
import { Course, CourseDocument } from './course.schema';
import { BankItemDto, GenerateQuestionsDto, UpdateBankItemDto } from './courses.dto';
import { BankItem, BankItemDocument, BankStatus } from './homework.schema';
import { TENSES, TENSE_LABEL, Tense, TenseDraft, aiTenseQuestions, templateQuestions } from './tense';

/** How many earlier words the recap story may use. */
const RECAP_WORDS = 12;

@Injectable()
export class QuestionsService {
  constructor(
    @InjectModel(Course.name) private readonly courses: Model<Course>,
    @InjectModel(BankItem.name) private readonly bank: Model<BankItem>,
    private readonly config: ConfigService,
    private readonly profile: ProfileService
  ) {}

  private async owned(user: string, id: string): Promise<CourseDocument> {
    const c = await this.courses.findById(id);
    if (!c) throw new NotFoundException('Course not found.');
    if (c.ownerId !== user) throw new ForbiddenException('Only the course owner can manage its questions.');
    return c;
  }

  private checkDay(c: CourseDocument, day: number) {
    if (!Number.isInteger(day) || day < 1 || day > c.totalDays) throw new BadRequestException('Day must be between 1 and ' + c.totalDays + '.');
  }

  view(q: BankItemDocument) {
    return {
      id: String(q._id), day: q.day, kind: q.kind, word: q.word, tense: q.tense, tenseLabel: TENSE_LABEL[q.tense as Tense] ?? '',
      prompt: q.prompt, choices: q.choices, answer: q.answer, accept: q.accept, explain: q.explain, source: q.source, status: q.status
    };
  }

  /** Checks a question's shape: one blank, and for multiple choice 4 different choices including the answer. */
  private validate(kind: string, prompt: string, choices: string[], answer: string) {
    if (kind === 'recap') {
      if (!prompt.trim()) throw new BadRequestException('The recap story is empty.');
      return;
    }
    if ((prompt.match(/___/g) ?? []).length !== 1) throw new BadRequestException('The sentence needs exactly one blank (___).');
    if (!answer.trim()) throw new BadRequestException('The answer is empty.');
    if (kind === 'tenseChoice' && (new Set(choices.map((c) => c.trim().toLowerCase())).size !== 4 || !choices.includes(answer))) {
      throw new BadRequestException('Multiple choice needs 4 different choices, one of them the answer.');
    }
  }

  /** The owner's bank: every item, or one day's. */
  async list(user: string, id: string, day?: number) {
    await this.owned(user, id);
    const items = await this.bank.find({ courseId: id, ...(day ? { day } : {}) }).sort({ day: 1, createdAt: 1 });
    return items.map((q) => this.view(q));
  }

  /** Per-day counts for the owner's editor. */
  async counts(courseId: string): Promise<Map<number, { pending: number; approved: number }>> {
    const rows = await this.bank.aggregate<{ _id: { day: number; status: string }; n: number }>([
      { $match: { courseId, status: { $in: ['pending', 'approved'] } } },
      { $group: { _id: { day: '$day', status: '$status' }, n: { $sum: 1 } } }
    ]);
    const m = new Map<number, { pending: number; approved: number }>();
    for (const r of rows) {
      const c = m.get(r._id.day) ?? { pending: 0, approved: 0 };
      c[r._id.status as 'pending' | 'approved'] = r.n;
      m.set(r._id.day, c);
    }
    return m;
  }

  /**
   * Writes tense questions for a day's words (and a recap story of the earlier days' words) with AI,
   * using one of the owner's daily AI generations. Without AI, verbs get built-in template questions.
   * Everything new waits for the owner's approval.
   */
  async generate(user: string, id: string, day: number, dto: GenerateQuestionsDto) {
    const c = await this.owned(user, id);
    this.checkDay(c, day);
    const days = c.toObject().days;
    const words = days.find((d) => d.day === day)?.words ?? [];
    if (!words.length) throw new BadRequestException('Add words to day ' + day + ' first.');
    const tenses = (dto.tenses?.length ? dto.tenses : TENSES) as Tense[];
    const perWord = dto.perWord ?? 2;
    const earlier = days.filter((d) => d.day < day).flatMap((d) => d.words.map((w) => w.word)).slice(-RECAP_WORDS);

    let drafts: TenseDraft[] = [];
    let recap: { text: string; vi: string } | null = null;
    let source: 'ai' | 'template' = 'template';
    const key = this.config.get<string>('OPENAI_API_KEY');
    if (key) {
      const { used, limit } = await this.profile.dailyStatus(user, 'courseAi');
      if (used >= limit) {
        throw new HttpException({ statusCode: 429, error: 'Daily limit reached', message: 'You’ve used your ' + limit + ' AI generations for today. Try again tomorrow, or write questions by hand.' }, HttpStatus.TOO_MANY_REQUESTS);
      }
      const ai = await aiTenseQuestions(words.map((w) => w.word), earlier, tenses, perWord, key, this.config.get<string>('OPENAI_MODEL', 'gpt-4o-mini'));
      if (ai && ai.questions.length) {
        await this.profile.useDaily(user, 'courseAi');
        drafts = ai.questions;
        recap = ai.recap;
        source = 'ai';
      }
    }
    if (source === 'template') {
      drafts = words.filter((w) => w.pos === 'Verb').flatMap((w) => templateQuestions(w.word, tenses, perWord));
      if (!drafts.length) {
        throw new UnprocessableEntityException('AI isn’t available right now, and built-in questions only work for verbs. Write questions by hand, or try again later.');
      }
    }

    const docs: Partial<BankItem>[] = drafts.map((d) => ({ courseId: id, day, kind: d.kind, word: d.word, tense: d.tense, prompt: d.prompt, choices: d.choices, answer: d.answer, accept: d.accept, explain: d.explain, source, status: 'pending' }));
    if (recap) {
      await this.bank.deleteMany({ courseId: id, day, kind: 'recap', status: 'pending' });
      docs.push({ courseId: id, day, kind: 'recap', word: '', tense: '', prompt: recap.text, explain: recap.vi, choices: [], answer: '', accept: [], source, status: 'pending' });
    }
    await this.bank.insertMany(docs);
    return { source, added: docs.length, quota: await this.profile.dailyStatus(user, 'courseAi'), items: await this.list(user, id, day) };
  }

  /** A question (or recap) the owner writes; approved straight away. */
  async create(user: string, id: string, day: number, dto: BankItemDto) {
    const c = await this.owned(user, id);
    this.checkDay(c, day);
    const choices = dto.kind === 'tenseChoice' ? (dto.choices ?? []).map((x) => x.trim()) : [];
    this.validate(dto.kind, dto.prompt, choices, dto.answer ?? '');
    if (dto.kind === 'recap') await this.bank.deleteMany({ courseId: id, day, kind: 'recap' });
    const q = await this.bank.create({
      courseId: id, day, kind: dto.kind, word: dto.word?.trim() ?? '', tense: dto.tense ?? '', prompt: dto.prompt.trim(), choices,
      answer: dto.answer?.trim() ?? '', accept: dto.accept ?? [], explain: dto.explain?.trim() ?? '', source: 'manual', status: 'approved'
    });
    return this.view(q);
  }

  async update(user: string, id: string, qid: string, dto: UpdateBankItemDto) {
    await this.owned(user, id);
    const q = await this.bank.findOne({ _id: qid, courseId: id });
    if (!q) throw new NotFoundException('Question not found.');
    if (dto.prompt !== undefined) q.prompt = dto.prompt.trim();
    if (dto.answer !== undefined) q.answer = dto.answer.trim();
    if (dto.choices !== undefined) q.choices = dto.choices.map((x) => x.trim());
    if (dto.accept !== undefined) q.accept = dto.accept;
    if (dto.explain !== undefined) q.explain = dto.explain.trim();
    if (dto.tense !== undefined) q.tense = dto.tense;
    if (dto.word !== undefined) q.word = dto.word.trim();
    if (dto.status !== undefined) q.status = dto.status;
    this.validate(q.kind, q.prompt, q.choices, q.answer);
    // Only one recap per day is used.
    if (q.kind === 'recap' && q.status === 'approved') await this.bank.updateMany({ courseId: id, day: q.day, kind: 'recap', status: 'approved', _id: { $ne: q._id } }, { $set: { status: 'rejected' } });
    await q.save();
    return this.view(q);
  }

  /**
   * Imports tense questions (from the owner's CSV/JSON) for a day that has words. Each row is checked on its own;
   * good rows are saved (approved), bad ones are reported by their index with the reason.
   */
  async importItems(user: string, id: string, day: number, rows: Record<string, unknown>[]) {
    const c = await this.owned(user, id);
    this.checkDay(c, day);
    const words = c.days.find((d) => d.day === day)?.words ?? [];
    if (!words.length) throw new BadRequestException('Add words to day ' + day + ' before importing questions.');
    const byLower = new Map(words.map((w) => [w.word.toLowerCase(), w.word]));
    const text = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
    const list = (v: unknown) => (Array.isArray(v) ? v.map(text).filter(Boolean) : text(v) ? text(v).split('|').map((x) => x.trim()).filter(Boolean) : []);
    const docs: Partial<BankItem>[] = [];
    const errors: { index: number; message: string }[] = [];
    rows.forEach((r, index) => {
      try {
        const rawKind = text(r.kind ?? r.type).toLowerCase();
        const kind = ['tense', 'typed', 'type'].includes(rawKind) ? 'tense' : ['tensechoice', 'multi', 'choice', 'mc', 'multiple'].includes(rawKind) ? 'tenseChoice' : '';
        if (!kind) throw new BadRequestException('Type must be "typed" or "multi".');
        const word = byLower.get(text(r.word).toLowerCase());
        if (!word) throw new BadRequestException('“' + text(r.word) + '” isn’t one of day ' + day + '’s words.');
        const tense = text(r.tense);
        if (tense && !(TENSES as readonly string[]).includes(tense)) throw new BadRequestException('Unknown tense “' + tense + '”. Use one of: ' + TENSES.join(', ') + '.');
        const prompt = text(r.prompt ?? r.sentence);
        const answer = text(r.answer);
        const choices = kind === 'tenseChoice' ? (Array.isArray(r.choices) ? list(r.choices) : [r.choice1, r.choice2, r.choice3, r.choice4].map(text).filter(Boolean)) : [];
        if (kind === 'tenseChoice' && choices.length === 3 && answer && !choices.includes(answer)) choices.push(answer);
        this.validate(kind, prompt, choices, answer);
        if (prompt.length > 1500 || answer.length > 80 || choices.some((x) => x.length > 80)) throw new BadRequestException('Text is too long.');
        docs.push({ courseId: id, day, kind, word, tense, prompt, choices, answer, accept: list(r.accept).slice(0, 5), explain: text(r.explain).slice(0, 1500), source: 'manual', status: 'approved' });
      } catch (e) {
        errors.push({ index, message: e instanceof Error ? e.message : 'Invalid row.' });
      }
    });
    if (docs.length) await this.bank.insertMany(docs);
    return { added: docs.length, errors, items: await this.list(user, id, day) };
  }

  /** Approve or reject several items at once. */
  async setStatus(user: string, id: string, ids: string[], status: BankStatus) {
    await this.owned(user, id);
    await this.bank.updateMany({ courseId: id, _id: { $in: ids }, kind: { $ne: 'recap' } }, { $set: { status } });
    // Recaps one at a time, so a day keeps a single approved recap.
    const recaps = await this.bank.find({ courseId: id, _id: { $in: ids }, kind: 'recap' });
    for (const r of recaps) await this.update(user, id, String(r._id), { status });
    return { updated: ids.length };
  }

  async remove(user: string, id: string, qid: string): Promise<void> {
    await this.owned(user, id);
    await this.bank.deleteOne({ _id: qid, courseId: id });
  }

  /** Approved items for some days of a course (for homework and warm-ups). */
  async approved(courseId: string, days: number[]): Promise<BankItemDocument[]> {
    return this.bank.find({ courseId, day: { $in: days }, status: 'approved' }).sort({ _id: 1 });
  }

  async removeCourses(courseIds: string[]): Promise<void> {
    await this.bank.deleteMany({ courseId: { $in: courseIds } });
  }
}
