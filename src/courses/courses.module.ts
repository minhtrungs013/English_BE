import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LibraryModule } from '../library/library.module';
import { LookupModule } from '../lookup/lookup';
import { ProfileModule } from '../profile/profile.module';
import { TagsModule } from '../tags/tags';
import { User, UserSchema } from '../users/user.schema';
import { WordsModule } from '../words/words.module';
import { Course, CourseSchema, Enrollment, EnrollmentSchema } from './course.schema';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Course.name, schema: CourseSchema },
      { name: Enrollment.name, schema: EnrollmentSchema },
      { name: User.name, schema: UserSchema }
    ]),
    WordsModule, LibraryModule, LookupModule, ProfileModule, TagsModule
  ],
  controllers: [CoursesController],
  providers: [CoursesService],
  exports: [CoursesService]
})
export class CoursesModule {}
