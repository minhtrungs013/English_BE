import { Type } from 'class-transformer';
import { IsIn, IsInt, IsMongoId, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { LEVELS } from '../common/constants';
import { TOPICS } from './library.schema';

export class LibraryQuery {
  /** Searches the word, meaning and Vietnamese translation. */
  @IsOptional() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @IsIn(TOPICS) topic?: string;
  @IsOptional() @IsIn(LEVELS) level?: string;
  /** "me" = only words I shared, "community" = shared by any user, "builtin" = the built-in words. */
  @IsOptional() @IsIn(['me', 'community', 'builtin']) source?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class FindWordQuery {
  @IsString() @MaxLength(80) word: string;
}

export class ShareWordDto {
  @IsMongoId() wordId: string;
  @IsOptional() @IsIn(TOPICS) topic?: string;
}
