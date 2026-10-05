import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { previousDay } from '../common/constants';
import { Profile, ProfileDocument, Progress, Settings } from './profile.schema';
import { UpdateSettingsDto } from './profile.dto';

@Injectable()
export class ProfileService {
  constructor(@InjectModel(Profile.name) private readonly profiles: Model<Profile>) {}

  /** Returns the user's profile, creating it with defaults on first use. */
  async get(user: string): Promise<ProfileDocument> {
    return this.profiles.findOneAndUpdate({ user }, { $setOnInsert: { user } }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true });
  }

  async create(user: string, settings: Partial<Settings>, progress: Partial<Progress> = {}): Promise<ProfileDocument> {
    await this.profiles.deleteOne({ user });
    return this.profiles.create({ user, settings, progress });
  }

  async updateSettings(user: string, dto: UpdateSettingsDto): Promise<ProfileDocument> {
    await this.get(user);
    const $set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(dto)) if (v !== undefined) $set['settings.' + k] = v;
    return (await this.profiles.findOneAndUpdate({ user }, { $set }, { returnDocument: 'after', runValidators: true }))!;
  }

  /** Counts one review on the client's `day` and extends the streak on the first review of a day. */
  async recordReview(user: string, day: string): Promise<Progress> {
    const doc = await this.get(user);
    const p = doc.progress;
    p.reviewedToday = (p.reviewedDay === day ? p.reviewedToday : 0) + 1;
    p.reviewedDay = day;
    if (p.lastStreakDay !== day) {
      p.streak = p.lastStreakDay === previousDay(day) ? p.streak + 1 : 1;
      p.lastStreakDay = day;
    }
    doc.markModified('progress');
    await doc.save();
    return doc.toJSON().progress as Progress;
  }

  /** Today's date (YYYY-MM-DD) in the app's time zone, so the daily limit resets at local midnight. */
  today(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Ho_Chi_Minh' }).format(new Date());
  }

  dailyAutofillLimit(): number {
    const n = Number(process.env.AUTOFILL_DAILY_LIMIT);
    return Number.isFinite(n) && n >= 0 ? n : 3;
  }

  /** How many auto-fills the user has used today, and the daily limit. */
  async autofillStatus(user: string): Promise<{ used: number; limit: number }> {
    const doc = await this.get(user);
    const day = this.today();
    return { used: doc.autofill?.day === day ? doc.autofill.count : 0, limit: this.dailyAutofillLimit() };
  }

  /**
   * Uses one of today's auto-fills. Returns false when the limit is reached.
   * Done with conditional updates so two quick taps can't both slip past the limit.
   */
  async useAutofill(user: string): Promise<boolean> {
    const day = this.today();
    const limit = this.dailyAutofillLimit();
    if (limit === 0) return false;
    await this.get(user);
    const sameDay = await this.profiles.updateOne({ user, 'autofill.day': day, 'autofill.count': { $lt: limit } }, { $inc: { 'autofill.count': 1 } });
    if (sameDay.modifiedCount) return true;
    const newDay = await this.profiles.updateOne({ user, 'autofill.day': { $ne: day } }, { $set: { autofill: { day, count: 1 } } });
    return newDay.modifiedCount > 0;
  }

  async resetProgress(user: string): Promise<void> {
    await this.get(user);
    await this.profiles.updateOne({ user }, { $set: { progress: { streak: 0, lastStreakDay: '', reviewedDay: '', reviewedToday: 0 } } });
  }
}
