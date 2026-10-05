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
import { Homework, HomeworkSchema, Submission, SubmissionSchema } from './homework.schema';
import { HomeworkService } from './homework.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Course.name, schema: CourseSchema },
      { name: Enrollment.name, schema: EnrollmentSchema },
      { name: Homework.name, schema: HomeworkSchema },
      { name: Submission.name, schema: SubmissionSchema },
      { name: User.name, schema: UserSchema }
    ]),
    WordsModule, LibraryModule, LookupModule, ProfileModule, TagsModule
  ],
  controllers: [CoursesController],
  providers: [CoursesService, HomeworkService],
  exports: [CoursesService]
})
export class CoursesModule {}
