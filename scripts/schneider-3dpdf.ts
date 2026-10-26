import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";

import { readCatalog } from "../src/lib/cases/catalog";
import type { WorkflowStage } from "../src/lib/resources/config";

/**
 * Schneider's products, set up from Orthognathic (user, 2026-10-17):
 *
 *  - 3D PDF: Orthognathic's statuses up to Segmentation — the same forms,
 *    viewers and settings — then "Case completed"; nothing is manufactured.
 *  - Cranial Plate: each status as Orthognathic has it — forms, viewers,
 *    owners, rules — matched by name.
 *
 * Safe to run again.
 *
 *   npx tsx scripts/schneider-3dpdf.ts            (the schneider space)
 */

/** Statuses of a manufactured device only; a 3D PDF case does not reach them. */
const PSI_ONLY_FORMS = /PSI performance evaluation/i;

export async function setupProductsFromOrthognathic(db: PrismaClient, spaceId: string): Promise<string> {
  const ortho = await db.resource.findFirst({ where: { spaceId, kind: "products", name: "Orthognathic", archivedAt: null } });
  if (!ortho) return "no Orthognathic product — nothing done";
  const source = readCatalog(ortho.data);
  const data = (ortho.data ?? {}) as Record<string, unknown>;
  const copy = (st: WorkflowStage): WorkflowStage => JSON.parse(JSON.stringify(st));

  // 3D PDF: up to Segmentation, then Case completed.
  const seg = source.stages.findIndex((st) => st.name === "Segmentation");
  const completed = source.stages.find((st) => /complet/i.test(st.name));
  const stages = [
    ...source.stages.slice(0, seg + 1).map(copy),
    ...(completed ? [{ ...copy(completed), forms: completed.forms.filter((f) => !PSI_ONLY_FORMS.test(f)) }] : []),
  ].map((st) => ({ ...st, id: `pdf-${st.id}` }));
  let made = "3D PDF already there";
  if (!(await db.resource.findFirst({ where: { spaceId, kind: "products", name: "3D PDF", archivedAt: null }, select: { id: true } }))) {
    await db.resource.create({
      data: {
        spaceId,
        kind: "products",
        name: "3D PDF",
        status: "Active",
        data: {
          code: "3DPDF",
          mode: "single",
          tags: ["3D PDF", "Planning"],
          scopes: [],
          stages,
          imageId: "",
          category: data.category ?? "",
          protocols: [],
          viewerIds: source.viewerIds,
          description: "A 3D PDF of the segmented anatomy for planning — the case ends after segmentation; nothing is manufactured.",
          workflowIds: [],
        } as unknown as Prisma.InputJsonObject,
      },
    });
    made = `3D PDF made — ${stages.map((s) => s.name).join(" → ")}`;
  }

  // Cranial Plate: each status as Orthognathic's, by name; its own stage ids kept.
  const cp = await db.resource.findFirst({ where: { spaceId, kind: "products", name: "Cranial Plate", archivedAt: null } });
  let aligned = "no Cranial Plate";
  if (cp) {
    const own = readCatalog(cp.data);
    const byName = new Map(source.stages.map((st) => [st.name, st]));
    const next = source.stages.map((st) => {
      const mine = own.stages.find((o) => o.name === st.name);
      return { ...copy(st), id: mine?.id ?? `cp-${st.id}` };
    });
    const sansId = (list: WorkflowStage[]) => JSON.stringify(list.map((st) => ({ ...st, id: "" })));
    const changed = sansId(next) !== sansId(own.stages);
    if (changed) await db.resource.update({ where: { id: cp.id }, data: { data: { ...((cp.data ?? {}) as object), stages: next } as unknown as Prisma.InputJsonObject } });
    aligned = changed ? `Cranial Plate aligned to Orthognathic (${byName.size} statuses)` : "Cranial Plate already as Orthognathic";
  }
  return `${made}; ${aligned}`;
}

async function main() {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const slug = process.argv[2] ?? "schneider";
    const space = await db.space.findUnique({ where: { slug } });
    if (!space) throw new Error(`No "${slug}" space.`);
    console.log(`${space.name}: ${await setupProductsFromOrthognathic(db, space.id)}.`);
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && /schneider-3dpdf\.ts$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
