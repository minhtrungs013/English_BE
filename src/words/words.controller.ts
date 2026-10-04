import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserId } from '../auth/auth.decorators';
import { ParseObjectIdPipe } from '../common/parse-object-id.pipe';
import { WordsService } from './words.service';
import { CreateWordDto, ReviewWordDto, UpdateWordDto } from './word.dto';

@ApiTags('words')
@ApiBearerAuth()
@Controller('words')
export class WordsController {
  constructor(private readonly words: WordsService) {}

  @Get()
  async findAll(@UserId() user: string) {
    return (await this.words.findAll(user)).map((w) => w.toJSON());
  }

  @Get(':id')
  async findOne(@UserId() user: string, @Param('id', ParseObjectIdPipe) id: string) {
    return (await this.words.findOne(user, id)).toJSON();
  }

  @Post()
  async create(@UserId() user: string, @Body() dto: CreateWordDto) {
    return (await this.words.create(user, dto)).toJSON();
  }

  @Patch(':id')
  async update(@UserId() user: string, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateWordDto) {
    return (await this.words.update(user, id, dto)).toJSON();
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@UserId() user: string, @Param('id', ParseObjectIdPipe) id: string) {
    await this.words.remove(user, id);
  }

  /** Rate a word after a flashcard (Again / Hard / Good / Easy) and reschedule it. */
  @Post(':id/review')
  @HttpCode(200)
  review(@UserId() user: string, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: ReviewWordDto) {
    return this.words.review(user, id, dto);
  }
}
