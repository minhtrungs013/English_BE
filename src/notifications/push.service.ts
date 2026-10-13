import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { hourNow } from '../common/day';
import { NotifyLink } from './notification.schema';
import { PushPlatform, PushToken } from './push-token.schema';

const EXPO_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo takes at most 100 messages per request. */
const CHUNK = 100;
const TIMEOUT_MS = 10_000;
/** No pushes from 22:00 to 07:00 (app time zone); the in-app notification is still created. */
const QUIET_FROM = 22;
const QUIET_TO = 7;

/** What a push needs from a notification. */
export interface PushNote { _id: unknown; type: string; title: string; body?: string; link?: NotifyLink | null }

interface ExpoTicket { status: 'ok' | 'error'; message?: string; details?: { error?: string } }

export function isQuietHour(hour = hourNow()): boolean {
  return hour >= QUIET_FROM || hour < QUIET_TO;
}

/** Sends notifications to the user's phones through the Expo push service. */
@Injectable()
export class PushService {
  private readonly log = new Logger('Push');

  constructor(@InjectModel(PushToken.name) private readonly tokens: Model<PushToken>) {}

  /** Saves the device's token for this user (moving it from whoever had it before). */
  async register(user: string, token: string, platform: PushPlatform): Promise<void> {
    await this.tokens.updateOne({ token }, { $set: { user, token, platform } }, { upsert: true });
  }

  /** Signing out on a device: it stops getting this user's pushes. */
  async unregister(user: string, token: string): Promise<void> {
    await this.tokens.deleteOne({ user, token });
  }

  /** Everyone with at least one device. */
  async users(): Promise<string[]> {
    return (await this.tokens.distinct('user')).map(String);
  }

  async deleteForUser(user: string): Promise<void> {
    await this.tokens.deleteMany({ user });
  }

  /** Pushes the notifications to all the user's devices. Never throws (problems are logged). */
  async send(user: string, notes: PushNote[]): Promise<void> {
    try {
      if (!notes.length || isQuietHour()) return;
      const devices = await this.tokens.find({ user }, { token: 1 }).lean();
      if (!devices.length) return;
      const messages = devices.flatMap((d) => notes.map((n) => ({
        to: d.token, title: n.title, body: n.body ?? '', sound: 'default', channelId: 'default',
        data: { id: String(n._id), type: n.type, link: n.link ?? null }
      })));
      for (let i = 0; i < messages.length; i += CHUNK) await this.post(messages.slice(i, i + CHUNK));
    } catch (e) {
      this.log.warn('Push failed: ' + (e as Error).message);
    }
  }

  private async post(messages: { to: string }[]): Promise<void> {
    const headers: Record<string, string> = { Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate', 'Content-Type': 'application/json' };
    if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = 'Bearer ' + process.env.EXPO_ACCESS_TOKEN;
    const res = await fetch(EXPO_URL, { method: 'POST', headers, body: JSON.stringify(messages), signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      this.log.warn('Expo push answered ' + res.status);
      return;
    }
    const tickets = ((await res.json()) as { data?: ExpoTicket[] }).data ?? [];
    // Tickets come back in the same order as the messages.
    const gone = new Set<string>();
    tickets.forEach((t, i) => {
      if (t.status !== 'error') return;
      if (t.details?.error === 'DeviceNotRegistered' && messages[i]) gone.add(messages[i].to);
      else this.log.warn('Push ticket error: ' + (t.details?.error ?? t.message ?? 'unknown'));
    });
    if (gone.size) await this.tokens.deleteMany({ token: { $in: [...gone] } });
  }
}
