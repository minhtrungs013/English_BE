import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsMongoId, IsOptional, Max, Min } from 'class-validator';
import { UserId } from '../auth/auth.decorators';
import { ParseObjectIdPipe } from '../common/parse-object-id.pipe';
import { NotificationsService } from './notifications.service';

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
  constructor(private readonly notes: NotificationsService) {}

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
