import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Param, Post } from '@nestjs/common';
import { InjectModel, MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Model } from 'mongoose';
import { UserId } from '../auth/auth.decorators';
import { jsonOptions } from '../common/to-json';
import { WordsModule } from '../words/words.module';
import { WordsService } from '../words/words.service';

/* ---------- schema ---------- */
@Schema({ collection: 'tags', timestamps: true, toJSON: jsonOptions })
export class Tag {
  /** Owner (user id). */
  @Prop({ required: true, index: true }) user: string;
  @Prop({ required: true }) name: string;
}
export const TagSchema = SchemaFactory.createForClass(Tag);
TagSchema.index({ user: 1, name: 1 }, { unique: true });

/** "#Front End" -> "front-end": lowercase letters, numbers and dashes. */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/* ---------- dto ---------- */
export class CreateTagDto {
  @IsString() @IsNotEmpty() @MaxLength(40) name: string;
}

/* ---------- service ---------- */
@Injectable()
export class TagsService {
  constructor(
    @InjectModel(Tag.name) private readonly tags: Model<Tag>,
    private readonly words: WordsService
  ) {}

  async findAll(user: string): Promise<string[]> {
    return (await this.tags.find({ user }).sort({ createdAt: 1 }).lean()).map((t) => t.name);
  }

  async create(user: string, raw: string): Promise<string> {
    const name = normalizeTag(raw);
    if (!name) throw new BadRequestException('Please enter a tag name.');
    try {
      await this.tags.create({ user, name });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new ConflictException('#' + name + ' already exists.');
      throw e;
    }
    return name;
  }

  /** Deletes the tag and removes it from every word that uses it. */
  async remove(user: string, name: string): Promise<void> {
    const res = await this.tags.deleteOne({ user, name });
    if (!res.deletedCount) throw new NotFoundException('Tag not found');
    await this.words.removeTag(user, name);
  }
}

/* ---------- controller ---------- */
@ApiTags('tags')
@ApiBearerAuth()
@Controller('tags')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Get()
  findAll(@UserId() user: string) {
    return this.tags.findAll(user);
  }

  @Post()
  async create(@UserId() user: string, @Body() dto: CreateTagDto) {
    return { name: await this.tags.create(user, dto.name) };
  }

  @Delete(':name')
  @HttpCode(204)
  async remove(@UserId() user: string, @Param('name') name: string) {
    await this.tags.remove(user, name);
  }
}

@Module({
  imports: [MongooseModule.forFeature([{ name: Tag.name, schema: TagSchema }]), WordsModule],
  controllers: [TagsController],
  providers: [TagsService],
  exports: [TagsService, MongooseModule]
})
export class TagsModule {}
