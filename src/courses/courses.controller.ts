import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserId } from '../auth/auth.decorators';
import { ParseObjectIdPipe } from '../common/parse-object-id.pipe';
import type { Topic } from '../library/library.schema';
import { CoursesService } from './courses.service';
import {
  AiWordDto, BankItemDto, BankQuery, BankStatusDto, CoursesQuery, CreateCourseDto, GenerateQuestionsDto, JoinByCodeDto, LeaderboardQuery,
  SetDayDto, ShareCourseWordDto, SubmitHomeworkDto, UpdateBankItemDto, UpdateCourseDto
} from './courses.dto';
import { QuestionsService } from './questions.service';
import { HomeworkService } from './homework.service';

@ApiTags('courses')
@ApiBearerAuth()
@Controller('courses')
export class CoursesController {
  constructor(
    private readonly courses: CoursesService,
    private readonly homework: HomeworkService,
    private readonly questions: QuestionsService
  ) {}

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

  /** The homework of an open day (answers only after it's handed in). */
  @Get(':id/days/:day/homework')
  getHomework(@UserId() user: string, @Param('id', ParseObjectIdPipe) id: string, @Param('day', ParseIntPipe) day: number) {
    return this.homework.get(user, id, day);
  }

  /** Hand in a day's homework (once); graded on the server, with the late penalty applied. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':id/days/:day/homework')
  @HttpCode(200)
  submitHomework(@UserId() user: string, @Param('id', ParseObjectIdPipe) id: string, @Param('day', ParseIntPipe) day: number, @Body() dto: SubmitHomeworkDto) {
    return this.homework.submit(user, id, day, dto.answers);
  }

  /** Warm-up before a day's new words: earlier words (the ones I missed first) and the day's recap story. */
  @Get(':id/days/:day/warmup')
  warmup(@UserId() user: string, @Param('id', ParseObjectIdPipe) id: string, @Param('day', ParseIntPipe) day: number) {
    return this.homework.warmup(user, id, day);
  }

  /* ---------- question bank (owner) ---------- */

  /** The tense questions and recap stories (?day= for one day), with their approval status. */
  @Get(':id/questions')
  listQuestions(@UserId() user: string, @Param('id', ParseObjectIdPipe) id: string, @Query() q: BankQuery) {
    return this.questions.list(user, id, q.day);
  }

  /** Write tense questions (and a recap) for a day with AI; they wait for approval. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/days/:day/questions/generate')
  @HttpCode(200)
  generateQuestions(@UserId() user: string, @Param('id', ParseObjectIdPipe) id: string, @Param('day', ParseIntPipe) day: number, @Body() dto: GenerateQuestionsDto) {
    return this.questions.generate(user, id, day, dto);
  }

  /** Add a question or recap by hand (approved straight away). */
  @Post(':id/days/:day/questions')
  createQuestion(@UserId() user: string, @Param('id', ParseObjectIdPipe) id: string, @Param('day', ParseIntPipe) day: number, @Body() dto: BankItemDto) {
    return this.questions.create(user, id, day, dto);
  }

  /** Approve / reject several at once. */
  @Post(':id/questions/status')
  @HttpCode(200)
  setQuestionStatus(@UserId() user: string, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: BankStatusDto) {
    return this.questions.setStatus(user, id, dto.ids, dto.status);
  }

  @Patch(':id/questions/:qid')
  updateQuestion(@UserId() user: string, @Param('id', ParseObjectIdPipe) id: string, @Param('qid', ParseObjectIdPipe) qid: string, @Body() dto: UpdateBankItemDto) {
    return this.questions.update(user, id, qid, dto);
  }

  @Delete(':id/questions/:qid')
  @HttpCode(204)
  async removeQuestion(@UserId() user: string, @Param('id', ParseObjectIdPipe) id: string, @Param('qid', ParseObjectIdPipe) qid: string) {
    await this.questions.remove(user, id, qid);
  }

  /** Leaderboards: one day (?day=, default my current day), total score, and on-time streaks. */
  @Get(':id/leaderboard')
  leaderboard(@UserId() user: string, @Param('id', ParseObjectIdPipe) id: string, @Query() q: LeaderboardQuery) {
    return this.homework.leaderboard(user, id, q.day);
  }
}
