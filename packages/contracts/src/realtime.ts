import { z } from "zod";
import type { MessageResponse } from "./messages";

// ---- Client -> server ----

export const joinChannelSchema = z.object({
  channelId: z.string().min(1),
});
export type JoinChannelInput = z.infer<typeof joinChannelSchema>;

export const typingSchema = z.object({
  channelId: z.string().min(1),
});
export type TypingInput = z.infer<typeof typingSchema>;

// ---- Server -> client ----

export interface TypingEvent {
  channelId: string;
  user: { id: string; displayName: string };
}

// Single source of truth for event names on both ends of the socket.
export const WS_EVENTS = {
  // client -> server
  channelJoin: "channel.join",
  channelLeave: "channel.leave",
  typingStart: "typing.start",
  typingStop: "typing.stop",
  // server -> client; message payloads are the same MessageResponse the REST
  // API returns — one contract, two transports.
  messageCreated: "message.created",
  messageUpdated: "message.updated",
  messageDeleted: "message.deleted",
  typing: "typing",
  typingStopped: "typing.stopped",
} as const;

export interface ServerToClientEvents {
  [WS_EVENTS.messageCreated]: (message: MessageResponse) => void;
  [WS_EVENTS.messageUpdated]: (message: MessageResponse) => void;
  [WS_EVENTS.messageDeleted]: (message: MessageResponse) => void;
  [WS_EVENTS.typing]: (event: TypingEvent) => void;
  [WS_EVENTS.typingStopped]: (event: TypingEvent) => void;
}

export interface ClientToServerEvents {
  [WS_EVENTS.channelJoin]: (
    input: JoinChannelInput,
    ack: (res: { ok: true } | { ok: false; error: string }) => void,
  ) => void;
  [WS_EVENTS.channelLeave]: (input: JoinChannelInput) => void;
  [WS_EVENTS.typingStart]: (input: TypingInput) => void;
  [WS_EVENTS.typingStop]: (input: TypingInput) => void;
}
