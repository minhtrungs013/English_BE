import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { LEVELS, RATINGS, STATUSES } from '../common/constants';
import { FamilyMember, familyProp } from '../common/family';
import { jsonOptions } from '../common/to-json';
import type { CourseWordOverrides as WordDetailsPatch } from '../courses/course.schema';

@Schema({ _id: false })
export class ReviewEntry {
  @Prop({ type: Date, required: true }) at: Date;
  @Prop({ enum: RATINGS, required: true }) r: string;
}

@Schema({ collection: 'words', timestamps: true, toJSON: jsonOptions })
export class Word {
  /** Owner (user id). */
  @Prop({ required: true, index: true }) user: string;
  @Prop({ required: true, trim: true }) word: string;
  /** Lower-cased copy of `word`; unique per user so a word can't be saved twice. */
  @Prop({ required: true }) wordLower: string;
  /**
   * The library word this is (its details come from there: words.service.ts views); '' for a word that isn't in the
   * library (a phrase, or one with no meaning yet), whose details are all in `overrides`.
   */
  @Prop({ default: '', index: true }) libraryId: string;
  /** What I changed for myself (only the fields that differ from the library word). */
  @Prop({ type: Object, default: () => ({}) }) overrides: WordDetailsPatch;
  // The old full copy (words saved before they were links; no defaults, so new words don't get these fields).
  @Prop() ipa?: string;
  @Prop() pos?: string;
  @Prop() meaning?: string;
  @Prop() vi?: string;
  @Prop() ex?: string;
  @Prop({ type: [String], default: undefined }) syn?: string[];
  @Prop({ type: [String], default: undefined }) ant?: string[];
  @Prop({ ...familyProp, default: undefined }) family?: FamilyMember[];
  @Prop({ enum: LEVELS }) level?: string;
  @Prop({ enum: STATUSES, default: 'new' }) status: string;
  /** Category id, or '' when uncategorized. */
  @Prop({ default: '', index: true }) cat: string;
  @Prop({ type: [String], default: [], index: true }) tags: string[];
  @Prop({ default: '' }) notes: string;
  @Prop({ type: Date, default: () => new Date(), index: true }) dueAt: Date;
  @Prop({ type: Date, default: () => new Date(), index: true }) addedAt: Date;
  @Prop({ type: [SchemaFactory.createForClass(ReviewEntry)], default: [] }) hist: ReviewEntry[];
}

export type WordDocument = HydratedDocument<Word>;
export const WordSchema = SchemaFactory.createForClass(Word);
WordSchema.index({ user: 1, wordLower: 1 }, { unique: true });
