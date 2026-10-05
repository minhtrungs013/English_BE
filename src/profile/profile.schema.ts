import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ACCENTS, DIRECTIONS, GOALS, THEMES } from '../common/constants';
import { jsonOptions } from '../common/to-json';

@Schema({ _id: false })
export class Settings {
  @Prop({ enum: GOALS, default: '20' }) goal: string;
  @Prop({ enum: DIRECTIONS, default: 'en-vi' }) dir: string;
  @Prop({ default: true }) autoplay: boolean;
  @Prop({ default: true }) showEx: boolean;
  @Prop({ enum: THEMES, default: 'light' }) theme: string;
  /** Main color of the app. */
  @Prop({ enum: ACCENTS, default: 'indigo' }) accent: string;
  /** Browser speech voice (voiceURI); '' = the browser's default English voice. */
  @Prop({ default: '' }) voice: string;
  /** Speaking speed (0.5–1.5) and pitch (0.5–1.5). */
  @Prop({ default: 0.9 }) rate: number;
  @Prop({ default: 1 }) pitch: number;
}

@Schema({ _id: false })
export class Progress {
  @Prop({ default: 0 }) streak: number;
  /** Client day key (YYYY-MM-DD) of the last day with a completed review. */
  @Prop({ default: '' }) lastStreakDay: string;
  @Prop({ default: '' }) reviewedDay: string;
  @Prop({ default: 0 }) reviewedToday: number;
}

/** A per-day usage counter: `count` uses on `day` (YYYY-MM-DD, app time zone). */
@Schema({ _id: false })
export class Autofill {
  @Prop({ default: '' }) day: string;
  @Prop({ default: 0 }) count: number;
}

/** One profile (settings + progress) per user. */
@Schema({ collection: 'profiles', timestamps: true, toJSON: jsonOptions })
export class Profile {
  @Prop({ required: true, unique: true }) user: string;
  @Prop({ type: SchemaFactory.createForClass(Settings), default: () => ({}) }) settings: Settings;
  @Prop({ type: SchemaFactory.createForClass(Progress), default: () => ({}) }) progress: Progress;
  /** Auto-fills that went to OpenAI / online dictionaries today. */
  @Prop({ type: SchemaFactory.createForClass(Autofill), default: () => ({}) }) autofill: Autofill;
  /** Words generated with AI for courses today. */
  @Prop({ type: SchemaFactory.createForClass(Autofill), default: () => ({}) }) courseAi: Autofill;
}

export type ProfileDocument = HydratedDocument<Profile>;
export const ProfileSchema = SchemaFactory.createForClass(Profile);
