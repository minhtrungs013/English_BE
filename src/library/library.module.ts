import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { MongooseModule } from '@nestjs/mongoose';
import { TagsModule } from '../tags/tags';
import { User, UserSchema } from '../users/user.schema';
import { WordsModule } from '../words/words.module';
import { LibraryController } from './library.controller';
import { LibraryWord, LibraryWordSchema } from './library.schema';
import { LibraryService } from './library.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: LibraryWord.name, schema: LibraryWordSchema }, { name: User.name, schema: UserSchema }]),
    WordsModule,
    TagsModule,
    NotificationsModule
  ],
  controllers: [LibraryController],
  providers: [LibraryService],
  exports: [LibraryService]
})
export class LibraryModule {}
