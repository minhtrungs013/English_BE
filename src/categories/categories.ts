import { Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { InjectModel, MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags, PartialType } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { HydratedDocument, Model } from 'mongoose';
import { UserId } from '../auth/auth.decorators';
import { CATEGORY_ICONS } from '../common/constants';
import { ParseObjectIdPipe } from '../common/parse-object-id.pipe';
import { jsonOptions } from '../common/to-json';
import { WordsModule } from '../words/words.module';
import { WordsService } from '../words/words.service';

/* ---------- schema ---------- */
@Schema({ collection: 'categories', timestamps: true, toJSON: jsonOptions })
export class Category {
  /** Owner (user id). */
  @Prop({ required: true, index: true }) user: string;
  @Prop({ required: true, trim: true }) name: string;
  @Prop({ required: true }) nameLower: string;
  @Prop({ enum: CATEGORY_ICONS, default: 'briefcase' }) icon: string;
}
export type CategoryDocument = HydratedDocument<Category>;
export const CategorySchema = SchemaFactory.createForClass(Category);
CategorySchema.index({ user: 1, nameLower: 1 }, { unique: true });

/* ---------- dto ---------- */
export class CreateCategoryDto {
  @IsString() @IsNotEmpty() @MaxLength(40) name: string;
  @IsIn(CATEGORY_ICONS) icon: string;
}
export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}

/* ---------- service ---------- */
@Injectable()
export class CategoriesService {
  constructor(
    @InjectModel(Category.name) private readonly cats: Model<Category>,
    private readonly words: WordsService
  ) {}

  findAll(user: string): Promise<CategoryDocument[]> {
    return this.cats.find({ user }).sort({ createdAt: 1 }).exec();
  }

  async create(user: string, dto: CreateCategoryDto): Promise<CategoryDocument> {
    const name = dto.name.trim();
    try {
      return await this.cats.create({ user, name, nameLower: name.toLowerCase(), icon: dto.icon });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new ConflictException('A category with this name already exists.');
      throw e;
    }
  }

  async update(user: string, id: string, dto: UpdateCategoryDto): Promise<CategoryDocument> {
    const patch: Record<string, unknown> = { ...dto };
    if (dto.name !== undefined) { patch.name = dto.name.trim(); patch.nameLower = dto.name.trim().toLowerCase(); }
    try {
      const c = await this.cats.findOneAndUpdate({ _id: id, user }, { $set: patch }, { returnDocument: 'after', runValidators: true });
      if (!c) throw new NotFoundException('Category not found');
      return c;
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new ConflictException('A category with this name already exists.');
      throw e;
    }
  }

  /** Deletes the category; its words become uncategorized. */
  async remove(user: string, id: string): Promise<void> {
    const res = await this.cats.deleteOne({ _id: id, user });
    if (!res.deletedCount) throw new NotFoundException('Category not found');
    await this.words.clearCategory(user, id);
  }
}

/* ---------- controller ---------- */
@ApiTags('categories')
@ApiBearerAuth()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly cats: CategoriesService) {}

  @Get()
  async findAll(@UserId() user: string) {
    return (await this.cats.findAll(user)).map((c) => c.toJSON());
  }

  @Post()
  async create(@UserId() user: string, @Body() dto: CreateCategoryDto) {
    return (await this.cats.create(user, dto)).toJSON();
  }

  @Patch(':id')
  async update(@UserId() user: string, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return (await this.cats.update(user, id, dto)).toJSON();
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@UserId() user: string, @Param('id', ParseObjectIdPipe) id: string) {
    await this.cats.remove(user, id);
  }
}

@Module({
  imports: [MongooseModule.forFeature([{ name: Category.name, schema: CategorySchema }]), WordsModule],
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService, MongooseModule]
})
export class CategoriesModule {}
