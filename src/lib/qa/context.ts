import "server-only";

import { formatInTimeZone } from "date-fns-tz";

import { decryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { fmtDate, shortPatientName } from "@/lib/format";
import { partDetails, partInspection, partStages, type PartRecord } from "@/lib/parts/queries";
import { imageSize, sizeKey } from "@/lib/parts/request-form";
import { caseDetails } from "@/lib/cases/case-form";
import { FILE_PREFIX } from "@/lib/qa/variables";
import { COMPANY_FIELDS, type Context } from "@/lib/qa/variables";
import { iso, toItemView, toLotView } from "@/lib/resources/queries";
import { effectiveStatus, materialStock, nextDue, type ResourceView } from "@/lib/resources/status";
import type { ResourceKind } from "@/lib/resources/config";

/**
 * The values a part's QA forms fill their variables from: the part, its case
 * (the patient only ever as initial and surname), the answers given when it
 * was requested, its machine and material, and what earlier forms recorded.
 */

const str = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const round = (n: number) => String(Math.round(n * 100) / 100);

async function resourceView(spaceId: string, kind: ResourceKind, name: string | null): Promise<ResourceView | null> {
  if (!name) return null;
  const row = await db.resource.findFirst({
    where: { spaceId, kind, name, archivedAt: null },
    include: { scheduleItems: true, lots: true },
  });
  if (!row) return null;
  return {
    id: row.id,
    kind,
    name: row.name,
    status: row.status,
    data: (row.data ?? {}) as Record<string, unknown>,
    items: row.scheduleItems.map(toItemView),
    lots: row.lots.map(toLotView),
    pendingReviews: [],
  };
}

export async function companyDetails(spaceId: string): Promise<Record<string, string>> {
  const row = await db.spaceSetting.findUnique({ where: { spaceId_key: { spaceId, key: "company" } } });
  const value = (row?.value ?? {}) as Record<string, unknown>;
  return Object.fromEntries(COMPANY_FIELDS.map((f) => [f.key, typeof value[f.key] === "string" ? (value[f.key] as string) : ""]));
}

/** The variables every form has, part or not: who is filling it, when, and the company. */
export async function generalContext(
  space: { id: string; name: string },
  user: { id?: string; name: string; roles: string[] },
  today: string,
  timeZone: string,
): Promise<Context> {
  const [company, signer] = await Promise.all([
    companyDetails(space.id),
    user.id ? db.user.findUnique({ where: { id: user.id }, select: { signatureKey: true, signatureUpdatedAt: true } }) : null,
  ]);
  return {
    "user.name": user.name,
    "user.role": user.roles.join(", "),
    // When the person's signature image was saved — "" when they have none.
    "user.signature": signer?.signatureKey ? (signer.signatureUpdatedAt?.toISOString() ?? "yes") : "",
    today,
    now: formatInTimeZone(new Date(), timeZone, "yyyy-MM-dd'T'HH:mm"),
    "space.name": space.name,
    // For showing times on the form — a signature's, say — as the space keeps them.
    "space.timeZone": timeZone,
    ...Object.fromEntries(Object.entries(company).map(([k, v]) => [`company.${k}`, v])),
  };
}

/** The variables of a form filled on a case opened here: the case, its form's answers, and the general ones. */
export async function caseContext(
  c: Parameters<typeof caseDetails>[0] & {
    caseNumber: string | null;
    platformCaseId: number | bigint | null;
    productName: string | null;
    scopeName: string | null;
    caseStatus: string | null;
    caseState: string | null;
    priority: string | null;
    surgeonName: string | null;
    representativeName: string | null;
    hospitalName: string | null;
    patientIdEncrypted: string | null;
    surgeryDate: Date | null;
    anticipatedShipDate: Date | null;
    assigneeName: string | null;
    platformCreatedAt?: Date | null;
    completedAt?: Date | null;
    productCode?: string | null;
  },
  space: { id: string; name: string },
  user: { id?: string; name: string; roles: string[] },
  today: string,
  timeZone: string,
): Promise<Context> {
  const context: Context = {
    "case.id": c.caseNumber ?? `#${c.platformCaseId}`,
    "case.product": c.productName ?? "",
    "case.scope": c.scopeName ?? "",
    "case.status": c.caseStatus ?? "",
    "case.state": c.caseState ?? "",
    "case.priority": c.priority ?? "",
    "case.surgeon": c.surgeonName ?? "",
    "case.salesRep": c.representativeName ?? "",
    "case.hospital": c.hospitalName ?? "",
    "case.surgeryDate": c.surgeryDate ? fmtDate(c.surgeryDate, timeZone) : "",
    "case.shipDate": c.anticipatedShipDate ? fmtDate(c.anticipatedShipDate, timeZone) : "",
    "case.deliveryDate": c.anticipatedShipDate ? fmtDate(c.anticipatedShipDate, timeZone) : "",
    "owner.name": c.assigneeName ?? "",
    "case.owner": c.assigneeName ?? "",
    "case.startDate": c.platformCreatedAt ? fmtDate(c.platformCreatedAt, timeZone) : "",
    "case.endDate": c.completedAt ? fmtDate(c.completedAt, timeZone) : "",
    "case.productCode": c.productCode ?? "",
    ...(await generalContext(space, user, today, timeZone)),
  };
  for (const detail of caseDetails(c)) context[detail.var] = detail.value;
  context["case.patient"] = context["case.patientInitials"] ?? "";
  context["case.patientId"] = decryptSecret(c.patientIdEncrypted) ?? "";
  return context;
}

export async function partContext(
  part: PartRecord,
  space: { id: string; name: string },
  user: { id?: string; name: string; roles: string[]; siteOnly?: boolean },
  today: string,
  timeZone: string,
): Promise<Context> {
  const c = part.case;
  const stages = partStages(part);
  const printFiles = part.files.filter((f) => f.kind === "print");
  const inspection = partInspection(part);

  // Where it is made.
  const site = part.siteId ? await db.resource.findFirst({ where: { id: part.siteId, spaceId: space.id }, select: { name: true, data: true } }) : null;
  const siteData = (site?.data ?? {}) as Record<string, unknown>;
  const siteText = (key: string) => (typeof siteData[key] === "string" ? (siteData[key] as string) : "");

  const context: Context = {
    "site.name": site?.name ?? part.siteName ?? "",
    "site.type": siteText("type"),
    "site.code": siteText("code"),
    "site.city": siteText("city"),
    "site.address": siteText("address"),
    "site.certificate": siteText("certificate"),
    "part.id": part.partNumber,
    "part.name": part.name,
    "part.type": part.partType ?? "",
    "part.qty": String(part.quantity),
    "part.workflow": part.workflowName,
    "part.material": part.material ?? "",
    "part.printer": part.printer ?? "",
    "part.sourcing": part.sourcing,
    "part.vendor": part.vendor ?? "",
    "part.due": iso(part.dueOn) ?? "",
    "part.notes": part.notes ?? "",
    "part.component": String(part.sequence),
    // Links in full, so the form can open them.
    "part.files": [...printFiles.map((f) => f.name), ...part.links].join(", "),
    "part.stage": stages[part.stageIndex]?.name ?? "",
    "part.technology": part.technology ?? "",
    "part.assignee": part.assigneeName ?? "",
    "part.requestedBy": part.requestedByName,
    // When the part was requested, in the space's time zone — the date as {today} gives it.
    "part.requestedOn": formatInTimeZone(part.createdAt, timeZone, "yyyy-MM-dd"),
    "part.requestedAt": formatInTimeZone(part.createdAt, timeZone, "yyyy-MM-dd HH:mm"),
    "owner.name": part.assigneeName ?? "",
    "balloon.count": String(inspection?.rows.length ?? 0),
    "balloon.table": inspection && inspection.rows.length
      ? `${inspection.rows.length} balloon characteristic${inspection.rows.length === 1 ? "" : "s"} on ${inspection.images.length} drawing${inspection.images.length === 1 ? "" : "s"}`
      : "",
    "request.priority": part.priority ?? "",

    "case.id": c ? (c.caseNumber ?? `#${c.platformCaseId}`) : "",
    "case.product": c?.productName ?? "",
    "case.scope": c?.scopeName ?? "",
    "case.status": c?.caseStatus ?? "",
    "case.state": c?.caseState ?? "",
    "case.priority": c?.priority ?? "",
    "case.surgeon": c?.surgeonName ?? "",
    "case.salesRep": c?.representativeName ?? "",
    "case.hospital": c?.hospitalName ?? "",
    "case.patient": c ? shortPatientName(decryptSecret(c.patientNameEncrypted)) : "",
    "case.age": c?.patientAge ?? "",
    "case.surgeryDate": c?.surgeryDate ? fmtDate(c.surgeryDate, timeZone) : "",
    "case.shipDate": c?.anticipatedShipDate ? fmtDate(c.anticipatedShipDate, timeZone) : "",
    "case.owner": c?.assigneeName ?? "",
    "case.startDate": c?.platformCreatedAt ? fmtDate(c.platformCreatedAt, timeZone) : "",
    "case.endDate": c?.completedAt ? fmtDate(c.completedAt, timeZone) : "",
    "case.productCode": c?.productCode ?? "",

    ...(await generalContext(space, user, today, timeZone)),
  };

  // A case opened in this app: its form's answers are {case.<var>}, and the
  // patient is shown by the initials it was opened with.
  if (c?.origin === "local") {
    for (const detail of caseDetails(c)) context[detail.var] = detail.value;
    if (context["case.patientInitials"]) context["case.patient"] = context["case.patientInitials"];
    context["case.patientId"] = decryptSecret(c.patientIdEncrypted) ?? "";
    context["case.deliveryDate"] = c.anticipatedShipDate ? fmtDate(c.anticipatedShipDate, timeZone) : "";
  }

  for (const detail of partDetails(part)) context[detail.var] = detail.value;
  // Where each print file named in {part.files} can be opened (FILE_PREFIX + name).
  for (const file of printFiles) context[`${FILE_PREFIX}${file.name}`] = `/api/part-files/${file.id}`;
  for (const image of part.files.filter((f) => f.kind === "image" && f.field)) {
    context[`request.${image.field}`] = `/api/part-files/${image.id}`;
    // How large the requester chose to show it.
    context[sizeKey(`request.${image.field}`)] = imageSize(image.displaySize);
  }

  const [printer, material] = await Promise.all([
    resourceView(space.id, "printers", part.printer),
    resourceView(space.id, "materials", part.material),
  ]);
  if (printer) {
    context["printer.assetId"] = str(printer.data.assetId);
    context["printer.serial"] = str(printer.data.serial);
    context["printer.status"] = effectiveStatus(printer, today).label;
    context["printer.nextMaintenance"] = nextDue(printer.items, "maintenance")?.dueOn ?? "";
  }
  if (material) {
    const stock = materialStock(material);
    context["material.grade"] = str(material.data.grade);
    context["material.stock"] = `${round(stock.quantity)} ${stock.unit}`;
  }

  // What this part's forms have recorded: the latest lot and parameter set,
  // and all the material drawn.
  const uses = await db.formUse.findMany({
    where: { partId: part.id, source: { in: ["lots", "params"] } },
    orderBy: { createdAt: "desc" },
  });
  const lotUses = uses.filter((u) => u.source === "lots");
  if (lotUses[0]?.itemId) {
    const lot = await db.materialLot.findFirst({ where: { id: lotUses[0].itemId, resource: { spaceId: space.id } } });
    if (lot) {
      context["material.lot"] = lot.lotNumber;
      context["lot.number"] = lot.lotNumber;
      context["lot.coa"] = lot.coa ?? "";
      context["lot.supplier"] = lot.supplier ?? "";
      context["lot.received"] = iso(lot.receivedOn) ?? "";
      context["lot.expiry"] = iso(lot.expiresOn) ?? "";
      context["lot.grn"] = lot.grnNumber ?? "";
    }
    const drawn = lotUses.reduce((sum, u) => sum + Number(u.quantity ?? 0), 0);
    context["material.drawn"] = drawn ? `${round(drawn)} ${lotUses[0].unit ?? ""}`.trim() : "";
  }
  const paramUse = uses.find((u) => u.source === "params");
  if (paramUse?.itemId) {
    const set = await db.resource.findFirst({ where: { id: paramUse.itemId, spaceId: space.id } });
    if (set) {
      const data = (set.data ?? {}) as Record<string, unknown>;
      context["params.name"] = set.name;
      context["params.code"] = str(data.code);
      context["params.keyParams"] = str(data.keyParams);
    }
  }
  // A vendor's or partner's staff (site-only) never see who the patient is.
  if (user.siteOnly) {
    for (const key of Object.keys(context)) if (/^case\.(patient|age|dob|birth)/i.test(key)) context[key] = "";
  }
  return context;
}
