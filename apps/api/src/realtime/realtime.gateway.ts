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
  type TypingEvent,
} from "@relay/contracts";
import { prisma } from "@relay/db";
import type { Server, Socket } from "socket.io";
import type { AccessTokenPayload } from "../auth/jwt-access.strategy";
import { ChannelsService } from "../channels/channels.service";

interface SocketUser {
  userId: string;
  displayName: string;
}

// Room-name helper: one room per channel. When the Redis adapter arrives in M4
// these same room names fan out across instances with zero gateway changes.
const channelRoom = (channelId: string) => `channel:${channelId}`;

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
        (socket.data as SocketUser).userId = user.id;
        (socket.data as SocketUser).displayName = user.displayName;
        next();
      } catch {
        next(new Error("Unauthorized"));
      }
    });
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
