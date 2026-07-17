import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@relay/contracts";

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:4000";

export type RelaySocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function createSocket(accessToken: string): RelaySocket {
  return io(SOCKET_URL, {
    auth: { token: accessToken },
    // Reconnection is on by default; auth callback re-reads nothing here, so a
    // token that expires mid-session will fail reconnect and surface as
    // connect_error — the caller decides whether to refresh and rebuild.
    transports: ["websocket"],
  });
}
