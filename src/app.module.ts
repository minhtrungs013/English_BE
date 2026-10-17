import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { KeepAliveService } from './common/keep-alive.service';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AccessModule } from './access/access';
import { AdminModule } from './admin/admin';
import { PracticeModule } from './practice/practice';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories';
import { ChatModule } from './chat/chat';
import { CoursesModule } from './courses/courses.module';
import { DictationModule } from './dictation/dictation.module';
import { GrammarModule } from './grammar/grammar.module';
import { NotificationsModule } from './notifications/notifications.module';
import { DataModule } from './data/data';
import { LibraryModule } from './library/library.module';
import { LookupModule } from './lookup/lookup';
import { ProfileModule } from './profile/profile.module';
import { TagsModule } from './tags/tags';
import { WordsModule } from './words/words.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
        dbName: config.get<string>('MONGODB_DB', 'English')
      })
    }),
    // Generous default limit; login/register have stricter limits of their own.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    AccessModule,
    AdminModule,
    PracticeModule,
    AuthModule,
    ProfileModule,
    WordsModule,
    CategoriesModule,
    TagsModule,
    LookupModule,
    LibraryModule,
    CoursesModule,
    NotificationsModule,
    GrammarModule,
    DictationModule,
    ChatModule,
    DataModule
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }, KeepAliveService]
})
export class AppModule {}
