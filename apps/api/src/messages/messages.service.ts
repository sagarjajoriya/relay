import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@relay/db";
import type { ListMessagesQuery, MessageResponse, PaginatedMessages } from "@relay/contracts";
import { ChannelsService } from "../channels/channels.service";
import { decodeCursor, encodeCursor } from "./cursor";

// Row shape shared by every query below (message + minimal author projection).
type MessageWithAuthor = {
  id: string;
  channelId: string;
  content: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  author: { id: string; displayName: string };
};

const authorSelect = { select: { id: true, displayName: true } } as const;

@Injectable()
export class MessagesService {
  constructor(private readonly channels: ChannelsService) {}

  async send(userId: string, channelId: string, content: string): Promise<MessageResponse> {
    await this.channels.assertCanAccess(userId, channelId);

    const message = await prisma.message.create({
      data: { channelId, authorId: userId, content },
      include: { author: authorSelect },
    });

    return this.toResponse(message);
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
      include: { author: authorSelect },
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? encodeCursor(page[page.length - 1]) : null;

    return { messages: page.map((m) => this.toResponse(m)), nextCursor };
  }

  async edit(userId: string, messageId: string, content: string): Promise<MessageResponse> {
    const message = await this.loadOwnedMessage(userId, messageId);
    if (message.deletedAt) {
      throw new NotFoundException("Message not found");
    }

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { content, editedAt: new Date() },
      include: { author: authorSelect },
    });

    return this.toResponse(updated);
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
      include: { author: authorSelect },
    });

    return this.toResponse(deleted);
  }

  // Loads a message, enforces channel visibility, then author-only mutation.
  private async loadOwnedMessage(userId: string, messageId: string): Promise<MessageWithAuthor & { authorId: string }> {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: { author: authorSelect },
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

  private toResponse(message: MessageWithAuthor): MessageResponse {
    const isTombstone = message.deletedAt !== null;
    return {
      id: message.id,
      channelId: message.channelId,
      author: { id: message.author.id, displayName: message.author.displayName },
      content: isTombstone ? null : message.content,
      createdAt: message.createdAt.toISOString(),
      editedAt: message.editedAt?.toISOString() ?? null,
      deletedAt: message.deletedAt?.toISOString() ?? null,
    };
  }
}
