import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export const PUSH_PLATFORMS = ['ios', 'android'] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

/** An Expo push token of one device. A token belongs to one user at a time (the last one signed in on it). */
@Schema({ collection: 'push_tokens', timestamps: { createdAt: false, updatedAt: true } })
export class PushToken {
  @Prop({ required: true, index: true }) user: string;
  @Prop({ required: true, unique: true }) token: string;
  @Prop({ required: true, enum: PUSH_PLATFORMS }) platform: PushPlatform;
}
export const PushTokenSchema = SchemaFactory.createForClass(PushToken);
