import "server-only";

import type { Prisma, QaTemplate } from "@prisma/client";

import { readCatalog } from "@/lib/cases/catalog";
import { db } from "@/lib/db";
import { templateLabel } from "@/lib/qa/template";

/**
 * A case's Order tab: forms between the surgeon and the internal team, not
 * tied to a case status. The team fills its part and saves; the surgeon fills
 * theirs and approves (the form's sign-off). Its product says which forms
 * every new case gets, and which may be added by hand; any of them can be
 * taken off again — a filled one is withdrawn, with why, and kept.
 *
 * Order forms are case forms with area "order" and no stage (stageIndex -1).
 */

export const ORDER_STAGE = -1;
export const ORDER_STAGE_NAME = "Order";

/** The forms a case's product lists for its Order tab: added to every case, and offered. */
export async function productOrderForms(spaceId: string, productId: string | null): Promise<{ auto: string[]; offered: string[] }> {
  if (!productId) return { auto: [], offered: [] };
  const product = await db.resource.findFirst({ where: { id: productId, spaceId, kind: "products" }, select: { data: true } });
  return readCatalog(product?.data).orderForms ?? { auto: [], offered: [] };
}

const byLabel = (templates: QaTemplate[], label: string) => {
  const l = label.trim().toLowerCase();
  return templates.find((t) => templateLabel(t).toLowerCase() === l) ?? templates.find((t) => t.name.toLowerCase() === l || (t.code && t.code.toLowerCase() === l)) ?? null;
};

/** What a form record of a template starts as, on a case's Order tab. */
export function orderFormData(spaceId: string, caseId: string, t: QaTemplate): Prisma.PartFormCreateManyInput {
  return {
    spaceId,
    caseId,
    templateId: t.id,
    area: "order",
    stageIndex: ORDER_STAGE,
    stageName: ORDER_STAGE_NAME,
    name: t.name,
    code: t.code,
    clause: t.clause,
    issue: t.issue,
    effective: t.effective,
    rev: t.rev,
    docLayout: t.docLayout,
    validity: t.validity,
    docStyle: t.docStyle,
    sections: t.sections as Prisma.InputJsonValue,
    status: "In progress",
    values: {},
    measured: {},
    quantities: {},
    snap: {},
  };
}

/** The first time a case opened here is looked at: its product's automatic order forms — once, so one taken off stays off. */
export async function ensureOrderForms(record: { id: string; spaceId: string; productId: string | null; origin: string; ordersReadyAt: Date | null }): Promise<void> {
  if (record.origin !== "local" || record.ordersReadyAt) return;
  const { auto } = await productOrderForms(record.spaceId, record.productId);
  await db.$transaction(async (tx) => {
    const fresh = await tx.caseRecord.updateMany({ where: { id: record.id, ordersReadyAt: null }, data: { ordersReadyAt: new Date() } });
    // Two first views at once: only one adds them.
    if (fresh.count === 0 || auto.length === 0) return;
    const templates = await tx.qaTemplate.findMany({ where: { spaceId: record.spaceId } });
    const picked = [...new Map(auto.map((label) => byLabel(templates, label)).filter((t): t is QaTemplate => Boolean(t)).map((t) => [t.id, t])).values()];
    if (picked.length) await tx.partForm.createMany({ data: picked.map((t) => orderFormData(record.spaceId, record.id, t)) });
  });
}

/**
 * The forms that can be added to a case's Order tab: those its product
 * offers or adds — or, when it lists none to offer, every order and generic
 * QA form.
 */
export async function addableOrderTemplates(spaceId: string, productId: string | null): Promise<QaTemplate[]> {
  const { auto, offered } = await productOrderForms(spaceId, productId);
  const templates = await db.qaTemplate.findMany({ where: { spaceId }, orderBy: { name: "asc" } });
  if (offered.length === 0) return templates.filter((t) => t.usedFor === "order" || t.usedFor === "generic" || auto.some((a) => byLabel([t], a)));
  return [...auto, ...offered].map((l) => byLabel(templates, l)).filter((t, i, all): t is QaTemplate => Boolean(t) && all.findIndex((x) => x?.id === t!.id) === i);
}

/** A case's order forms, oldest first — those withdrawn after being filled too. */
export async function caseOrderForms(spaceId: string, caseId: string) {
  return db.partForm.findMany({
    where: { spaceId, caseId, area: "order" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      templateId: true,
      name: true,
      code: true,
      rev: true,
      status: true,
      version: true,
      savedByName: true,
      savedAt: true,
      submittedByName: true,
      submittedAt: true,
      sentToName: true,
      approvedByName: true,
      approvedAt: true,
      withdrawnAt: true,
      withdrawnByName: true,
      withdrawnReason: true,
      createdAt: true,
    },
  });
}
