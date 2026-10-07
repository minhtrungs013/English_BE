import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** Kinds of notifications. Users can mute any of them (profile setting `mute`). */
export const NOTIFY_TYPES = [
  'day_open', 'homework_due', 'homework_late', 'streak_risk', 'course_start', 'words_due',
  'member_joined', 'member_removed', 'owner_pending', 'owner_empty_day', 'library_saved'
] as const;
export type NotifyType = (typeof NOTIFY_TYPES)[number];

/** Where a notification takes the user when tapped. */
export interface NotifyLink {
  /** 'course' (with courseId, optional day / tab / step), 'review' (words due), 'library'. */
  to: 'course' | 'review' | 'library';
  courseId?: string;
  day?: number;
  tab?: 'today' | 'map' | 'board' | 'members';
  step?: 'review' | 'learn' | 'listen' | 'homework';
}

/** Notifications are kept for 60 days. */
const KEEP_SECONDS = 60 * 86_400;

/**
 * One notification for one user. `key` makes each one unique per user (e.g. "day:<course>:<day>"),
 * so checking again never creates a duplicate; `count` groups repeats (e.g. "3 people joined today").
 */
@Schema({ collection: 'notifications', timestamps: true })
export class Notification {
  @Prop({ required: true, index: true }) user: string;
  @Prop({ required: true }) key: string;
  @Prop({ required: true }) type: string;
  @Prop({ required: true }) title: string;
  @Prop({ default: '' }) body: string;
  @Prop({ type: Object, default: null }) link: NotifyLink | null;
  @Prop({ default: 1 }) count: number;
  @Prop({ type: Date, default: null }) readAt: Date | null;
}
export type NotificationDocument = HydratedDocument<Notification>;
export const NotificationSchema = SchemaFactory.createForClass(Notification);
NotificationSchema.index({ user: 1, key: 1 }, { unique: true });
NotificationSchema.index({ user: 1, createdAt: -1 });
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: KEEP_SECONDS });
