import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ collection: 'users', timestamps: true })
export class User {
  @Prop({ required: true, trim: true }) name: string;
  @Prop({ required: true, unique: true, lowercase: true, trim: true }) email: string;
  /** scrypt hash `salt:hash` (base64). Never returned by the API — see `publicUser`. */
  @Prop({ required: true }) passwordHash: string;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);

export interface PublicUser { id: string; name: string; email: string }

export function publicUser(u: UserDocument): PublicUser {
  return { id: String(u._id), name: u.name, email: u.email };
}
