import { Controller, Delete, Get, HttpCode, Injectable, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection, InjectModel, MongooseModule } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Connection, Model } from 'mongoose';
import { Public, UserId } from '../auth/auth.decorators';
import { Category, CategoriesModule } from '../categories/categories';
import { Profile } from '../profile/profile.schema';
import { ProfileModule } from '../profile/profile.module';
import { ProfileService } from '../profile/profile.service';
import { Tag, TagsModule } from '../tags/tags';
import { User, UserSchema } from '../users/user.schema';
import { Word } from '../words/word.schema';
import { WordsModule } from '../words/words.module';
import { CoursesModule } from '../courses/courses.module';
import { CoursesService } from '../courses/courses.service';
import { LibraryModule } from '../library/library.module';
import { LibraryService } from '../library/library.service';

const NO_OWNER = { user: { $exists: false } };

@Injectable()
export class DataService implements OnApplicationBootstrap {
  private readonly log = new Logger('Data');

  constructor(
    @InjectModel(Word.name) private readonly words: Model<Word>,
    @InjectModel(Category.name) private readonly cats: Model<Category>,
    @InjectModel(Tag.name) private readonly tags: Model<Tag>,
    @InjectModel(Profile.name) private readonly profiles: Model<Profile>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly profile: ProfileService,
    private readonly library: LibraryService,
    private readonly courses: CoursesService
  ) {}

  /**
   * Migration from the single-user version: drop the old global unique indexes
   * (word, category name, tag name, profile key) in favour of per-user ones.
   */
  async onApplicationBootstrap(): Promise<void> {
    for (const m of [this.words, this.cats, this.tags, this.profiles, this.users] as Model<unknown>[]) {
      const dropped = await m.syncIndexes();
      if (dropped.length) this.log.log('Dropped old indexes on ' + m.collection.name + ': ' + dropped.join(', '));
    }
  }

  /** Data saved before accounts existed (no owner). The first account to register gets it. */
  async claimUnownedData(user: string): Promise<boolean> {
    const has = await this.words.exists(NO_OWNER);
    if (!has) return false;
    await Promise.all([
      this.words.updateMany(NO_OWNER, { $set: { user } }),
      this.cats.updateMany(NO_OWNER, { $set: { user } }),
      this.tags.updateMany(NO_OWNER, { $set: { user } })
    ]);
    // Keep the old profile's progress (streak etc.) and drop the ownerless profile.
    const old = await this.profiles.collection.findOne({ user: { $exists: false } });
    if (old) {
      await this.profiles.collection.deleteOne({ _id: old._id });
      await this.profile.create(user, {}, (old.progress as object) ?? {});
    }
    this.log.log('Assigned existing vocabulary to the first account.');
    return true;
  }

  /** Removes the user's words, categories and tags and resets progress (settings are kept). */
  async clear(user: string): Promise<void> {
    await Promise.all([this.words.deleteMany({ user }), this.cats.deleteMany({ user }), this.tags.deleteMany({ user })]);
    await this.profile.resetProgress(user);
  }

  /** Deletes the account and everything it owns. */
  async deleteAccount(user: string): Promise<void> {
    await this.courses.deleteForUser(user);
    await Promise.all([
      this.words.deleteMany({ user }), this.cats.deleteMany({ user }), this.tags.deleteMany({ user }),
      this.profiles.deleteOne({ user }), this.users.deleteOne({ _id: user })
    ]);
  }

  async bootstrap(user: string) {
    const [u, words, cats, tags, profile] = await Promise.all([
      this.users.findById(user),
      this.words.find({ user }).sort({ addedAt: -1 }),
      this.cats.find({ user }).sort({ createdAt: 1 }),
      this.tags.find({ user }).sort({ createdAt: 1 }).lean(),
      this.profile.get(user)
    ]);
    const p = profile.toJSON();
    const shared = await this.library.existing(words.map((w) => w.wordLower));
    return {
      words: words.map((w) => w.toJSON()), cats: cats.map((c) => c.toJSON()), tags: tags.map((t) => t.name),
      // Lower-cased words of yours that are already in the library (so the app hides "Share").
      shared,
      userId: user,
      autofill: await this.profile.autofillStatus(user),
      // Name and email come from the account; the rest are learning preferences.
      settings: { ...p.settings, name: u?.name ?? '', email: u?.email ?? '' },
      progress: p.progress
    };
  }
}

@ApiTags('data')
@Controller()
export class DataController {
  constructor(
    private readonly data: DataService,
    @InjectConnection() private readonly conn: Connection
  ) {}

  @Public()
  @Get('health')
  health() {
    return { ok: true, db: this.conn.readyState === 1 ? 'connected' : 'disconnected' };
  }

  /** Everything the app needs on load, in one request. */
  @ApiBearerAuth()
  @Get('bootstrap')
  bootstrap(@UserId() user: string) {
    return this.data.bootstrap(user);
  }

  /** Delete all of your words, categories and tags. */
  @ApiBearerAuth()
  @Delete('data')
  @HttpCode(204)
  async clear(@UserId() user: string) {
    await this.data.clear(user);
  }
}

@Module({
  imports: [WordsModule, CategoriesModule, TagsModule, ProfileModule, LibraryModule, CoursesModule, MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])],
  controllers: [DataController],
  providers: [DataService],
  exports: [DataService]
})
export class DataModule {}
