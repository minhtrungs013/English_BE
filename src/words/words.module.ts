import { Module } from '@nestjs/common';
import { UsageModule } from '../usage/usage';
import { MongooseModule } from '@nestjs/mongoose';
import { ProfileModule } from '../profile/profile.module';
import { LibraryWord, LibraryWordSchema } from '../library/library.schema';
import { Word, WordSchema } from './word.schema';
import { WordsService } from './words.service';
import { WordsController } from './words.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: Word.name, schema: WordSchema }, { name: LibraryWord.name, schema: LibraryWordSchema }]), ProfileModule, UsageModule],
  controllers: [WordsController],
  providers: [WordsService],
  exports: [WordsService, MongooseModule]
})
export class WordsModule {}
