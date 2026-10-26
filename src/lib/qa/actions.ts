"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { recordAudit } from "@/lib/audit";
import { assertSameOrigin } from "@/lib/auth/origin";
import { requireSpaceAdmin, requireSpaceUser, userRoleNames } from "@/lib/auth/rbac";
import type { SessionSpace, SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { layoutsSchema, readLayouts } from "@/lib/qa/layouts";
import type { Inspection } from "@/lib/parts/request-form";
import { getPart, partInspection } from "@/lib/parts/queries";
import { partContext } from "@/lib/qa/context";
import { fillClosed, formOwner, orderClosed, ownerActivity, ownerApprovers, type FormOwner } from "@/lib/qa/owner";
import { formScope } from "@/lib/sites/scope";
import { COMPANY_FIELDS } from "@/lib/qa/variables";
import { cleanFileName, deleteStoredFile, MAX_FILE_BYTES, readStoredFile, saveFile } from "@/lib/files";
import { computeRow, formatDuration, parseDuration, readRows } from "@/lib/qa/calc";
import { ENTRY_TYPES, evaluate, formModel, pickedOption, quantityOf, enteredText, readFiles, type Attachment, type FormState, withOwnUse } from "@/lib/qa/evaluate";
import { qaLibraries } from "@/lib/qa/libraries";
import { formSections, qaSettings } from "@/lib/qa/queries";
import {
  readTemplate,
  standardTemplates,
  autoSigner,
  roleAllowed,
  templateProblem,
  templateSchema,
  type QaTemplateData,
} from "@/lib/qa/template";
import { chainField, peopleKey, readPeople, readStamps, signSteps, stampsKey, type SignPerson, type SignStamp } from "@/lib/qa/signoff";
import { spaceTimeZone } from "@/lib/queries/cases";
import { spaceToday } from "@/lib/resources/queries";

/**
 * Every change to QA templates and to the forms filled on parts.
 *
 * Templates are set up by a space's admins. Forms are filled by anyone in the
 * space; approving one follows the space's rule on who may approve — by
 * default somebody other than the person who submitted it.
 */

export interface QaActionResult {
  ok: boolean;
  message?: string;
  id?: string;
}

type Actor = SessionUser & { space: SessionSpace };

const OK: QaActionResult = { ok: true };
const fail = (message: string): QaActionResult => ({ ok: false, message });
const json = (value: unknown) => value as Prisma.InputJsonValue;

async function admin(): Promise<Actor> {
  await assertSameOrigin();
  return requireSpaceAdmin();
}

async function member(): Promise<Actor> {
  await assertSameOrigin();
  return requireSpaceUser();
}

function audit(actor: Actor, action: `qa.${string}`, entity: { id: string; name: string }, summary: string, entityType = "qa") {
  return recordAudit({
    action,
    entityType,
    spaceId: actor.space.id,
    entityId: entity.id,
    entityName: entity.name,
    summary,
    actorId: actor.id,
    actorEmail: actor.email,
  });
}

// --- Templates -------------------------------------------------------------------------------

function templateRow(data: QaTemplateData) {
  return {
    name: data.name,
    code: data.code.toUpperCase(),
    clause: data.clause,
    issue: data.issue,
    effective: data.effective,
    rev: data.rev,
    docLayout: data.docLayout,
    validity: data.validity ?? "",
    docStyle: data.docStyle ?? "reference",
    usedFor: data.usedFor ?? "generic",
    attach: data.attach,
    sections: json(data.sections),
  };
}

/** "+ New QA form": opens an empty editor; the form is created when it is first saved. */
export async function createTemplate(): Promise<void> {
  await admin();
  redirect("/qaforms/new");
}

/** The six forms the design ships with — added on request, never on their own. */
export async function addStandardTemplates(): Promise<QaActionResult> {
  const actor = await admin();
  const existing = await db.qaTemplate.findMany({ where: { spaceId: actor.space.id }, select: { code: true } });
  const have = new Set(existing.map((t) => t.code));
  const missing = standardTemplates().filter((t) => !have.has(t.code));
  if (missing.length === 0) return fail("The standard forms are already here.");
  await db.qaTemplate.createMany({
    data: missing.map((t) => ({ spaceId: actor.space.id, ...templateRow(t), updatedByName: actor.name })),
  });
  await audit(actor, "qa.template_create", { id: actor.space.id, name: "Standard QA forms" }, `Added ${missing.length} standard QA forms`);
  revalidatePath("/qaforms");
  return { ok: true, message: `Added ${missing.length} standard form${missing.length === 1 ? "" : "s"}` };
}

export async function saveTemplate(id: string, payload: string): Promise<QaActionResult & { createdId?: string }> {
  const actor = await admin();
  const creating = String(id) === "new";
  const template = creating ? { id: "" } : await db.qaTemplate.findFirst({ where: { id: String(id), spaceId: actor.space.id } });
  if (!template) return fail("That QA form no longer exists.");

  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return fail("The form could not be read — reload the page and try again.");
  }
  const parsed = templateSchema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "The form is not valid.");
  const data = parsed.data as QaTemplateData;
  const problem = templateProblem(data);
  if (problem) return fail(problem);

  const clash = await db.qaTemplate.findFirst({
    where: { spaceId: actor.space.id, code: data.code.toUpperCase(), id: { not: template.id }, NOT: { code: "" } },
  });
  if (clash) return fail(`Another QA form already has the document code ${clash.code}.`);

  if (creating) {
    const created = await db.qaTemplate.create({ data: { spaceId: actor.space.id, ...templateRow(data), updatedByName: actor.name } });
    await audit(actor, "qa.template_create", { id: created.id, name: created.name }, `Created QA form ${created.code || created.name}`);
    revalidatePath("/qaforms");
    return { ok: true, message: "QA form created", createdId: created.id };
  }

  await db.qaTemplate.update({ where: { id: template.id }, data: { ...templateRow(data), updatedByName: actor.name } });
  await audit(actor, "qa.template_save", { id: template.id, name: data.name }, `Saved QA form ${data.code || data.name}`);
  revalidatePath("/qaforms");
  revalidatePath(`/qaforms/${template.id}`);
  return { ok: true, message: "QA form saved — parts requested from now on get this version" };
}

export async function duplicateTemplate(id: string): Promise<QaActionResult> {
  const actor = await admin();
  const template = await db.qaTemplate.findFirst({ where: { id: String(id), spaceId: actor.space.id } });
  if (!template) return fail("That QA form no longer exists.");
  const data = readTemplate(template);
  // New ids throughout, so the copy shares nothing with the original.
  const sections = data.sections.map((s) => ({
    ...s,
    id: `s-${crypto.randomUUID().slice(0, 8)}`,
    items: s.items.map((i) => ({ ...i, id: `i-${crypto.randomUUID().slice(0, 8)}` })),
  }));
  let code = data.code ? `${data.code}-C` : "";
  while (code && (await db.qaTemplate.findFirst({ where: { spaceId: actor.space.id, code } }))) code += "C";
  const copy = await db.qaTemplate.create({
    data: {
      spaceId: actor.space.id,
      ...templateRow({ ...data, name: `${data.name} (copy)`, code, attach: [], sections }),
      updatedByName: actor.name,
    },
  });
  await audit(actor, "qa.template_create", { id: copy.id, name: copy.name }, `Duplicated QA form ${data.code || data.name}`);
  revalidatePath("/qaforms");
  return { ok: true, id: copy.id, message: `Duplicated ${data.name}` };
}

export async function deleteTemplate(id: string): Promise<QaActionResult> {
  const actor = await admin();
  const template = await db.qaTemplate.findFirst({ where: { id: String(id), spaceId: actor.space.id } });
  if (!template) return fail("That QA form no longer exists.");
  // Forms already on parts carry their own copy of the template and stay.
  await db.qaTemplate.delete({ where: { id: template.id } });
  await audit(actor, "qa.template_delete", { id: template.id, name: template.name }, `Deleted QA form ${template.code || template.name}`);
  revalidatePath("/qaforms");
  return { ok: true, message: "QA form deleted — records already on parts are kept" };
}

export async function saveQaSettings(separateApprover: boolean): Promise<QaActionResult> {
  const actor = await admin();
  await db.spaceSetting.upsert({
    where: { spaceId_key: { spaceId: actor.space.id, key: "qa" } },
    create: { spaceId: actor.space.id, key: "qa", value: { separateApprover: Boolean(separateApprover) }, updatedByName: actor.name },
    update: { value: { separateApprover: Boolean(separateApprover) }, updatedByName: actor.name },
  });
  await audit(
    actor,
    "qa.settings",
    { id: actor.space.id, name: "QA approval rule" },
    separateApprover ? "Approver must be a different person from the submitter" : "The submitter may also approve",
  );
  revalidatePath("/qaforms");
  return OK;
}

/** A part's variable values, for the editor's live preview. */
export async function previewEnvironment(partId: string): Promise<{ context: Record<string, string>; inspection: Inspection | null } | null> {
  const actor = await member();
  const part = await getPart(actor.space.id, String(partId));
  if (!part) return null;
  const [timeZone, today] = await Promise.all([spaceTimeZone(actor.space.id), spaceToday(actor.space.id)]);
  return { context: await partContext(part, actor.space, { id: actor.id, name: actor.name, roles: userRoleNames(actor), siteOnly: actor.siteOnly }, today, timeZone), inspection: partInspection(part) };
}

// --- Filling a form ------------------------------------------------------------------------------

const stateSchema = z.object({
  // A data table is stored as JSON in one value, so it may be long.
  values: z.record(z.string().max(80), z.string().max(30000)),
  measured: z.record(z.string().max(120), z.string().max(60)),
  quantities: z.record(z.string().max(80), z.string().max(30)),
});

type Mode = "draft" | "submit" | "approve";

const round3 = (n: number) => Math.round(n * 1000) / 1000;

class StockError extends Error {}

/**
 * The person a form may be sent to: active in the space, holding one of the
 * stage's approver roles, and — when the approver must be someone else — not
 * the one sending it.
 */
async function approverIfAllowed(
  actor: Actor,
  userId: string,
  approverRoles: string,
  notId: string | null,
): Promise<{ error: string } | { id: string; name: string }> {
  const user = await db.user.findFirst({
    where: { id: userId, spaceId: actor.space.id, isActive: true },
    select: { id: true, name: true, role: true, platformRoleName: true },
  });
  if (!user) return { error: "That person is not an active member of this space." };
  if (notId && user.id === notId) return { error: "Send it to someone else — the approver must be a different person." };
  if (approverRoles && !roleAllowed(approverRoles, userRoleNames(user).join(", "))) {
    return { error: `${user.name} does not hold a role that approves this stage's forms (${approverRoles}).` };
  }
  return { id: user.id, name: user.name };
}

/** The signed-in person's signature image, copied onto this record — so a later change to it leaves what was signed as it was. */
async function copySignature(actor: Actor, ref: FormOwner["fileRef"], formId: string, itemId: string, label: string): Promise<{ error: string } | { fileId: string }> {
  const signer = await db.user.findUnique({ where: { id: actor.id }, select: { signatureKey: true, signatureType: true } });
  if (!signer?.signatureKey) return { error: `"${label}" is signed with a signature image — add yours first: draw it on this form, or under My account.` };
  let bytes: Buffer;
  try {
    bytes = await readStoredFile(signer.signatureKey);
  } catch {
    return { error: "Your signature image could not be read — add it again under My account." };
  }
  const key = await saveFile(actor.space.id, bytes);
  const copy = await db.partFile.create({
    data: {
      spaceId: actor.space.id,
      ...ref,
      kind: "signature",
      field: `${formId}:${itemId}`,
      name: `Signature — ${actor.name}`,
      contentType: signer.signatureType ?? "image/png",
      size: bytes.length,
      storageKey: key,
      uploadedByName: actor.name,
    },
  });
  return { fileId: copy.id };
}

/** Who signed a signature field, as stored beside it: account, roles, when, and the copied image. */
interface Stamp {
  name: string;
  roles: string;
  at: string;
  fileId?: string;
}

function readStamp(text: string | undefined): Stamp | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as Stamp;
  } catch {
    return null;
  }
}

/** Remove signature image copies, file and record. */
async function dropSnapshots(ids: string[]) {
  if (!ids.length) return;
  const files = await db.partFile.findMany({ where: { id: { in: ids }, kind: "signature" } });
  await db.partFile.deleteMany({ where: { id: { in: files.map((f) => f.id) } } });
  await Promise.all(files.map((f) => deleteStoredFile(f.storageKey).catch(() => undefined)));
}

/**
 * Save a form — as a draft, for approval, or as the approval itself. What it
 * picked from the libraries is written down as traceability, and any quantity
 * recorded as used is taken off that lot's or item's stock.
 */
export async function saveForm(formId: string, mode: Mode, payload: string, sendTo?: string): Promise<QaActionResult> {
  const actor = await member();
  if (!["draft", "submit", "approve"].includes(mode)) return fail("Unknown action.");

  const form = await db.partForm.findFirst({
    where: { id: String(formId), spaceId: actor.space.id, ...formScope(actor) },
    include: { uses: true },
  });
  if (!form) return fail("That form no longer exists.");
  if (form.status === "Approved") return fail("This record is approved and locked.");
  // Sent for approval: changed only by whoever signs it now; the sender reverts it to draft first.
  if (form.status === "Pending approval" && mode !== "approve") {
    return fail("It is waiting for approval — revert it to draft to change it.");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return fail("The form could not be read — reload and try again.");
  }
  const parsed = stateSchema.safeParse(raw);
  if (!parsed.success) return fail("Some entries are too long.");
  // Signature stamps are the server's to write; whatever came with the form is ignored.
  const state: FormState = {
    ...parsed.data,
    values: Object.fromEntries(Object.entries(parsed.data.values).filter(([k]) => !k.startsWith("sig:") && !k.startsWith("sigs:"))),
  };
  // Reviewed by / Approved by: chosen people sign in turn (signoff.ts).
  const chainItems = formSections(form)
    .flatMap((sec) => sec.items)
    .filter((i) => chainField(i));
  const chained = chainItems.length > 0;

  const owner = await formOwner(actor.space.id, form);
  if (!owner) return fail("The part or case of this form no longer exists.");
  const closed = mode === "approve" ? null : (fillClosed(owner, form) ?? (await orderClosed(owner, form)));
  if (closed) return fail(closed);

  const settings = await qaSettings(actor.space.id);
  // Who may approve this stage's forms, as its workflow says.
  const approverRoles = ownerApprovers(owner, form.stageIndex);
  if (mode === "approve" && chained && (form.status !== "Pending approval" || !form.sentToId)) {
    return fail("Submit the form first — the people chosen to review and approve it sign in turn.");
  }
  if (mode === "approve") {
    if (form.sentToId) {
      // Sent to one person: only they approve it.
      if (form.sentToId !== actor.id) return fail(`This form was sent to ${form.sentToName ?? "someone else"} — only they can approve it.`);
    } else {
      if (settings.separateApprover) {
        if (form.status !== "Pending approval") return fail("Submit the form for approval first — it is approved by someone else.");
        if (form.submittedById === actor.id) return fail("You submitted this form — someone else must approve it.");
      }
      if (approverRoles && !roleAllowed(approverRoles, userRoleNames(actor).join(", "))) {
        return fail(`Only ${approverRoles} approve this stage's forms.`);
      }
    }
  }
  // Submitting sends the form to one chosen person who may approve it.
  let sentTo: { id: string; name: string } | null = null;
  if (mode === "submit" && !chained) {
    if (!sendTo) return fail("Choose who to send it to for approval.");
    const chosen = await approverIfAllowed(actor, String(sendTo), approverRoles, settings.separateApprover ? actor.id : null);
    if ("error" in chosen) return fail(chosen.error);
    sentTo = chosen;
  }

  // Signatures the app signs: "Prepared by" as the form is submitted, by the
  // person submitting it; "Approved by" as it is approved, by the approver.
  // Neither can be typed; until its moment each keeps what it had, or nothing.
  const kept = (form.values ?? {}) as Record<string, string>;
  for (const item of formSections(form).flatMap((s) => s.items)) {
    const signer = autoSigner(item);
    if (!signer) continue;
    if (signer === "reviewer" || signer === "approver") {
      // The signatures so far stay; the people chosen are the filler's until it is sent.
      for (const key of [item.id, stampsKey(item.id)]) {
        if (kept[key] && mode !== "submit") state.values[key] = kept[key];
        else delete state.values[key];
      }
      if (form.status === "Pending approval" && mode !== "submit") {
        if (kept[peopleKey(item.id)]) state.values[peopleKey(item.id)] = kept[peopleKey(item.id)];
      } else {
        const picked = readPeople(state.values[peopleKey(item.id)]).slice(0, 10);
        if (picked.length) state.values[peopleKey(item.id)] = JSON.stringify(picked.map((x) => ({ id: String(x.id).slice(0, 40), name: String(x.name).slice(0, 120) })));
        else delete state.values[peopleKey(item.id)];
      }
      continue;
    }
    // A form approved without being submitted is prepared by its approver too.
    const signNow = signer === "submitter" ? mode === "submit" || (mode === "approve" && !kept[item.id]) : mode === "approve";
    if (signNow) state.values[item.id] = actor.name;
    else if (signer === "submitter" && kept[item.id]) state.values[item.id] = kept[item.id];
    else delete state.values[item.id];
  }

  const [libraries, timeZone, today] = await Promise.all([
    qaLibraries(actor.space.id),
    spaceTimeZone(actor.space.id),
    spaceToday(actor.space.id),
  ]);
  const context = await owner.context(actor.space, { id: actor.id, name: actor.name, roles: userRoleNames(actor), siteOnly: actor.siteOnly }, today, timeZone);
  const sections = formSections(form);
  const items = sections.flatMap((s) => s.items);

  const model = formModel(sections, state, context, libraries);
  // A field not shown keeps nothing: no value, no quantity taken from stock.
  for (const id of model.hidden) {
    delete state.values[id];
    delete state.quantities[id];
  }

  // What this form already used is back on the shelf for the checks — also a lot it used up.
  const ownStock = withOwnUse(
    libraries,
    form.uses.filter((u) => u.itemId && u.quantity).map((u) => ({ source: u.source, itemId: u.itemId!, qty: Number(u.quantity) })),
  );
  const result = evaluate(sections, state, context, ownStock, owner.inspection);
  if (mode !== "draft") {
    if (result.missing.length) {
      return fail(`Fill all required items before ${mode === "submit" ? "submitting" : "approving"}: ${result.missing.slice(0, 4).join(", ")}${result.missing.length > 4 ? "…" : ""}`);
    }
    if (result.blocked.length) return fail(`${result.blocked[0]} — pick another item or fix it first`);
  }
  if (mode === "approve" && result.fails.length) {
    return fail(`${result.fails.length} item${result.fails.length === 1 ? "" : "s"} out of specification — raise an NCR / rework before approving`);
  }
  // Quantities over what is available would take stock below zero, even in a draft.
  const overdraw = result.blocked.find((b) => b.includes(" available"));
  if (overdraw) return fail(overdraw);

  // --- Reviewed by / Approved by: who signs, and who signs now --------------------------------
  const chainShown = chainItems.filter((i) => !model.hidden.has(i.id));
  const chainSnapshots: string[] = [];
  let chainNext: SignPerson | null = null;
  let chainKind: "reviewer" | "approver" | null = null;
  if (chained && mode === "submit") {
    for (const item of chainShown) {
      const picked = readPeople(state.values[peopleKey(item.id)]);
      if (!picked.length) {
        if (item.req) return fail(`Choose who signs "${item.label}".`);
        continue;
      }
      if (new Set(picked.map((x) => x.id)).size !== picked.length) return fail(`"${item.label}" lists the same person twice.`);
      const roles = (item.roles ?? "").trim() || (chainField(item) === "approver" ? approverRoles : "");
      const people: SignPerson[] = [];
      for (const x of picked) {
        const chosen = await approverIfAllowed(actor, x.id, roles, settings.separateApprover ? actor.id : null);
        if ("error" in chosen) return fail(`"${item.label}": ${chosen.error}`);
        people.push(chosen);
      }
      state.values[peopleKey(item.id)] = JSON.stringify(people);
    }
    const steps = signSteps(chainShown, state.values);
    if (!steps.length) return fail("Choose who reviews or approves this form.");
    sentTo = steps[0].person;
  }
  if (chained && mode === "approve") {
    const steps = signSteps(chainShown, state.values);
    const at = steps.findIndex((x) => !x.signed);
    const step = steps[at];
    if (!step || step.person.id !== actor.id) return fail(`It is not your turn to sign — waiting for ${step?.person.name ?? form.sentToName ?? "someone else"}.`);
    const item = step.item;
    if (item.roles && !roleAllowed(item.roles, userRoleNames(actor).join(", "))) return fail(`"${item.label}" can only be signed by: ${item.roles}.`);
    const stamp: SignStamp = { id: actor.id, name: actor.name, roles: userRoleNames(actor).join(", "), at: new Date().toISOString() };
    if (item.style === "image") {
      const copied = await copySignature(actor, owner.fileRef, form.id, item.id, item.label);
      if ("error" in copied) return fail(copied.error);
      stamp.fileId = copied.fileId;
      chainSnapshots.push(copied.fileId);
    }
    const stamps = [...readStamps(state.values[stampsKey(item.id)]).filter((x) => x.id !== actor.id), stamp];
    state.values[stampsKey(item.id)] = JSON.stringify(stamps);
    state.values[item.id] = stamps.map((x) => x.name).join(", ");
    chainKind = step.kind;
    chainNext = steps.slice(at + 1).find((x) => !x.signed)?.person ?? null;
  }
  // Approved only when the last chosen person has signed.
  const approving = mode === "approve" && !chainNext;

  // --- Traceability: what was picked, and how much was used ------------------------------------
  const uses: Prisma.FormUseCreateManyInput[] = [];
  const snap: Record<string, { label: string; line: string; warn: string | null }> = {};
  const values = { ...state.values };
  for (const item of items) {
    if (item.type !== "select" || !item.src || model.hidden.has(item.id)) continue;
    if (item.src === "custom") {
      const value = enteredText(item, state, context);
      if (value) {
        values[item.id] = value;
        uses.push({ spaceId: actor.space.id, formId: form.id, partId: owner.kind === "part" ? owner.id : null, source: "custom", itemId: null, label: value, field: item.label });
      }
      continue;
    }
    const option = pickedOption(item, state, context, libraries);
    if (!option) continue;
    values[item.id] = option.id;
    const qty = item.qty ? quantityOf(state, item.id) : null;
    uses.push({
      spaceId: actor.space.id,
      formId: form.id,
      partId: owner.kind === "part" ? owner.id : null,
      source: item.src,
      itemId: option.id,
      label: option.label,
      quantity: qty !== null ? new Prisma.Decimal(round3(qty)) : null,
      unit: qty !== null ? option.unit : null,
      field: item.label,
    });
    snap[item.id] = { label: option.label, line: option.info.map(([k, v]) => `${k}: ${v}`).join("  ·  "), warn: option.warn };
  }
  // Entries pre-filled from variables are kept as they read when saved; a
  // duration is kept as h:mm, and a calculated field as its result, so the
  // record reads the same however its formula is later changed.
  const computed = model.calc;
  const stored = (form.values ?? {}) as Record<string, string>;
  const roles = userRoleNames(actor);
  // Signature images copied for this save, and copies it replaces.
  const newSnapshots: string[] = [...chainSnapshots];
  const obsoleteSnapshots: string[] = [];
  const evidence = new Set(
    (await db.partFile.findMany({ where: { ...owner.fileRef, kind: "evidence", field: { startsWith: `${form.id}:` } }, select: { id: true } })).map((f) => f.id),
  );
  // Pictures beside a field's value: only those uploaded for this form, on a field that takes them.
  for (const k of Object.keys(values)) if (k.startsWith("img:") && !items.some((i) => i.allowImages && `img:${i.id}` === k)) delete values[k];
  for (const item of items) {
    if (!item.allowImages) continue;
    const k = `img:${item.id}`;
    const pics = model.hidden.has(item.id) ? [] : readFiles(values[k]).filter((f) => evidence.has(f.id));
    if (pics.length) values[k] = JSON.stringify(pics);
    else delete values[k];
  }
  for (const item of items) {
    if (model.hidden.has(item.id)) {
      delete values[item.id];
      continue;
    }
    if (item.type === "grid") {
      // Rows with nothing typed are dropped; calculated cells are kept as worked out.
      const columns = item.columns ?? [];
      const rows = readRows(values[item.id])
        .filter((row) => columns.some((c) => c.kind !== "calc" && (row.c[c.id] ?? "").trim()))
        .map((row) => {
          const cells = computeRow(columns, row, context);
          const c: Record<string, string> = {};
          for (const col of columns) {
            const raw = col.kind === "calc" ? (cells[col.id]?.text ?? "") : (row.c[col.id] ?? "").trim();
            const text = col.kind === "image" && raw && !evidence.has(raw) ? "" : raw;
            if (text) c[col.id] = col.kind === "duration" && parseDuration(text) !== null ? formatDuration(parseDuration(text)!) : text;
          }
          return { id: row.id, c };
        });
      if (rows.length) values[item.id] = JSON.stringify(rows);
      else delete values[item.id];
      continue;
    }
    if (item.type === "file") {
      // Only files actually attached to this form, on this part.
      const files = readFiles(values[item.id]).filter((f) => evidence.has(f.id));
      if (files.length) values[item.id] = JSON.stringify(files);
      else delete values[item.id];
      continue;
    }
    if (ENTRY_TYPES.includes(item.type) && values[item.id] === undefined) {
      const text = enteredText(item, state, context);
      if (text) values[item.id] = text;
    }
    if (item.type === "duration" && values[item.id]) {
      const minutes = parseDuration(values[item.id]);
      if (minutes !== null) values[item.id] = formatDuration(minutes);
    }
    if (item.type === "calc") {
      if (computed[item.id]?.text) values[item.id] = computed[item.id].text;
      else delete values[item.id];
    }
    // A signature records the account that signed it, and when; one kept for
    // some roles can be signed only by a person who holds one of them.
    if (item.type === "sign") {
      // Signed in turn by chosen people, above.
      if (chainField(item)) continue;
      const text = (values[item.id] ?? "").trim();
      const before = readStamp(stored[`sig:${item.id}`]);
      if (!text) {
        // Cleared: an image copied for the old signature is no longer needed.
        if (before?.fileId) obsoleteSnapshots.push(before.fileId);
        continue;
      }
      if (text === (stored[item.id] ?? "").trim() && before) {
        values[`sig:${item.id}`] = stored[`sig:${item.id}`];
        continue;
      }
      if (item.roles && !roleAllowed(item.roles, roles.join(", "))) {
        await dropSnapshots(newSnapshots);
        return fail(`"${item.label}" can only be signed by: ${item.roles}. You are signed in as ${roles.join(", ") || "no role"}.`);
      }
      const stamp: Stamp = { name: actor.name, roles: roles.join(", "), at: new Date().toISOString() };
      if (item.style === "image") {
        // Signed with the image kept on My account — copied onto this record,
        // so a later change to it leaves what was signed as it was.
        const copied = await copySignature(actor, owner.fileRef, form.id, item.id, item.label);
        if ("error" in copied) {
          await dropSnapshots(newSnapshots);
          return fail(copied.error);
        }
        newSnapshots.push(copied.fileId);
        stamp.fileId = copied.fileId;
        // The image speaks for the signed-in person; the name is theirs too.
        values[item.id] = actor.name;
      }
      if (before?.fileId) obsoleteSnapshots.push(before.fileId);
      values[`sig:${item.id}`] = JSON.stringify(stamp);
    }
  }

  // Stock moves by the difference between what the form used before and now.
  const delta = new Map<string, { source: string; itemId: string; qty: number }>();
  for (const use of form.uses) {
    if (!use.itemId || !use.quantity) continue;
    const key = `${use.source}:${use.itemId}`;
    delta.set(key, { source: use.source, itemId: use.itemId, qty: (delta.get(key)?.qty ?? 0) - Number(use.quantity) });
  }
  for (const use of uses) {
    if (!use.itemId || use.quantity === null || use.quantity === undefined) continue;
    const key = `${use.source}:${use.itemId}`;
    delta.set(key, { source: use.source, itemId: use.itemId, qty: (delta.get(key)?.qty ?? 0) + Number(use.quantity) });
  }

  const now = new Date();
  const status = approving ? "Approved" : mode === "approve" ? "Pending approval" : mode === "submit" ? "Pending approval" : form.status === "Pending approval" ? "Pending approval" : "In progress";
  const titles: Record<Mode, string> = {
    draft: "Saved quality form draft",
    submit: "Submitted quality form for approval",
    approve: approving ? "Approved quality form" : chainKind === "reviewer" ? "Reviewed quality form" : "Signed quality form approval",
  };
  const detail = `${form.name}${form.code ? ` (${form.code})` : ""}${result.fails.length ? ` · ${result.fails.length} out of spec` : ""}`;

  try {
    await db.$transaction(async (tx) => {
      for (const { source, itemId, qty } of delta.values()) {
        const change = round3(qty);
        if (change === 0) continue;
        if (source === "lots" || source === "components" || source === "packaging") {
          const lot = await tx.materialLot.findFirst({ where: { id: itemId, resource: { spaceId: actor.space.id } } });
          if (!lot) continue;
          if (Number(lot.remaining) - change < -0.0005) throw new StockError(`Lot ${lot.lotNumber} has only ${Number(lot.remaining)} left.`);
          await tx.materialLot.update({ where: { id: lot.id }, data: { remaining: { decrement: change } } });
          await tx.lotAdjustment.create({
            data: {
              lotId: lot.id,
              quantity: new Prisma.Decimal(-change),
              reason: `${change > 0 ? "Used on" : "Returned from"} ${owner.label} — ${form.code || form.name}`,
              byId: actor.id,
              byName: actor.name,
            },
          });
        }
      }

      await tx.formUse.deleteMany({ where: { formId: form.id } });
      if (uses.length) await tx.formUse.createMany({ data: uses });

      await tx.partForm.update({
        where: { id: form.id },
        data: {
          status,
          values: json(values),
          measured: json(state.measured),
          quantities: json(state.quantities),
          snap: json(snap),
          outOfSpec: result.fails.length,
          assigneeId: form.assigneeId ?? actor.id,
          assigneeName: form.assigneeName ?? actor.name,
          savedById: actor.id,
          savedByName: actor.name,
          savedAt: now,
          ...(mode === "submit" && sentTo
            ? { submittedById: actor.id, submittedByName: actor.name, submittedAt: now, sentToId: sentTo.id, sentToName: sentTo.name }
            : {}),
          ...(mode === "approve" && !approving && chainNext ? { sentToId: chainNext.id, sentToName: chainNext.name } : {}),
          ...(approving
            ? {
                approvedById: actor.id,
                approvedByName: actor.name,
                approvedAt: now,
                // Approving straight from a draft is a submission too.
                ...(form.submittedById ? {} : { submittedById: actor.id, submittedByName: actor.name, submittedAt: now }),
              }
            : {}),
        },
      });
      // The approved record is kept as a version, unchanged, to compare later revisions with.
      if (approving) {
        await tx.partFormVersion.create({
          data: {
            spaceId: actor.space.id,
            formId: form.id,
            version: form.version,
            event: "approved",
            byId: actor.id,
            byName: actor.name,
            sections: json(sections),
            values: json(values),
            measured: json(state.measured),
            quantities: json(state.quantities),
            snap: json(snap),
            outOfSpec: result.fails.length,
            submittedByName: form.submittedByName ?? actor.name,
            submittedAt: form.submittedAt ?? now,
          },
        });
      }
      if (owner.kind === "part") {
        await tx.partActivity.create({
          data: { partId: owner.id, title: titles[mode], detail: sentTo ? `${detail} → sent to ${sentTo.name}` : chainNext ? `${detail} → next: ${chainNext.name}` : detail, byId: actor.id, byName: actor.name },
        });
      }
    });
  } catch (error) {
    // Nothing points at the signature copies made for a save that did not happen.
    await dropSnapshots(newSnapshots);
    // A stock check inside the transaction says what ran short; anything else is unexpected.
    if (error instanceof StockError) return fail(error.message);
    console.error("[qa] form save failed", error instanceof Error ? error.message : error);
    return fail("The form could not be saved. Try again.");
  }

  await dropSnapshots(obsoleteSnapshots);
  await audit(actor, `qa.form_${mode}`, { id: form.id, name: `${owner.label} · ${form.code || form.name}` }, `${titles[mode]}: ${detail}`, owner.kind);
  revalidatePath(owner.href);
  revalidatePath(owner.kind === "part" ? "/parts" : "/cases");
  if (chainNext) revalidatePath("/approvals");
  return {
    ok: true,
    message: approving
      ? "Form approved"
      : mode === "approve" && chainNext
        ? `Signed${chainKind === "reviewer" ? " as reviewer" : ""} — sent on to ${chainNext.name}`
        : mode === "submit" ? `Submitted for approval — sent to ${sentTo?.name}`
          : "Draft saved",
  };
}

/**
 * Pass a form waiting for approval on to another person who may approve it —
 * by the person it was sent to (away, say), or by a space admin.
 */
export async function passOnForm(formId: string, to: string): Promise<QaActionResult> {
  const actor = await member();
  const form = await db.partForm.findFirst({ where: { id: String(formId), spaceId: actor.space.id, ...formScope(actor) } });
  if (!form) return fail("That form no longer exists.");
  if (form.status !== "Pending approval" || !form.sentToId) return fail("This form is not waiting for anyone's approval.");
  if (form.sentToId !== actor.id && actor.role !== "SPACE_ADMIN") return fail("Only the person it was sent to, or a space admin, can pass it on.");
  const owner = await formOwner(actor.space.id, form);
  if (!owner) return fail("The part or case of this form no longer exists.");
  const settings = await qaSettings(actor.space.id);
  const stageRoles = ownerApprovers(owner, form.stageIndex);
  const values = { ...((form.values ?? {}) as Record<string, string>) };
  const step = signSteps(formSections(form).flatMap((sec) => sec.items), values).find((x) => !x.signed);
  const roles = step ? (step.item.roles ?? "").trim() || (step.kind === "approver" ? stageRoles : "") : stageRoles;
  const chosen = await approverIfAllowed(actor, String(to), roles, settings.separateApprover ? form.submittedById : null);
  if ("error" in chosen) return fail(chosen.error);
  if (chosen.id === form.sentToId) return OK;
  if (step) {
    const people = readPeople(values[peopleKey(step.item.id)]);
    if (people.some((x) => x.id === chosen.id)) return fail(`${chosen.name} already signs "${step.item.label}".`);
    values[peopleKey(step.item.id)] = JSON.stringify(people.map((x) => (x.id === step.person.id ? chosen : x)));
  }

  await db.partForm.update({ where: { id: form.id }, data: { sentToId: chosen.id, sentToName: chosen.name, ...(step ? { values: json(values) } : {}) } });
  await Promise.all(ownerActivity(owner, { title: "Passed on for approval", detail: `${form.name}: ${form.sentToName ?? "—"} → ${chosen.name}`, byId: actor.id, byName: actor.name }));
  await audit(actor, "qa.form_pass_on", { id: form.id, name: form.name }, `Passed ${form.code || form.name} on for approval: ${form.sentToName ?? "—"} → ${chosen.name}`, owner.kind);
  revalidatePath(owner.href);
  revalidatePath("/approvals");
  return { ok: true, message: `Passed on to ${chosen.name}` };
}

/**
 * Back to draft: the signatures given on submit or since — Prepared by,
 * Reviewed by, Approved by — are cleared; the people chosen stay chosen. The
 * signature image copies no longer referenced are returned for removal
 * (unless a kept version still shows them).
 */
function draftValues(form: { sections: Prisma.JsonValue; values: Prisma.JsonValue }): { values: Record<string, string>; images: string[] } {
  const values = { ...((form.values ?? {}) as Record<string, string>) };
  const images: string[] = [];
  for (const item of formSections(form).flatMap((sec) => sec.items)) {
    if (!autoSigner(item)) continue;
    const stamp = readStamp(values[`sig:${item.id}`]);
    if (stamp?.fileId) images.push(stamp.fileId);
    for (const x of readStamps(values[stampsKey(item.id)])) if (x.fileId) images.push(x.fileId);
    delete values[item.id];
    delete values[`sig:${item.id}`];
    delete values[stampsKey(item.id)];
  }
  return { values, images };
}

const DRAFT_RESET = {
  status: "In progress",
  sentToId: null,
  sentToName: null,
  submittedById: null,
  submittedByName: null,
  submittedAt: null,
  approvedById: null,
  approvedByName: null,
  approvedAt: null,
} as const;

/**
 * Reject a form sent for approval — by the person whose turn it is to sign.
 * The form as sent is kept as a version, with the reason; it goes back to
 * draft and has to be submitted again.
 */
export async function rejectForm(formId: string, reason: string): Promise<QaActionResult> {
  const actor = await member();
  const why = String(reason ?? "").trim().slice(0, 1000);
  if (why.length < 3) return fail("Say why it is rejected.");
  const form = await db.partForm.findFirst({ where: { id: String(formId), spaceId: actor.space.id, ...formScope(actor) } });
  if (!form) return fail("That form no longer exists.");
  if (form.status !== "Pending approval") return fail("Only a form waiting for approval can be rejected.");
  if (form.sentToId !== actor.id) return fail(`It is waiting for ${form.sentToName ?? "someone else"} — only they can reject it.`);
  const owner = await formOwner(actor.space.id, form);
  if (!owner) return fail("The part or case of this form no longer exists.");
  // The signature images stay: the rejected version shows them.
  const { values } = draftValues(form);
  await db.$transaction([
    db.partFormVersion.create({
      data: {
        spaceId: actor.space.id,
        formId: form.id,
        version: form.version,
        event: "rejected",
        reason: why,
        byId: actor.id,
        byName: actor.name,
        sections: form.sections ?? [],
        values: form.values ?? {},
        measured: form.measured ?? {},
        quantities: form.quantities ?? {},
        snap: form.snap ?? {},
        outOfSpec: form.outOfSpec,
        submittedByName: form.submittedByName,
        submittedAt: form.submittedAt,
      },
    }),
    db.partForm.update({ where: { id: form.id }, data: { ...DRAFT_RESET, values: json(values) } }),
    ...ownerActivity(owner, { title: "Rejected quality form", detail: `${form.name}: ${why}`, byId: actor.id, byName: actor.name }),
  ]);
  await audit(actor, "qa.form_reject", { id: form.id, name: form.name }, `Rejected ${form.code || form.name}: ${why}`, owner.kind);
  revalidatePath(owner.href);
  revalidatePath("/approvals");
  return { ok: true, message: `Rejected — sent back to ${form.submittedByName ?? "the sender"} as a draft` };
}

/**
 * Revert to draft. Waiting for approval: by the person who sent it, or a
 * space admin, while not everyone has signed. Approved: by a space admin or
 * the person who approved it — the approved record stays as its version, and
 * a new version opens as a draft.
 */
export async function revertForm(formId: string): Promise<QaActionResult> {
  const actor = await member();
  const form = await db.partForm.findFirst({ where: { id: String(formId), spaceId: actor.space.id, ...formScope(actor) } });
  if (!form) return fail("That form no longer exists.");
  const admin = actor.role === "SPACE_ADMIN";
  const owner = await formOwner(actor.space.id, form);
  if (!owner) return fail("The part or case of this form no longer exists.");
  if (form.status === "Pending approval") {
    if (form.submittedById !== actor.id && !admin) return fail("Only the person who sent it, or a space admin, can revert it to draft.");
    const { values, images } = draftValues(form);
    await db.$transaction([
      db.partForm.update({ where: { id: form.id }, data: { ...DRAFT_RESET, values: json(values) } }),
      ...ownerActivity(owner, { title: "Reverted quality form to draft", detail: form.name, byId: actor.id, byName: actor.name }),
    ]);
    await dropSnapshots(images);
    await audit(actor, "qa.form_revert", { id: form.id, name: form.name }, `Reverted ${form.code || form.name} to draft`, owner.kind);
    revalidatePath(owner.href);
    revalidatePath("/approvals");
    return { ok: true, message: "Reverted to draft" };
  }
  if (form.status === "Approved") {
    if (!admin && form.approvedById !== actor.id) return fail("Only a space admin, or the person who approved it, can revise an approved record.");
    const kept = await db.partFormVersion.count({ where: { formId: form.id, version: form.version, event: "approved" } });
    // Approved before versions were kept: keep it now.
    const { values } = draftValues(form);
    const next = form.version + 1;
    await db.$transaction([
      ...(kept
        ? []
        : [
            db.partFormVersion.create({
              data: {
                spaceId: actor.space.id,
                formId: form.id,
                version: form.version,
                event: "approved",
                byId: form.approvedById,
                byName: form.approvedByName ?? "—",
                sections: form.sections ?? [],
                values: form.values ?? {},
                measured: form.measured ?? {},
                quantities: form.quantities ?? {},
                snap: form.snap ?? {},
                outOfSpec: form.outOfSpec,
                submittedByName: form.submittedByName,
                submittedAt: form.submittedAt,
                createdAt: form.approvedAt ?? new Date(),
              },
            }),
          ]),
      db.partForm.update({ where: { id: form.id }, data: { ...DRAFT_RESET, version: next, values: json(values) } }),
      ...ownerActivity(owner, { title: "Revised approved quality form", detail: `${form.name}: version ${form.version} kept, version ${next} opened`, byId: actor.id, byName: actor.name }),
    ]);
    await audit(actor, "qa.form_revise", { id: form.id, name: form.name }, `Revised ${form.code || form.name}: version ${next} opened, version ${form.version} kept`, owner.kind);
    revalidatePath(owner.href);
    return { ok: true, message: `Version ${next} opened as a draft — version ${form.version} is kept` };
  }
  return fail("Only a form waiting for approval, or an approved one, can be reverted.");
}

/** Give a form to someone, or to oneself. */
export async function assignForm(formId: string, to: string | null): Promise<QaActionResult> {
  const actor = await member();
  const form = await db.partForm.findFirst({ where: { id: String(formId), spaceId: actor.space.id, ...formScope(actor) } });
  if (!form) return fail("That form no longer exists.");
  const person =
    to === null
      ? null
      : to === "me"
        ? { id: actor.id, name: actor.name }
        : await db.user.findFirst({ where: { id: to, spaceId: actor.space.id, isActive: true }, select: { id: true, name: true } });
  if (to !== null && !person) return fail("That person is not an active member of this space.");

  const owner = await formOwner(actor.space.id, form);
  if (!owner) return fail("The part or case of this form no longer exists.");
  await db.partForm.update({ where: { id: form.id }, data: { assigneeId: person?.id ?? null, assigneeName: person?.name ?? null } });
  await Promise.all(ownerActivity(owner, { title: "Assigned quality form", detail: `${form.name} → ${person?.name ?? "Unassigned"}`, byId: actor.id, byName: actor.name }));
  revalidatePath(owner.href);
  return OK;
}

// --- Attachments on a form -------------------------------------------------------------------------

/** What a photo / attachment field takes: pictures and PDFs. */
const EVIDENCE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"];

/** The form, if this space's and still open, and the attachment field on it. */
async function evidenceTarget(actor: Actor, formId: string, itemId: string) {
  const form = await db.partForm.findFirst({ where: { id: String(formId), spaceId: actor.space.id, ...formScope(actor) } });
  if (!form) return { error: "That form no longer exists." } as const;
  if (form.status === "Approved") return { error: "This record is approved and locked." } as const;
  // "img:<id>": the pictures beside a field's value; otherwise an attachment field.
  const pictures = String(itemId).startsWith("img:");
  const id = pictures ? String(itemId).slice(4) : String(itemId);
  const item = formSections(form).flatMap((s) => s.items).find((i) => i.id === id && (pictures ? Boolean(i.allowImages) : i.type === "file"));
  if (!item) return { error: "That field no longer takes attachments." } as const;
  const owner = await formOwner(actor.space.id, form);
  if (!owner) return { error: "The part or case of this form no longer exists." } as const;
  const closed = fillClosed(owner, form) ?? (await orderClosed(owner, form));
  if (closed) return { error: closed } as const;
  return { form, item, owner, key: pictures ? `img:${item.id}` : item.id, pictures } as const;
}

/** Attach a photo or PDF to a form's attachment field. It is kept with the part, and listed on the form at once. */
export async function attachFormFile(formId: string, itemId: string, formData: FormData): Promise<QaActionResult & { files?: Attachment[] }> {
  const actor = await member();
  const target = await evidenceTarget(actor, formId, itemId);
  if ("error" in target) return fail(target.error!);
  const { form, item, owner, key, pictures } = target;

  const file = formData.get("file");
  if (!(file && typeof file === "object" && "arrayBuffer" in file && file.size > 0)) return fail("Choose a file.");
  if (pictures && !EVIDENCE_TYPES.slice(0, 4).includes(file.type)) return fail("Add a picture (PNG, JPEG, WebP or GIF).");
  if (!pictures && !item.anyFile && !EVIDENCE_TYPES.includes(file.type)) return fail("Attach a photo (PNG, JPEG, WebP, GIF) or a PDF.");
  if (file.size > MAX_FILE_BYTES) return fail("Files are limited to 25 MB.");

  const name = cleanFileName(file.name);
  const storageKey = await saveFile(actor.space.id, Buffer.from(await file.arrayBuffer()));
  try {
    const created = await db.partFile.create({
      data: {
        spaceId: actor.space.id,
        ...owner.fileRef,
        kind: "evidence",
        field: `${form.id}:${key}`,
        name,
        contentType: file.type || "application/octet-stream",
        size: file.size,
        storageKey,
        uploadedByName: actor.name,
      },
    });
    // Recorded on the form straight away, so it is not lost if the form is left unsaved.
    const values = { ...((form.values ?? {}) as Record<string, string>) };
    const files = [...readFiles(values[key]), { id: created.id, name, type: file.type }];
    values[key] = JSON.stringify(files);
    await db.partForm.update({ where: { id: form.id }, data: { values: json(values) } });
    await Promise.all(ownerActivity(owner, { title: "Attached evidence", detail: `${name} — ${form.code || form.name} · ${item.label}`, byId: actor.id, byName: actor.name }));
    await audit(actor, "qa.form_attach", { id: form.id, name: form.name }, `Attached ${name} to ${form.code || form.name} · ${item.label}`);
    revalidatePath(owner.href);
    return { ok: true, message: "Attached", files };
  } catch (error) {
    await deleteStoredFile(storageKey).catch(() => undefined);
    throw error;
  }
}

/**
 * The picture of one row of a data table (an image column) — kept with the
 * part or case like other evidence; the cell holds its id once the form is saved.
 */
export async function attachGridImage(formId: string, itemId: string, rowId: string, formData: FormData): Promise<QaActionResult & { fileId?: string }> {
  const actor = await member();
  const form = await db.partForm.findFirst({ where: { id: String(formId), spaceId: actor.space.id, ...formScope(actor) } });
  if (!form) return fail("That form no longer exists.");
  if (form.status === "Approved") return fail("This record is approved and locked.");
  const item = formSections(form).flatMap((s) => s.items).find((i) => i.id === String(itemId) && i.type === "grid");
  if (!item || !(item.columns ?? []).some((c) => c.kind === "image")) return fail("That table takes no images.");
  const owner = await formOwner(actor.space.id, form);
  if (!owner) return fail("The part or case of this form no longer exists.");
  const closed = fillClosed(owner, form) ?? (await orderClosed(owner, form));
  if (closed) return fail(closed);
  const file = formData.get("file");
  if (!(file && typeof file === "object" && "arrayBuffer" in file && file.size > 0)) return fail("Choose a picture.");
  if (!EVIDENCE_TYPES.slice(0, 4).includes(file.type)) return fail("Use a PNG, JPEG, WebP or GIF picture.");
  if (file.size > MAX_FILE_BYTES) return fail("Files are limited to 25 MB.");
  const storageKey = await saveFile(actor.space.id, Buffer.from(await file.arrayBuffer()));
  try {
    const created = await db.partFile.create({
      data: {
        spaceId: actor.space.id,
        ...owner.fileRef,
        kind: "evidence",
        field: `${form.id}:${item.id}:${String(rowId).slice(0, 40)}`,
        name: cleanFileName(file.name),
        contentType: file.type,
        size: file.size,
        storageKey,
        uploadedByName: actor.name,
      },
    });
    return { ok: true, fileId: created.id };
  } catch (error) {
    await deleteStoredFile(storageKey).catch(() => undefined);
    throw error;
  }
}

export async function removeFormFile(formId: string, itemId: string, fileId: string): Promise<QaActionResult & { files?: Attachment[] }> {
  const actor = await member();
  const target = await evidenceTarget(actor, formId, itemId);
  if ("error" in target) return fail(target.error!);
  const { form, item, owner, key } = target;
  const file = await db.partFile.findFirst({ where: { id: String(fileId), ...owner.fileRef, kind: "evidence", field: `${form.id}:${key}` } });
  const values = { ...((form.values ?? {}) as Record<string, string>) };
  const files = readFiles(values[key]).filter((f) => f.id !== String(fileId));
  if (files.length) values[key] = JSON.stringify(files);
  else delete values[key];
  await db.partForm.update({ where: { id: form.id }, data: { values: json(values) } });
  if (file) {
    await db.partFile.delete({ where: { id: file.id } });
    await deleteStoredFile(file.storageKey).catch(() => undefined);
    await Promise.all(ownerActivity(owner, { title: "Removed evidence", detail: `${file.name} — ${form.code || form.name} · ${item.label}`, byId: actor.id, byName: actor.name }));
    await audit(actor, "qa.form_detach", { id: form.id, name: form.name }, `Removed ${file.name} from ${form.code || form.name} · ${item.label}`);
  }
  revalidatePath(owner.href);
  return { ok: true, message: "Removed", files };
}

// --- Company details ---------------------------------------------------------------------------------

/** The company details forms print and read as {company.…}. */
export async function saveCompanyDetails(details: Record<string, string>): Promise<QaActionResult> {
  const actor = await admin();
  const value = Object.fromEntries(COMPANY_FIELDS.map((f) => [f.key, String(details?.[f.key] ?? "").trim().slice(0, 300)]));
  await db.spaceSetting.upsert({
    where: { spaceId_key: { spaceId: actor.space.id, key: "company" } },
    create: { spaceId: actor.space.id, key: "company", value, updatedByName: actor.name },
    update: { value, updatedByName: actor.name },
  });
  await audit(actor, "qa.company", { id: actor.space.id, name: "Company details" }, `Saved the company details used on quality forms`);
  revalidatePath("/qaforms");
  return { ok: true, message: "Company details saved" };
}

/**
 * The space's header & footer designs, as edited in QA Form Setup. A design
 * removed: the forms that used it use the reference-standards design again
 * (records already made keep their own and fall back the same way).
 */
export async function saveDocLayouts(input: unknown): Promise<QaActionResult> {
  const actor = await admin();
  const parsed = layoutsSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the designs.");
  const layouts = parsed.data;
  if (new Set(layouts.map((l) => l.id)).size !== layouts.length) return fail("Two designs share an id — reload the page and try again.");
  const names = layouts.map((l) => l.name.toLowerCase());
  if (new Set(names).size !== names.length) return fail("Two designs have the same name.");
  const before = readLayouts((await db.spaceSetting.findUnique({ where: { spaceId_key: { spaceId: actor.space.id, key: "qaLayouts" } } }))?.value);
  const kept = new Set(readLayouts(layouts).map((l) => l.id));
  const gone = before.filter((l) => !kept.has(l.id)).map((l) => l.id);
  await db.$transaction([
    db.spaceSetting.upsert({
      where: { spaceId_key: { spaceId: actor.space.id, key: "qaLayouts" } },
      create: { spaceId: actor.space.id, key: "qaLayouts", value: layouts as unknown as Prisma.InputJsonArray, updatedByName: actor.name },
      update: { value: layouts as unknown as Prisma.InputJsonArray, updatedByName: actor.name },
    }),
    db.qaTemplate.updateMany({ where: { spaceId: actor.space.id, docStyle: { in: gone.length ? gone : ["-"] } }, data: { docStyle: "reference" } }),
  ]);
  await audit(actor, "qa.layouts", { id: actor.space.id, name: "Header & footer designs" }, `Saved ${layouts.length} header & footer design${layouts.length === 1 ? "" : "s"}${gone.length ? ` — ${gone.length} removed` : ""}`);
  revalidatePath("/qaforms");
  return { ok: true, message: "Designs saved" };
}
