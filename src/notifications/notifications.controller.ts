import { timingSafeEqual } from 'crypto';
import { Body, Controller, Delete, ForbiddenException, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsMongoId, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { Public, UserId } from '../auth/auth.decorators';
import { ParseObjectIdPipe } from '../common/parse-object-id.pipe';
import { NotificationsService } from './notifications.service';
import { PUSH_PLATFORMS, type PushPlatform } from './push-token.schema';
import { PushService } from './push.service';

const EXPO_TOKEN = /^ExponentPushToken\[.+\]$|^ExpoPushToken\[.+\]$/;

export class PushTokenDto {
  @IsString() @MaxLength(200) @Matches(EXPO_TOKEN) token: string;
  @IsIn(PUSH_PLATFORMS) platform: PushPlatform;
}

export class RemovePushTokenDto {
  @IsString() @MaxLength(200) token: string;
}

/** The cron secret matches (constant time). No secret configured: nobody gets in. */
export function cronAllowed(given: string | undefined, secret = process.env.CRON_SECRET): boolean {
  if (!secret || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class NotificationsQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  /** Page back: only notifications older than this (ms). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) before?: number;
}

export class MarkReadDto {
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsMongoId({ each: true }) ids?: string[];
  @IsOptional() @IsBoolean() all?: boolean;
}

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notes: NotificationsService,
    private readonly push: PushService
  ) {}

  /** This device's Expo push token (moved to this user if someone else had it). */
  @Post('push-token')
  @HttpCode(204)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async addPushToken(@UserId() user: string, @Body() dto: PushTokenDto) {
    await this.push.register(user, dto.token, dto.platform);
  }

  /** Signing out: this device stops getting pushes. */
  @Delete('push-token')
  @HttpCode(204)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async removePushToken(@UserId() user: string, @Body() dto: RemovePushTokenDto) {
    await this.push.unregister(user, dto.token);
  }

  /** Called hourly by cron-job.org with header `x-cron-secret`: checks everyone who has a phone registered. */
  @Public()
  @SkipThrottle()
  @Post('cron')
  @HttpCode(200)
  cron(@Headers('x-cron-secret') secret?: string) {
    if (!cronAllowed(secret)) throw new ForbiddenException();
    return this.notes.refreshAll();
  }

  /** Newest first; also checks for anything new (today's course day, homework due or late, …). */
  @Get()
  list(@UserId() user: string, @Query() q: NotificationsQuery) {
    return this.notes.list(user, q.limit ?? 30, q.before);
  }

  /** How many are unread (after checking for anything new). */
  @Get('unread')
  unread(@UserId() user: string) {
    return this.notes.count(user);
  }

  /** `{ ids }` or `{ all: true }`. */
  @Post('read')
  @HttpCode(200)
  read(@UserId() user: string, @Body() dto: MarkReadDto) {
    return this.notes.markRead(user, dto.ids, !!dto.all);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@UserId() user: string, @Param('id', ParseObjectIdPipe) id: string) {
    await this.notes.remove(user, id);
  }
}
