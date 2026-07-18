import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OnEvent } from "@nestjs/event-emitter";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import {
  joinChannelSchema,
  typingSchema,
  WS_EVENTS,
  type MessageResponse,
  type PresenceEvent,
  type PresenceUser,
  type TypingEvent,
} from "@relay/contracts";
import { prisma } from "@relay/db";
import type { Server, Socket } from "socket.io";
import type { AccessTokenPayload } from "../auth/jwt-access.strategy";
import { ChannelsService } from "../channels/channels.service";

interface SocketUser {
  userId: string;
  displayName: string;
  // Stashed at connect so disconnect can broadcast offline without a DB hit.
  workspaceIds: string[];
}

// Room names are instance-agnostic: the Redis adapter fans every room
// broadcast out across all API instances.
const channelRoom = (channelId: string) => `channel:${channelId}`;
const workspaceRoom = (workspaceId: string) => `workspace:${workspaceId}`;
const userRoom = (userId: string) => `user:${userId}`;

@WebSocketGateway({
  // Decorator options are evaluated before Nest DI exists, so ConfigService
  // isn't available here; the env var is validated at boot regardless.
  cors: { origin: process.env.CORS_ORIGIN ?? "http://localhost:3000", credentials: true },
})
export class RealtimeGateway {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly channels: ChannelsService,
  ) {}

  // Socket.io middleware: runs once per connection attempt, before the
  // connection is established — unauthenticated sockets never get in at all,
  // which beats checking a guard on every subsequent event.
  afterInit(server: Server) {
    server.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth?.token;
        if (typeof token !== "string" || token.length === 0) {
          return next(new Error("Unauthorized"));
        }
        const payload = this.jwt.verify<AccessTokenPayload>(token, {
          secret: this.config.get<string>("JWT_ACCESS_SECRET"),
        });
        const user = await prisma.user.findUnique({ where: { id: payload.sub } });
        if (!user) {
          return next(new Error("Unauthorized"));
        }
        const memberships = await prisma.workspaceMember.findMany({
          where: { userId: user.id },
          select: { workspaceId: true },
        });
        (socket.data as SocketUser).userId = user.id;
        (socket.data as SocketUser).displayName = user.displayName;
        (socket.data as SocketUser).workspaceIds = memberships.map((m) => m.workspaceId);
        next();
      } catch {
        next(new Error("Unauthorized"));
      }
    });
  }

  // ---- Presence ----
  // Built on adapter room queries (fetchSockets spans every instance via
  // Redis) instead of hand-rolled counters in Redis: room state dies with its
  // socket, so a crashed instance can never leave a user stuck "online".

  async handleConnection(socket: Socket) {
    const { userId, displayName, workspaceIds } = socket.data as SocketUser;
    await socket.join([userRoom(userId), ...workspaceIds.map(workspaceRoom)]);

    // First socket for this user anywhere -> they just came online.
    const userSockets = await this.server.in(userRoom(userId)).fetchSockets();
    if (userSockets.length === 1) {
      this.emitPresence(WS_EVENTS.presenceOnline, { id: userId, displayName }, workspaceIds);
    }
  }

  async handleDisconnect(socket: Socket) {
    const { userId, displayName, workspaceIds } = socket.data as SocketUser;
    if (!userId) return; // socket rejected during handshake

    // Rooms are already vacated by now; zero remaining sockets -> offline.
    const userSockets = await this.server.in(userRoom(userId)).fetchSockets();
    if (userSockets.length === 0) {
      this.emitPresence(WS_EVENTS.presenceOffline, { id: userId, displayName }, workspaceIds);
    }
  }

  private emitPresence(event: string, user: PresenceUser, workspaceIds: string[]) {
    for (const workspaceId of workspaceIds) {
      const payload: PresenceEvent = { workspaceId, user };
      this.server.to(workspaceRoom(workspaceId)).emit(event, payload);
    }
  }

  // Who's online in a workspace = distinct users with a socket in its room,
  // across all instances. Used by the REST presence endpoint.
  async onlineUsersInWorkspace(workspaceId: string): Promise<PresenceUser[]> {
    const sockets = await this.server.in(workspaceRoom(workspaceId)).fetchSockets();
    const byId = new Map<string, PresenceUser>();
    for (const s of sockets) {
      const { userId, displayName } = s.data as SocketUser;
      byId.set(userId, { id: userId, displayName });
    }
    return [...byId.values()];
  }

  @SubscribeMessage(WS_EVENTS.channelJoin)
  async onChannelJoin(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    const parsed = joinChannelSchema.safeParse(body);
    if (!parsed.success) {
      return { ok: false as const, error: "Invalid payload" };
    }
    const { userId } = socket.data as SocketUser;
    try {
      // Server-side access check — the client never decides its own rooms.
      await this.channels.assertCanAccess(userId, parsed.data.channelId);
    } catch {
      return { ok: false as const, error: "Channel not found" };
    }
    await socket.join(channelRoom(parsed.data.channelId));
    return { ok: true as const };
  }

  @SubscribeMessage(WS_EVENTS.channelLeave)
  async onChannelLeave(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    const parsed = joinChannelSchema.safeParse(body);
    if (parsed.success) {
      await socket.leave(channelRoom(parsed.data.channelId));
    }
  }

  @SubscribeMessage(WS_EVENTS.typingStart)
  onTypingStart(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    this.relayTyping(socket, body, WS_EVENTS.typing);
  }

  @SubscribeMessage(WS_EVENTS.typingStop)
  onTypingStop(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    this.relayTyping(socket, body, WS_EVENTS.typingStopped);
  }

  // Typing is ephemeral by design: only relayed to sockets already in the room
  // (room membership was access-checked at join), volatile because a dropped
  // typing signal costs nothing.
  private relayTyping(socket: Socket, body: unknown, event: string) {
    const parsed = typingSchema.safeParse(body);
    if (!parsed.success) return;
    const { channelId } = parsed.data;
    if (!socket.rooms.has(channelRoom(channelId))) return;
    const { userId, displayName } = socket.data as SocketUser;
    const payload: TypingEvent = { channelId, user: { id: userId, displayName } };
    socket.to(channelRoom(channelId)).volatile.emit(event, payload);
  }

  // ---- Domain event -> room broadcast ----
  // The write path (MessagesService) emits these without knowing we exist.

  @OnEvent(WS_EVENTS.messageCreated)
  broadcastCreated(message: MessageResponse) {
    this.server.to(channelRoom(message.channelId)).emit(WS_EVENTS.messageCreated, message);
  }

  @OnEvent(WS_EVENTS.messageUpdated)
  broadcastUpdated(message: MessageResponse) {
    this.server.to(channelRoom(message.channelId)).emit(WS_EVENTS.messageUpdated, message);
  }

  @OnEvent(WS_EVENTS.messageDeleted)
  broadcastDeleted(message: MessageResponse) {
    this.server.to(channelRoom(message.channelId)).emit(WS_EVENTS.messageDeleted, message);
  }
}
