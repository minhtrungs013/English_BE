import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserId } from '../auth/auth.decorators';
import { ParseObjectIdPipe } from '../common/parse-object-id.pipe';
import { LibraryService } from './library.service';
import { FindWordQuery, LibraryQuery, ShareWordDto } from './library.dto';

@ApiTags('library')
@ApiBearerAuth()
@Controller('library')
export class LibraryController {
  constructor(private readonly library: LibraryService) {}

  /** Browse / search the shared library: ?q=&topic=&level=&source=&page=&limit= */
  @Get()
  list(@UserId() user: string, @Query() q: LibraryQuery) {
    return this.library.list(user, q);
  }

  /**
   * Exact (case-insensitive) match for a word, so the add-word form can offer the library's
   * version instead of creating a duplicate. Returns { word: null } when there is none.
   */
  @Get('find')
  async find(@Query() q: FindWordQuery) {
    const d = q.word.trim() ? await this.library.findByWord(q.word.trim().toLowerCase()) : null;
    return { word: d ? d.toJSON() : null };
  }

  @Get(':id')
  async findOne(@Param('id', ParseObjectIdPipe) id: string) {
    return (await this.library.findOne(id)).toJSON();
  }

  /** Save a library word into my vocabulary. */
  @Post(':id/save')
  save(@UserId() user: string, @Param('id', ParseObjectIdPipe) id: string) {
    return this.library.save(user, id);
  }

  /** Share one of my words to the library: { wordId, topic? } */
  @Post('share')
  share(@UserId() user: string, @Body() dto: ShareWordDto) {
    return this.library.share(user, dto);
  }

  /** Remove a word I shared. */
  @Delete(':id')
  @HttpCode(204)
  async unshare(@UserId() user: string, @Param('id', ParseObjectIdPipe) id: string) {
    await this.library.unshare(user, id);
  }
}
