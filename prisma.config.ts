import "dotenv/config";
import path from "node:path";
import { defineConfig } from "prisma/config";

/**
 * Prisma CLI configuration. Prisma 7 no longer reads the connection URL from
 * schema.prisma; migrate/studio take it from here, while the runtime client
 * gets it through the pg adapter in src/lib/db.ts.
 */
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
