import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { hashPassword } from "../src/lib/auth/password";

/**
 * A second person in the demo space — a QA reviewer — so that the rule "the
 * approver must be someone other than the submitter" can be tried out.
 *
 *   npx tsx scripts/demo-user.ts
 *
 * Touches the `demo` space only, with the same password as the demo admin.
 */

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to add a demo user with NODE_ENV=production.");
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const space = await db.space.findUnique({ where: { slug: "demo" } });
  if (!space) throw new Error("Run npm run seed:dev first — there is no demo space.");
  const passwordHash = await hashPassword(process.env.SUPER_ADMIN_PASSWORD ?? "");
  const email = "qa@3dsurgical.example";
  await db.user.upsert({
    where: { spaceId_email: { spaceId: space.id, email } },
    update: { passwordHash, isActive: true },
    create: { spaceId: space.id, email, name: "Meera Iyer (QA)", role: "MEMBER", passwordHash },
  });
  console.log(`Demo QA reviewer ready: ${email}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
