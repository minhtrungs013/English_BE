import { Body, Controller, Get, HttpCode, Module, Param, Post, Query } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { UserId } from '../auth/auth.decorators';
import { GrammarProgress, GrammarProgressSchema, GrammarService } from './grammar.service';

export class PracticeQuery {
  /** A tense id, or "mix". */
  @IsString() @Matches(/^(mix|[a-z-]{3,30})$/) mode: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(20) n?: number;
}

export class PracticeAnswerDto {
  @IsString() @MaxLength(40) id: string;
  @IsString() @MaxLength(200) answer: string;
}

export class PracticeSubmitDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => PracticeAnswerDto) answers: PracticeAnswerDto[];
}

@ApiTags('grammar')
@ApiBearerAuth()
@Controller('grammar')
export class GrammarController {
  constructor(private readonly grammar: GrammarService) {}

  /** The 7 tenses with my mastery. */
  @Get()
  list(@UserId() user: string) {
    return this.grammar.list(user);
  }

  /** ?mode=<tense>|mix&n=10 — questions without answers. Declared before ":tense". */
  @Get('practice')
  practice(@UserId() user: string, @Query() q: PracticeQuery) {
    return this.grammar.practice(user, q.mode, q.n);
  }

  /** Grade a practice set; updates my mastery. */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('practice')
  @HttpCode(200)
  submit(@UserId() user: string, @Body() dto: PracticeSubmitDto) {
    return this.grammar.submit(user, dto.answers);
  }

  /** One tense's lesson (theory in Vietnamese, examples in English). */
  @Get(':tense')
  lesson(@UserId() user: string, @Param('tense') tense: string) {
    return this.grammar.lesson(user, tense);
  }
}

@Module({
  imports: [MongooseModule.forFeature([{ name: GrammarProgress.name, schema: GrammarProgressSchema }])],
  controllers: [GrammarController],
  providers: [GrammarService],
  exports: [GrammarService]
})
export class GrammarModule {}
