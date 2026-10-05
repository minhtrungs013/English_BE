import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { previousDay } from '../common/constants';
import { todayKey } from '../common/day';

/** Daily limits that reset at midnight (app time zone). */
export type DailyQuota = 'autofill' | 'courseAi';
const LIMIT_ENV: Record<DailyQuota, [string, number]> = { autofill: ['AUTOFILL_DAILY_LIMIT', 3], courseAi: ['COURSE_AI_DAILY_LIMIT', 30] };
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

  dailyLimit(q: DailyQuota): number {
    const [env, fallback] = LIMIT_ENV[q];
    const n = Number(process.env[env]);
    return process.env[env] !== undefined && Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  /** How much of a daily limit the user has used today. */
  async dailyStatus(user: string, q: DailyQuota): Promise<{ used: number; limit: number }> {
    const doc = await this.get(user);
    const c = doc[q];
    return { used: c?.day === todayKey() ? c.count : 0, limit: this.dailyLimit(q) };
  }

  /**
   * Uses one of today's allowance. Returns false when the limit is reached.
   * Done with conditional updates so two quick taps can't both slip past the limit.
   */
  async useDaily(user: string, q: DailyQuota): Promise<boolean> {
    const day = todayKey();
    const limit = this.dailyLimit(q);
    if (limit === 0) return false;
    await this.get(user);
    const sameDay = await this.profiles.updateOne({ user, [q + '.day']: day, [q + '.count']: { $lt: limit } }, { $inc: { [q + '.count']: 1 } });
    if (sameDay.modifiedCount) return true;
    const newDay = await this.profiles.updateOne({ user, [q + '.day']: { $ne: day } }, { $set: { [q]: { day, count: 1 } } });
    return newDay.modifiedCount > 0;
  }

  autofillStatus(user: string) { return this.dailyStatus(user, 'autofill'); }
  useAutofill(user: string) { return this.useDaily(user, 'autofill'); }

  async resetProgress(user: string): Promise<void> {
    await this.get(user);
    await this.profiles.updateOne({ user }, { $set: { progress: { streak: 0, lastStreakDay: '', reviewedDay: '', reviewedToday: 0 } } });
  }
}
