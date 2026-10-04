import { Body, Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public, UserId } from './auth.decorators';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto, RegisterDto, UpdateMeDto } from './auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Create an account. Returns a token and the user. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
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
