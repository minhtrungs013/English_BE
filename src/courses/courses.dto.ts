import { PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsIn, IsInt, IsMongoId, IsNotEmpty, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested
} from 'class-validator';
import { LEVELS, POS_LIST } from '../common/constants';
import { TOPICS } from '../library/library.schema';
import { VISIBILITIES, WORD_SOURCES } from './course.schema';
import { BANK_KINDS, BANK_STATUSES, type BankStatus } from './homework.schema';
import { TENSES } from './tense';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateCourseDto {
  @Transform(trim) @IsString() @IsNotEmpty({ message: 'Please enter a course title.' }) @MaxLength(80) title: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsInt() @Min(3) @Max(10) wordsPerDay?: number;
  @IsOptional() @IsIn(VISIBILITIES) visibility?: string;
  /** Day 1 for everyone (YYYY-MM-DD); '' or left out = each learner starts when they join. */
  @IsOptional() @IsString() @Matches(/^(\d{4}-\d{2}-\d{2})?$/, { message: 'Start date must look like 2026-10-06.' }) startDate?: string;
}
export class UpdateCourseDto extends PartialType(CreateCourseDto) {}

export class CourseWordDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(80) word: string;
  @IsOptional() @IsString() @MaxLength(80) ipa?: string;
  @IsOptional() @IsIn(POS_LIST) pos?: string;
  @IsOptional() @IsString() @MaxLength(1000) meaning?: string;
  @IsOptional() @IsString() @MaxLength(500) vi?: string;
  @IsOptional() @IsString() @MaxLength(1000) ex?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(60, { each: true }) syn?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(60, { each: true }) ant?: string[];
  @IsOptional() @IsIn(LEVELS) level?: string;
  @IsOptional() @IsString() @MaxLength(40) libraryId?: string;
  @IsOptional() @IsIn(WORD_SOURCES) source?: string;
}

export class SetDayDto {
  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => CourseWordDto) words: CourseWordDto[];
}

export class AiWordDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(80) word: string;
}

export class JoinByCodeDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z0-9]{6}$/, { message: 'Join codes are 6 letters and numbers.' }) code: string;
}

export class ShareCourseWordDto {
  @IsOptional() @IsIn(TOPICS) topic?: string;
}

export class CoursesQuery {
  /** mine = courses I created, joined = courses I'm taking, public = all public courses. */
  @IsOptional() @IsIn(['mine', 'joined', 'public']) scope?: string;
}

export class SubmitHomeworkDto {
  /** One answer per question, in order ('' for a question left blank). */
  @IsArray() @ArrayMaxSize(60) @IsString({ each: true }) @MaxLength(200, { each: true }) answers: string[];
}

export class LearnDayDto {
  /** Words to save to My Vocabulary ([] = none). Left out: all of the day's words. */
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(80, { each: true }) save?: string[];
}

export class SaveDayWordsDto {
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @IsNotEmpty({ each: true }) @MaxLength(80, { each: true }) words: string[];
}

export class ImportQuestionsDto {
  /** Rows from a CSV/JSON file; each is checked on its own and bad rows are reported, not saved. */
  @IsArray() @ArrayMaxSize(100) items: Record<string, unknown>[];
}

export class ListeningDoneDto {
  @IsOptional() @IsInt() @Min(0) @Max(100) correct?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) total?: number;
}

export class WarmupDoneDto {
  @IsOptional() @IsInt() @Min(0) @Max(100) correct?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) total?: number;
}

export class LeaderboardQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(30) day?: number;
}

export class GenerateQuestionsDto {
  /** Tenses to practise (default: all). */
  @IsOptional() @IsArray() @ArrayMaxSize(7) @IsIn(TENSES, { each: true }) tenses?: string[];
  /** Questions per word, 1–3 (default 2). */
  @IsOptional() @IsInt() @Min(1) @Max(3) perWord?: number;
}

export class BankItemDto {
  @IsIn(BANK_KINDS) kind: string;
  @IsOptional() @IsString() @MaxLength(80) word?: string;
  @IsOptional() @IsIn([...TENSES, '']) tense?: string;
  /** The sentence with one "___", or the recap story (dialogues use data.title). */
  @IsOptional() @IsString() @MaxLength(1500) prompt?: string;
  /** Dialogues only: { title, scenario, speakers, lines, questions } — see dialogue.ts. */
  @IsOptional() @IsObject() data?: Record<string, unknown>;
  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsString({ each: true }) @MaxLength(80, { each: true }) choices?: string[];
  @IsOptional() @IsString() @MaxLength(80) answer?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) @MaxLength(80, { each: true }) accept?: string[];
  /** Why this tense (Vietnamese), or the recap's translation. */
  @IsOptional() @IsString() @MaxLength(1500) explain?: string;
}

export class UpdateBankItemDto {
  @IsOptional() @IsString() @MaxLength(80) word?: string;
  @IsOptional() @IsIn([...TENSES, '']) tense?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(1500) prompt?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsString({ each: true }) @MaxLength(80, { each: true }) choices?: string[];
  @IsOptional() @IsString() @MaxLength(80) answer?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) @MaxLength(80, { each: true }) accept?: string[];
  @IsOptional() @IsString() @MaxLength(1500) explain?: string;
  @IsOptional() @IsIn(BANK_STATUSES) status?: BankStatus;
  @IsOptional() @IsObject() data?: Record<string, unknown>;
}

export class BankStatusDto {
  @IsArray() @ArrayMaxSize(100) @IsMongoId({ each: true }) ids: string[];
  @IsIn(BANK_STATUSES) status: BankStatus;
}

export class BankQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(30) day?: number;
}
