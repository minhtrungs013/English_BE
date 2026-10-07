import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { addDays, appTimeZone, daysBetween, todayKey } from '../common/day';
import { Course, Enrollment, currentDay } from '../courses/course.schema';
import { BankItem, Submission } from '../courses/homework.schema';
import { Profile } from '../profile/profile.schema';
import { Word } from '../words/word.schema';
import { Notification, NotificationDocument, NotifyLink, NotifyType } from './notification.schema';

/** Checking a user's courses for new notifications happens at most this often. */
const CHECK_EVERY_MS = 60_000;
/** Late homework is only mentioned for the last few days, so an old course doesn't flood the list. */
const LATE_DAYS_SHOWN = 3;
/** Owners hear about days without words this many days before a learner reaches them. */
const EMPTY_DAY_NOTICE = 2;
/** Hours (app time zone) after which the evening reminders appear. */
const DUE_HOUR = 18;
const STREAK_HOUR = 20;

const plural = (n: number, w: string) => n + ' ' + w + (n === 1 ? '' : 's');
const people = (n: number) => (n === 1 ? '1 person' : n + ' people');
const penaltyFor = (late: number) => (late <= 0 ? 100 : late === 1 ? 80 : late === 2 ? 60 : 50);

/** The current hour (0–23) in the app's time zone. */
function hourNow(): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: appTimeZone(), hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
}

/** "10 Oct" for a YYYY-MM-DD key. */
function shortDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

interface Draft { key: string; type: NotifyType; title: string; body?: string; link?: NotifyLink | null }

@Injectable()
export class NotificationsService {
  private readonly checked = new Map<string, number>();

  constructor(
    @InjectModel(Notification.name) private readonly notes: Model<Notification>,
    @InjectModel(Course.name) private readonly courses: Model<Course>,
    @InjectModel(Enrollment.name) private readonly enrollments: Model<Enrollment>,
    @InjectModel(Submission.name) private readonly submissions: Model<Submission>,
    @InjectModel(BankItem.name) private readonly bank: Model<BankItem>,
    @InjectModel(Word.name) private readonly words: Model<Word>,
    @InjectModel(Profile.name) private readonly profiles: Model<Profile>
  ) {}

  /* ---------- writing ---------- */

  private async muted(user: string): Promise<Set<string>> {
    const p = await this.profiles.findOne({ user }, { 'settings.mute': 1 }).lean<{ settings?: { mute?: string[] } }>();
    return new Set(p?.settings?.mute ?? []);
  }

  /** Creates notifications that don't exist yet (by key); existing ones are left as they are. */
  private async addMany(user: string, drafts: Draft[]): Promise<void> {
    if (!drafts.length) return;
    const mute = await this.muted(user);
    const ops = drafts.filter((d) => !mute.has(d.type)).map((d) => ({
      updateOne: {
        filter: { user, key: d.key },
        update: { $setOnInsert: { user, key: d.key, type: d.type, title: d.title, body: d.body ?? '', link: d.link ?? null, count: 1, readAt: null } },
        upsert: true
      }
    }));
    if (ops.length) await this.notes.bulkWrite(ops, { ordered: false });
  }

  /**
   * A notification that groups repeats under one key (e.g. several people joining today):
   * the count goes up, the text is rewritten for the new count and it becomes unread again.
   */
  private async bump(user: string, key: string, type: NotifyType, text: (count: number) => { title: string; body?: string }, link: NotifyLink | null) {
    if ((await this.muted(user)).has(type)) return;
    const n = await this.notes.findOneAndUpdate(
      { user, key },
      { $setOnInsert: { user, key, type, link, title: '', body: '' }, $inc: { count: 1 } },
      { upsert: true, returnDocument: 'after' }
    );
    if (!n) return;
    const t = text(n.count);
    await this.notes.updateOne({ _id: n._id }, { $set: { title: t.title, body: t.body ?? '', readAt: null } });
  }

  /* ---------- events (called by other services) ---------- */

  /** Someone joined a course: tell the owner (grouped per course per day). */
  async memberJoined(ownerId: string, learnerId: string, courseId: string, courseTitle: string, learnerName: string) {
    if (ownerId === learnerId) return;
    await this.bump(ownerId, 'join:' + courseId + ':' + todayKey(), 'member_joined', (n) => ({
      title: n === 1 ? learnerName + ' joined “' + courseTitle + '”' : people(n) + ' joined “' + courseTitle + '” today',
      body: 'See how your learners are doing in Members.'
    }), { to: 'course', courseId, tab: 'members' });
  }

  /** The owner removed someone from a course. */
  async memberRemoved(learnerId: string, courseId: string, courseTitle: string) {
    await this.addMany(learnerId, [{
      key: 'removed:' + courseId + ':' + Date.now(), type: 'member_removed',
      title: 'You were removed from “' + courseTitle + '”', body: 'The course owner removed you. Your homework in it was deleted.', link: null
    }]);
  }

  /** Someone saved a word the user shared to the library (grouped per word per day). */
  async librarySaved(authorId: string, saverId: string, libraryId: string, word: string) {
    if (!authorId || authorId === saverId) return;
    await this.bump(authorId, 'libsave:' + libraryId + ':' + todayKey(), 'library_saved', (n) => ({
      title: (n === 1 ? 'Someone' : people(n)) + ' saved your word “' + word + '”' + (n === 1 ? '' : ' today'),
      body: 'Thanks for sharing it to the library.'
    }), { to: 'library' });
  }

  /* ---------- checks when the user opens the app ---------- */

  /**
   * Works out what the user should hear about right now: today's course day, homework due tonight or late,
   * a streak about to end, a course starting tomorrow, words due for review, and (for owners) questions
   * waiting for approval or upcoming days without words. Each is created once (by key).
   */
  async refresh(user: string, force = false): Promise<void> {
    const last = this.checked.get(user) ?? 0;
    if (!force && Date.now() - last < CHECK_EVERY_MS) return;
    this.checked.set(user, Date.now());

    const today = todayKey();
    const hour = hourNow();
    const drafts: Draft[] = [];

    // ---- courses I'm taking
    const mine = await this.enrollments.find({ user }).lean();
    const ids = mine.map((e) => e.courseId);
    const owned = await this.courses.find({ ownerId: user }, { _id: 1 }).lean();
    const allIds = [...new Set([...ids, ...owned.map((c) => String(c._id))])];
    const courses = new Map((await this.courses.find({ _id: { $in: allIds } }, { title: 1, totalDays: 1, ownerId: 1, 'days.day': 1, 'days.words.word': 1 }).lean())
      .map((c) => [String(c._id), c]));
    const subs = ids.length ? await this.submissions.find({ user, courseId: { $in: ids }, submittedAt: { $ne: null } }, { courseId: 1, day: 1, lateDays: 1 }).lean() : [];

    for (const e of mine) {
      const c = courses.get(e.courseId);
      if (!c) continue;
      const cid = e.courseId;
      const wordsOn = (d: number) => c.days.find((x) => x.day === d)?.words.length ?? 0;
      const cur = currentDay(e, c.totalDays);
      if (cur === 0) {
        if (daysBetween(today, e.startDay) === 1) {
          drafts.push({ key: 'start:' + cid + ':' + e.startDay, type: 'course_start', title: '“' + c.title + '” starts tomorrow', body: 'Day 1 opens on ' + shortDate(e.startDay) + '.', link: { to: 'course', courseId: cid } });
        }
        continue;
      }
      const handed = subs.filter((s) => s.courseId === cid);
      const handedDays = new Set(handed.map((s) => s.day));
      const isToday = daysBetween(e.startDay, today) + 1 === cur; // false once the course has ended
      if (isToday && wordsOn(cur)) {
        drafts.push({
          key: 'day:' + cid + ':' + cur, type: 'day_open',
          title: 'Day ' + cur + ' of “' + c.title + '” is open', body: plural(wordsOn(cur), 'new word') + (wordsOn(cur) === 1 ? ' is' : ' are') + ' waiting for you.',
          link: { to: 'course', courseId: cid, day: cur }
        });
        if (hour >= DUE_HOUR && !handedDays.has(cur)) {
          drafts.push({
            key: 'due:' + cid + ':' + cur, type: 'homework_due',
            title: 'Day ' + cur + ' homework is due tonight', body: 'Hand it in before midnight to keep 100% of the score in “' + c.title + '”.',
            link: { to: 'course', courseId: cid, day: cur, step: 'homework' }
          });
        }
        if (hour >= STREAK_HOUR && !handedDays.has(cur)) {
          const onTime = new Set(handed.filter((s) => s.lateDays === 0).map((s) => s.day));
          let streak = 0;
          for (let d = cur - 1; d >= 1; d--) {
            if (onTime.has(d)) streak++;
            else if (wordsOn(d)) break;
          }
          if (streak >= 3) {
            drafts.push({
              key: 'streak:' + cid + ':' + cur, type: 'streak_risk',
              title: 'Your ' + streak + '-day streak ends tonight', body: 'Hand in day ' + cur + ' of “' + c.title + '” on time to keep it going.',
              link: { to: 'course', courseId: cid, day: cur, step: 'homework' }
            });
          }
        }
      }
      for (let d = cur - 1; d >= Math.max(1, cur - LATE_DAYS_SHOWN); d--) {
        if (!wordsOn(d) || handedDays.has(d)) continue;
        const late = daysBetween(addDays(e.startDay, d - 1), today);
        if (late < 1) continue;
        drafts.push({
          key: 'late:' + cid + ':' + d, type: 'homework_late',
          title: 'Day ' + d + ' homework is late', body: 'Hand it in now to keep ' + penaltyFor(late) + '% of the score in “' + c.title + '”.',
          link: { to: 'course', courseId: cid, day: d, step: 'homework' }
        });
      }
    }

    // ---- courses I own
    for (const o of owned) {
      const cid = String(o._id);
      const c = courses.get(cid);
      if (!c) continue;
      const pending = await this.bank.countDocuments({ courseId: cid, status: 'pending' });
      if (pending) {
        drafts.push({
          key: 'pending:' + cid + ':' + today, type: 'owner_pending',
          title: plural(pending, 'item') + ' waiting for your approval', body: 'Questions or dialogues in “' + c.title + '” need a look before learners get them.',
          link: { to: 'course', courseId: cid }
        });
      }
      // Days without words that a learner reaches soon (earliest date first).
      const learners = await this.enrollments.find({ courseId: cid, user: { $ne: user } }, { startDay: 1 }).lean();
      const soon = new Map<number, string>();
      for (const l of learners) {
        const cur = currentDay(l, c.totalDays);
        for (let d = Math.max(1, cur); d <= Math.min(c.totalDays, cur + EMPTY_DAY_NOTICE); d++) {
          if (c.days.some((x) => x.day === d && x.words.length)) continue;
          const date = addDays(l.startDay, d - 1);
          if (daysBetween(today, date) < 0) continue;
          if (!soon.has(d) || date < soon.get(d)!) soon.set(d, date);
        }
      }
      for (const [d, date] of soon) {
        drafts.push({
          key: 'empty:' + cid + ':' + d, type: 'owner_empty_day',
          title: 'Day ' + d + ' of “' + c.title + '” has no words yet', body: date === today ? 'A learner is on that day today.' : 'A learner reaches it on ' + shortDate(date) + '.',
          link: { to: 'course', courseId: cid }
        });
      }
    }

    // ---- my vocabulary
    const due = await this.words.countDocuments({ user, dueAt: { $lte: new Date() } });
    if (due) {
      drafts.push({ key: 'words:' + today, type: 'words_due', title: plural(due, 'word') + ' due for review', body: 'A short review keeps them fresh.', link: { to: 'review' } });
    }

    await this.addMany(user, drafts);
  }

  /* ---------- reading ---------- */

  private view(n: NotificationDocument) {
    return {
      id: String(n._id), type: n.type, title: n.title, body: n.body, link: n.link, count: n.count,
      read: !!n.readAt, at: (n as unknown as { updatedAt?: Date }).updatedAt?.getTime() ?? Date.now()
    };
  }

  async unread(user: string): Promise<number> {
    return this.notes.countDocuments({ user, readAt: null });
  }

  /** Newest first; `before` (ms) pages back. */
  async list(user: string, limit = 30, before?: number) {
    await this.refresh(user);
    const q = { user, ...(before ? { updatedAt: { $lt: new Date(before) } } : {}) };
    const rows = await this.notes.find(q).sort({ updatedAt: -1 }).limit(limit + 1);
    return { items: rows.slice(0, limit).map((n) => this.view(n)), hasMore: rows.length > limit, unread: await this.unread(user) };
  }

  async count(user: string) {
    await this.refresh(user);
    return { unread: await this.unread(user) };
  }

  /** Marks some (or all) as read. */
  async markRead(user: string, ids?: string[], all = false) {
    const filter = all ? { user, readAt: null } : { user, readAt: null, _id: { $in: (ids ?? []).filter((x) => Types.ObjectId.isValid(x)) } };
    await this.notes.updateMany(filter, { $set: { readAt: new Date() } });
    return { unread: await this.unread(user) };
  }

  async remove(user: string, id: string): Promise<void> {
    const r = await this.notes.deleteOne({ _id: id, user });
    if (!r.deletedCount) throw new NotFoundException('Notification not found.');
  }

  async deleteForUser(user: string): Promise<void> {
    this.checked.delete(user);
    await this.notes.deleteMany({ user });
  }
}
