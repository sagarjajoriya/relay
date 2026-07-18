import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { MailerService } from "./mailer.service";
import { NotificationProducerListener } from "./notification-producer.listener";
import { NOTIFICATIONS_QUEUE } from "./notifications.constants";
import { NotificationsController } from "./notifications.controller";
import { NotificationsProcessor } from "./notifications.processor";
import { NotificationsService } from "./notifications.service";

@Module({
  imports: [
    BullModule.registerQueue({
      name: NOTIFICATIONS_QUEUE,
      defaultJobOptions: {
        // At-least-once with exponential backoff: 500ms, 1s, 2s, 4s between
        // the 5 attempts, then the job parks in "failed" for inspection.
        attempts: 5,
        backoff: { type: "exponential", delay: 500 },
        removeOnComplete: { count: 1000 },
        removeOnFail: false,
      },
    }),
    RealtimeModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsProcessor, NotificationProducerListener, MailerService],
})
export class NotificationsModule {}
