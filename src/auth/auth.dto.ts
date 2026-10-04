import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

const trimLower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class RegisterDto {
  @Transform(trim) @IsString() @IsNotEmpty({ message: 'Please enter your name.' }) @MaxLength(60) name: string;
  @Transform(trimLower) @IsEmail({}, { message: 'Please enter a valid email address.' }) @MaxLength(120) email: string;
  @IsString() @MinLength(8, { message: 'Password must be at least 8 characters.' }) @MaxLength(128) password: string;
}

export class LoginDto {
  @Transform(trimLower) @IsEmail({}, { message: 'Please enter a valid email address.' }) email: string;
  @IsString() @IsNotEmpty({ message: 'Please enter your password.' }) @MaxLength(128) password: string;
}

export class UpdateMeDto {
  @Transform(trim) @IsString() @IsNotEmpty({ message: 'Please enter your name.' }) @MaxLength(60) name: string;
}

export class ChangePasswordDto {
  @IsString() @IsNotEmpty() @MaxLength(128) currentPassword: string;
  @IsString() @MinLength(8, { message: 'New password must be at least 8 characters.' }) @MaxLength(128) newPassword: string;
}
