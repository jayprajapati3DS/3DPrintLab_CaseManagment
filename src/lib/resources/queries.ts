import "server-only";

import type { Prisma } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";

import { db } from "@/lib/db";
import { spaceTimeZone } from "@/lib/queries/cases";
import { KINDS, type ResourceKind, type Track } from "@/lib/resources/config";
import type { ItemView, LotView, ResourceView } from "@/lib/resources/status";

/**
 * Reading master data. Every function takes the space first, and every query
 * filters on it: a record in another company's space does not exist here.
 */

/** Today's date in the space's timezone — what "overdue" is measured against. */
export async function spaceToday(spaceId: string): Promise<string> {
  return formatInTimeZone(new Date(), await spaceTimeZone(spaceId), "yyyy-MM-dd");
}

export const iso = (date: Date | null | undefined): string | null =>
  date ? date.toISOString().slice(0, 10) : null;

const LIST_INCLUDE = {
  scheduleItems: true,
  lots: true,
  records: {
    where: { affectsValidation: true, reviewOutcome: null },
    select: { id: true, itemName: true, doneOn: true },
  },
} satisfies Prisma.ResourceInclude;

type ListRow = Prisma.ResourceGetPayload<{ include: typeof LIST_INCLUDE }>;

export function toItemView(item: {
  id: string;
  track: string;
  name: string;
  dueOn: Date | null;
  repeatMonths: number | null;
  lastDoneOn: Date | null;
  lastResult: string | null;
}): ItemView {
  return {
    id: item.id,
    track: item.track as Track,
    name: item.name,
    dueOn: iso(item.dueOn),
    repeatMonths: item.repeatMonths,
    lastDoneOn: iso(item.lastDoneOn),
    lastResult: item.lastResult,
  };
}

export function toLotView(lot: {
  id: string;
  lotNumber: string;
  remaining: Prisma.Decimal;
  received: Prisma.Decimal;
  expiresOn: Date | null;
}): LotView {
  return {
    id: lot.id,
    lotNumber: lot.lotNumber,
    remaining: Number(lot.remaining),
    received: Number(lot.received),
    expiresOn: iso(lot.expiresOn),
  };
}

export function toView(row: ListRow): ResourceView {
  return {
    id: row.id,
    kind: row.kind as ResourceKind,
    name: row.name,
    status: row.status,
    data: (row.data ?? {}) as Record<string, unknown>,
    items: row.scheduleItems.map(toItemView),
    lots: row.lots.map(toLotView),
    pendingReviews: row.records.map((r) => ({
      recordId: r.id,
      itemName: r.itemName,
      doneOn: iso(r.doneOn)!,
    })),
  };
}

export async function listResources(spaceId: string, kind: ResourceKind, archived = false) {
  const rows = await db.resource.findMany({
    where: { spaceId, kind, archivedAt: archived ? { not: null } : null },
    include: LIST_INCLUDE,
    orderBy: archived ? { archivedAt: "desc" } : { createdAt: "asc" },
  });
  return rows.map((row) => ({ row, view: toView(row) }));
}

export async function countArchived(spaceId: string, kind: ResourceKind): Promise<number> {
  return db.resource.count({ where: { spaceId, kind, archivedAt: { not: null } } });
}

const DETAIL_INCLUDE = {
  scheduleItems: { orderBy: { createdAt: "asc" } },
  lots: { orderBy: { receivedOn: "asc" }, include: { adjustments: { orderBy: { createdAt: "asc" } } } },
  records: { orderBy: [{ doneOn: "desc" }, { createdAt: "desc" }], include: { documents: true } },
  documents: { orderBy: { createdAt: "desc" }, include: { record: { select: { itemName: true, track: true } } } },
} satisfies Prisma.ResourceInclude;

export type ResourceDetail = Prisma.ResourceGetPayload<{ include: typeof DETAIL_INCLUDE }>;

export async function getResource(
  spaceId: string,
  kind: ResourceKind,
  id: string,
): Promise<ResourceDetail | null> {
  return db.resource.findFirst({ where: { id, spaceId, kind }, include: DETAIL_INCLUDE });
}

export function detailToView(row: ResourceDetail): ResourceView {
  return {
    id: row.id,
    kind: row.kind as ResourceKind,
    name: row.name,
    status: row.status,
    data: (row.data ?? {}) as Record<string, unknown>,
    items: row.scheduleItems.map(toItemView),
    lots: row.lots.map(toLotView),
    pendingReviews: row.records
      .filter((r) => r.affectsValidation && !r.reviewOutcome)
      .map((r) => ({ recordId: r.id, itemName: r.itemName, doneOn: iso(r.doneOn)! })),
  };
}

/** Active records of a kind, as id and name — for selects and suggestions. */
export async function resourceOptions(spaceId: string, kind: ResourceKind) {
  return db.resource.findMany({
    where: { spaceId, kind, archivedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function listTechnologies(spaceId: string) {
  return db.technology.findMany({ where: { spaceId }, orderBy: { createdAt: "asc" } });
}

/**
 * Everything a supplier is named on, gathered from the other pages. Matched by
 * name, because that is how the fields that point at a supplier are written.
 */
export async function suppliedItems(spaceId: string, vendor: { id: string; name: string }) {
  const name = vendor.name.trim().toLowerCase();
  if (!name) return [];

  const [lots, calibrations, others] = await Promise.all([
    db.materialLot.findMany({
      where: {
        resource: { spaceId, archivedAt: null },
        OR: [{ supplierId: vendor.id }, { supplierId: null, supplier: { equals: vendor.name, mode: "insensitive" } }],
      },
      include: { resource: { select: { id: true, name: true, kind: true } } },
    }),
    db.scheduleRecord.findMany({
      where: { resource: { spaceId, archivedAt: null, kind: "measuring" }, track: "maintenance", doneBy: { equals: vendor.name, mode: "insensitive" } },
      include: { resource: { select: { id: true, name: true } } },
      orderBy: { doneOn: "desc" },
    }),
    db.resource.findMany({
      where: { spaceId, archivedAt: null, kind: { in: ["steril", "software", "workflows"] } },
      select: { id: true, kind: true, name: true, data: true },
    }),
  ]);

  const LOT_TYPE: Record<string, string> = { materials: "Material lot", components: "Component lot", packaging: "Packaging lot" };
  const rows: Array<{ type: string; item: string; detail: string; date: string; href: string }> = lots.map((lot) => ({
    type: LOT_TYPE[lot.resource.kind] ?? "Lot",
    item: `${lot.resource.name} — ${lot.lotNumber}`,
    detail: `${Number(lot.remaining)} of ${Number(lot.received)} remaining${lot.grnNumber ? ` · ${lot.grnNumber}` : ""}${lot.coa ? ` · ${lot.coa}` : ""}`,
    date: iso(lot.receivedOn) ?? "",
    href: `${KINDS[lot.resource.kind as ResourceKind].route}/${lot.resource.id}?tab=lots`,
  }));
  // One row per instrument, for its latest calibration by this lab.
  const seen = new Set<string>();
  for (const record of calibrations) {
    if (seen.has(record.resource.id)) continue;
    seen.add(record.resource.id);
    rows.push({
      type: "Calibration service",
      item: record.resource.name,
      detail: `${record.itemName}${record.ref ? ` · ${record.ref}` : ""}`,
      date: iso(record.doneOn) ?? "",
      href: `/measuring/${record.resource.id}?tab=maint`,
    });
  }

  const TYPES: Partial<Record<ResourceKind, { type: string; field: string }>> = {
    steril: { type: "Sterilization service", field: "equipment" },
    software: { type: "Software", field: "vendor" },
  };

  for (const r of others) {
    const data = (r.data ?? {}) as Record<string, unknown>;
    const kind = r.kind as ResourceKind;
    if (kind === "workflows") {
      if (data.vendorId === vendor.id) {
        rows.push({ type: "Outsourced workflow", item: r.name, detail: String(data.method ?? ""), date: "", href: `/production/${r.id}` });
      }
      continue;
    }
    const spec = TYPES[kind];
    if (!spec) continue;
    const value = String(data[spec.field] ?? "").trim().toLowerCase();
    // "SteriCare Services, Ahmedabad" still names SteriCare Services.
    if (value && (value === name || value.startsWith(`${name},`))) {
      rows.push({
        type: spec.type,
        item: r.name,
        detail: String(data.code ?? data.partNo ?? data.assetId ?? ""),
        date: "",
        href: `${KINDS[kind].route}/${r.id}`,
      });
    }
  }

  return rows;
}

/** How many active workflows, machines and materials name a technology. */
export async function technologyUse(spaceId: string, name: string) {
  const rows = await db.resource.findMany({
    where: { spaceId, archivedAt: null, kind: { in: ["workflows", "printers", "materials"] } },
    select: { kind: true, data: true },
  });
  const uses = { workflows: 0, printers: 0, materials: 0 };
  for (const row of rows) {
    const data = (row.data ?? {}) as Record<string, unknown>;
    const value = row.kind === "workflows" ? data.method : data.process;
    if (value === name) uses[row.kind as keyof typeof uses] += 1;
  }
  return uses;
}
