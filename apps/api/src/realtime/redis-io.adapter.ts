import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import type { ServerOptions } from "socket.io";

// Swaps Socket.io's default in-memory adapter for the Redis adapter: every
// room broadcast is published through Redis pub/sub, so a message emitted on
// one API instance reaches sockets connected to any other. Room names and all
// gateway code are unchanged — this is purely a transport-layer swap.
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  async connectToRedis(redisUrl: string): Promise<void> {
    // The adapter protocol needs two connections: one publishes, one is stuck
    // in subscriber mode (Redis connections can't do both at once).
    const pubClient = createClient({ url: redisUrl });
    const subClient = pubClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  override createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
