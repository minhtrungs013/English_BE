import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { NOTIFY_TYPES } from '../notifications/notification.schema';
import { ACCENTS, DIRECTIONS, GOALS, THEMES } from '../common/constants';

/** The display name lives on the user account (PATCH /auth/me); these are learning preferences. */
export class UpdateSettingsDto {
  @IsOptional() @IsIn(GOALS) goal?: string;
  @IsOptional() @IsIn(DIRECTIONS) dir?: string;
  @IsOptional() @IsBoolean() autoplay?: boolean;
  @IsOptional() @IsBoolean() showEx?: boolean;
  @IsOptional() @IsIn(THEMES) theme?: string;
  @IsOptional() @IsIn(ACCENTS) accent?: string;
  @IsOptional() @IsString() @MaxLength(300) voice?: string;
  @IsOptional() @IsNumber() @Min(0.5) @Max(1.5) rate?: number;
  @IsOptional() @IsNumber() @Min(0.5) @Max(1.5) pitch?: number;
  /** Notification types to turn off. */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsIn(NOTIFY_TYPES, { each: true }) mute?: string[];
}
