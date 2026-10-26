import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { env, isProduction } from "@/lib/env";

/**
 * Prisma client. Prisma 7 takes the connection through a driver adapter rather
 * than a URL in the schema, so the pool is constructed here.
 *
 * Next dev reloads modules on every edit; caching on globalThis keeps that from
 * opening a new pool per reload and exhausting Postgres connections.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient() {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    // Queries are noisy and can carry business data; log them only on demand.
    log: isProduction ? ["error"] : ["error", "warn"],
  });
}

export const db = globalForPrisma.prisma ?? createClient();

if (!isProduction) globalForPrisma.prisma = db;
