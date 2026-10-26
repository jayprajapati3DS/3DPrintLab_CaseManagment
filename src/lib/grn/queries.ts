import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { readGrnConfig, type GrnConfig } from "@/lib/grn/config";
import { stageLabel } from "@/lib/parts/queries";
import { iso, toItemView, toLotView } from "@/lib/resources/queries";
import { effectiveStatus, type ResourceView } from "@/lib/resources/status";
import type { ResourceKind } from "@/lib/resources/config";

/** Reading goods receipts, their setup, the lot register — and what a line can point at. */

export async function getGrnConfig(spaceId: string): Promise<{ config: GrnConfig; saved: boolean; updatedAt: Date | null; updatedByName: string | null }> {
  const row = await db.spaceSetting.findUnique({ where: { spaceId_key: { spaceId, key: "grn" } } });
  return { config: readGrnConfig(row?.value), saved: Boolean(row), updatedAt: row?.updatedAt ?? null, updatedByName: row?.updatedByName ?? null };
}

const LIST_INCLUDE = {
  lines: { select: { id: true, type: true, decision: true, rejectedQty: true } },
} satisfies Prisma.GrnInclude;

export async function listGrns(spaceId: string) {
  return db.grn.findMany({ where: { spaceId }, include: LIST_INCLUDE, orderBy: [{ receivedOn: "desc" }, { number: "desc" }] });
}

const DETAIL_INCLUDE = {
  lines: { orderBy: { position: "asc" } },
  documents: { orderBy: { createdAt: "desc" } },
  log: { orderBy: { createdAt: "desc" } },
} satisfies Prisma.GrnInclude;

export type GrnRecord = Prisma.GrnGetPayload<{ include: typeof DETAIL_INCLUDE }>;

export async function getGrn(spaceId: string, id: string): Promise<GrnRecord | null> {
  return db.grn.findFirst({ where: { id, spaceId }, include: DETAIL_INCLUDE });
}

/** Every lot ID known to the space — to continue the running number. */
export async function knownLotIds(spaceId: string): Promise<string[]> {
  const [lots, lines] = await Promise.all([
    db.materialLot.findMany({ where: { resource: { spaceId } }, select: { lotNumber: true } }),
    db.grnLine.findMany({ where: { spaceId, lotNumber: { not: null } }, select: { lotNumber: true } }),
  ]);
  return [...lots.map((l) => l.lotNumber), ...lines.map((l) => l.lotNumber!)];
}

// --- What a line can point at -------------------------------------------------------------------

export interface SupplierOption {
  id: string;
  name: string;
  kind: string;
  status: string;
  approved: boolean;
  warn: string | null;
}

export interface ItemOption {
  id: string;
  label: string;
  hint: string;
  unit: string;
  lots?: Array<{ id: string; label: string }>;
  /** Calibration: the instrument's scheduled items. */
  items?: Array<{ id: string; label: string }>;
}

export interface LineOptions {
  suppliers: SupplierOption[];
  material: ItemOption[];
  component: ItemOption[];
  packaging: ItemOption[];
  calibration: ItemOption[];
  equipment: Record<"tooling" | "measuring" | "postproc" | "steril", ItemOption[]>;
  parts: Array<{ id: string; label: string; outsourced: boolean }>;
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export async function lineOptions(spaceId: string, today: string): Promise<LineOptions> {
  const resources = await db.resource.findMany({
    where: {
      spaceId,
      archivedAt: null,
      kind: { in: ["vendors", "materials", "components", "packaging", "measuring", "tooling", "postproc", "steril"] },
    },
    include: { scheduleItems: true, lots: { orderBy: { receivedOn: "asc" } } },
    orderBy: { name: "asc" },
  });
  const view = (r: (typeof resources)[number]): ResourceView => ({
    id: r.id,
    kind: r.kind as ResourceKind,
    name: r.name,
    status: r.status,
    data: (r.data ?? {}) as Record<string, unknown>,
    items: r.scheduleItems.map(toItemView),
    lots: r.lots.map(toLotView),
    pendingReviews: [],
  });
  const of = (kind: string) => resources.filter((r) => r.kind === kind);

  const suppliers = of("vendors")
    .map((r): SupplierOption => {
      const status = effectiveStatus(view(r), today);
      const approved = r.status === "Approved" && status.tone !== "red";
      return {
        id: r.id,
        name: r.name,
        kind: str((r.data as Record<string, unknown>)?.kind),
        status: r.status || "—",
        approved,
        warn: approved ? null : status.tone === "red" ? `${r.name} — ${status.label.toLowerCase()}` : `${r.name} is "${r.status || "not set"}" — not on the approved supplier list. Accepting goods needs QA justification.`,
      };
    })
    .sort((a, b) => Number(b.approved) - Number(a.approved) || a.name.localeCompare(b.name));

  /** Stock is the sum of an item's lots — the same for every kind that has lots. */
  const lotsOf = (r: (typeof resources)[number], unit: string) => ({
    hint: (() => {
      const qty = r.lots.reduce((s, l) => s + Math.max(0, Number(l.remaining)), 0);
      const current = r.lots.find((l) => Number(l.remaining) > 0);
      return `Stock now ${Math.round(qty * 1000) / 1000} ${unit} · ${r.lots.length} lot${r.lots.length === 1 ? "" : "s"}${current ? ` · current lot ${current.lotNumber}` : ""}`;
    })(),
    lots: r.lots.map((l) => ({ id: l.id, label: `${l.lotNumber} · ${Number(l.remaining)} ${unit} left` })),
  });

  const parts = await db.part.findMany({
    where: { spaceId, OR: [{ caseId: null }, { case: { bucket: { not: "ARCHIVED" } } }] },
    orderBy: [{ sourcing: "desc" }, { createdAt: "desc" }],
    take: 300,
    select: { id: true, partNumber: true, sourcing: true, vendor: true, stageIndex: true, stageCount: true, stages: true },
  });

  return {
    suppliers,
    material: of("materials").map((r) => {
      const data = (r.data ?? {}) as Record<string, unknown>;
      const unit = str(data.unit) || "unit";
      return { id: r.id, label: `${r.name}${data.tech ? ` · ${str(data.tech)}` : ""}`, unit, ...lotsOf(r, unit) };
    }),
    component: of("components").map((r) => ({
      id: r.id,
      label: `${r.name}${(r.data as Record<string, unknown>)?.partNo ? ` · ${str((r.data as Record<string, unknown>).partNo)}` : ""}`,
      unit: "pcs",
      ...lotsOf(r, "pcs"),
    })),
    packaging: of("packaging").map((r) => ({
      id: r.id,
      label: `${r.name}${(r.data as Record<string, unknown>)?.code ? ` · ${str((r.data as Record<string, unknown>).code)}` : ""}`,
      unit: "pcs",
      ...lotsOf(r, "pcs"),
    })),
    calibration: of("measuring").map((r) => ({
      id: r.id,
      label: `${r.name}${(r.data as Record<string, unknown>)?.assetId ? ` · ${str((r.data as Record<string, unknown>).assetId)}` : ""}`,
      hint: "",
      unit: "",
      items: r.scheduleItems.map((i) => ({ id: i.id, label: `${i.name}${i.dueOn ? ` · due ${iso(i.dueOn)}` : ""}` })),
    })),
    equipment: {
      tooling: of("tooling").map((r) => ({ id: r.id, label: r.name, hint: "", unit: "" })),
      measuring: of("measuring").map((r) => ({ id: r.id, label: r.name, hint: "", unit: "" })),
      postproc: of("postproc").map((r) => ({ id: r.id, label: r.name, hint: "", unit: "" })),
      steril: of("steril").map((r) => ({ id: r.id, label: r.name, hint: "", unit: "" })),
    },
    parts: parts
      // Not yet finished — or, outsourced with no workflow yet, still able to come back from its vendor.
      .filter((p) => p.stageIndex < p.stageCount - 1 || (p.stageCount === 0 && p.sourcing === "Outsourced"))
      .map((p) => ({
        id: p.id,
        label: `${p.partNumber} · ${stageLabel(p)}${p.sourcing === "Outsourced" ? ` · outsourced${p.vendor ? ` to ${p.vendor}` : ""}` : ""}`,
        outsourced: p.sourcing === "Outsourced",
      })),
  };
}

// --- Lot register ---------------------------------------------------------------------------------

export interface LotRow {
  key: string;
  lot: string;
  item: string;
  kind: string;
  supplier: string;
  batch: string;
  grn: string;
  grnId: string | null;
  expiry: string | null;
  remaining: string;
  status: string;
  tone: "green" | "amber" | "grey" | "blue" | "red";
}

export async function lotRegister(spaceId: string, today: string): Promise<LotRow[]> {
  const [lots, lines] = await Promise.all([
    db.materialLot.findMany({
      where: { resource: { spaceId } },
      include: { resource: { select: { name: true, kind: true, data: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.grnLine.findMany({
      where: { spaceId, type: { in: ["material", "component", "packaging"] } },
      include: { grn: { select: { id: true, number: true, received: true, supplierName: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const KIND_LABEL: Record<string, string> = { materials: "Raw material", components: "Standard component", packaging: "Packaging & labelling" };
  const rows: LotRow[] = [];
  for (const lot of lots) {
    const unit = lot.resource.kind === "materials" ? str((lot.resource.data as Record<string, unknown>)?.unit) || "unit" : "pcs";
    const remaining = Number(lot.remaining);
    const expiry = iso(lot.expiresOn);
    const expired = expiry !== null && expiry < today;
    const status = remaining <= 0 ? "Used up" : expired ? "Expired" : lot.grnId ? (Number(lot.rejected ?? 0) > 0 ? "Released (part rejected)" : "Released") : "Released (before GRN)";
    rows.push({
      key: `m-${lot.id}`,
      lot: lot.lotNumber,
      item: lot.resource.name,
      kind: KIND_LABEL[lot.resource.kind] ?? lot.resource.kind,
      supplier: lot.supplier ?? "",
      batch: lot.supplierLot ?? "",
      grn: lot.grnNumber ?? "",
      grnId: lot.grnId,
      expiry,
      remaining: `${Math.round(remaining * 1000) / 1000} ${unit}`,
      status,
      tone: status === "Expired" ? "red" : status === "Used up" ? "grey" : "green",
    });
  }
  for (const line of lines) {
    // An accepted line is a lot above; only what is not in stock yet is listed from receipts.
    if (line.decision === "Accepted") continue;
    const status = !line.grn.received
      ? "Draft GRN"
      : line.decision === "Accepted"
        ? "Released"
        : line.decision === "Rejected"
          ? "Rejected"
          : line.decision === "Quarantine"
            ? "On hold"
            : "Quarantine";
    rows.push({
      key: `g-${line.id}`,
      lot: line.lotNumber ?? "—",
      item: line.itemName ?? "—",
      kind: line.type === "material" ? "Raw material" : line.type === "component" ? "Standard component" : "Packaging & labelling",
      supplier: line.grn.supplierName ?? "",
      batch: line.supplierBatch ?? "",
      grn: line.grn.number,
      grnId: line.grn.id,
      expiry: iso(line.expiresOn),
      remaining: line.decision === "Accepted" ? `${Number(line.quantity ?? 0) - Number(line.rejectedQty ?? 0)} ${line.unit ?? ""}`.trim() : "—",
      status,
      tone: status === "Released" ? "green" : status === "Rejected" ? "red" : status === "Draft GRN" ? "grey" : "amber",
    });
  }
  return rows;
}
