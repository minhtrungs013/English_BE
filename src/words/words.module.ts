import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProfileModule } from '../profile/profile.module';
import { Word, WordSchema } from './word.schema';
import { WordsService } from './words.service';
import { WordsController } from './words.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: Word.name, schema: WordSchema }]), ProfileModule],
  controllers: [WordsController],
  providers: [WordsService],
  exports: [WordsService, MongooseModule]
})
export class WordsModule {}
