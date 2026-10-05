import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { LEVELS } from '../common/constants';
import { daysBetween, todayKey } from '../common/day';
import { jsonOptions } from '../common/to-json';

export const VISIBILITIES = ['private', 'public'] as const;
export const WORD_SOURCES = ['library', 'ai', 'manual'] as const;
export const TOTAL_DAYS = 30;

/** A word as stored in a course day: a snapshot, so later library edits don't change a course people are taking. */
@Schema({ _id: false })
export class CourseWord {
  @Prop({ required: true, trim: true }) word: string;
  @Prop({ default: '' }) ipa: string;
  @Prop({ default: 'Noun' }) pos: string;
  @Prop({ default: '' }) meaning: string;
  @Prop({ default: '' }) vi: string;
  @Prop({ default: '' }) ex: string;
  @Prop({ type: [String], default: [] }) syn: string[];
  @Prop({ type: [String], default: [] }) ant: string[];
  @Prop({ enum: LEVELS, default: 'B1' }) level: string;
  /** Library entry this word came from (or was shared to); '' when it's only in this course. */
  @Prop({ default: '' }) libraryId: string;
  @Prop({ enum: WORD_SOURCES, default: 'manual' }) source: string;
}
const CourseWordSchema = SchemaFactory.createForClass(CourseWord);

@Schema({ _id: false })
export class CourseDay {
  @Prop({ required: true }) day: number;
  @Prop({ type: [CourseWordSchema], default: [] }) words: CourseWord[];
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
  /** Days whose warm-up (review of earlier words) the learner has finished, with how they did. */
  @Prop({ type: [{ day: Number, at: Date, correct: Number, total: Number, _id: false }], default: [] })
  warmedUp: { day: number; at: Date; correct: number; total: number }[];
}
export type EnrollmentDocument = HydratedDocument<Enrollment>;
export const EnrollmentSchema = SchemaFactory.createForClass(Enrollment);
EnrollmentSchema.index({ user: 1, courseId: 1 }, { unique: true });

/** The learner's current day: day 1 on the day they joined, one more each day, up to the last day. */
export function currentDay(e: Pick<Enrollment, 'startDay'>, totalDays: number): number {
  return Math.min(totalDays, Math.max(1, daysBetween(e.startDay, todayKey()) + 1));
}
