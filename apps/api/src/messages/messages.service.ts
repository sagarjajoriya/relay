import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { prisma, type Attachment } from "@relay/db";
import {
  MENTION_TOKEN_REGEX,
  WS_EVENTS,
  type ListMessagesQuery,
  type MessageAuthor,
  type MessageResponse,
  type PaginatedMessages,
  type ReactionSummary,
  type SendMessageInput,
} from "@relay/contracts";
import { AttachmentsService } from "../attachments/attachments.service";
import { ChannelsService } from "../channels/channels.service";
import { decodeCursor, encodeCursor } from "./cursor";

// Row shape shared by every query below.
type MessageRow = {
  id: string;
  channelId: string;
  parentId: string | null;
  replyCount: number;
  lastReplyAt: Date | null;
  content: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  author: { id: string; displayName: string };
  attachments: Attachment[];
  reactions: { emoji: string; userId: string }[];
  channel: { workspaceId: string };
};

const messageInclude = {
  author: { select: { id: true, displayName: true } },
  attachments: true,
  reactions: { select: { emoji: true, userId: true } },
  channel: { select: { workspaceId: true } },
} as const;

export function extractMentionIds(content: string): string[] {
  return [...new Set([...content.matchAll(MENTION_TOKEN_REGEX)].map((m) => m[1]))];
}

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
    const message = await this.createMessage(userId, channelId, input, null);
    const response = await this.toResponse(message);
    this.events.emit(WS_EVENTS.messageCreated, response);
    return response;
  }

  // Reply into a single-level thread: the parent must be a top-level, live
  // message. replyCount/lastReplyAt are denormalized onto the parent in the
  // same transaction, and the parent is re-broadcast as message.updated so
  // channel timelines refresh their thread indicator live.
  async reply(userId: string, parentId: string, input: SendMessageInput): Promise<MessageResponse> {
    const parent = await prisma.message.findUnique({ where: { id: parentId } });
    if (!parent || parent.deletedAt) {
      throw new NotFoundException("Message not found");
    }
    if (parent.parentId) {
      throw new BadRequestException("Replies cannot be nested — reply to the thread's root message");
    }
    await this.channels.assertCanAccess(userId, parent.channelId);

    const reply = await this.createMessage(userId, parent.channelId, input, parentId);

    const updatedParent = await prisma.message.update({
      where: { id: parentId },
      data: { replyCount: { increment: 1 }, lastReplyAt: reply.createdAt },
      include: messageInclude,
    });

    const [replyResponse, parentResponse] = await Promise.all([
      this.toResponse(reply),
      this.toResponse(updatedParent),
    ]);
    this.events.emit(WS_EVENTS.messageCreated, replyResponse);
    this.events.emit(WS_EVENTS.messageUpdated, parentResponse);
    return replyResponse;
  }

  private async createMessage(
    userId: string,
    channelId: string,
    input: SendMessageInput,
    parentId: string | null,
  ): Promise<MessageRow> {
    const attachmentIds = input.attachmentIds ?? [];
    if (attachmentIds.length > 0) {
      await this.attachments.validateForLink(userId, channelId, attachmentIds);
    }

    return prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: { channelId, authorId: userId, content: input.content, parentId },
      });
      if (attachmentIds.length > 0) {
        await this.attachments.linkToMessage(tx, attachmentIds, created.id);
      }
      return tx.message.findUniqueOrThrow({ where: { id: created.id }, include: messageInclude });
    });
  }

  // Channel timeline: top-level messages only — replies live in their thread.
  async list(userId: string, channelId: string, query: ListMessagesQuery): Promise<PaginatedMessages> {
    await this.channels.assertCanAccess(userId, channelId);

    const decoded = query.cursor ? decodeCursor(query.cursor) : null;
    const take = query.limit + 1;

    const rows = await prisma.message.findMany({
      where: { channelId, parentId: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      ...(decoded ? { cursor: { id: decoded.i }, skip: 1 } : {}),
      include: messageInclude,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? encodeCursor(page[page.length - 1]) : null;

    return { messages: await this.toResponses(page), nextCursor };
  }

  // Thread view: replies ascending (a conversation reads top-down).
  async listThread(userId: string, parentId: string, query: ListMessagesQuery): Promise<PaginatedMessages> {
    const parent = await prisma.message.findUnique({ where: { id: parentId } });
    if (!parent) {
      throw new NotFoundException("Message not found");
    }
    await this.channels.assertCanAccess(userId, parent.channelId);

    const decoded = query.cursor ? decodeCursor(query.cursor) : null;
    const take = query.limit + 1;

    const rows = await prisma.message.findMany({
      where: { parentId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take,
      ...(decoded ? { cursor: { id: decoded.i }, skip: 1 } : {}),
      include: messageInclude,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? encodeCursor(page[page.length - 1]) : null;

    return { messages: await this.toResponses(page), nextCursor };
  }

  // Reactions are open to anyone who can see the channel (not author-only).
  // PUT is idempotent via the (message, user, emoji) unique constraint; the
  // refreshed message rides the existing message.updated broadcast.
  async react(userId: string, messageId: string, emoji: string): Promise<MessageResponse> {
    const message = await this.loadVisibleMessage(userId, messageId);
    await prisma.reaction.upsert({
      where: { messageId_userId_emoji: { messageId, userId, emoji } },
      update: {},
      create: { messageId, userId, emoji },
    });
    return this.refreshAndBroadcast(message.id);
  }

  async unreact(userId: string, messageId: string, emoji: string): Promise<MessageResponse> {
    const message = await this.loadVisibleMessage(userId, messageId);
    await prisma.reaction.deleteMany({ where: { messageId, userId, emoji } });
    return this.refreshAndBroadcast(message.id);
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

  private async refreshAndBroadcast(messageId: string): Promise<MessageResponse> {
    const fresh = await prisma.message.findUniqueOrThrow({ where: { id: messageId }, include: messageInclude });
    const response = await this.toResponse(fresh);
    this.events.emit(WS_EVENTS.messageUpdated, response);
    return response;
  }

  // Visibility only (any channel viewer) — used by reactions.
  private async loadVisibleMessage(userId: string, messageId: string): Promise<MessageRow> {
    const message = await prisma.message.findUnique({ where: { id: messageId }, include: messageInclude });
    if (!message || message.deletedAt) {
      throw new NotFoundException("Message not found");
    }
    await this.channels.assertCanAccess(userId, message.channelId);
    return message;
  }

  // Visibility + author-only mutation — used by edit/delete.
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
    return (await this.toResponses([message]))[0];
  }

  // Batch-shaped so a 30-message page resolves all mentions in ONE user query
  // instead of one per message.
  private async toResponses(rows: MessageRow[]): Promise<MessageResponse[]> {
    const allMentionIds = new Set<string>();
    for (const row of rows) {
      if (!row.deletedAt) for (const id of extractMentionIds(row.content)) allMentionIds.add(id);
    }
    const mentionUsers = allMentionIds.size
      ? await prisma.user.findMany({
          where: { id: { in: [...allMentionIds] } },
          select: { id: true, displayName: true },
        })
      : [];
    const mentionById = new Map(mentionUsers.map((u) => [u.id, u]));

    return Promise.all(
      rows.map(async (message) => {
        const isTombstone = message.deletedAt !== null;
        const mentions: MessageAuthor[] = isTombstone
          ? []
          : extractMentionIds(message.content)
              .map((id) => mentionById.get(id))
              .filter((u): u is MessageAuthor => u !== undefined);

        const byEmoji = new Map<string, string[]>();
        for (const r of message.reactions) {
          byEmoji.set(r.emoji, [...(byEmoji.get(r.emoji) ?? []), r.userId]);
        }
        const reactions: ReactionSummary[] = [...byEmoji.entries()].map(([emoji, userIds]) => ({
          emoji,
          count: userIds.length,
          userIds,
        }));

        return {
          id: message.id,
          channelId: message.channelId,
          workspaceId: message.channel.workspaceId,
          author: { id: message.author.id, displayName: message.author.displayName },
          parentId: message.parentId,
          replyCount: message.replyCount,
          lastReplyAt: message.lastReplyAt?.toISOString() ?? null,
          reactions: isTombstone ? [] : reactions,
          mentions,
          content: isTombstone ? null : message.content,
          attachments: isTombstone ? [] : await this.attachments.toResponses(message.attachments),
          createdAt: message.createdAt.toISOString(),
          editedAt: message.editedAt?.toISOString() ?? null,
          deletedAt: message.deletedAt?.toISOString() ?? null,
        };
      }),
    );
  }
}
