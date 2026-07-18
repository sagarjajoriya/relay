import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ChannelsModule } from "../channels/channels.module";
import { ATTACHMENTS_GC_QUEUE } from "./attachments.constants";
import { AttachmentsController } from "./attachments.controller";
import { AttachmentsGcProcessor } from "./attachments.processor";
import { AttachmentsService } from "./attachments.service";
import { StorageService } from "./storage.service";

@Module({
  imports: [
    BullModule.registerQueue({
      name: ATTACHMENTS_GC_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { count: 500 },
      },
    }),
    ChannelsModule,
  ],
  controllers: [AttachmentsController],
  providers: [AttachmentsService, AttachmentsGcProcessor, StorageService],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
