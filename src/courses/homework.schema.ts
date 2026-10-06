import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const QUESTION_TYPES = ['meaning', 'word', 'type', 'blank', 'tense', 'tenseChoice'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/**
 * One homework question. meaning: pick the Vietnamese meaning of a word; word: pick the word for a meaning;
 * type: type the word for a meaning; blank: type the missing word in the example sentence;
 * tense / tenseChoice: put the verb in the right tense (typed / multiple choice), from the course's question bank.
 */
@Schema({ _id: false })
export class Question {
  @Prop({ enum: QUESTION_TYPES, required: true }) type: string;
  /** The course word this question is about. */
  @Prop({ required: true }) word: string;
  /** true when the word is from an earlier day (review), false for the day's new words. */
  @Prop({ default: false }) review: boolean;
  @Prop({ required: true }) prompt: string;
  @Prop({ default: '' }) hint: string;
  /** Choices for meaning / word questions; empty for typed answers. */
  @Prop({ type: [String], default: [] }) choices: string[];
  /** The correct answer (never sent before the homework is submitted). */
  @Prop({ required: true }) answer: string;
  /** Other answers that also count as correct (e.g. the form used in the example sentence). */
  @Prop({ type: [String], default: [] }) accept: string[];
  /** Tense questions: which tense, and why (Vietnamese), shown after handing in. */
  @Prop({ default: '' }) tense?: string;
  @Prop({ default: '' }) explain?: string;
}
const QuestionSchema = SchemaFactory.createForClass(Question);

/** The homework of one course day, the same for every learner (so scores can be compared). */
@Schema({ collection: 'homework', timestamps: true })
export class Homework {
  @Prop({ required: true, index: true }) courseId: string;
  @Prop({ required: true }) day: number;
  /** The course words the questions were made from; when they change and nobody has submitted, the homework is made again. */
  @Prop({ required: true }) wordsKey: string;
  @Prop({ type: [QuestionSchema], default: [] }) questions: Question[];
}
export type HomeworkDocument = HydratedDocument<Homework>;
export const HomeworkSchema = SchemaFactory.createForClass(Homework);
HomeworkSchema.index({ courseId: 1, day: 1 }, { unique: true });

/** A learner's homework for one day: created when they first open it, completed when they submit. */
@Schema({ collection: 'submissions', timestamps: true })
export class Submission {
  @Prop({ required: true, index: true }) courseId: string;
  @Prop({ required: true, index: true }) user: string;
  @Prop({ required: true }) day: number;
  @Prop({ required: true }) openedAt: Date;
  @Prop({ type: Date, default: null }) submittedAt: Date | null;
  @Prop({ type: [String], default: [] }) answers: string[];
  @Prop({ type: [Boolean], default: [] }) results: boolean[];
  @Prop({ default: 0 }) correct: number;
  @Prop({ default: 0 }) total: number;
  /** Score before the late penalty, 0–100. */
  @Prop({ default: 0 }) raw: number;
  /** Days after the day opened for this learner (0 = on time). */
  @Prop({ default: 0 }) lateDays: number;
  /** Percent of the score kept: 100 on time, then 80, 60, 50. */
  @Prop({ default: 100 }) penalty: number;
  /** Final score, 0–100. */
  @Prop({ default: 0 }) score: number;
  @Prop({ default: 0 }) durationMs: number;
}
export type SubmissionDocument = HydratedDocument<Submission>;
export const SubmissionSchema = SchemaFactory.createForClass(Submission);
SubmissionSchema.index({ courseId: 1, user: 1, day: 1 }, { unique: true });
SubmissionSchema.index({ courseId: 1, day: 1, submittedAt: 1 });

export const BANK_KINDS = ['tense', 'tenseChoice', 'recap', 'dialogue'] as const;
/** Bank kinds that are questions in homework and warm-ups. */
export const TENSE_KINDS = ['tense', 'tenseChoice'];
export const BANK_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type BankStatus = (typeof BANK_STATUSES)[number];

/**
 * The course's question bank: tense questions about a day's words, and the day's recap story (kind 'recap',
 * read in the warm-up before the day's words). AI-written items wait for the owner's approval;
 * only approved ones are used.
 */
@Schema({ collection: 'course_questions', timestamps: true })
export class BankItem {
  @Prop({ required: true, index: true }) courseId: string;
  @Prop({ required: true }) day: number;
  @Prop({ enum: BANK_KINDS, required: true }) kind: string;
  /** The course word it's about ('' for a recap). */
  @Prop({ default: '' }) word: string;
  @Prop({ default: '' }) tense: string;
  /** The sentence with "___" (or the recap story). */
  @Prop({ required: true }) prompt: string;
  @Prop({ type: [String], default: [] }) choices: string[];
  @Prop({ default: '' }) answer: string;
  @Prop({ type: [String], default: [] }) accept: string[];
  /** Why this tense (Vietnamese), or the recap's Vietnamese translation. */
  @Prop({ default: '' }) explain: string;
  @Prop({ enum: ['ai', 'template', 'manual'], default: 'manual' }) source: string;
  @Prop({ enum: BANK_STATUSES, default: 'pending' }) status: string;
  /** Dialogues: speakers, lines (with [[blanks]]) and comprehension questions — see dialogue.ts. */
  @Prop({ type: Object, default: null }) data: Record<string, unknown> | null;
}
export type BankItemDocument = HydratedDocument<BankItem>;
export const BankItemSchema = SchemaFactory.createForClass(BankItem);
BankItemSchema.index({ courseId: 1, day: 1, status: 1 });
