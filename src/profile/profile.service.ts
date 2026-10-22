import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { previousDay, STYLE_UNLOCKS } from '../common/constants';
import { todayKey } from '../common/day';
import { PlanService } from '../plans/plans';

/** Daily limits that reset at midnight (app time zone). The numbers come from the user's plan (PlanService). */
export type DailyQuota = 'autofill' | 'courseAi' | 'chat' | 'sentence';
import { Profile, ProfileDocument, Progress, Settings } from './profile.schema';
import { UpdateSettingsDto } from './profile.dto';

@Injectable()
export class ProfileService {
  constructor(@InjectModel(Profile.name) private readonly profiles: Model<Profile>, private readonly plans: PlanService) {}

  /** Returns the user's profile, creating it with defaults on first use. */
  async get(user: string): Promise<ProfileDocument> {
    return this.profiles.findOneAndUpdate({ user }, { $setOnInsert: { user } }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true });
  }

  async create(user: string, settings: Partial<Settings>, progress: Partial<Progress> = {}): Promise<ProfileDocument> {
    await this.profiles.deleteOne({ user });
    return this.profiles.create({ user, settings, progress });
  }

  async updateSettings(user: string, dto: UpdateSettingsDto): Promise<ProfileDocument> {
    const doc = await this.get(user);
    const need = dto.style ? STYLE_UNLOCKS[dto.style] : undefined;
    if (need && Math.max(doc.progress?.bestStreak ?? 0, doc.progress?.streak ?? 0) < need) {
      throw new ForbiddenException('Keep a ' + need + '-day review streak to unlock this style.');
    }
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
    p.bestStreak = Math.max(p.bestStreak ?? 0, p.streak);
    doc.markModified('progress');
    await doc.save();
    return doc.toJSON().progress as Progress;
  }

  dailyLimit(user: string, q: DailyQuota): Promise<number> {
    return this.plans.limit(user, q);
  }

  /** How much of a daily limit the user has used today. */
  async dailyStatus(user: string, q: DailyQuota): Promise<{ used: number; limit: number }> {
    const doc = await this.get(user);
    const c = doc[q];
    return { used: c?.day === todayKey() ? c.count : 0, limit: await this.dailyLimit(user, q) };
  }

  /**
   * Uses one of today's allowance. Returns false when the limit is reached.
   * Done with conditional updates so two quick taps can't both slip past the limit.
   * Every daily quota is for AI work, so it also throws 429 when the plan's AI tokens for today are used up.
   */
  async useDaily(user: string, q: DailyQuota, opts: { checkTokens?: boolean } = {}): Promise<boolean> {
    const day = todayKey();
    const limit = await this.dailyLimit(user, q);
    if (limit === 0) return false;
    if (opts.checkTokens !== false) await this.plans.assertTokens(user);
    await this.get(user);
    const sameDay = await this.profiles.updateOne({ user, [q + '.day']: day, [q + '.count']: { $lt: limit } }, { $inc: { [q + '.count']: 1 } });
    if (sameDay.modifiedCount) return true;
    const newDay = await this.profiles.updateOne({ user, [q + '.day']: { $ne: day } }, { $set: { [q]: { day, count: 1 } } });
    return newDay.modifiedCount > 0;
  }

  /** Throws 429 when today's AI tokens (plan) are used up; for callers that count the quota only after the AI call. */
  assertTokens(user: string) { return this.plans.assertTokens(user); }

  /** Gives back one use of today's allowance (the AI call it was for failed). */
  async refundDaily(user: string, q: DailyQuota): Promise<void> {
    await this.profiles.updateOne({ user, [q + '.day']: todayKey(), [q + '.count']: { $gt: 0 } }, { $inc: { [q + '.count']: -1 } });
  }

  autofillStatus(user: string) { return this.dailyStatus(user, 'autofill'); }
  useAutofill(user: string) { return this.useDaily(user, 'autofill'); }

  async resetProgress(user: string): Promise<void> {
    await this.get(user);
    await this.profiles.updateOne({ user }, { $set: { progress: { streak: 0, lastStreakDay: '', reviewedDay: '', reviewedToday: 0 } } });
  }
}
