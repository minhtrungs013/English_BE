import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { addDays, daysBetween, todayKey } from '../common/day';
import { LibraryService } from '../library/library.service';
import { User } from '../users/user.schema';
import { Course, CourseDocument, CourseWord, Enrollment, EnrollmentDocument, currentDay } from './course.schema';
import { gradeDictation } from '../dictation/dictation.grade';
import { CHOICE_KINDS, QUESTION_KINDS, TENSE_KINDS, WORD_KINDS, BankItemDocument, Homework, HomeworkDocument, Question, QuestionType, Submission, SubmissionDocument, type SentenceFeedback } from './homework.schema';
import { containsWord, gradeSentence, SentenceAttempt } from '../practice/sentence-grade';
import { Dialogue, dialogueBlanks } from './dialogue';
import { NotificationsService } from '../notifications/notifications.service';
import { QuestionsService } from './questions.service';
import { TENSE_LABEL, type Tense } from './tense';
import { familyKey, wordFormQuestion } from '../common/wordform';
import { SentenceGrammarService } from './sentence-grammar';
import { fullSentence, wordFormNote } from './sentence-rules';
import { AccessService } from '../access/access';

/** How many earlier words a day's homework reviews (at least this many, or the course's words per day). */
const MIN_REVIEW = 3;
const BOARD_ROWS = 50;
/** Tense questions from the bank in a day's homework: about the new words, and about review words. */
const TENSE_NEW = 4;
/** Word fill questions from the bank for the day's new words. */
const WORD_NEW = 4;
const TENSE_REVIEW = 2;
/** Words in the warm-up before a day's new words. */
const WARMUP_WORDS = 6;
/** Most word-form (word family) questions in a day's homework. */
const WORDFORM_PER_DAY = 2;

/** Percent of the score kept when homework is handed in late: on time 100%, then 80%, 60%, and 50% from 3 days late. */
export function penaltyFor(lateDays: number): number {
  return lateDays <= 0 ? 100 : lateDays === 1 ? 80 : lateDays === 2 ? 60 : 50;
}

/** Lower-case, trimmed, straight quotes, single spaces, no punctuation around it. */
export function normalizeAnswer(s: string): string {
  return s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The Vietnamese meaning, or the English one when there is none. */
const label = (w: { vi: string; meaning: string }) => (w.vi || w.meaning || '').trim();

/** The example sentence with the word (or a simple inflection of it) blanked out. */
function blankOut(w: CourseWord): { prompt: string; found: string } | null {
  if (!w.ex) return null;
  const m = new RegExp('\\b' + escapeRegex(w.word) + '(?:s|es|ed|d|ing|er|ers)?\\b', 'i').exec(w.ex);
  if (!m) return null;
  return { prompt: w.ex.slice(0, m.index) + '_____' + w.ex.slice(m.index + m[0].length), found: m[0] };
}

function lettersHint(word: string): string {
  return word.charAt(0) + '… (' + word.replace(/\s/g, '').length + ' letters' + (word.includes(' ') ? ', ' + word.split(/\s+/).length + ' words' : '') + ')';
}

type Pool = { word: string; label: string }[];

/** Three wrong choices for a question, different from the answer and from each other. */
function distractors(answer: string, pool: string[]): string[] {
  const seen = new Set([normalizeAnswer(answer)]);
  const out: string[] = [];
  for (const p of shuffle(pool)) {
    const k = normalizeAnswer(p);
    if (!p || seen.has(k)) continue;
    seen.add(k);
    out.push(p);
    if (out.length === 3) break;
  }
  return out;
}

function makeQuestion(w: CourseWord, type: QuestionType, review: boolean, pool: Pool): Question {
  const meaning = label(w);
  if (type === 'meaning' || type === 'word') {
    const answer = type === 'meaning' ? meaning : w.word;
    const wrong = distractors(answer, pool.map((p) => (type === 'meaning' ? p.label : p.word)));
    if (wrong.length === 3 && answer) {
      return {
        type, word: w.word, review, answer, accept: [],
        prompt: type === 'meaning' ? w.word : meaning,
        hint: type === 'meaning' ? w.pos : (w.vi && w.meaning ? w.meaning : ''),
        choices: shuffle([answer, ...wrong])
      };
    }
    type = 'type'; // not enough other words for choices
  }
  if (type === 'blank') {
    const b = blankOut(w);
    if (b) return { type, word: w.word, review, prompt: b.prompt, hint: meaning, choices: [], answer: b.found, accept: [w.word] };
  }
  return { type: 'type', word: w.word, review, prompt: meaning || w.meaning, hint: lettersHint(w.word), choices: [], answer: w.word, accept: [] };
}

/** Example sentences that make good dictation: a sentence, not too long. */
const dictatable = (w: CourseWord) => {
  const ex = w.ex.trim();
  const words = ex.split(/\s+/).length;
  return ex.length <= 160 && words >= 4 && words <= 18;
};

/**
 * Up to `max` word-form questions from the words' families (today's words first, then earlier ones),
 * skipping words asked as a blank today and families already used.
 */
function wordFormQuestions(today: CourseWord[], earlier: CourseWord[], blanked: Set<string>, max: number): Question[] {
  const out: Question[] = [];
  const families = new Set<string>();
  const words = new Set<string>();
  const candidates = [...shuffle(today).map((w) => ({ w, review: false })), ...shuffle(earlier).map((w) => ({ w, review: true }))];
  for (const { w, review } of candidates) {
    if (out.length >= max) break;
    const k = w.word.toLowerCase();
    if (blanked.has(k) || words.has(k) || !w.family?.length) continue;
    const fk = familyKey(w.family);
    if (families.has(fk)) continue;
    const f = wordFormQuestion(w.family);
    if (!f) continue;
    families.add(fk);
    words.add(k);
    out.push({ type: 'wordform', word: w.word, review, prompt: f.prompt, hint: f.pos, choices: [], answer: f.answer, accept: [], explain: f.family + (f.vi ? ' — ' + f.vi : '') });
  }
  return out;
}

/** A short hash of a string (to notice changes in word families). */
function hashOf(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function dictationQuestion(w: CourseWord, review: boolean): Question {
  const n = w.ex.trim().split(/\s+/).length;
  return { type: 'dictation', word: w.word, review, prompt: '', hint: n + ' words', choices: [], answer: w.ex.trim(), accept: [] };
}

/** What the learner gets of a question before handing in: dictation sentences are only sent (encoded) for the device to speak. */
/** "Write a sentence" with one of the day's new words. */
function sentenceQuestion(w: CourseWord): Question {
  return { type: 'sentence', word: w.word, review: false, prompt: 'Write a sentence with “' + w.word + '”', hint: label(w), choices: [], answer: w.ex.trim() || w.word, accept: [] };
}
/** AI's grade at or above this counts as correct. */
const SENTENCE_PASS = 7;

function shown(q: Question) {
  return { type: q.type, review: q.review, prompt: q.prompt, hint: q.hint, choices: q.choices, ...(q.type === 'dictation' ? { audio: Buffer.from(q.answer, 'utf8').toString('base64') } : {}) };
}

/** A homework question from an approved bank item. */
function fromBank(b: BankItemDocument, review: boolean, hint = ''): Question {
  return { type: b.kind, word: b.word, review, prompt: b.prompt, hint, choices: CHOICE_KINDS.includes(b.kind) ? shuffle(b.choices) : [], answer: b.answer, accept: b.accept, tense: b.tense, explain: b.explain };
}

const tenseLabel = (t: string) => TENSE_LABEL[t as Tense] ?? '';

/**
 * On-time homework on consecutive days up to the learner's current day (or the day before, if today isn't done yet).
 * Days without words don't break a streak.
 */
function streakOf(onTime: Set<number>, current: number, hasWords: Set<number>): number {
  let d = onTime.has(current) ? current : current - 1;
  let streak = 0;
  for (; d >= 1; d--) {
    if (onTime.has(d)) streak++;
    else if (hasWords.has(d)) break;
  }
  return streak;
}

@Injectable()
export class HomeworkService {
  private readonly log = new Logger('Homework');
  constructor(
    @InjectModel(Course.name) private readonly courses: Model<Course>,
    @InjectModel(Enrollment.name) private readonly enrollments: Model<Enrollment>,
    @InjectModel(Homework.name) private readonly homework: Model<Homework>,
    @InjectModel(Submission.name) private readonly submissions: Model<Submission>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(SentenceAttempt.name) private readonly attempts: Model<SentenceAttempt>,
    private readonly config: ConfigService,
    private readonly library: LibraryService,
    private readonly questions: QuestionsService,
    private readonly notes: NotificationsService,
    private readonly grammar: SentenceGrammarService,
    private readonly access: AccessService
  ) {}

  /* ---------- access ---------- */

  /** The course and the learner's enrollment, checking the day is open for them and has words. */
  private async openDay(user: string, id: string, day: number): Promise<{ c: CourseDocument; e: EnrollmentDocument }> {
    const c = await this.courses.findById(id);
    if (!c) throw new NotFoundException('Course not found.');
    const e = await this.enrollments.findOne({ user, courseId: id });
    if (!e) throw new ForbiddenException('Join the course to do its homework.');
    if (!Number.isInteger(day) || day < 1 || day > currentDay(e, c.totalDays)) throw new ForbiddenException('Day ' + day + ' isn’t open yet.');
    if (!c.days.find((d) => d.day === day)?.words.length) throw new BadRequestException('Day ' + day + ' has no words yet.');
    return { c, e };
  }

  /** Days after the day opened for this learner (0 = today is that day). */
  private lateDays(e: EnrollmentDocument, day: number): number {
    return Math.max(0, daysBetween(addDays(e.startDay, day - 1), todayKey()));
  }

  /* ---------- making the homework ---------- */

  /** What the homework is made from: the words up to this day and the approved tense questions for them. */
  private wordsKey(c: CourseDocument, day: number, bank: BankItemDocument[]): string {
    return c.days.filter((d) => d.day <= day).sort((a, b) => a.day - b.day)
      .map((d) => d.day + ':' + d.words.map((w) => w.word.toLowerCase()).join(',')).join('|') +
      '#' + bank.map((b) => String(b._id) + ':' + ((b as unknown as { updatedAt?: Date }).updatedAt?.getTime() ?? 0)).join(',') +
      '#d' + (c.dictationPerDay ?? 2) +
      '#f' + hashOf(JSON.stringify(c.days.filter((d) => d.day <= day).sort((a, b) => a.day - b.day)
        .map((d) => d.words.map((w) => (w.family ?? []).map((m) => [m.word, m.pos, m.vi, m.ex ?? ''])))));
  }

  private async bankUpTo(c: CourseDocument, day: number): Promise<BankItemDocument[]> {
    const items = await this.questions.approved(String(c._id), Array.from({ length: day }, (_, i) => i + 1));
    return items.filter((b) => QUESTION_KINDS.includes(b.kind));
  }

  /** Words to take wrong choices from: the course's, plus some library words for small courses. */
  private async poolFor(c: CourseDocument): Promise<Pool> {
    const all = c.toObject().days.flatMap((d) => d.words);
    const extra = all.length < 12 ? await this.library.sample(12) : [];
    return [...all, ...extra].map((w) => ({ word: w.word, label: label(w) }));
  }

  /**
   * Questions for a day: two for each new word (pick the meaning or the word, then type it or fill the example),
   * and one for each of a few words from earlier days.
   */
  private async build(c: CourseDocument, day: number, bank: BankItemDocument[]): Promise<Question[]> {
    const days = c.toObject().days;
    const today = days.find((d) => d.day === day)?.words ?? [];
    const earlier = days.filter((d) => d.day < day).flatMap((d) => d.words);
    const pool = await this.poolFor(c);

    const qs: Question[] = [];
    for (const w of today) {
      qs.push(makeQuestion(w, Math.random() < 0.5 ? 'meaning' : 'word', false, pool));
      qs.push(makeQuestion(w, blankOut(w) ? 'blank' : 'type', false, pool));
    }
    const seen = new Set(today.map((w) => w.word.toLowerCase()));
    const review = shuffle(earlier.filter((w) => !seen.has(w.word.toLowerCase()))).slice(0, Math.max(MIN_REVIEW, c.wordsPerDay));
    const types: QuestionType[] = ['meaning', 'word', 'type', 'blank'];
    for (const w of review) qs.push(makeQuestion(w, types[Math.floor(Math.random() * types.length)], true, pool));
    // Tense practice from the owner-approved question bank.
    qs.push(...shuffle(bank.filter((b) => b.day === day && TENSE_KINDS.includes(b.kind))).slice(0, TENSE_NEW).map((b) => fromBank(b, false)));
    // Word fill: the day's word itself in the blank; the hint is its Vietnamese meaning.
    const viOf = new Map([...today, ...earlier].map((w) => [w.word.toLowerCase(), label(w)]));
    qs.push(...shuffle(bank.filter((b) => b.day === day && WORD_KINDS.includes(b.kind))).slice(0, WORD_NEW).map((b) => fromBank(b, false, b.kind === 'wordFill' ? viOf.get(b.word.toLowerCase()) ?? '' : '')));
    // A word already asked by word fill isn't asked as a blank too (two gaps for one word): it's typed from its meaning instead.
    const unblank = () => {
      const filled = new Set(qs.filter((q) => WORD_KINDS.includes(q.type)).map((q) => q.word.toLowerCase()));
      qs.forEach((q, i) => {
        if (q.type !== 'blank' || !filled.has(q.word.toLowerCase())) return;
        const w = [...today, ...earlier].find((x) => x.word.toLowerCase() === q.word.toLowerCase());
        if (w) qs[i] = makeQuestion(w, 'type', q.review, pool);
      });
    };
    unblank();
    // Dictation: example sentences of earlier words not asked as a blank today (a blank's own sentence would give it away).
    const blanked = new Set(qs.filter((q) => q.type === 'blank').map((q) => q.word.toLowerCase()));
    const want = Math.min(3, Math.max(0, c.dictationPerDay ?? 2));
    const picked = shuffle(earlier.filter((w) => dictatable(w) && !blanked.has(w.word.toLowerCase())))
      .filter((w, i, all) => all.findIndex((x) => x.ex.trim() === w.ex.trim()) === i).slice(0, want);
    for (const w of picked) qs.push(dictationQuestion(w, true));
    // Not enough earlier sentences (e.g. day 1): use today's, and ask that word by typing instead of a blank.
    for (const w of shuffle(today.filter(dictatable)).slice(0, want - picked.length)) {
      const i = qs.findIndex((q) => q.type === 'blank' && q.word === w.word && !q.review);
      if (i >= 0) qs[i] = makeQuestion(w, 'type', false, pool);
      qs.push(dictationQuestion(w, false));
    }
    // Word forms from the words' families, never about a word asked as a blank today.
    const blankedNow = new Set(qs.filter((q) => q.type === 'blank').map((q) => q.word.toLowerCase()));
    qs.push(...wordFormQuestions(today, earlier, blankedNow, WORDFORM_PER_DAY));
    const reviewed = new Set(review.map((w) => w.word.toLowerCase()));
    qs.push(...shuffle(bank.filter((b) => b.day < day && reviewed.has(b.word.toLowerCase()))).slice(0, TENSE_REVIEW).map((b) => fromBank(b, true, b.kind === 'wordFill' ? viOf.get(b.word.toLowerCase()) ?? '' : '')));
    unblank();
    // One "Write a sentence" with a new word, graded by AI (only when AI is set up).
    const writable = shuffle(today.filter((w) => !blankedNow.has(w.word.toLowerCase())));
    if (this.config.get<string>('ANTHROPIC_API_KEY') && writable.length) qs.push(sentenceQuestion(writable[0]));
    return shuffle(qs);
  }

  /** The day's homework, made the first time someone opens it (and again if the words changed before anyone submitted). */
  private async ensure(c: CourseDocument, day: number): Promise<HomeworkDocument> {
    const courseId = String(c._id);
    const bank = await this.bankUpTo(c, day);
    const key = this.wordsKey(c, day, bank);
    const existing = await this.homework.findOne({ courseId, day });
    if (existing && (existing.wordsKey === key || (await this.submissions.exists({ courseId, day, submittedAt: { $ne: null } })))) return existing;
    const questions = await this.build(c, day, bank);
    try {
      return (await this.homework.findOneAndUpdate({ courseId, day }, { $set: { wordsKey: key, questions } }, { upsert: true, returnDocument: 'after' }))!;
    } catch {
      // Someone else made it at the same moment.
      return (await this.homework.findOne({ courseId, day }))!;
    }
  }

  /* ---------- views ---------- */

  /**
   * The grammar of each question's sentence (answer in place), or null. Only ever sent with the answers:
   * after handing in, and in the warm-up (which isn't graded).
   */
  private grammarOf(qs: { type: string; prompt: string; answer: string; hint?: string; tense?: string; explain?: string }[]) {
    return this.grammar.views(qs.map((q) => ({
      text: fullSentence(q),
      hint: {
        tense: q.tense,
        // Tense questions explain the tense; a word-form question's explain is its family, not grammar.
        explain: TENSE_KINDS.includes(q.type) ? q.explain : '',
        note: q.type === 'wordform' ? wordFormNote(q.prompt, q.answer, q.hint ?? '') : null
      }
    })));
  }

  private async result(hw: HomeworkDocument, s: SubmissionDocument) {
    const grammar = await this.grammarOf(hw.questions);
    return {
      score: s.score, raw: s.raw, correct: s.correct, total: s.total, lateDays: s.lateDays, penalty: s.penalty,
      durationMs: s.durationMs, submittedAt: s.submittedAt?.getTime() ?? null,
      review: hw.questions.map((q, i) => ({
        type: q.type, review: q.review, prompt: q.prompt, hint: q.hint, choices: q.choices,
        tense: q.tense ?? '', tenseLabel: tenseLabel(q.tense ?? ''), explain: q.explain ?? '',
        yourAnswer: s.answers[i] ?? '', answer: q.answer, correct: !!s.results[i],
        ...(q.type === 'dictation' ? { grade: gradeDictation(q.answer, s.answers[i] ?? '') } : {}),
        ...(q.type === 'sentence' ? { ai: s.feedback?.[i] ?? null } : {}),
        grammar: grammar[i]
      }))
    };
  }

  /** The homework for an open day. Answers are only included once it's submitted. */
  async get(user: string, id: string, day: number) {
    const { c, e } = await this.openDay(user, id, day);
    const hw = await this.ensure(c, day);
    await this.submissions.updateOne({ courseId: id, user, day }, { $setOnInsert: { courseId: id, user, day, openedAt: new Date() } }, { upsert: true });
    const s = (await this.submissions.findOne({ courseId: id, user, day }))!;
    const lateDays = this.lateDays(e, day);
    return {
      day, total: hw.questions.length, lateDays, penalty: penaltyFor(lateDays),
      questions: hw.questions.map(shown),
      submission: s.submittedAt ? await this.result(hw, s) : null
    };
  }

  /**
   * Grades the "Write a sentence" answers with AI (all at once). When AI isn't available, a sentence that uses the
   * word and has at least 5 words passes, without a score. Each graded sentence also goes to the learner's mistake notebook.
   */
  private async gradeSentences(user: string, hw: HomeworkDocument, answers: string[]): Promise<Record<string, SentenceFeedback>> {
    const key = this.config.get<string>('ANTHROPIC_API_KEY');
    const model = this.config.get<string>('ANTHROPIC_MODEL', 'claude-haiku-4-5');
    const out: Record<string, SentenceFeedback> = {};
    await Promise.all(hw.questions.map(async (q, i) => {
      if (q.type !== 'sentence') return;
      const text = (answers[i] ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
      const empty: SentenceFeedback = { score: 0, corrected: '', better: '', feedbackVi: '', mistakes: [] };
      if (!text || !containsWord(text, q.word)) { out[i] = { ...empty, feedbackVi: text ? 'Câu chưa dùng từ “' + q.word + '”.' : '' }; return; }
      const simple = text.split(' ').length >= 5;
      if (!key) { out[i] = { ...empty, score: simple ? null : 0, feedbackVi: 'Chưa chấm được bằng AI; câu được tính theo kiểm tra cơ bản.' }; return; }
      try {
        const g = await gradeSentence(key, model, { word: q.word, pos: '', meaning: '', vi: q.hint }, text, 'homework-sentence');
        out[i] = { score: g.score, corrected: g.corrected, better: g.better, feedbackVi: g.feedbackVi, mistakes: g.mistakes };
        await this.attempts.create({ user, wordId: '', word: q.word, sentence: text, score: g.score, corrected: g.corrected, lesson: g.lesson?.id ?? '', mistakes: g.mistakes, source: 'homework' })
          .catch(() => undefined);
      } catch (e) {
        this.log.warn('Homework sentence grading failed: ' + String(e));
        out[i] = { ...empty, score: simple ? null : 0, feedbackVi: 'Chưa chấm được bằng AI; câu được tính theo kiểm tra cơ bản.' };
      }
    }));
    return out;
  }

  /** Grades and saves the homework. Each learner hands in each day once. */
  async submit(user: string, id: string, day: number, answers: string[]) {
    const { e } = await this.openDay(user, id, day);
    const hw = await this.homework.findOne({ courseId: id, day });
    if (!hw) throw new ConflictException('Open the homework first.');
    if (answers.length !== hw.questions.length) throw new ConflictException('This homework has changed. Reload it and try again.');
    const feedback = await this.gradeSentences(user, hw, answers);
    const results = hw.questions.map((q, i) => {
      if (q.type === 'dictation') return gradeDictation(q.answer, answers[i] ?? '').passed;
      if (q.type === 'sentence') { const f = feedback[i]; return !!f && (f.score === null || f.score >= SENTENCE_PASS); }
      const a = normalizeAnswer(answers[i] ?? '');
      return !!a && [q.answer, ...q.accept].some((x) => normalizeAnswer(x) === a);
    });
    const correct = results.filter(Boolean).length;
    const total = hw.questions.length;
    const lateDays = this.lateDays(e, day);
    const penalty = penaltyFor(lateDays);
    const raw = total ? Math.round((correct / total) * 100) : 0;
    const now = new Date();
    const prev = await this.submissions.findOne({ courseId: id, user, day });
    if (prev?.submittedAt) throw new ConflictException('You’ve already handed in day ' + day + '.');
    const openedAt = prev?.openedAt ?? now;
    let s: SubmissionDocument | null;
    try {
      s = await this.submissions.findOneAndUpdate(
        { courseId: id, user, day, submittedAt: null },
        { $set: { submittedAt: now, answers, results, correct, total, raw, lateDays, penalty, score: Math.round((raw * penalty) / 100), durationMs: now.getTime() - openedAt.getTime(), feedback: Object.keys(feedback).length ? feedback : null }, $setOnInsert: { openedAt } },
        { upsert: true, returnDocument: 'after' }
      );
    } catch {
      s = null; // handed in twice at the same moment
    }
    if (!s) throw new ConflictException('You’ve already handed in day ' + day + '.');
    return this.result(hw, s);
  }

  /**
   * The warm-up before a day's new words: a few earlier words, the ones I got wrong in earlier homework first,
   * each with one practice question (answers included, since it isn't graded), plus the day's approved recap story.
   */
  async warmup(user: string, id: string, day: number) {
    const c = await this.courses.findById(id);
    if (!c) throw new NotFoundException('Course not found.');
    const e = await this.enrollments.findOne({ user, courseId: id });
    if (!e) throw new ForbiddenException('Join the course first.');
    if (!Number.isInteger(day) || day < 1 || day > currentDay(e, c.totalDays)) throw new ForbiddenException('Day ' + day + ' isn’t open yet.');
    const days = c.toObject().days;
    const earlier = days.filter((d) => d.day < day).flatMap((d) => d.words);
    const recapItem = (await this.questions.approved(id, [day])).find((b) => b.kind === 'recap');
    const recap = recapItem ? { text: recapItem.prompt, vi: recapItem.explain } : null;
    if (!earlier.length) return { day, recap, words: [], questions: [] };

    // Mistakes in my earlier homework, by word.
    const subs = await this.submissions.find({ courseId: id, user, day: { $lt: day }, submittedAt: { $ne: null } }).lean();
    const hws = new Map((await this.homework.find({ courseId: id, day: { $in: subs.map((s) => s.day) } }).lean()).map((h) => [h.day, h]));
    const wrong = new Map<string, number>();
    const practised = new Set<string>();
    for (const s of subs) {
      hws.get(s.day)?.questions.forEach((q, i) => {
        const k = q.word.toLowerCase();
        practised.add(k);
        if (!s.results[i]) wrong.set(k, (wrong.get(k) ?? 0) + 1);
      });
    }
    // Missed most first, then words not practised in homework yet, then the rest (random within each group).
    const rank = (w: CourseWord) => (wrong.get(w.word.toLowerCase()) ?? 0) * 10 + (practised.has(w.word.toLowerCase()) ? 0 : 1) + Math.random();
    const picked = [...earlier].sort((a, b) => rank(b) - rank(a)).slice(0, WARMUP_WORDS);

    const bank = (await this.questions.approved(id, Array.from({ length: day - 1 }, (_, i) => i + 1))).filter((b) => QUESTION_KINDS.includes(b.kind));
    const pool = await this.poolFor(c);
    const types: QuestionType[] = ['meaning', 'word', 'type', 'blank'];
    const questions = picked.map((w) => {
      const tense = shuffle(bank.filter((b) => b.word.toLowerCase() === w.word.toLowerCase()))[0];
      const q = tense && Math.random() < 0.5 ? fromBank(tense, true, tense.kind === 'wordFill' ? label(w) : '') : makeQuestion(w, types[Math.floor(Math.random() * types.length)], true, pool);
      return { type: q.type, word: q.word, prompt: q.prompt, hint: q.hint, choices: q.choices, answer: q.answer, accept: q.accept, tense: q.tense ?? '', tenseLabel: tenseLabel(q.tense ?? ''), explain: q.explain ?? '' };
    });
    // The warm-up already includes the answers, so the grammar can come along (shown once a question is answered).
    const grammar = await this.grammarOf(questions);
    return {
      day, recap,
      words: picked.map((w) => ({ word: w.word, ipa: w.ipa, vi: w.vi, meaning: w.meaning, missed: wrong.get(w.word.toLowerCase()) ?? 0 })),
      questions: questions.map((q, i) => ({ ...q, grammar: grammar[i] }))
    };
  }

  /**
   * The grammar of the example sentences of an open day's words (the Learn step). Only the course's own sentences:
   * the app can't ask about any other text here.
   */
  async examples(user: string, id: string, day: number) {
    const { c } = await this.openDay(user, id, day);
    const words = (c.days.find((d) => d.day === day)?.words ?? []).filter((w) => w.ex?.trim());
    const grammar = await this.grammar.views(words.map((w) => ({ text: w.ex.trim() })));
    return { items: words.map((w, i) => ({ word: w.word, ex: w.ex.trim(), grammar: grammar[i] })).filter((x) => x.grammar) };
  }

  /** Marks a day's warm-up as finished (it isn't graded; the result is only kept for the learner's progress). */
  async warmupDone(user: string, id: string, day: number, correct = 0, total = 0) {
    const c = await this.courses.findById(id);
    if (!c) throw new NotFoundException('Course not found.');
    const e = await this.enrollments.findOne({ user, courseId: id });
    if (!e) throw new ForbiddenException('Join the course first.');
    if (!Number.isInteger(day) || day < 1 || day > currentDay(e, c.totalDays)) throw new ForbiddenException('Day ' + day + ' isn’t open yet.');
    const entry = { day, at: new Date(), correct: Math.max(0, correct), total: Math.max(0, total) };
    const others = (e.warmedUp ?? []).filter((w) => w.day !== day);
    e.warmedUp = [...others, entry].sort((a, b) => a.day - b.day);
    await e.save();
    return { warmedUp: e.warmedUp.map((w) => w.day) };
  }

  /**
   * The day's approved listening dialogue (answers included — it's practice), with a shuffled word bank
   * of the blanks' base words. null when the owner hasn't added one.
   */
  async listening(user: string, id: string, day: number) {
    await this.openDay(user, id, day);
    const item = (await this.questions.approved(id, [day])).find((b) => b.kind === 'dialogue');
    if (!item?.data) return { day, dialogue: null };
    const d = item.data as unknown as Dialogue;
    const bank = shuffle([...new Set(dialogueBlanks(d).map((b) => b.base))]);
    return { day, dialogue: { id: String(item._id), ...d, wordBank: bank } };
  }

  /** Marks a day's listening practice as finished (or skipped). */
  async listeningDone(user: string, id: string, day: number, correct = 0, total = 0) {
    const { e } = await this.openDay(user, id, day);
    const entry = { day, at: new Date(), correct: Math.max(0, correct), total: Math.max(0, total) };
    e.listened = [...(e.listened ?? []).filter((w) => w.day !== day), entry].sort((a, b) => a.day - b.day);
    await e.save();
    return { listened: e.listened.map((w) => w.day) };
  }

  /** My submitted scores in a course, by day. */
  async myScores(user: string, courseId: string): Promise<Map<number, number>> {
    const rows = await this.submissions.find({ courseId, user, submittedAt: { $ne: null } }, { day: 1, score: 1 }).lean();
    return new Map(rows.map((r) => [r.day, r.score]));
  }

  /* ---------- leaderboards ---------- */

  /**
   * Leaderboards for a course (owner and learners only): one day's homework, total score over all days,
   * and streaks of homework handed in on time. Learners are shown by their real name.
   */
  async leaderboard(user: string, id: string, dayArg?: number) {
    const c = await this.courses.findById(id);
    if (!c) throw new NotFoundException('Course not found.');
    const enrolled = await this.enrollments.find({ courseId: id }).lean();
    const mine = enrolled.find((e) => e.user === user);
    const admin = await this.access.isAdmin(user);
    if (!admin && !mine) throw new ForbiddenException('Join the course to see its leaderboard.');

    const maxDay = admin && !mine ? c.totalDays : currentDay(mine!, c.totalDays);
    const day = Math.max(1, Math.min(maxDay, dayArg ?? (mine ? currentDay(mine, c.totalDays) : 1)));
    const ids = enrolled.map((e) => e.user);
    const names = new Map((await this.users.find({ _id: { $in: ids } }, { name: 1 }).lean()).map((u) => [String(u._id), u.name]));
    const subs = (await this.submissions.find({ courseId: id, user: { $in: ids }, submittedAt: { $ne: null } }).lean());

    const board = <T extends { user: string }>(rows: T[]) => {
      const ranked = rows.map((r, i) => {
        const { user: u, ...rest } = r;
        return { rank: i + 1, name: names.get(u) || 'Learner', me: u === user, ...rest };
      });
      return { rows: ranked.slice(0, BOARD_ROWS), me: ranked.find((r) => r.me) ?? null, count: ranked.length };
    };

    const dayRows = subs.filter((s) => s.day === day)
      .sort((a, b) => b.score - a.score || a.durationMs - b.durationMs || +a.submittedAt! - +b.submittedAt!)
      .map((s) => ({ user: s.user, score: s.score, correct: s.correct, total: s.total, lateDays: s.lateDays, durationMs: s.durationMs }));

    const totals = new Map<string, { score: number; days: number }>();
    for (const s of subs) {
      const t = totals.get(s.user) ?? { score: 0, days: 0 };
      t.score += s.score;
      t.days += 1;
      totals.set(s.user, t);
    }
    const overallRows = [...totals].map(([u, t]) => ({ user: u, ...t })).sort((a, b) => b.score - a.score || b.days - a.days);

    // Streak: on-time homework on consecutive days up to today (or yesterday, if today isn't done yet).
    // Days without words don't break a streak.
    const hasWords = new Set(c.days.filter((d) => d.words.length).map((d) => d.day));
    const onTime = new Map<string, Set<number>>();
    for (const s of subs) if (s.lateDays === 0) (onTime.get(s.user) ?? onTime.set(s.user, new Set()).get(s.user)!).add(s.day);
    const streakRows = enrolled.map((e) => {
      const streak = streakOf(onTime.get(e.user) ?? new Set<number>(), currentDay(e, c.totalDays), hasWords);
      return { user: e.user, streak, score: totals.get(e.user)?.score ?? 0 };
    }).filter((r) => r.streak > 0).sort((a, b) => b.streak - a.streak || b.score - a.score);

    return { day, maxDay, members: enrolled.length, dayBoard: board(dayRows), overall: board(overallRows), streak: board(streakRows) };
  }

  /* ---------- members (owner) ---------- */

  private async ownedCourse(user: string, id: string): Promise<CourseDocument> {
    const c = await this.courses.findById(id);
    if (!c) throw new NotFoundException('Course not found.');
    await this.access.requireAdmin(user, 'Only an admin can see a course’s members.');
    return c;
  }

  /**
   * Everyone taking the course with their progress: days learned / reviewed / listened, homework handed in,
   * average and total score, late hand-ins, streak, how many open days still have no homework, and last activity.
   */
  async members(user: string, id: string) {
    const c = await this.ownedCourse(user, id);
    const enrolled = await this.enrollments.find({ courseId: id }).lean<(Enrollment & { createdAt?: Date })[]>();
    const ids = enrolled.map((e) => e.user);
    const [users, subs] = await Promise.all([
      this.users.find({ _id: { $in: ids } }, { name: 1 }).lean(),
      this.submissions.find({ courseId: id, user: { $in: ids } }).lean()
    ]);
    const people = new Map(users.map((u) => [String(u._id), u]));
    const hasWords = new Set(c.days.filter((d) => d.words.length).map((d) => d.day));
    const rows = enrolled.map((e) => {
      const mine = subs.filter((s) => s.user === e.user);
      const handed = mine.filter((s) => s.submittedAt);
      const cur = currentDay(e, c.totalDays);
      const scores = handed.map((s) => s.score);
      const times = [
        ...(e.learned ?? []).map((x) => x.at), ...(e.warmedUp ?? []).map((x) => x.at), ...(e.listened ?? []).map((x) => x.at),
        ...mine.map((s) => s.submittedAt ?? s.openedAt), e.createdAt
      ].filter(Boolean).map((t) => new Date(t as Date).getTime());
      const handedDays = new Set(handed.map((s) => s.day));
      const missing = [...hasWords].filter((d) => d <= cur && !handedDays.has(d)).length;
      return {
        userId: e.user, name: people.get(e.user)?.name || 'Learner',
        isOwner: e.user === c.ownerId, joinedAt: e.createdAt ? new Date(e.createdAt).getTime() : null,
        startDay: e.startDay, currentDay: cur,
        learned: (e.learned ?? []).length, warmedUp: (e.warmedUp ?? []).length, listened: (e.listened ?? []).length,
        homework: handed.length, missing, late: handed.filter((s) => s.lateDays > 0).length,
        totalScore: scores.reduce((a, b) => a + b, 0), avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
        streak: streakOf(new Set(handed.filter((s) => s.lateDays === 0).map((s) => s.day)), cur, hasWords),
        lastActive: times.length ? Math.max(...times) : null
      };
    }).sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0));
    return { members: rows, totalDays: c.totalDays, daysWithWords: hasWords.size };
  }

  /** One member's day-by-day progress. */
  async member(user: string, id: string, memberId: string) {
    const c = await this.ownedCourse(user, id);
    const e = await this.enrollments.findOne({ courseId: id, user: memberId }).lean<Enrollment & { createdAt?: Date }>();
    if (!e) throw new NotFoundException('This person isn’t in the course.');
    const u = await this.users.findById(memberId, { name: 1 }).lean();
    const subs = await this.submissions.find({ courseId: id, user: memberId }).lean();
    const cur = currentDay(e, c.totalDays);
    const at = (list: { day: number; at: Date }[] | undefined, d: number) => {
      const x = (list ?? []).find((y) => y.day === d);
      return x ? new Date(x.at).getTime() : null;
    };
    const days = Array.from({ length: c.totalDays }, (_, i) => {
      const d = i + 1;
      const s = subs.find((x) => x.day === d);
      const warm = (e.warmedUp ?? []).find((x) => x.day === d);
      const lis = (e.listened ?? []).find((x) => x.day === d);
      return {
        day: d, date: addDays(e.startDay, i), open: d <= cur, words: c.days.find((x) => x.day === d)?.words.length ?? 0,
        learnedAt: at(e.learned, d), warmedUpAt: at(e.warmedUp, d), listenedAt: at(e.listened, d),
        warmup: warm && warm.total ? { correct: warm.correct, total: warm.total } : null,
        listening: lis && lis.total ? { correct: lis.correct, total: lis.total } : null,
        homework: s?.submittedAt
          ? { score: s.score, raw: s.raw, correct: s.correct, total: s.total, lateDays: s.lateDays, durationMs: s.durationMs, submittedAt: new Date(s.submittedAt).getTime() }
          : s ? { opened: true } : null
      };
    });
    return {
      userId: memberId, name: u?.name || 'Learner', isOwner: memberId === c.ownerId,
      joinedAt: e.createdAt ? new Date(e.createdAt).getTime() : null, startDay: e.startDay, currentDay: cur, days
    };
  }

  /** The owner removes someone from the course (their enrollment and homework go too). */
  async removeMember(user: string, id: string, memberId: string): Promise<void> {
    const c = await this.ownedCourse(user, id);
    if (memberId === c.ownerId) throw new BadRequestException('Use “Leave course” to stop taking your own course.');
    const r = await this.enrollments.deleteOne({ courseId: id, user: memberId });
    if (!r.deletedCount) throw new NotFoundException('This person isn’t in the course.');
    await this.submissions.deleteMany({ courseId: id, user: memberId });
    await this.notes.memberRemoved(memberId, id, c.title).catch(() => undefined);
  }

  /* ---------- clean-up ---------- */

  async removeCourse(courseId: string): Promise<void> {
    await Promise.all([this.homework.deleteMany({ courseId }), this.submissions.deleteMany({ courseId })]);
  }

  async removeLearner(user: string, courseId: string): Promise<void> {
    await this.submissions.deleteMany({ user, courseId });
  }

  async deleteForUser(user: string, ownedCourseIds: string[]): Promise<void> {
    await Promise.all([
      this.submissions.deleteMany({ $or: [{ user }, { courseId: { $in: ownedCourseIds } }] }),
      this.homework.deleteMany({ courseId: { $in: ownedCourseIds } })
    ]);
  }
}
