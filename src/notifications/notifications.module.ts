import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Course, CourseSchema, Enrollment, EnrollmentSchema } from '../courses/course.schema';
import { BankItem, BankItemSchema, Submission, SubmissionSchema } from '../courses/homework.schema';
import { Profile, ProfileSchema } from '../profile/profile.schema';
import { Word, WordSchema } from '../words/word.schema';
import { Notification, NotificationSchema } from './notification.schema';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: Course.name, schema: CourseSchema },
      { name: Enrollment.name, schema: EnrollmentSchema },
      { name: Submission.name, schema: SubmissionSchema },
      { name: BankItem.name, schema: BankItemSchema },
      { name: Word.name, schema: WordSchema },
      { name: Profile.name, schema: ProfileSchema }
    ])
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService]
})
export class NotificationsModule {}
