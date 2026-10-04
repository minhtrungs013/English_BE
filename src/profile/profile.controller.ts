import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserId } from '../auth/auth.decorators';
import { ProfileService } from './profile.service';
import { UpdateSettingsDto } from './profile.dto';

@ApiTags('profile')
@ApiBearerAuth()
@Controller('profile')
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  async get(@UserId() user: string) {
    const p = (await this.profile.get(user)).toJSON();
    return { settings: p.settings, progress: p.progress };
  }

  @Patch('settings')
  async updateSettings(@UserId() user: string, @Body() dto: UpdateSettingsDto) {
    return (await this.profile.updateSettings(user, dto)).toJSON().settings;
  }
}
