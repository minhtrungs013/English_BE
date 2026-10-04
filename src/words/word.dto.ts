import { PartialType } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { DAY_KEY, LEVELS, POS_LIST, RATINGS } from '../common/constants';

export class CreateWordDto {
  @IsString() @IsNotEmpty() @MaxLength(80) word: string;
  @IsOptional() @IsString() @MaxLength(80) ipa?: string;
  @IsOptional() @IsIn(POS_LIST) pos?: string;
  @IsOptional() @IsString() @MaxLength(1000) meaning?: string;
  @IsOptional() @IsString() @MaxLength(500) vi?: string;
  @IsOptional() @IsString() @MaxLength(1000) ex?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(60, { each: true }) syn?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(60, { each: true }) ant?: string[];
  @IsOptional() @IsIn(LEVELS) level?: string;
  @IsOptional() @IsString() @MaxLength(40) cat?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(40, { each: true }) tags?: string[];
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class UpdateWordDto extends PartialType(CreateWordDto) {}

export class ReviewWordDto {
  @IsIn(RATINGS) rating: (typeof RATINGS)[number];
  /** Flashcard practice also reschedules the word but doesn't count toward the daily review/streak. */
  @IsOptional() @IsBoolean() practice?: boolean;
  /** The client's local date (YYYY-MM-DD), so streaks follow the learner's time zone. */
  @IsOptional() @Matches(DAY_KEY) day?: string;
}
