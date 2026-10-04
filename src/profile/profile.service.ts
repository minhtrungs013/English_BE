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

  async resetProgress(user: string): Promise<void> {
    await this.get(user);
    await this.profiles.updateOne({ user }, { $set: { progress: { streak: 0, lastStreakDay: '', reviewedDay: '', reviewedToday: 0 } } });
  }
}
