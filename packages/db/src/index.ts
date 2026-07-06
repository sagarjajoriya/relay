import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __relayPrisma: PrismaClient | undefined;
}

// Reused across hot reloads in dev so Next.js/Nest watch mode doesn't open a
// new connection pool on every file change.
export const prisma = globalThis.__relayPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__relayPrisma = prisma;
}
