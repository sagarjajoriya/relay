import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma, Prisma, type Channel } from "@relay/db";
import type { ChannelResponse, CreateChannelInput, UnreadCounts } from "@relay/contracts";

@Injectable()
export class ChannelsService {
  async create(userId: string, workspaceId: string, input: CreateChannelInput): Promise<ChannelResponse> {
    await this.assertWorkspaceMember(userId, workspaceId);

    const existing = await prisma.channel.findUnique({
      where: { workspaceId_name: { workspaceId, name: input.name } },
    });
    if (existing) {
      throw new ConflictException("A channel with this name already exists in the workspace");
    }

    const channel = await prisma.channel.create({
      data: {
        workspaceId,
        name: input.name,
        type: input.type,
        topic: input.topic ?? null,
        createdById: userId,
        // A private channel's creator must be a member to access it; public
        // channels stay membership-free (open to the whole workspace).
        members: input.type === "PRIVATE" ? { create: { userId } } : undefined,
      },
    });

    return this.toResponse(channel);
  }

  async list(userId: string, workspaceId: string): Promise<ChannelResponse[]> {
    await this.assertWorkspaceMember(userId, workspaceId);

    const channels = await prisma.channel.findMany({
      where: {
        workspaceId,
        archivedAt: null,
        OR: [{ type: "PUBLIC" }, { type: "PRIVATE", members: { some: { userId } } }],
      },
      orderBy: { createdAt: "asc" },
    });

    return channels.map((c) => this.toResponse(c));
  }

  async get(userId: string, channelId: string): Promise<ChannelResponse> {
    const channel = await this.assertCanAccess(userId, channelId);
    return this.toResponse(channel);
  }

  async addMember(actorId: string, channelId: string, targetUserId: string): Promise<ChannelResponse> {
    const channel = await this.assertCanAccess(actorId, channelId);
    // The person being added must already belong to the workspace.
    await this.assertWorkspaceMember(targetUserId, channel.workspaceId);

    await prisma.channelMember.upsert({
      where: { channelId_userId: { channelId, userId: targetUserId } },
      update: {},
      create: { channelId, userId: targetUserId },
    });

    return this.toResponse(channel);
  }

  async markRead(userId: string, channelId: string): Promise<void> {
    await this.assertCanAccess(userId, channelId);
    await prisma.channelRead.upsert({
      where: { userId_channelId: { userId, channelId } },
      update: { lastReadAt: new Date() },
      create: { userId, channelId, lastReadAt: new Date() },
    });
  }

  // Unread top-level messages per visible channel, in one query: LEFT JOIN the
  // user's read watermark and count newer messages authored by others.
  // Channels with zero unread simply don't appear in the result.
  async unreadCounts(userId: string, workspaceId: string): Promise<UnreadCounts> {
    await this.assertWorkspaceMember(userId, workspaceId);

    const rows = await prisma.$queryRaw<{ channel_id: string; unread: number }[]>(Prisma.sql`
      SELECT c.id AS channel_id, COUNT(m.id)::int AS unread
      FROM channels c
      LEFT JOIN channel_reads r ON r."channelId" = c.id AND r."userId" = ${userId}
      JOIN messages m ON m."channelId" = c.id
        AND m."deletedAt" IS NULL
        AND m."parentId" IS NULL
        AND m."authorId" <> ${userId}
        AND (r."lastReadAt" IS NULL OR m."createdAt" > r."lastReadAt")
      WHERE c."workspaceId" = ${workspaceId}
        AND c."archivedAt" IS NULL
        AND (
          c.type = 'PUBLIC'
          OR EXISTS (
            SELECT 1 FROM channel_members cm
            WHERE cm."channelId" = c.id AND cm."userId" = ${userId}
          )
        )
      GROUP BY c.id
    `);

    return Object.fromEntries(rows.map((r) => [r.channel_id, r.unread]));
  }

  // Shared visibility gate reused by MessagesService. Returns the channel so
  // callers don't re-fetch. Uses 404 (not 403) for private channels the user
  // isn't in, so their existence never leaks to other workspace members.
  async assertCanAccess(userId: string, channelId: string): Promise<Channel> {
    const channel = await prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) {
      throw new NotFoundException("Channel not found");
    }

    await this.assertWorkspaceMember(userId, channel.workspaceId);

    if (channel.type === "PRIVATE") {
      const membership = await prisma.channelMember.findUnique({
        where: { channelId_userId: { channelId, userId } },
      });
      if (!membership) {
        throw new NotFoundException("Channel not found");
      }
    }

    return channel;
  }

  private async assertWorkspaceMember(userId: string, workspaceId: string): Promise<void> {
    const membership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!membership) {
      throw new ForbiddenException("You are not a member of this workspace");
    }
  }

  private toResponse(channel: Channel): ChannelResponse {
    return {
      id: channel.id,
      workspaceId: channel.workspaceId,
      type: channel.type,
      name: channel.name,
      topic: channel.topic,
      createdAt: channel.createdAt.toISOString(),
    };
  }
}
