import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { LEVELS } from '../common/constants';
import { daysBetween, todayKey } from '../common/day';
import { FamilyMember, familyProp } from '../common/family';
import { jsonOptions } from '../common/to-json';

export const VISIBILITIES = ['private', 'public'] as const;
export const WORD_SOURCES = ['library', 'ai', 'manual'] as const;
export const TOTAL_DAYS = 30;

/** The details of a course word that come from the library (or are written for this course only). */
export const COURSE_WORD_FIELDS = ['ipa', 'pos', 'meaning', 'vi', 'ex', 'syn', 'ant', 'family', 'level'] as const;
export type CourseWordField = (typeof COURSE_WORD_FIELDS)[number];

/** A course word with all its details: the library word with the course's own changes on top (course-words.ts). */
export interface CourseWord {
  word: string; ipa: string; pos: string; meaning: string; vi: string; ex: string; syn: string[]; ant: string[];
  /** Related forms (decide → decision, decisive…), the word itself included; [] = none. */
  family: FamilyMember[];
  level: string;
  /** Library entry the word comes from; '' when it's only in this course. */
  libraryId: string;
  source: string;
}
export type CourseWordOverrides = Partial<Pick<CourseWord, CourseWordField>>;

/**
 * A word as stored in a course day: a link to the library word plus what this course changed (`overrides`), so a
 * library edit (or an AI regenerate) shows in every course. A word that isn't in the library keeps all its details
 * in `overrides`. Courses saved before kept a full copy in the old fields below; they are read as overrides until
 * scripts/migrate-course-words.js turns them into links.
 */
@Schema({ _id: false })
export class CourseWordRef {
  @Prop({ required: true, trim: true }) word: string;
  @Prop({ default: '' }) libraryId: string;
  @Prop({ enum: WORD_SOURCES, default: 'manual' }) source: string;
  @Prop({ type: Object, default: () => ({}) }) overrides: CourseWordOverrides;
  // The old full copy (no defaults, so new words don't get these fields).
  @Prop() ipa?: string;
  @Prop() pos?: string;
  @Prop() meaning?: string;
  @Prop() vi?: string;
  @Prop() ex?: string;
  @Prop({ type: [String], default: undefined }) syn?: string[];
  @Prop({ type: [String], default: undefined }) ant?: string[];
  @Prop({ ...familyProp, default: undefined }) family?: FamilyMember[];
  @Prop({ enum: LEVELS }) level?: string;
}
const CourseWordSchema = SchemaFactory.createForClass(CourseWordRef);

@Schema({ _id: false })
export class CourseDay {
  @Prop({ required: true }) day: number;
  @Prop({ type: [CourseWordSchema], default: [] }) words: CourseWordRef[];
}
const CourseDaySchema = SchemaFactory.createForClass(CourseDay);

/** A 30-day course: each learner starts at day 1 on the day they join, and one more day opens each day. */
@Schema({ collection: 'courses', timestamps: true, toJSON: jsonOptions })
export class Course {
  @Prop({ required: true, index: true }) ownerId: string;
  @Prop({ default: '' }) ownerName: string;
  @Prop({ required: true, trim: true }) title: string;
  @Prop({ default: '' }) description: string;
  /** How many new words each day has (set by the course owner). */
  @Prop({ default: 5 }) wordsPerDay: number;
  @Prop({ default: TOTAL_DAYS }) totalDays: number;
  /** Dictation questions (hear a sentence, type it) in each day's homework, 0–3 (set by the course owner). */
  @Prop({ default: 2 }) dictationPerDay: number;
  /**
   * Day 1 for everyone (YYYY-MM-DD, app time zone). '' = self-paced: each learner's day 1 is the day they join.
   */
  @Prop({ default: '' }) startDate: string;
  /** private: only the owner and people with the join code; public: listed for everyone. */
  @Prop({ enum: VISIBILITIES, default: 'private', index: true }) visibility: string;
  /** Code others can use to join (also works for public courses). */
  @Prop({ required: true, unique: true }) joinCode: string;
  /** Tag added to the course's words when a learner saves them to My Vocabulary. */
  @Prop({ required: true }) tag: string;
  @Prop({ type: [CourseDaySchema], default: [] }) days: CourseDay[];
}
export type CourseDocument = HydratedDocument<Course>;
export const CourseSchema = SchemaFactory.createForClass(Course);

/** One learner taking one course. */
@Schema({ collection: 'enrollments', timestamps: true, toJSON: jsonOptions })
export class Enrollment {
  @Prop({ required: true, index: true }) user: string;
  @Prop({ required: true, index: true }) courseId: string;
  /** The learner's day 1 (YYYY-MM-DD, app time zone). */
  @Prop({ required: true }) startDay: string;
  /** Days whose words the learner has learned (saved to My Vocabulary). */
  @Prop({ type: [{ day: Number, at: Date, _id: false }], default: [] }) learned: { day: number; at: Date }[];
  /** Days whose warm-up (review of earlier words) the learner has finished, with how they did (words: each answer). */
  @Prop({ type: [{ day: Number, at: Date, correct: Number, total: Number, words: { type: [{ word: String, ok: Boolean, _id: false }], default: [] }, _id: false }], default: [] })
  warmedUp: { day: number; at: Date; correct: number; total: number; words?: { word: string; ok: boolean }[] }[];
  /** Days whose listening practice the learner has finished (or skipped). */
  @Prop({ type: [{ day: Number, at: Date, correct: Number, total: Number, _id: false }], default: [] })
  listened: { day: number; at: Date; correct: number; total: number }[];
}
export type EnrollmentDocument = HydratedDocument<Enrollment>;
export const EnrollmentSchema = SchemaFactory.createForClass(Enrollment);
EnrollmentSchema.index({ user: 1, courseId: 1 }, { unique: true });

/**
 * The learner's current day: day 1 on their start day (the course's start date, or the day they joined),
 * one more each day, up to the last day. 0 = the course hasn't started yet.
 */
export function currentDay(e: Pick<Enrollment, 'startDay'>, totalDays: number): number {
  return Math.min(totalDays, Math.max(0, daysBetween(e.startDay, todayKey()) + 1));
}
