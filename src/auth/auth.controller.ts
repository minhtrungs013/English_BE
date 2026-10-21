import { Body, Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public, UserId } from './auth.decorators';
import { AuthService } from './auth.service';
import { ChangePasswordDto, EmailDto, LoginDto, RegisterDto, ResetPasswordDto, UpdateMeDto, VerifyCodeDto } from './auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Start sign-up: emails a 6-digit code. Returns { email }; the account is created by register/verify. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @HttpCode(202)
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  /** Finish sign-up with the emailed code. Returns a token and the user. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register/verify')
  @HttpCode(200)
  verifyRegister(@Body() dto: VerifyCodeDto) {
    return this.auth.verifyRegister(dto);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('register/resend')
  @HttpCode(204)
  async resendRegister(@Body() dto: EmailDto) {
    await this.auth.resendRegister(dto);
  }

  /** Emails a password reset code if the account exists. Always 204. */
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('password/forgot')
  @HttpCode(204)
  async forgot(@Body() dto: EmailDto) {
    await this.auth.forgotPassword(dto);
  }

  /** Set a new password with the emailed code. Returns a token and the user (signed in). */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('password/reset')
  @HttpCode(200)
  reset(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  /** Log in with email + password. Returns a token and the user. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @ApiBearerAuth()
  @Get('me')
  me(@UserId() id: string) {
    return this.auth.me(id);
  }

  @ApiBearerAuth()
  @Patch('me')
  updateMe(@UserId() id: string, @Body() dto: UpdateMeDto) {
    return this.auth.updateName(id, dto.name);
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('change-password')
  @HttpCode(204)
  async changePassword(@UserId() id: string, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(id, dto);
  }

  /** Permanently delete the account and all of its vocabulary. */
  @ApiBearerAuth()
  @Delete('me')
  @HttpCode(204)
  async deleteMe(@UserId() id: string) {
    await this.auth.deleteAccount(id);
  }
}
