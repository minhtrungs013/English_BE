import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserId } from '../auth/auth.decorators';
import { ParseObjectIdPipe } from '../common/parse-object-id.pipe';
import type { Topic } from '../library/library.schema';
import { CoursesService } from './courses.service';
import { AiWordDto, CoursesQuery, CreateCourseDto, JoinByCodeDto, SetDayDto, ShareCourseWordDto, UpdateCourseDto } from './courses.dto';

@ApiTags('courses')
@ApiBearerAuth()
@Controller('courses')
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  /** ?scope=joined (default) | mine | public */
  @Get()
  list(@UserId() user: string, @Query() q: CoursesQuery) {
    return this.courses.list(user, q.scope);
  }

  @Post()
  create(@UserId() user: string, @Body() dto: CreateCourseDto) {
    return this.courses.create(user, dto);
  }

  /** Word details for a course: the library's entry if there is one, otherwise AI (daily limit). */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('ai-word')
  @HttpCode(200)
  aiWord(@UserId() user: string, @Body() dto: AiWordDto) {
    return this.courses.aiWord(user, dto.word);
  }

  @Post('join')
  @HttpCode(200)
  joinByCode(@UserId() user: string, @Body() dto: JoinByCodeDto) {
    return this.courses.joinByCode(user, dto.code);
  }

  @Get(':id')
  get(@UserId() user: string, @Param('id', ParseObjectIdPipe) id: string) {
    return this.courses.get(user, id);
  }

  @Patch(':id')
  update(@UserId() user: string, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateCourseDto) {
    return this.courses.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@UserId() user: string, @Param('id', ParseObjectIdPipe) id: string) {
    await this.courses.remove(user, id);
  }

  /** Replace the words of day `day` (owner only). */
  @Put(':id/days/:day')
  setDay(@UserId() user: string, @Param('id', ParseObjectIdPipe) id: string, @Param('day', ParseIntPipe) day: number, @Body() dto: SetDayDto) {
    return this.courses.setDay(user, id, day, dto.words);
  }

  /** Add word #index of a day to the shared library (owner only). */
  @Post(':id/days/:day/words/:index/library')
  @HttpCode(200)
  shareWord(@UserId() user: string, @Param('id', ParseObjectIdPipe) id: string, @Param('day', ParseIntPipe) day: number,
    @Param('index', ParseIntPipe) index: number, @Body() dto: ShareCourseWordDto) {
    return this.courses.shareWord(user, id, day, index, (dto.topic ?? 'other') as Topic);
  }

  /** Join a public course (or one you own). Private courses need POST /courses/join with the code. */
  @Post(':id/join')
  @HttpCode(200)
  join(@UserId() user: string, @Param('id', ParseObjectIdPipe) id: string) {
    return this.courses.join(user, id);
  }

  @Delete(':id/enrollment')
  @HttpCode(204)
  async leave(@UserId() user: string, @Param('id', ParseObjectIdPipe) id: string) {
    await this.courses.leave(user, id);
  }

  /** Learn an open day: its words are saved to My Vocabulary. */
  @Post(':id/days/:day/learn')
  @HttpCode(200)
  learn(@UserId() user: string, @Param('id', ParseObjectIdPipe) id: string, @Param('day', ParseIntPipe) day: number) {
    return this.courses.learn(user, id, day);
  }
}
