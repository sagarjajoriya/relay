import { Injectable, Logger } from "@nestjs/common";
import { prisma } from "@relay/db";
import type { NotificationResponse } from "@relay/contracts";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { MailerService } from "./mailer.service";

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly gateway: RealtimeGateway,
    private readonly mailer: MailerService,
  ) {}

  // Runs inside the queue worker under at-least-once semantics: every step is
  // idempotent so a retry after a partial failure never double-notifies.
  async fanOutMessage(messageId: string): Promise<void> {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: { channel: true, author: { select: { displayName: true } } },
    });
    // Deleted (or never landed) between enqueue and processing — nothing to do.
    if (!message || message.deletedAt) return;

    const { channel } = message;

    // Recipients = users who can see the channel, minus the author.
    const recipients =
      channel.type === "PRIVATE"
        ? (
            await prisma.channelMember.findMany({
              where: { channelId: channel.id, userId: { not: message.authorId } },
              include: { user: { select: { id: true, email: true } } },
            })
          ).map((m) => m.user)
        : (
            await prisma.workspaceMember.findMany({
              where: { workspaceId: channel.workspaceId, userId: { not: message.authorId } },
              include: { user: { select: { id: true, email: true } } },
            })
          ).map((m) => m.user);
    if (recipients.length === 0) return;

    // Insert-once per (recipient, message): retries skip existing rows.
    await prisma.notification.createMany({
      data: recipients.map((r) => ({
        userId: r.id,
        workspaceId: channel.workspaceId,
        channelId: channel.id,
        messageId: message.id,
      })),
      skipDuplicates: true,
    });

    // Email policy: only users currently offline in the workspace — online
    // users are watching the live stream (M4 presence answers this).
    const online = new Set((await this.gateway.onlineUsersInWorkspace(channel.workspaceId)).map((u) => u.id));
    const offline = recipients.filter((r) => !online.has(r.id));

    // Only rows not yet emailed: attempt N doesn't re-send what attempt N-1
    // already delivered.
    const pending = await prisma.notification.findMany({
      where: { messageId: message.id, emailedAt: null, userId: { in: offline.map((r) => r.id) } },
    });
    const emailByUserId = new Map(recipients.map((r) => [r.id, r.email]));

    for (const notification of pending) {
      await this.mailer.send({
        to: emailByUserId.get(notification.userId)!,
        subject: `New message in #${channel.name}`,
        body: `${message.author.displayName}: ${message.content.slice(0, 200)}`,
        notificationId: notification.id,
      });
      await prisma.notification.update({
        where: { id: notification.id },
        data: { emailedAt: new Date() },
      });
    }

    this.logger.log(
      `fanned out message=${message.id} recipients=${recipients.length} emailed=${pending.length} onlineSkipped=${recipients.length - offline.length}`,
    );
  }

  async listForUser(userId: string): Promise<NotificationResponse[]> {
    const rows = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    if (rows.length === 0) return [];

    const messages = await prisma.message.findMany({
      where: { id: { in: rows.map((r) => r.messageId) } },
      select: { id: true, content: true, deletedAt: true, author: { select: { displayName: true } } },
    });
    const byId = new Map(messages.map((m) => [m.id, m]));

    return rows.map((r) => {
      const message = byId.get(r.messageId);
      return {
        id: r.id,
        type: r.type,
        workspaceId: r.workspaceId,
        channelId: r.channelId,
        messageId: r.messageId,
        messagePreview: message && !message.deletedAt ? message.content.slice(0, 100) : null,
        authorDisplayName: message?.author.displayName ?? null,
        readAt: r.readAt?.toISOString() ?? null,
        emailedAt: r.emailedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }
}
