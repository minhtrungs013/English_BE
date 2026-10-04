import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { LEVELS } from '../common/constants';
import { jsonOptions } from '../common/to-json';

export const TOPICS = ['it', 'interview', 'customer', 'leader', 'other'] as const;
export type Topic = (typeof TOPICS)[number];

/** Tag added to a word when it is saved from the library. */
export const TOPIC_TAG: Record<Topic, string> = {
  it: 'it', interview: 'interview', customer: 'customer-meeting', leader: 'leader-meeting', other: 'library'
};

/** A word in the shared library that every user can browse and save. */
@Schema({ collection: 'library', timestamps: true, toJSON: jsonOptions })
export class LibraryWord {
  @Prop({ required: true, trim: true }) word: string;
  /** One library entry per word (case-insensitive). */
  @Prop({ required: true, unique: true }) wordLower: string;
  @Prop({ default: '' }) ipa: string;
  @Prop({ default: 'Noun' }) pos: string;
  @Prop({ default: '' }) meaning: string;
  @Prop({ default: '' }) vi: string;
  @Prop({ default: '' }) ex: string;
  @Prop({ type: [String], default: [] }) syn: string[];
  @Prop({ type: [String], default: [] }) ant: string[];
  @Prop({ enum: LEVELS, default: 'B1' }) level: string;
  @Prop({ enum: TOPICS, default: 'other', index: true }) topic: string;
  /** User id of whoever shared it; '' for the built-in words. */
  @Prop({ default: '', index: true }) authorId: string;
  @Prop({ default: 'Wordbook' }) authorName: string;
  /** How many times users saved it to their vocabulary. */
  @Prop({ default: 0 }) saves: number;
  @Prop({ type: Date, default: () => new Date(), index: true }) sharedAt: Date;
}

export type LibraryWordDocument = HydratedDocument<LibraryWord>;
export const LibraryWordSchema = SchemaFactory.createForClass(LibraryWord);
