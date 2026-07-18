import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { ATTACHMENTS_GC_QUEUE, type GcJobData } from "./attachments.constants";
import { AttachmentsService } from "./attachments.service";

@Processor(ATTACHMENTS_GC_QUEUE)
export class AttachmentsGcProcessor extends WorkerHost {
  constructor(private readonly attachments: AttachmentsService) {
    super();
  }

  async process(job: Job<GcJobData>): Promise<void> {
    await this.attachments.reapIfOrphaned(job.data.attachmentId);
  }
}
