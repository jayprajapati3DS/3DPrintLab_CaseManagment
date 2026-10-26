import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";

/**
 * The standard Viewer list: 3D Viewer, Orthognathic Planner and Fibula Flap
 * Planner — each of its own type. Adds the ones a space does not have yet (by
 * name), and gives a standard one whose type is not one of the viewer types its
 * own; names, descriptions and logos are the space's to edit.
 *
 *   npx tsx scripts/seed-viewers.ts demo schneider
 */

export const STANDARD_VIEWERS: Array<{ name: string; type: string; description: string }> = [
  { name: "3D Viewer", type: "3D Viewer", description: "The case's 3D models in the browser — rotate, measure, hide and show parts." },
  { name: "Orthognathic Planner", type: "Orthognathic Planner", description: "Orthognathic surgery planning: osteotomies, segment moves and occlusion." },
  { name: "Fibula Flap Planner", type: "Fibula Flap Planner", description: "Fibula free-flap reconstruction planning: segments, cutting guides and plate fit." },
];

export async function seedViewers(db: PrismaClient, spaceId: string): Promise<number> {
  const existing = await db.resource.findMany({ where: { spaceId, kind: "viewers" }, select: { id: true, name: true, data: true } });
  for (const row of existing) {
    const standard = STANDARD_VIEWERS.find((v) => v.name.toLowerCase() === row.name.trim().toLowerCase());
    const data = (row.data ?? {}) as Record<string, unknown>;
    if (standard && !STANDARD_VIEWERS.some((v) => v.type === data.type)) {
      // The link field is gone: it is dropped with the old type.
      const rest = { ...data };
      delete rest.url;
      await db.resource.update({ where: { id: row.id }, data: { data: { ...rest, type: standard.type } as Prisma.InputJsonObject } });
    }
  }
  const have = new Set(existing.map((v) => v.name.trim().toLowerCase()));
  let added = 0;
  for (const v of STANDARD_VIEWERS) {
    if (have.has(v.name.toLowerCase())) continue;
    await db.resource.create({ data: { spaceId, kind: "viewers", name: v.name, status: "Active", data: { type: v.type, description: v.description } } });
    added += 1;
  }
  return added;
}

async function main() {
  const slugs = process.argv.slice(2);
  if (slugs.length === 0) throw new Error("Name the spaces: npx tsx scripts/seed-viewers.ts demo schneider");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    for (const slug of slugs) {
      const space = await db.space.findUnique({ where: { slug } });
      if (!space) {
        console.log(`${slug}: no such space`);
        continue;
      }
      console.log(`${space.name}: ${await seedViewers(db, space.id)} viewer(s) added`);
    }
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && /seed-viewers\.ts$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
