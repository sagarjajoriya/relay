import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { NOTIFICATIONS_QUEUE, type FanoutJobData } from "./notifications.constants";
import { NotificationsService } from "./notifications.service";

// Runs in-process for now: decoupled in time (retries, survives request
// lifecycle), not yet in space. M10 moves this class into a separate worker
// app; it has no HTTP dependencies, so that's a file move, not a redesign.
@Processor(NOTIFICATIONS_QUEUE, { concurrency: 5 })
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(private readonly notifications: NotificationsService) {
    super();
  }

  async process(job: Job<FanoutJobData>): Promise<void> {
    this.logger.log(`processing ${job.name} message=${job.data.messageId} attempt=${job.attemptsMade + 1}`);
    await this.notifications.fanOutMessage(job.data.messageId);
  }
}
