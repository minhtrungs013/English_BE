import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { LEVELS } from '../common/constants';
import { FamilyMember, familyProp } from '../common/family';
import { jsonOptions } from '../common/to-json';

export const TOPICS = ['it', 'interview', 'customer', 'leader', 'toeic', 'other'] as const;
export type Topic = (typeof TOPICS)[number];

/** Tag added to a word when it is saved from the library. */
export const TOPIC_TAG: Record<Topic, string> = {
  it: 'it', interview: 'interview', customer: 'customer-meeting', leader: 'leader-meeting', toeic: 'toeic', other: 'library'
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
  /** Related forms (decide → decision, decisive…), the word itself included; [] = none. */
  @Prop(familyProp) family: FamilyMember[];
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

/**
 * A Vietnamese meaning a learner suggested for a library word (from the chat, when the word meant something the
 * library entry doesn't have, e.g. platform = "nền tảng" while the library only says "sân ga"). An admin approves it.
 */
@Schema({ collection: 'meaning_suggestions', versionKey: false })
export class MeaningSuggestion {
  @Prop({ required: true, index: true }) libraryWordId: string;
  @Prop({ required: true }) word: string;
  @Prop({ required: true }) vi: string;
  /** Lowercase vi: one suggestion per meaning per word. */
  @Prop({ required: true }) viKey: string;
  @Prop({ default: '' }) userId: string;
  @Prop({ default: '' }) userName: string;
  @Prop({ enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true }) status: string;
  @Prop({ default: () => new Date() }) at: Date;
}
export const MeaningSuggestionSchema = SchemaFactory.createForClass(MeaningSuggestion);
MeaningSuggestionSchema.index({ libraryWordId: 1, viKey: 1 }, { unique: true });

/** The meanings in a Vietnamese field ("nền tảng, sân ga" → ["nền tảng", "sân ga"]), lowercase. */
export const viParts = (vi: string): string[] => vi.toLowerCase().normalize('NFC').split(/[,;/]/).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
/** True when the field already has this meaning (or one containing it, e.g. "nền tảng (phần mềm)"). */
export const hasMeaning = (vi: string, sense: string): boolean => {
  const s = sense.toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();
  return !!s && viParts(vi).some((p) => p === s || p.includes(s) || s.includes(p));
};
