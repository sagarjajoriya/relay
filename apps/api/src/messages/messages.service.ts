import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { prisma, type Attachment } from "@relay/db";
import {
  WS_EVENTS,
  type ListMessagesQuery,
  type MessageResponse,
  type PaginatedMessages,
  type SendMessageInput,
} from "@relay/contracts";
import { AttachmentsService } from "../attachments/attachments.service";
import { ChannelsService } from "../channels/channels.service";
import { decodeCursor, encodeCursor } from "./cursor";

// Row shape shared by every query below (message + author + attachments).
type MessageRow = {
  id: string;
  channelId: string;
  content: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  author: { id: string; displayName: string };
  attachments: Attachment[];
};

const messageInclude = {
  author: { select: { id: true, displayName: true } },
  attachments: true,
} as const;

@Injectable()
export class MessagesService {
  constructor(
    private readonly channels: ChannelsService,
    private readonly attachments: AttachmentsService,
    // Domain events decouple the HTTP write path from delivery: the realtime
    // gateway subscribes today; queue producers (M5) subscribe to the same
    // events without this service knowing either exists.
    private readonly events: EventEmitter2,
  ) {}

  async send(userId: string, channelId: string, input: SendMessageInput): Promise<MessageResponse> {
    await this.channels.assertCanAccess(userId, channelId);

    const attachmentIds = input.attachmentIds ?? [];
    if (attachmentIds.length > 0) {
      // Storage HEADs and ownership checks happen before the transaction (no
      // external calls inside it); the PENDING-status guard inside linkToMessage
      // still makes concurrent double-links abort.
      await this.attachments.validateForLink(userId, channelId, attachmentIds);
    }

    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: { channelId, authorId: userId, content: input.content },
      });
      if (attachmentIds.length > 0) {
        await this.attachments.linkToMessage(tx, attachmentIds, created.id);
      }
      return tx.message.findUniqueOrThrow({ where: { id: created.id }, include: messageInclude });
    });

    const response = await this.toResponse(message);
    this.events.emit(WS_EVENTS.messageCreated, response);
    return response;
  }

  async list(userId: string, channelId: string, query: ListMessagesQuery): Promise<PaginatedMessages> {
    await this.channels.assertCanAccess(userId, channelId);

    const decoded = query.cursor ? decodeCursor(query.cursor) : null;
    // Fetch one extra row to determine whether an older page exists without a
    // second count query.
    const take = query.limit + 1;

    const rows = await prisma.message.findMany({
      where: { channelId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      ...(decoded ? { cursor: { id: decoded.i }, skip: 1 } : {}),
      include: messageInclude,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? encodeCursor(page[page.length - 1]) : null;

    return { messages: await Promise.all(page.map((m) => this.toResponse(m))), nextCursor };
  }

  async edit(userId: string, messageId: string, content: string): Promise<MessageResponse> {
    const message = await this.loadOwnedMessage(userId, messageId);
    if (message.deletedAt) {
      throw new NotFoundException("Message not found");
    }

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { content, editedAt: new Date() },
      include: messageInclude,
    });

    const response = await this.toResponse(updated);
    this.events.emit(WS_EVENTS.messageUpdated, response);
    return response;
  }

  async remove(userId: string, messageId: string): Promise<MessageResponse> {
    const message = await this.loadOwnedMessage(userId, messageId);
    if (message.deletedAt) {
      // Already a tombstone — return it idempotently rather than erroring.
      return this.toResponse(message);
    }

    const deleted = await prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
      include: messageInclude,
    });

    const response = await this.toResponse(deleted);
    this.events.emit(WS_EVENTS.messageDeleted, response);
    return response;
  }

  // Loads a message, enforces channel visibility, then author-only mutation.
  private async loadOwnedMessage(userId: string, messageId: string): Promise<MessageRow & { authorId: string }> {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: messageInclude,
    });
    if (!message) {
      throw new NotFoundException("Message not found");
    }

    await this.channels.assertCanAccess(userId, message.channelId);

    if (message.authorId !== userId) {
      throw new ForbiddenException("You can only modify your own messages");
    }

    return message;
  }

  private async toResponse(message: MessageRow): Promise<MessageResponse> {
    const isTombstone = message.deletedAt !== null;
    return {
      id: message.id,
      channelId: message.channelId,
      author: { id: message.author.id, displayName: message.author.displayName },
      content: isTombstone ? null : message.content,
      // Tombstones hide their attachments along with their content.
      attachments: isTombstone ? [] : await this.attachments.toResponses(message.attachments),
      createdAt: message.createdAt.toISOString(),
      editedAt: message.editedAt?.toISOString() ?? null,
      deletedAt: message.deletedAt?.toISOString() ?? null,
    };
  }
}
