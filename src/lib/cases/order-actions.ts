"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { assertSameOrigin } from "@/lib/auth/origin";
import { requireSpaceUser } from "@/lib/auth/rbac";
import { addableOrderTemplates, orderFormData } from "@/lib/cases/orders";
import { db } from "@/lib/db";

/**
 * Adding a form to a case's Order tab, and taking one off. For the case's
 * team (anyone of the space but a surgeon or a vendor's staff, who only fill
 * and sign); role-based permissions come later.
 */

export interface OrderResult {
  ok: boolean;
  message: string;
}

async function actor() {
  await assertSameOrigin();
  return requireSpaceUser();
}

async function loadCase(spaceId: string, caseId: string) {
  return db.caseRecord.findFirst({ where: { id: caseId, spaceId, origin: "local" }, select: { id: true, caseNumber: true, productId: true } });
}

function done(caseId: string) {
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/orders");
}

export async function addOrderForm(caseId: string, templateId: string): Promise<OrderResult> {
  const user = await actor();
  if (user.siteOnly || user.surgeonOnly) return { ok: false, message: "Order forms are added by the case team." };
  const record = await loadCase(user.space.id, caseId);
  if (!record) return { ok: false, message: "This case is not one opened here." };
  const template = (await addableOrderTemplates(user.space.id, record.productId)).find((t) => t.id === templateId);
  if (!template) return { ok: false, message: "That form is not one this case's product offers for its Order tab." };
  const open = await db.partForm.findFirst({ where: { caseId: record.id, area: "order", templateId: template.id, withdrawnAt: null }, select: { id: true } });
  if (open) return { ok: false, message: `${template.name} is already on the Order tab.` };
  await db.partForm.create({ data: orderFormData(user.space.id, record.id, template) });
  await recordAudit({
    action: "case.order_form_add",
    entityType: "case",
    spaceId: user.space.id,
    entityId: record.id,
    entityName: record.caseNumber ?? "",
    actorId: user.id,
    actorEmail: user.email,
    summary: `Added the order form ${template.name}${template.code ? ` (${template.code})` : ""} to case ${record.caseNumber}.`,
  });
  done(record.id);
  return { ok: true, message: `${template.name} added.` };
}

/**
 * Take a form off the Order tab: one nobody has filled goes; one filled,
 * sent or signed is withdrawn — kept, with who and why, and no longer open.
 */
export async function removeOrderForm(formId: string, reason: string): Promise<OrderResult> {
  const user = await actor();
  if (user.siteOnly || user.surgeonOnly) return { ok: false, message: "Order forms are taken off by the case team." };
  const form = await db.partForm.findFirst({ where: { id: formId, spaceId: user.space.id, area: "order", withdrawnAt: null }, include: { case: { select: { id: true, caseNumber: true } } } });
  if (!form || !form.case) return { ok: false, message: "That order form is no longer on the case." };
  const touched = Boolean(form.savedAt) || form.status === "Pending approval" || form.status === "Approved";
  const why = String(reason ?? "").trim().slice(0, 500);
  if (touched && why.length < 3) return { ok: false, message: "Say why it is withdrawn — it has been filled." };
  if (touched) {
    await db.partForm.update({ where: { id: form.id }, data: { withdrawnAt: new Date(), withdrawnByName: user.name, withdrawnReason: why } });
  } else {
    await db.partForm.delete({ where: { id: form.id } });
  }
  await recordAudit({
    action: touched ? "case.order_form_withdraw" : "case.order_form_remove",
    entityType: "case",
    spaceId: user.space.id,
    entityId: form.case.id,
    entityName: form.case.caseNumber ?? "",
    actorId: user.id,
    actorEmail: user.email,
    summary: `${touched ? "Withdrew" : "Removed"} the order form ${form.name}${form.code ? ` (${form.code})` : ""} from case ${form.case.caseNumber}${why ? ` — ${why}` : ""}.`,
  });
  done(form.case.id);
  return { ok: true, message: touched ? `${form.name} withdrawn — kept in the case's history.` : `${form.name} removed.` };
}
