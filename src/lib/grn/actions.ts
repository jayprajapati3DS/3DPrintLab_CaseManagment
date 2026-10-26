"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { recordAudit } from "@/lib/audit";
import { assertSameOrigin } from "@/lib/auth/origin";
import { canManageSpace, requireSpaceAdmin, requireSpaceUser } from "@/lib/auth/rbac";
import type { SessionSpace, SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { cleanFileName, deleteStoredFile, MAX_FILE_BYTES, saveFile } from "@/lib/files";
import {
  EQUIPMENT_CATEGORIES,
  grnConfigSchema,
  LINE_TYPES,
  list,
  LOT_TYPES,
  nextGrnNumber,
  nextLotId,
  STOCK_TYPES,
  testOutcome,
  testSummary,
  type GrnConfig,
  type LineType,
  type TestEntry,
} from "@/lib/grn/config";
import { getGrnConfig, knownLotIds, lineOptions } from "@/lib/grn/queries";
import { partStageMeta, partStages } from "@/lib/parts/queries";
import { KINDS, type ResourceKind } from "@/lib/resources/config";
import { spaceToday } from "@/lib/resources/queries";
import { addMonths } from "@/lib/resources/status";

/**
 * Goods receipt: a delivery is received (a draft until confirmed), each line
 * is inspected against its acceptance tests, and an accepted line goes into
 * stock — a new or topped-up material lot, components, packaging, a returned
 * calibrated instrument, new equipment, or outsourced parts moved on.
 *
 * Receiving and inspecting are for anyone in the space; the setup is for its
 * admins. Every step is logged on the receipt and in the audit trail.
 */

export interface GrnActionResult {
  ok: boolean;
  message?: string;
}

type Actor = SessionUser & { space: SessionSpace };
const OK: GrnActionResult = { ok: true };
const fail = (message: string): GrnActionResult => ({ ok: false, message });
const json = (value: unknown) => value as Prisma.InputJsonValue;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const toDate = (v: string) => new Date(`${v}T00:00:00Z`);
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** The register each kind of lot line belongs to. */
const LOT_KIND = { material: "materials", component: "components", packaging: "packaging" } as const;
const isLotType = (type: string): type is keyof typeof LOT_KIND => type in LOT_KIND;

async function member(): Promise<Actor> {
  await assertSameOrigin();
  return requireSpaceUser();
}
async function admin(): Promise<Actor> {
  await assertSameOrigin();
  return requireSpaceAdmin();
}

function audit(actor: Actor, action: `grn.${string}`, grn: { id: string; number: string }, summary: string) {
  return recordAudit({
    action,
    entityType: "grn",
    spaceId: actor.space.id,
    entityId: grn.id,
    entityName: grn.number,
    summary,
    actorId: actor.id,
    actorEmail: actor.email,
  });
}

function paths(id?: string) {
  revalidatePath("/grn");
  revalidatePath("/grnlots");
  if (id) revalidatePath(`/grn/${id}`);
}

async function loadGrn(actor: Actor, id: string) {
  return db.grn.findFirst({ where: { id: String(id), spaceId: actor.space.id }, include: { lines: { orderBy: { position: "asc" } } } });
}

const log = (grnId: string, actor: Actor, text: string) => ({ grnId, byName: actor.name, text });
/** The same, for a log entry created through its receipt. */
const entry = (actor: Actor, text: string) => ({ byName: actor.name, text });

// --- Receipts ----------------------------------------------------------------------------------------

/**
 * "New GRN": opens the receipt details unsaved (/grn/new). The draft — and
 * its number — exists once "Create receipt" is pressed, so a receipt started
 * and left takes no number and leaves nothing behind.
 */
export async function createGrn(): Promise<void> {
  await member();
  redirect("/grn/new");
}

/**
 * Start a receipt from an item's page: a draft GRN with a line for that item
 * already on it, and its usual supplier filled in. Stock arrives only this
 * way — or, once, as opening stock.
 */
export async function receiveViaGrn(formData: FormData): Promise<void> {
  const actor = await member();
  const resource = await db.resource.findFirst({
    where: { id: String(formData.get("resourceId") ?? ""), spaceId: actor.space.id, archivedAt: null },
    include: { scheduleItems: { where: { track: "maintenance" }, orderBy: { dueOn: "asc" } }, lots: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!resource) redirect("/grn");
  const type: LineType | null =
    resource.kind === "materials" ? "material" : resource.kind === "components" ? "component" : resource.kind === "packaging" ? "packaging" : resource.kind === "measuring" ? "calibration" : null;
  if (!type) redirect("/grn");

  const { config } = await getGrnConfig(actor.space.id);
  const today = await spaceToday(actor.space.id);
  const now = toDate(today);
  // The supplier this item last came from, if there is one on record.
  const supplierId = resource.lots[0]?.supplierId ?? null;
  const supplier = supplierId ? await db.resource.findFirst({ where: { id: supplierId, spaceId: actor.space.id, kind: "vendors", archivedAt: null } }) : null;
  const unit = type === "material" ? String(((resource.data ?? {}) as Record<string, unknown>).unit ?? "unit") : type === "calibration" ? null : "pcs";
  const lotNumber =
    isLotType(type) && config.lotId.mode === "auto" ? nextLotId(config, type, await knownLotIds(actor.space.id), now) : null;

  let created: { id: string } | null = null;
  for (let attempt = 0; attempt < 4 && !created; attempt += 1) {
    const existing = await db.grn.findMany({ where: { spaceId: actor.space.id }, select: { number: true } });
    try {
      created = await db.grn.create({
        data: {
          spaceId: actor.space.id,
          number: nextGrnNumber(config, existing.map((g) => g.number), now),
          receivedOn: now,
          supplierId: supplier?.id ?? null,
          supplierName: supplier?.name ?? null,
          header: json({ receivedBy: actor.name, condition: list(config.conditions)[0] ?? "" }),
          createdById: actor.id,
          createdByName: actor.name,
          log: { create: { byName: actor.name, text: `Draft receipt started from ${resource.name}` } },
          lines: {
            create: {
              spaceId: actor.space.id,
              position: 1,
              type,
              itemId: resource.id,
              itemName: resource.name,
              lotNumber,
              unit,
              calItemId: type === "calibration" ? (resource.scheduleItems[0]?.id ?? null) : null,
              extra: {},
              tests: {},
            },
          },
        },
        select: { id: true },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    }
  }
  if (!created) redirect("/grn");
  paths();
  redirect(`/grn/${created.id}?tab=lines`);
}

const headerSchema = z.object({
  supplierId: z.string().max(60),
  receivedOn: isoDate,
  header: z.record(z.string().max(40), z.string().max(300)),
});

export async function saveGrnHeader(grnId: string, payload: string): Promise<GrnActionResult> {
  const actor = await member();
  const creating = String(grnId) === "new";
  const grn = creating ? null : await loadGrn(actor, grnId);
  if (!creating && !grn) return fail("That receipt no longer exists.");
  let parsed;
  try {
    parsed = headerSchema.safeParse(JSON.parse(payload));
  } catch {
    return fail("The receipt could not be read.");
  }
  if (!parsed.success) return fail("Check the dates and fields and try again.");
  const { supplierId, receivedOn, header } = parsed.data;

  let supplierName: string | null = null;
  if (supplierId) {
    const supplier = await db.resource.findFirst({ where: { id: supplierId, spaceId: actor.space.id, kind: "vendors" } });
    if (!supplier) return fail("Choose a supplier from the approved supplier list.");
    supplierName = supplier.name;
  }
  const { config } = await getGrnConfig(actor.space.id);
  const known = new Set(config.header.map((h) => h.k));
  const cleaned = Object.fromEntries(Object.entries(header).filter(([k]) => known.has(k)).map(([k, v]) => [k, v.trim()]));

  // First save of a new receipt: the draft is created now, with the next number.
  if (creating || !grn) {
    let created: { id: string } | null = null;
    for (let attempt = 0; attempt < 4 && !created; attempt += 1) {
      const existing = await db.grn.findMany({ where: { spaceId: actor.space.id }, select: { number: true } });
      try {
        created = await db.grn.create({
          data: {
            spaceId: actor.space.id,
            number: nextGrnNumber(config, existing.map((g) => g.number), toDate(receivedOn)),
            receivedOn: toDate(receivedOn),
            supplierId: supplierId || null,
            supplierName,
            header: json(cleaned),
            createdById: actor.id,
            createdByName: actor.name,
            log: { create: { byName: actor.name, text: "Draft receipt started" } },
          },
          select: { id: true },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      }
    }
    if (!created) return fail("Could not number the receipt — try again.");
    paths();
    redirect(`/grn/${created.id}?tab=lines`);
  }

  const changes: string[] = [];
  if ((grn.supplierId ?? "") !== supplierId) changes.push(`supplier → ${supplierName ?? "none"}`);
  if (grn.receivedOn.toISOString().slice(0, 10) !== receivedOn) changes.push(`received on → ${receivedOn}`);
  const before = (grn.header ?? {}) as Record<string, string>;
  for (const field of config.header) {
    if ((before[field.k] ?? "") !== (cleaned[field.k] ?? "")) changes.push(`${field.label} → ${cleaned[field.k] || "blank"}`);
  }
  if (changes.length === 0) return OK;

  await db.grn.update({
    where: { id: grn.id },
    data: {
      supplierId: supplierId || null,
      supplierName,
      receivedOn: toDate(receivedOn),
      header: json(cleaned),
      // A draft's details are being filled in; after receipt, a change is history.
      ...(grn.received ? { log: { create: { byName: actor.name, text: `Receipt details changed: ${changes.join("; ")}` } } } : {}),
    },
  });
  paths(grn.id);
  return OK;
}

export async function deleteDraftGrn(grnId: string): Promise<GrnActionResult> {
  const actor = await member();
  const grn = await db.grn.findFirst({ where: { id: String(grnId), spaceId: actor.space.id }, include: { documents: true } });
  if (!grn) return fail("That receipt no longer exists.");
  if (grn.received) return fail("Only a draft can be deleted — this delivery has been received.");
  if (grn.createdById !== actor.id && !canManageSpace(actor)) return fail("Only whoever started the draft, or a space admin, can delete it.");
  await db.grn.delete({ where: { id: grn.id } });
  await Promise.all(grn.documents.map((d) => deleteStoredFile(d.storageKey).catch(() => undefined)));
  await audit(actor, "grn.delete_draft", grn, `Deleted draft ${grn.number}`);
  paths();
  redirect("/grn");
}

// --- Lines ----------------------------------------------------------------------------------------------

const lineSchema = z.object({
  type: z.enum(LINE_TYPES),
  itemId: z.string().max(60),
  lotMode: z.enum(["new", "existing"]),
  lotNumber: z.string().max(60),
  existingLotId: z.string().max(60),
  supplierBatch: z.string().max(80),
  quantity: z.string().max(20),
  unit: z.string().max(20),
  expiry: z.string().max(10),
  coa: z.string().max(80),
  partIds: z.array(z.string().max(60)).max(50),
  ref: z.string().max(120),
  calItemId: z.string().max(60),
  cert: z.string().max(80),
  calDate: z.string().max(10),
  category: z.string().max(20),
  equipmentMode: z.enum(["existing", "new"]),
  newName: z.string().max(120),
  newAsset: z.string().max(60),
  description: z.string().max(300),
  extra: z.record(z.string().max(40), z.string().max(300)),
});
export type LinePayload = z.infer<typeof lineSchema>;

/** What a line must have before the receipt can be confirmed — or null when it has it. */
function lineProblem(line: LinePayload, config: GrnConfig, autoLot: boolean): string | null {
  const qty = Number(line.quantity.replace(",", "."));
  const hasQty = line.quantity.trim() !== "" && Number.isFinite(qty) && qty > 0;
  switch (line.type) {
    case "material":
    case "component":
    case "packaging":
      if (!line.itemId) return line.type === "material" ? "Choose the material." : "Choose the item.";
      if (line.lotMode === "existing" ? !line.existingLotId : !line.lotNumber.trim() && !autoLot) return "Give the lot ID, or choose the lot to top up.";
      if (!hasQty) return "Enter the quantity received.";
      break;
    case "part":
      if (line.partIds.length === 0) return "Choose at least one part that came back.";
      break;
    case "calibration":
      if (!line.itemId || !line.calItemId) return "Choose the instrument and its calibration item.";
      break;
    case "equipment":
      if (line.equipmentMode === "new" ? !line.newName.trim() : !line.itemId) return line.equipmentMode === "new" ? "Name the new item." : "Choose the item.";
      if (!EQUIPMENT_CATEGORIES.some(([k]) => k === line.category)) return "Choose the equipment category.";
      break;
    case "other":
      if (!line.description.trim()) return "Describe what arrived.";
      break;
  }
  for (const field of config.types[line.type].extra) {
    if (field.req && !(line.extra[field.k] ?? "").trim()) return `Fill in "${field.label}".`;
  }
  for (const d of [line.expiry, line.calDate]) if (d && !isoDate.safeParse(d).success) return "Enter dates as dates.";
  return null;
}

/** A stored line, read back into the shape the form sends. */
function payloadOf(line: Prisma.GrnLineGetPayload<object>): LinePayload {
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  return {
    type: line.type as LinePayload["type"],
    itemId: line.itemId ?? "",
    lotMode: line.lotMode === "existing" ? "existing" : "new",
    lotNumber: line.lotNumber ?? "",
    existingLotId: line.existingLotId ?? "",
    supplierBatch: line.supplierBatch ?? "",
    quantity: line.quantity !== null ? String(Number(line.quantity)) : "",
    unit: line.unit ?? "",
    expiry: iso(line.expiresOn),
    coa: line.coa ?? "",
    partIds: line.partIds,
    ref: line.ref ?? "",
    calItemId: line.calItemId ?? "",
    cert: line.cert ?? "",
    calDate: iso(line.calDate),
    category: line.category ?? "tooling",
    equipmentMode: line.equipmentMode === "new" ? "new" : "existing",
    newName: line.newName ?? "",
    newAsset: line.newAsset ?? "",
    description: line.description ?? "",
    extra: (line.extra ?? {}) as Record<string, string>,
  };
}

async function resolveLine(actor: Actor, line: LinePayload) {
  const ok = (name: string | null, unit: string | null) => ({ itemName: name, unit });
  const resource = (kind: string) =>
    line.itemId ? db.resource.findFirst({ where: { id: line.itemId, spaceId: actor.space.id, kind, archivedAt: null } }) : null;
  switch (line.type) {
    case "material":
    case "component":
    case "packaging": {
      const r = await resource(LOT_KIND[line.type]);
      if (!r) return null;
      if (line.lotMode === "existing") {
        const lot = await db.materialLot.findFirst({ where: { id: line.existingLotId, resourceId: r.id } });
        if (!lot) return null;
      }
      return ok(r.name, line.type === "material" ? String(((r.data ?? {}) as Record<string, unknown>).unit ?? "unit") : "pcs");
    }
    case "calibration": {
      const r = await resource("measuring");
      if (!r) return null;
      const item = await db.scheduleItem.findFirst({ where: { id: line.calItemId, resourceId: r.id } });
      return item ? ok(r.name, null) : null;
    }
    case "equipment": {
      if (line.equipmentMode === "new") return ok(line.newName.trim(), null);
      const r = await resource(line.category);
      return r ? ok(r.name, null) : null;
    }
    case "part": {
      const parts = await db.part.findMany({ where: { id: { in: line.partIds }, spaceId: actor.space.id }, select: { partNumber: true } });
      return parts.length === line.partIds.length ? ok(parts.map((p) => p.partNumber).join(", "), null) : null;
    }
    case "other":
      return ok(line.description.trim(), line.unit.trim() || null);
  }
}

function lineData(line: LinePayload) {
  const qty = Number(line.quantity.replace(",", "."));
  return {
    type: line.type,
    itemId: line.type === "equipment" && line.equipmentMode === "new" ? null : line.itemId || null,
    lotMode: line.lotMode,
    lotNumber: line.lotNumber.trim() || null,
    existingLotId: isLotType(line.type) && line.lotMode === "existing" ? line.existingLotId : null,
    supplierBatch: line.supplierBatch.trim() || null,
    quantity: line.quantity.trim() && Number.isFinite(qty) ? new Prisma.Decimal(round3(qty)) : null,
    expiresOn: line.expiry ? toDate(line.expiry) : null,
    coa: line.coa.trim() || null,
    partIds: line.type === "part" ? line.partIds : [],
    ref: line.ref.trim() || null,
    calItemId: line.type === "calibration" ? line.calItemId : null,
    cert: line.cert.trim() || null,
    calDate: line.calDate ? toDate(line.calDate) : null,
    category: line.type === "equipment" ? line.category : null,
    equipmentMode: line.type === "equipment" ? line.equipmentMode : null,
    newName: line.newName.trim() || null,
    newAsset: line.newAsset.trim() || null,
    description: line.description.trim() || null,
    extra: json(line.extra),
  };
}

export async function saveGrnLine(grnId: string, lineId: string | null, payload: string): Promise<GrnActionResult> {
  const actor = await member();
  const grn = await loadGrn(actor, grnId);
  if (!grn) return fail("That receipt no longer exists.");
  let parsed;
  try {
    parsed = lineSchema.safeParse(JSON.parse(payload));
  } catch {
    return fail("The line could not be read.");
  }
  if (!parsed.success) return fail("Some entries on the line are not valid.");
  const line = parsed.data;
  const { config } = await getGrnConfig(actor.space.id);
  if (!config.types[line.type].on) return fail(`${config.types[line.type].label} cannot be received — it is turned off in GRN setup.`);

  const existing = lineId ? grn.lines.find((l) => l.id === lineId) : null;
  if (lineId && !existing) return fail("That line no longer exists.");
  if (existing?.decision) return fail("This line has been inspected and can no longer be changed.");

  const autoLot = config.lotId.mode === "auto" && isLotType(line.type) && line.lotMode !== "existing";
  const problem = lineProblem(line, config, autoLot);
  if (problem) return fail(`Fill the item, lot and quantity first — ${problem}`);
  const resolved = await resolveLine(actor, line);
  if (!resolved) return fail("That item is no longer available — choose it again.");

  const data = { ...lineData(line), itemName: resolved.itemName, unit: resolved.unit };
  // The lot gets its ID when the line is added, so it can be labelled at once.
  if (autoLot && !existing?.lotNumber && !data.lotNumber) {
    data.lotNumber = nextLotId(config, line.type as (typeof LOT_TYPES)[number], await knownLotIds(actor.space.id), toDate(await spaceToday(actor.space.id)));
  } else if (autoLot && existing?.lotNumber) {
    data.lotNumber = existing.lotNumber;
  }
  if (isLotType(line.type) && line.lotMode === "existing") {
    const lot = await db.materialLot.findFirst({ where: { id: line.existingLotId } });
    data.lotNumber = lot?.lotNumber ?? null;
  }

  if (existing) {
    await db.grnLine.update({ where: { id: existing.id }, data });
  } else {
    await db.grnLine.create({
      data: { ...data, spaceId: actor.space.id, grnId: grn.id, position: (grn.lines.at(-1)?.position ?? 0) + 1, tests: json({}) },
    });
    if (grn.received) await db.grnLog.create({ data: log(grn.id, actor, `Line added — ${resolved.itemName ?? line.type}`) });
  }
  paths(grn.id);
  return OK;
}

export async function removeGrnLine(lineId: string): Promise<GrnActionResult> {
  const actor = await member();
  const line = await db.grnLine.findFirst({ where: { id: String(lineId), spaceId: actor.space.id }, include: { grn: true } });
  if (!line) return fail("That line no longer exists.");
  if (line.decision) return fail("An inspected line stays on the receipt.");
  await db.grnLine.delete({ where: { id: line.id } });
  if (line.grn.received) await db.grnLog.create({ data: log(line.grnId, actor, `Line removed — ${line.itemName ?? line.type}`) });
  paths(line.grnId);
  return OK;
}

export async function confirmReceipt(grnId: string): Promise<GrnActionResult> {
  const actor = await member();
  const grn = await loadGrn(actor, grnId);
  if (!grn) return fail("That receipt no longer exists.");
  if (grn.received) return OK;
  const { config } = await getGrnConfig(actor.space.id);
  const today = await spaceToday(actor.space.id);

  if (!grn.supplierId) return fail("Select a supplier first.");
  const options = await lineOptions(actor.space.id, today);
  const supplier = options.suppliers.find((s) => s.id === grn.supplierId);
  if (!supplier) return fail("That supplier is no longer on the list — choose it again.");
  if (!supplier.approved && config.rules.supplier === "block") return fail("Supplier not approved — receipt blocked by GRN setup.");

  const header = (grn.header ?? {}) as Record<string, string>;
  const missing = config.header.filter((h) => h.show && h.req && !(header[h.k] ?? "").trim()).map((h) => h.label);
  if (missing.length) return fail(`Fill: ${missing.join(", ")}`);
  if (grn.lines.length === 0) return fail("Add at least one line.");
  for (const line of grn.lines) {
    const problem = lineProblem(payloadOf(line), config, false);
    if (problem) return fail(`Complete every line (item, lot and quantity) — line ${line.position}: ${problem}`);
  }

  await db.grn.update({
    where: { id: grn.id },
    data: {
      received: true,
      receivedAt: new Date(),
      confirmedByName: actor.name,
      log: {
        create: entry(
          actor,
          `Receipt confirmed — ${grn.lines.length} line${grn.lines.length === 1 ? "" : "s"} sent to incoming inspection${supplier.approved ? "" : ` (supplier ${supplier.status})`}`,
        ),
      },
    },
  });
  await audit(actor, "grn.receive", grn, `Goods received on ${grn.number} from ${grn.supplierName} — ${grn.lines.length} line(s)`);
  paths(grn.id);
  return { ok: true, message: `${grn.number} received — lines are in quarantine until inspected` };
}

// --- Inspection -----------------------------------------------------------------------------------------

const testsSchema = z.record(
  z.string().max(40),
  z.object({ n: z.number().int().min(1).max(50), res: z.array(z.enum(["Pass", "Fail", ""])).max(50) }),
);

export async function saveLineTests(lineId: string, payload: string): Promise<GrnActionResult> {
  const actor = await member();
  const line = await db.grnLine.findFirst({ where: { id: String(lineId), spaceId: actor.space.id }, include: { grn: true } });
  if (!line) return fail("That line no longer exists.");
  if (line.decision === "Accepted" || line.decision === "Rejected") return fail("This line has been decided.");
  let tests;
  try {
    tests = testsSchema.parse(JSON.parse(payload));
  } catch {
    return fail("The results could not be read.");
  }
  await db.grnLine.update({ where: { id: line.id }, data: { tests: json(tests) } });
  paths(line.grnId);
  return { ok: true, message: "Results saved" };
}

const decisionSchema = z.object({
  decision: z.enum(["Accepted", "Rejected", "Quarantine"]),
  tests: testsSchema,
  rejectedQty: z.string().max(20),
  reason: z.string().max(500),
});

/** Accept, reject or hold one line, and on acceptance put what arrived where it belongs. */
export async function decideLine(lineId: string, payload: string): Promise<GrnActionResult> {
  const actor = await member();
  const line = await db.grnLine.findFirst({ where: { id: String(lineId), spaceId: actor.space.id }, include: { grn: true } });
  if (!line) return fail("That line no longer exists.");
  const grn = line.grn;
  if (!grn.received) return fail("Confirm the receipt first");
  if (line.decision === "Accepted" || line.decision === "Rejected") return fail("This line has already been decided.");

  let parsed;
  try {
    parsed = decisionSchema.safeParse(JSON.parse(payload));
  } catch {
    return fail("The decision could not be read.");
  }
  if (!parsed.success) return fail("Check the entries and try again.");
  let { decision } = parsed.data;
  const { tests, reason } = parsed.data;
  const { config } = await getGrnConfig(actor.space.id);
  const type = line.type as LineType;
  const checks = config.types[type].checks;
  const stock = STOCK_TYPES.includes(type);

  const received = Number(line.quantity ?? 0);
  const rejected = stock && parsed.data.rejectedQty.trim() ? Number(parsed.data.rejectedQty.replace(",", ".")) : 0;
  if (!Number.isFinite(rejected) || rejected < 0) return fail("Enter the rejected quantity as a number.");

  if (decision === "Accepted") {
    if (stock && rejected > received) return fail("Rejected quantity is more than received");
    if (stock && received > 0 && rejected >= received) decision = "Rejected";
  }
  if (decision === "Accepted") {
    const counted = config.rules.allChecks ? checks : checks.filter((c) => c.req);
    const outcomes = counted.map((c) => ({ c, o: testOutcome(c, tests[c.id] as TestEntry | undefined) }));
    if (outcomes.some(({ o }) => o.state === "pending")) return fail("Record a result for every piece of each required test first");
    if (outcomes.some(({ o }) => o.state === "fail") && rejected === 0) {
      return fail(stock ? "A test has failed — enter the rejected quantity, or reject / hold the line" : "A test has failed — reject or hold the line");
    }
    if (rejected > 0 && !reason.trim()) return fail(`Enter the rejection reason for the ${rejected} rejected`);
  } else if (config.rules.reasonReq && !reason.trim()) {
    return fail(decision === "Rejected" ? "Enter a reason for rejection" : "Enter a reason for the hold");
  }

  const released = round3(received - rejected);
  const summary = testSummary(checks, tests as Record<string, TestEntry>);
  const n = line.position;
  const unit = line.unit ?? "";
  const sentence =
    decision === "Accepted"
      ? `Line ${n} accepted · ${line.itemName ?? type}${stock ? ` · released ${released} ${unit} to stock${rejected ? ` · rejected ${rejected} ${unit}` : ""}` : ""}`
      : decision === "Rejected"
        ? `Line ${n} rejected · ${line.itemName ?? type}${reason ? ` — ${reason}` : ""}`
        : `Line ${n} on hold (quarantine) · ${line.itemName ?? type}${reason ? ` — ${reason}` : ""}`;

  const today = await spaceToday(actor.space.id);
  let effect = "";
  const advanced: string[] = [];

  try {
    await db.$transaction(async (tx) => {
      let resultId: string | null = null;
      if (decision === "Accepted") {
        switch (type) {
          case "material":
          case "component":
          case "packaging": {
            if (line.lotMode === "existing" && line.existingLotId) {
              const lot = await tx.materialLot.update({
                where: { id: line.existingLotId },
                data: { received: { increment: released }, remaining: { increment: released } },
              });
              await tx.lotAdjustment.create({
                data: { lotId: lot.id, quantity: new Prisma.Decimal(released), reason: `Top-up received on ${grn.number}`, byId: actor.id, byName: actor.name },
              });
              resultId = lot.id;
              effect = `Added ${released} ${unit} to lot ${lot.lotNumber}`;
            } else {
              const lot = await tx.materialLot.create({
                data: {
                  resourceId: line.itemId!,
                  lotNumber: line.lotNumber ?? `${grn.number}-${n}`,
                  supplierLot: line.supplierBatch,
                  received: new Prisma.Decimal(released),
                  remaining: new Prisma.Decimal(released),
                  receivedOn: grn.receivedOn,
                  supplier: grn.supplierName,
                  coa: line.coa,
                  expiresOn: line.expiresOn,
                  grnId: grn.id,
                  grnNumber: grn.number,
                  supplierId: grn.supplierId,
                  rejected: rejected ? new Prisma.Decimal(rejected) : null,
                },
              });
              resultId = lot.id;
              effect = `Lot ${lot.lotNumber} created with ${released} ${unit}`;
            }
            break;
          }
          case "calibration": {
            const item = await tx.scheduleItem.findFirst({ where: { id: line.calItemId!, resource: { spaceId: actor.space.id } } });
            if (!item) throw new Error("item missing");
            const doneOn = line.calDate ? line.calDate.toISOString().slice(0, 10) : grn.receivedOn.toISOString().slice(0, 10);
            await tx.scheduleRecord.create({
              data: {
                resourceId: item.resourceId,
                itemId: item.id,
                track: item.track,
                itemName: item.name,
                doneOn: toDate(doneOn),
                doneBy: grn.supplierName ?? "Calibration lab",
                result: item.track === "qualification" ? "Pass" : null,
                ref: line.cert,
                note: `Received on ${grn.number}`,
                recordedById: actor.id,
                recordedByName: actor.name,
              },
            });
            await tx.scheduleItem.update({
              where: { id: item.id },
              data: {
                lastDoneOn: toDate(doneOn),
                lastResult: item.track === "qualification" ? "Pass" : item.lastResult,
                dueOn: item.repeatMonths ? toDate(addMonths(doneOn, item.repeatMonths)) : null,
              },
            });
            resultId = item.resourceId;
            effect = `${item.name} recorded on ${line.itemName} — certificate ${line.cert ?? "—"}`;
            break;
          }
          case "equipment": {
            if (line.equipmentMode === "new") {
              const kind = line.category as ResourceKind;
              const cfg = KINDS[kind];
              const idField = cfg.fields.find((f) => ["assetId", "toolId", "code"].includes(f.key));
              const created = await tx.resource.create({
                data: {
                  spaceId: actor.space.id,
                  kind,
                  name: line.newName ?? "New equipment",
                  status: cfg.statuses[0] ?? "",
                  data: json(idField && line.newAsset ? { [idField.key]: line.newAsset } : {}),
                },
              });
              await tx.scheduleItem.create({
                data: {
                  resourceId: created.id,
                  track: cfg.tabs.includes("qual") ? "qualification" : "maintenance",
                  name: "Installation qualification (IQ)",
                  dueOn: toDate(addMonths(today, 1)),
                },
              });
              resultId = created.id;
              effect = `${created.name} added to ${cfg.title} with an IQ due in a month`;
            } else {
              resultId = line.itemId;
              effect = `${line.itemName} received`;
            }
            break;
          }
          case "part": {
            for (const partId of line.partIds) {
              const part = await tx.part.findFirst({ where: { id: partId, spaceId: actor.space.id } });
              if (!part) continue;
              await tx.partActivity.create({
                data: { partId: part.id, title: `Received on ${grn.number}`, detail: "Goods receipt accepted — part returned from supplier", byId: actor.id, byName: actor.name },
              });
              // It moves on to its next stage if that stage's forms allow it.
              const stages = partStages(part);
              const open = await tx.partForm.count({ where: { partId: part.id, stageIndex: part.stageIndex, status: { not: "Approved" } } });
              if (part.stageIndex < stages.length - 1 && open === 0) {
                const meta = partStageMeta(part);
                meta[part.stageIndex] = { ...meta[part.stageIndex], by: actor.name, at: new Date().toISOString() };
                await tx.part.update({ where: { id: part.id }, data: { stageIndex: part.stageIndex + 1, stageMeta: json(meta) } });
                await tx.partForm.updateMany({ where: { partId: part.id, stageIndex: part.stageIndex + 1, status: "Upcoming" }, data: { status: "In progress" } });
                await tx.partActivity.create({
                  data: {
                    partId: part.id,
                    title: "Advanced stage",
                    detail: `${stages[part.stageIndex].name} → ${stages[part.stageIndex + 1].name} (on ${grn.number})`,
                    byId: actor.id,
                    byName: actor.name,
                  },
                });
                advanced.push(part.partNumber);
              }
            }
            effect = advanced.length ? `Moved on: ${advanced.join(", ")}` : "GRN logged on the parts; none could move on yet (forms at their stage are not approved)";
            break;
          }
          case "other":
            effect = "Not stock-tracked";
            break;
        }
      }

      await tx.grnLine.update({
        where: { id: line.id },
        data: {
          decision,
          tests: json(tests),
          rejectedQty: stock && rejected ? new Prisma.Decimal(rejected) : null,
          reason: reason.trim() || null,
          inspectedById: actor.id,
          inspectedByName: actor.name,
          inspectedAt: new Date(),
          testSummary: summary,
          resultId,
        },
      });
      await tx.grnLog.create({ data: log(grn.id, actor, `${sentence}${effect ? ` — ${effect}` : ""}`) });
    });
  } catch (error) {
    console.error("[grn] decision failed", error instanceof Error ? error.message : error);
    return fail("The decision could not be saved — the item may have been removed. Reload and try again.");
  }

  await audit(actor, decision === "Accepted" ? "grn.accept" : decision === "Rejected" ? "grn.reject" : "grn.hold", { id: grn.id, number: grn.number }, `${grn.number}: ${sentence}`);
  paths(grn.id);
  for (const partId of line.partIds) revalidatePath(`/parts/${partId}`);
  return { ok: true, message: sentence };
}

// --- Documents -----------------------------------------------------------------------------------------

export async function uploadGrnDocuments(grnId: string, formData: FormData): Promise<GrnActionResult> {
  const actor = await member();
  const grn = await loadGrn(actor, grnId);
  if (!grn) return fail("That receipt no longer exists.");
  const kind = String(formData.get("kind") ?? "Other").slice(0, 60);
  const files = formData.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && f.size > 0);
  if (files.length === 0) return fail("Choose at least one file.");
  if (files.some((f) => f.size > MAX_FILE_BYTES)) return fail("Files are limited to 25 MB each.");
  const keys: string[] = [];
  try {
    for (const file of files) {
      const storageKey = await saveFile(actor.space.id, Buffer.from(await file.arrayBuffer()));
      keys.push(storageKey);
      await db.grnDocument.create({
        data: {
          spaceId: actor.space.id,
          grnId: grn.id,
          kind,
          name: cleanFileName(file.name),
          contentType: file.type || "application/octet-stream",
          size: file.size,
          storageKey,
          uploadedByName: actor.name,
        },
      });
    }
    await db.grnLog.create({ data: log(grn.id, actor, `${files.length} document${files.length === 1 ? "" : "s"} attached (${kind})`) });
  } catch (error) {
    await Promise.all(keys.map((k) => deleteStoredFile(k).catch(() => undefined)));
    console.error("[grn] upload failed", error instanceof Error ? error.message : error);
    return fail("The files could not be saved. Try again.");
  }
  paths(grn.id);
  return { ok: true, message: files.length === 1 ? "Document attached" : `${files.length} documents attached` };
}

export async function removeGrnDocument(documentId: string): Promise<GrnActionResult> {
  const actor = await member();
  const doc = await db.grnDocument.findFirst({ where: { id: String(documentId), spaceId: actor.space.id } });
  if (!doc) return fail("That document is no longer attached.");
  await db.grnDocument.delete({ where: { id: doc.id } });
  await deleteStoredFile(doc.storageKey).catch(() => undefined);
  await db.grnLog.create({ data: { grnId: doc.grnId, byName: actor.name, text: `Document removed — ${doc.name}` } });
  paths(doc.grnId);
  return OK;
}

// --- Setup -------------------------------------------------------------------------------------------------

export async function saveGrnConfig(payload: string): Promise<GrnActionResult> {
  const actor = await admin();
  let parsed;
  try {
    parsed = grnConfigSchema.safeParse(JSON.parse(payload));
  } catch {
    return fail("The setup could not be read.");
  }
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "The setup is not valid.");
  const keys = parsed.data.header.map((h) => h.k);
  if (new Set(keys).size !== keys.length) return fail("Two receipt fields share a key — reload and try again.");
  await db.spaceSetting.upsert({
    where: { spaceId_key: { spaceId: actor.space.id, key: "grn" } },
    create: { spaceId: actor.space.id, key: "grn", value: json(parsed.data), updatedByName: actor.name },
    update: { value: json(parsed.data), updatedByName: actor.name },
  });
  await recordAudit({
    action: "grn.setup_save",
    entityType: "grn",
    spaceId: actor.space.id,
    entityId: actor.space.id,
    entityName: "GRN setup",
    summary: "Saved the GRN setup",
    actorId: actor.id,
    actorEmail: actor.email,
  });
  revalidatePath("/grnsetup");
  paths();
  return { ok: true, message: "GRN setup saved — it applies to new and open receipts" };
}
