import "dotenv/config";

import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";

import { defaultCaseStages, readCatalog, type CatalogData, type ProductScope } from "../src/lib/cases/catalog";
import type { WorkflowStage } from "../src/lib/resources/config";

/**
 * Sub-scopes used to be records of their own; they are now kept inside their
 * product. This moves each space's sub-scope records into their products —
 * keeping their ids, which cases already name — and archives the old records.
 * A product with sub-scopes becomes a "product with sub-scopes"; each scope
 * keeps its own stages, or gets a copy of the product's.
 *
 * Safe to run again. Only the spaces named are touched:
 *
 *   npx tsx scripts/fold-subscopes.ts demo schneider
 */

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const copy = (stages: WorkflowStage[]) => stages.map((s) => ({ ...s, id: randomUUID() }));

async function fold(slug: string): Promise<string> {
  const space = await db.space.findUnique({ where: { slug } });
  if (!space) return `${slug}: no such space`;
  const rows = await db.resource.findMany({ where: { spaceId: space.id, kind: { in: ["products", "subscopes"] }, archivedAt: null } });
  const subs = rows.filter((r) => r.kind === "subscopes");
  let moved = 0;
  for (const product of rows.filter((r) => r.kind === "products")) {
    const data = readCatalog(product.data);
    const own = subs.filter((s) => (s.data as Record<string, unknown>)?.productId === product.id);
    if (own.length === 0) continue;
    const base = data.mode === "single" && data.stages.length ? data.stages : defaultCaseStages();
    const kept = new Set(data.scopes.map((s) => s.id));
    const scopes: ProductScope[] = [
      ...(data.mode === "scopes" ? data.scopes : []),
      ...own
        .filter((s) => !kept.has(s.id))
        .map((s) => {
          const d = (s.data ?? {}) as Record<string, unknown>;
          const stages = d.ownStages === true && Array.isArray(d.stages) && d.stages.length ? (d.stages as WorkflowStage[]) : copy(base);
          return { id: s.id, name: s.name, code: String(d.code ?? ""), description: String(d.description ?? ""), workflowIds: d.workflowId ? [String(d.workflowId)] : [], stages, imageId: "", viewerIds: [], protocols: [] };
        }),
    ];
    const next: CatalogData = { ...data, mode: "scopes", stages: [], scopes };
    await db.resource.update({ where: { id: product.id }, data: { data: next as unknown as Prisma.InputJsonObject } });
    await db.resource.updateMany({
      where: { id: { in: own.map((s) => s.id) } },
      data: { archivedAt: new Date(), archivedByName: "System", archiveReason: `Moved into the product "${product.name}" — sub-scopes are kept inside their product.` },
    });
    moved += own.length;
  }
  return `${space.name}: ${moved} sub-scope${moved === 1 ? "" : "s"} moved into their products`;
}

async function main() {
  const slugs = process.argv.slice(2);
  if (slugs.length === 0) throw new Error("Name the spaces: npx tsx scripts/fold-subscopes.ts demo schneider");
  for (const slug of slugs) console.log(await fold(slug));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
