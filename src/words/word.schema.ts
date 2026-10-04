import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { LEVELS, RATINGS, STATUSES } from '../common/constants';
import { jsonOptions } from '../common/to-json';

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
  @Prop({ default: '' }) ipa: string;
  @Prop({ default: 'Noun' }) pos: string;
  @Prop({ default: '' }) meaning: string;
  @Prop({ default: '' }) vi: string;
  @Prop({ default: '' }) ex: string;
  @Prop({ type: [String], default: [] }) syn: string[];
  @Prop({ type: [String], default: [] }) ant: string[];
  @Prop({ enum: LEVELS, default: 'B1' }) level: string;
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
