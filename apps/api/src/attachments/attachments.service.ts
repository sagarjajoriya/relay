import { InjectQueue } from "@nestjs/bullmq";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma, type Attachment, type Prisma } from "@relay/db";
import type { AttachmentResponse, RequestUploadInput, RequestUploadResponse } from "@relay/contracts";
import { Queue } from "bullmq";
import { randomUUID } from "node:crypto";
import { ChannelsService } from "../channels/channels.service";
import { ATTACHMENTS_GC_QUEUE, GC_JOB, type GcJobData } from "./attachments.constants";
import { StorageService } from "./storage.service";

@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);
  private readonly maxBytes: number;
  private readonly gcDelayMs: number;

  constructor(
    private readonly storage: StorageService,
    private readonly channels: ChannelsService,
    @InjectQueue(ATTACHMENTS_GC_QUEUE) private readonly gcQueue: Queue<GcJobData>,
    config: ConfigService,
  ) {
    this.maxBytes = config.get<number>("ATTACHMENT_MAX_BYTES")!;
    this.gcDelayMs = config.get<number>("ATTACHMENT_GC_DELAY_MS")!;
  }

  async requestUpload(userId: string, channelId: string, input: RequestUploadInput): Promise<RequestUploadResponse> {
    const channel = await this.channels.assertCanAccess(userId, channelId);
    if (input.sizeBytes > this.maxBytes) {
      throw new BadRequestException(`File exceeds the ${Math.floor(this.maxBytes / 1024 / 1024)}MB limit`);
    }

    // Key never derives from the raw filename — the original name only lives
    // in the DB row and the Content-Disposition header at download time.
    const storageKey = `${channel.workspaceId}/${channelId}/${randomUUID()}`;

    const attachment = await prisma.attachment.create({
      data: {
        uploaderId: userId,
        channelId,
        storageKey,
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
      },
    });

    // Reap the row + object if no message send confirms this upload in time.
    await this.gcQueue.add(
      GC_JOB,
      { attachmentId: attachment.id },
      { jobId: `gc-${attachment.id}`, delay: this.gcDelayMs },
    );

    const uploadUrl = await this.storage.presignPut(storageKey, input.contentType);
    return { attachmentId: attachment.id, uploadUrl, expiresInSeconds: this.storage.putUrlTtlSeconds };
  }

  // Pre-transaction validation for linking attachments to a message: right
  // uploader, right channel, still PENDING, and the object really exists in
  // storage within size bounds (the client's declared size is a claim, not a
  // fact). Throws 400 on any violation.
  async validateForLink(userId: string, channelId: string, attachmentIds: string[]): Promise<Attachment[]> {
    const unique = [...new Set(attachmentIds)];
    const rows = await prisma.attachment.findMany({ where: { id: { in: unique } } });
    if (rows.length !== unique.length) {
      throw new BadRequestException("One or more attachments do not exist");
    }
    for (const row of rows) {
      if (row.uploaderId !== userId) {
        throw new BadRequestException("You can only attach files you uploaded");
      }
      if (row.channelId !== channelId) {
        throw new BadRequestException("Attachment belongs to a different channel");
      }
      if (row.status !== "PENDING" || row.messageId) {
        throw new BadRequestException("Attachment is already linked to a message");
      }
      const realSize = await this.storage.objectSize(row.storageKey);
      if (realSize === null) {
        throw new BadRequestException(`No uploaded file found for attachment ${row.id}`);
      }
      if (realSize > this.maxBytes) {
        // Uploaded object is bigger than allowed (declared size was a lie) —
        // reject and clean up the object immediately.
        await this.storage.deleteObject(row.storageKey);
        throw new BadRequestException("Uploaded file exceeds the size limit");
      }
    }
    return rows;
  }

  // Runs inside the message-create transaction. The status guard in the WHERE
  // makes concurrent double-links lose: count mismatch aborts the transaction.
  async linkToMessage(tx: Prisma.TransactionClient, attachmentIds: string[], messageId: string): Promise<void> {
    const unique = [...new Set(attachmentIds)];
    const updated = await tx.attachment.updateMany({
      where: { id: { in: unique }, status: "PENDING", messageId: null },
      data: { status: "ATTACHED", messageId },
    });
    if (updated.count !== unique.length) {
      throw new BadRequestException("Attachment is already linked to a message");
    }
  }

  async toResponses(rows: Attachment[]): Promise<AttachmentResponse[]> {
    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        fileName: row.fileName,
        contentType: row.contentType,
        sizeBytes: row.sizeBytes,
        downloadUrl: await this.storage.presignGet(row.storageKey, row.fileName),
      })),
    );
  }

  // GC worker body: reap the attachment iff it is still an orphan.
  async reapIfOrphaned(attachmentId: string): Promise<void> {
    const row = await prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!row || row.status !== "PENDING") return;
    await this.storage.deleteObject(row.storageKey);
    await prisma.attachment.delete({ where: { id: attachmentId } });
    this.logger.log(`reaped orphaned attachment ${attachmentId}`);
  }
}
