import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { hashPassword } from "../src/lib/auth/password";

/**
 * Seeds the one thing the application cannot bootstrap itself: the first
 * platform administrator. Everyone else signs in at a company space, and a
 * space can only be created from the admin console.
 *
 * Idempotent: an existing account is left alone, password included, so
 * re-running never resets anyone's credentials.
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD ?? "";
  const name = process.env.SUPER_ADMIN_NAME?.trim() || "Platform Admin";

  if (!email || !password) {
    throw new Error("Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD in .env before seeding.");
  }
  if (password.length < 10) {
    throw new Error("SUPER_ADMIN_PASSWORD must be at least 10 characters.");
  }

  const existing = await db.user.findFirst({ where: { isSuperAdmin: true, email } });
  if (existing) {
    console.log(`Super admin already exists: ${email} (left unchanged).`);
    return;
  }

  await db.user.create({
    data: {
      email,
      name,
      isSuperAdmin: true,
      passwordHash: await hashPassword(password),
    },
  });
  console.log(`Super admin created: ${email}. Sign in at the admin console (admin.<BASE_DOMAIN>).`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
