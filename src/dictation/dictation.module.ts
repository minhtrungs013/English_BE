import { Body, Controller, Get, HttpCode, Module, Param, Post, Query } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { UserId } from '../auth/auth.decorators';
import { DictationProgress, DictationProgressSchema, DictationService } from './dictation.service';

export class DictationPracticeQuery {
  /** A set id, mix, or daily (today's dictation). */
  @IsString() @Matches(/^[a-z-]{2,30}$/) mode: string;
  /** Items (for the passages set: passages, at most 3). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(20) n?: number;
}

export class DictationAnswerDto {
  @IsString() @MaxLength(40) id: string;
  /** A line: what was typed. */
  @IsOptional() @IsString() @MaxLength(400) typed?: string;
  /** A passage: one typed text per sentence, in order. */
  @IsOptional() @IsArray() @ArrayMaxSize(6) @IsString({ each: true }) @MaxLength(400, { each: true }) typedSentences?: string[];
  @IsOptional() @IsInt() @Min(0) @Max(50) plays?: number;
  /** 1 = word count, 2 = first letters, 3 = sentence revealed (not passed). */
  @IsOptional() @IsInt() @Min(0) @Max(3) hints?: number;
}

export class DictationSubmitDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => DictationAnswerDto) answers: DictationAnswerDto[];
}

export class DictationGradeItemDto {
  @IsString() @MaxLength(400) text: string;
  @IsString() @MaxLength(400) typed: string;
}

export class DictationGradeDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => DictationGradeItemDto) items: DictationGradeItemDto[];
}

@ApiTags('dictation')
@ApiBearerAuth()
@Controller('dictation')
export class DictationController {
  constructor(private readonly dictation: DictationService) {}

  /** The sets with my mastery, and whether I practised today. */
  @Get()
  list(@UserId() user: string) {
    return this.dictation.list(user);
  }

  /** ?mode=<set>|mix|daily&n=10 — items to hear and type. Declared before ":set". */
  @Get('practice')
  practice(@UserId() user: string, @Query() q: DictationPracticeQuery) {
    return this.dictation.practice(user, q.mode, q.n);
  }

  /** Grade answers (usually one per Check); updates my mastery. */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('practice')
  @HttpCode(200)
  submit(@UserId() user: string, @Body() dto: DictationSubmitDto) {
    return this.dictation.submit(user, dto.answers);
  }

  /** Stateless grading of any sentence (sentences from my own words). Declared before ":set". */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('grade')
  @HttpCode(200)
  grade(@Body() dto: DictationGradeDto) {
    return this.dictation.gradeMany(dto.items);
  }

  /** One set: summary, tips, item count, my mastery. */
  @Get(':set')
  set(@UserId() user: string, @Param('set') set: string) {
    return this.dictation.set(user, set);
  }
}

@Module({
  imports: [MongooseModule.forFeature([{ name: DictationProgress.name, schema: DictationProgressSchema }])],
  controllers: [DictationController],
  providers: [DictationService],
  exports: [DictationService]
})
export class DictationModule {}
