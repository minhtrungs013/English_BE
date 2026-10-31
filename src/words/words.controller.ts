import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserId } from '../auth/auth.decorators';
import { ParseObjectIdPipe } from '../common/parse-object-id.pipe';
import { WordsService } from './words.service';
import { UsageService } from '../usage/usage';
import { CreateWordDto, ReviewWordDto, UpdateWordDto } from './word.dto';

@ApiTags('words')
@ApiBearerAuth()
@Controller('words')
export class WordsController {
  constructor(private readonly words: WordsService, private readonly usage: UsageService) {}

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
    const w = await this.words.create(user, dto);
    // A new word gets its "How to use" written in the background (shared; uses my daily Usage allowance).
    this.usage.ensureForNewWord(user, { word: w.word, pos: w.pos, vi: w.vi, meaning: w.meaning });
    return w.toJSON();
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
