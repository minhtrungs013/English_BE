import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { MongooseModule } from '@nestjs/mongoose';
import { TagsModule } from '../tags/tags';
import { User, UserSchema } from '../users/user.schema';
import { WordsModule } from '../words/words.module';
import { LibraryController } from './library.controller';
import { LibraryWord, LibraryWordSchema, MeaningSuggestion, MeaningSuggestionSchema } from './library.schema';
import { LibraryService } from './library.service';
import { UsageModule } from '../usage/usage';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: LibraryWord.name, schema: LibraryWordSchema }, { name: MeaningSuggestion.name, schema: MeaningSuggestionSchema }, { name: User.name, schema: UserSchema }]),
    WordsModule,
    TagsModule,
    NotificationsModule,
    UsageModule
  ],
  controllers: [LibraryController],
  providers: [LibraryService],
  exports: [LibraryService]
})
export class LibraryModule {}
