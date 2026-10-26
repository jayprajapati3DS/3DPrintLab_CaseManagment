"use server";

import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { recordAudit } from "@/lib/audit";
import { assertSameOrigin } from "@/lib/auth/origin";
import { canManageSpace, requireSpaceAdmin, requireSpaceUser, userRoleNames } from "@/lib/auth/rbac";
import type { SessionSpace, SessionUser } from "@/lib/auth/session";
import { classifyCase } from "@/lib/cases/classify";
import {
  CASE_PRIORITIES,
  caseFieldVar,
  caseFormFor,
  caseFormSchema,
  caseSetupProblem,
  NEW_CASE_FORM,
  askedOnCreate,
  caseDetails,
  type CaseDetail,
  type CaseField,
  type CaseFormDef,
  type CaseSetup,
} from "@/lib/cases/case-form";
import { caseStagesFor } from "@/lib/cases/catalog";
import { caseCatalog, caseHospitals, caseNumbersInUse, casePeople, getCaseSetup, peopleFor } from "@/lib/cases/queries";
import { caseSortKey } from "@/lib/cases/sort-key";
import { encryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { cleanFileName, deleteStoredFile, MAX_FILE_BYTES, saveFile } from "@/lib/files";
import { fileAllowed, normaliseLink } from "@/lib/parts/request-form";
import { idDate, initialsOf, nextId } from "@/lib/resources/ids";
import { caseStageIndex, caseStages, readStageMarks } from "@/lib/cases/stages";
import { ensureOrderForms } from "@/lib/cases/orders";
import { infoLockedFor, isOptionalForm } from "@/lib/resources/config";

/**
 * Case management: the case form's setup, and opening a case from it — in a
 * space whose cases are managed here rather than synced from the platform.
 */

export interface CaseActionResult {
  ok: boolean;
  message?: string;
}

type Actor = SessionUser & { space: SessionSpace };
const fail = (message: string): CaseActionResult => ({ ok: false, message });

/** The case team: a surgeon or a vendor's staff changes nothing of a case but its order forms. */
async function caseTeamMember() {
  const actor = await requireSpaceUser();
  if (actor.surgeonOnly) redirect("/orders");
  if (actor.siteOnly) redirect("/parts");
  return actor;
}

async function audit(actor: Actor, action: `case.${string}`, entity: { id: string | null; name: string }, summary: string, after?: unknown) {
  await recordAudit({
    action,
    entityType: "case",
    spaceId: actor.space.id,
    entityId: entity.id,
    entityName: entity.name,
    summary,
    after,
    actorId: actor.id,
    actorEmail: actor.email,
  });
}

/** The setup as saved — every change below reads it fresh, changes one thing, and saves it whole. */
async function currentSetup(actor: Actor): Promise<CaseSetup> {
  const { source, idPattern, idStart, forms } = await getCaseSetup(actor.space.id, actor.space.name);
  return { source, idPattern, ...(idStart ? { idStart } : {}), forms };
}

async function storeSetup(actor: Actor, setup: CaseSetup, summary: string): Promise<CaseActionResult | null> {
  const problem = caseSetupProblem(setup);
  if (problem) return fail(problem);
  await db.spaceSetting.upsert({
    where: { spaceId_key: { spaceId: actor.space.id, key: "caseSetup" } },
    create: { spaceId: actor.space.id, key: "caseSetup", value: setup as unknown as Prisma.InputJsonObject, updatedByName: actor.name },
    update: { value: setup as unknown as Prisma.InputJsonObject, updatedByName: actor.name },
  });
  await audit(actor, "case.setup_save", { id: actor.space.id, name: "Case form setup" }, summary, setup);
  revalidatePath("/casesetup");
  revalidatePath("/cases");
  return null;
}

/** Where cases come from, and the case ID pattern every form shares. */
export async function saveCaseRule(source: string, idPattern: string, idStart?: number | null): Promise<CaseActionResult> {
  await assertSameOrigin();
  const actor = await requireSpaceAdmin();
  if (source !== "local" && source !== "platform") return fail("Choose where cases come from.");
  if (idStart != null && (!Number.isInteger(idStart) || idStart < 1 || idStart > 99_999_999)) return fail("Start numbering from a whole number of 1 or more.");
  const { idStart: _previous, ...rest } = await currentSetup(actor);
  void _previous;
  const setup = { ...rest, source: source as CaseSetup["source"], idPattern: idPattern.trim().slice(0, 60), ...(idStart && idStart > 1 ? { idStart } : {}) } as CaseSetup;
  const failed = await storeSetup(actor, setup, `Case setup — ${setup.source === "local" ? "cases opened here" : "cases from the platform"}, IDs ${setup.idPattern}`);
  return failed ?? { ok: true, message: "Saved" };
}

/**
 * One case form, as edited. A form being added (id "new") gets its id here —
 * nothing is created until it is saved.
 */
export async function saveCaseForm(payload: string): Promise<CaseActionResult & { formId?: string }> {
  await assertSameOrigin();
  const actor = await requireSpaceAdmin();
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return fail("The form could not be read — reload the page and try again.");
  }
  const parsed = caseFormSchema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "The case form is not valid.");
  const form = parsed.data as CaseFormDef;
  const setup = await currentSetup(actor);
  const adding = form.id === NEW_CASE_FORM;
  if (adding) {
    if (setup.forms.length >= 30) return fail("A space can keep at most 30 case forms.");
    form.id = `cf-${randomUUID().slice(0, 8)}`;
  } else if (!setup.forms.some((f) => f.id === form.id)) {
    return fail("That case form is gone — reload the page.");
  }
  // Which form is the default is changed from the list, not here.
  form.isDefault = adding ? false : (setup.forms.find((f) => f.id === form.id)?.isDefault ?? false);
  const forms = adding ? [...setup.forms, form] : setup.forms.map((f) => (f.id === form.id ? form : f));
  const failed = await storeSetup(actor, { ...setup, forms }, `${adding ? "Added" : "Saved"} the case form "${form.name}"`);
  return failed ?? { ok: true, message: adding ? "Case form added" : "Case form saved", formId: form.id };
}

export async function setDefaultCaseForm(formId: string): Promise<CaseActionResult> {
  await assertSameOrigin();
  const actor = await requireSpaceAdmin();
  const setup = await currentSetup(actor);
  const form = setup.forms.find((f) => f.id === formId);
  if (!form) return fail("That case form is gone — reload the page.");
  const forms = setup.forms.map((f) => ({ ...f, isDefault: f.id === formId }));
  const failed = await storeSetup(actor, { ...setup, forms }, `"${form.name}" is now the default case form`);
  return failed ?? { ok: true, message: `"${form.name}" is the default` };
}

/** Removes a form no case was opened with; one in use stays, so its cases keep their layout. */
export async function deleteCaseForm(formId: string): Promise<CaseActionResult> {
  await assertSameOrigin();
  const actor = await requireSpaceAdmin();
  const setup = await currentSetup(actor);
  const form = setup.forms.find((f) => f.id === formId);
  if (!form) return fail("That case form is gone — reload the page.");
  if (setup.forms.length === 1) return fail("Keep at least one case form.");
  if (form.isDefault) return fail("Make another form the default first.");
  const used = await db.caseRecord.count({ where: { spaceId: actor.space.id, caseFormId: formId } });
  if (used) return fail(`${used} case${used === 1 ? " was" : "s were"} opened with "${form.name}" — it stays, so they keep showing what was asked.`);
  const failed = await storeSetup(actor, { ...setup, forms: setup.forms.filter((f) => f.id !== formId) }, `Deleted the case form "${form.name}"`);
  return failed ?? { ok: true, message: "Case form deleted" };
}

const isFile = (value: FormDataEntryValue | null): value is File => typeof value === "object" && value !== null && "arrayBuffer" in value && value.size > 0;

type Catalog = Awaited<ReturnType<typeof caseCatalog>>;
type Person = Awaited<ReturnType<typeof casePeople>>[number];

interface Answers {
  product: Catalog["products"][number] | null;
  subscope: Catalog["subscopes"][number] | null;
  /** The case's own columns, by built-in field — null clears one on edit. */
  columns: { priority?: string | null; surgeryDate?: Date | null; deliveryDate?: Date | null; surgeon?: string | null; hospital?: string | null; patientId?: string | null; salesRep?: string | null };
  details: CaseDetail[];
  pending: Array<{ field: string; name: string; contentType: string; bytes: Buffer }>;
}

/**
 * Read a case form's answers from what the form sent (v:<id>, file:<id>,
 * links:<id>), checking each against its field. On edit, the files a field
 * already holds count towards it being filled.
 */
async function readAnswers(
  fields: CaseField[],
  formData: FormData,
  ctx: { catalog: Catalog; people: Person[]; hospitals: Awaited<ReturnType<typeof caseHospitals>>; formName: string; productIds: string[]; heldFiles?: Map<string, string[]> },
): Promise<Answers | { error: string }> {
  const text = (id: string) => String(formData.get(`v:${id}`) ?? "").trim().slice(0, 2000);
  const out: Answers = { product: null, subscope: null, columns: {}, details: [], pending: [] };
  let surgeonPerson: Person | null = null;
  const hospitalChecks: Array<{ label: string; id: string; bySurgeon: boolean }> = [];
  const departmentChecks: Array<{ label: string; var: string; value: string }> = [];
  let chosenHospital: (typeof ctx.hospitals)[number] | null = null;
  const missing: string[] = [];

  for (const f of fields) {
    if (f.type === "caseid") continue;
    if (f.type === "file") {
      const files = formData.getAll(`file:${f.id}`).filter(isFile);
      let links: string[] = [];
      try {
        links = (JSON.parse(String(formData.get(`links:${f.id}`) ?? "[]")) as unknown[]).map((l) => normaliseLink(String(l))).filter((l): l is string => Boolean(l));
      } catch {
        links = [];
      }
      if (!f.allowLinks) links = [];
      for (const file of files) {
        if (f.fileTypes.length && !fileAllowed(file.name, f.fileTypes)) return { error: `"${file.name}" is not a ${f.fileTypes.join(" / ")} file.` };
        if (file.size > MAX_FILE_BYTES) return { error: `"${file.name}" is over 25 MB — add it as a link instead.` };
        out.pending.push({ field: f.var, name: cleanFileName(file.name), contentType: file.type || "application/octet-stream", bytes: Buffer.from(await file.arrayBuffer()) });
      }
      const held = ctx.heldFiles?.get(f.var) ?? [];
      if (f.req && held.length + files.length + links.length === 0) missing.push(f.label);
      const value = [...held, ...files.map((x) => cleanFileName(x.name)), ...links].join(", ");
      if (value) out.details.push({ label: f.label, var: caseFieldVar(f), value });
      continue;
    }
    const value = text(f.id);
    if (f.req && !value) {
      missing.push(f.label);
      continue;
    }
    switch (f.key) {
      case "product":
        if (!value) break;
        out.product = ctx.catalog.products.find((x) => x.id === value) ?? null;
        if (!out.product) return { error: "Choose a product from the list." };
        if (ctx.productIds.length && !ctx.productIds.includes(out.product.id)) return { error: `"${ctx.formName}" does not open ${out.product.name} cases — choose another form.` };
        break;
      case "subscope":
        if (!value) break;
        out.subscope = ctx.catalog.subscopes.find((x) => x.id === value) ?? null;
        if (!out.subscope) return { error: "Choose a sub-scope from the list." };
        break;
      case "priority":
        if (value && !(CASE_PRIORITIES as readonly string[]).includes(value)) return { error: "Choose a priority from the list." };
        out.columns.priority = value || null;
        break;
      case "surgeryDate":
      case "deliveryDate":
        if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { error: `"${f.label}" is not a date.` };
        out.columns[f.key] = value ? new Date(`${value}T00:00:00Z`) : null;
        break;
      case "surgeon": {
        if (!value) {
          out.columns.surgeon = null;
          break;
        }
        surgeonPerson = peopleFor(ctx.people, f.roles).find((x) => x.id === value) ?? null;
        if (!surgeonPerson) return { error: `Choose "${f.label}" from the list.` };
        out.columns.surgeon = surgeonPerson.name;
        break;
      }
      case "projectManager": {
        if (!value) break;
        const person = peopleFor(ctx.people, f.roles).find((x) => x.id === value);
        if (!person) return { error: `Choose "${f.label}" from the list.` };
        out.details.push({ label: f.label, var: caseFieldVar(f), value: person.name, ids: [person.id] });
        break;
      }
      case "secondarySurgeons":
      case "salesPeople": {
        const allowed = peopleFor(ctx.people, f.roles);
        const chosen = [...new Set(value.split(",").filter(Boolean))].map((pid) => allowed.find((x) => x.id === pid));
        if (chosen.some((x) => !x)) return { error: `Choose "${f.label}" from the list.` };
        const names = chosen.map((x) => x!.name).join(", ");
        if (f.key === "salesPeople") out.columns.salesRep = names || null;
        if (names) out.details.push({ label: f.label, var: caseFieldVar(f), value: names, ids: chosen.map((x) => x!.id) });
        break;
      }
      case "hospital":
        if (value) hospitalChecks.push({ label: f.label, id: value, bySurgeon: f.hospitalSource === "surgeon" });
        else out.columns.hospital = null;
        break;
      case "department":
        if (value) departmentChecks.push({ label: f.label, var: caseFieldVar(f), value: value.slice(0, 200) });
        break;
      case "patientId":
        out.columns.patientId = value || null;
        break;
      default: {
        if (!value) break;
        if (f.type === "select" && !f.options.includes(value)) return { error: `Choose "${f.label}" from the list.` };
        if (f.type === "number" && !Number.isFinite(Number(value))) return { error: `"${f.label}" must be a number.` };
        if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { error: `"${f.label}" is not a date.` };
        out.details.push({ label: f.label, var: caseFieldVar(f), value: f.type === "checkbox" ? "Yes" : value });
      }
    }
  }
  if (missing.length) return { error: `Fill in: ${missing.join(", ")}.` };
  // The hospital: one of the list — and, when the field says so, one of the surgeon's.
  for (const check of hospitalChecks) {
    const hospital = ctx.hospitals.find((h) => h.id === check.id);
    if (!hospital) return { error: `Choose "${check.label}" from the list.` };
    const surgeon = surgeonPerson as Person | null;
    if (check.bySurgeon && surgeon && !surgeon.hospitalIds.includes(hospital.id)) return { error: `${hospital.name} is not one of ${surgeon.name}'s hospitals.` };
    out.columns.hospital = hospital.name;
    chosenHospital = hospital;
  }
  // The department: one of the hospital's, when it has any.
  for (const check of departmentChecks) {
    const hospital = chosenHospital as (typeof ctx.hospitals)[number] | null;
    if (hospital && hospital.departments.length && !hospital.departments.some((d) => d.name === check.value)) return { error: `Choose "${check.label}" from ${hospital.name}'s departments.` };
    out.details.push({ label: check.label, var: check.var, value: check.value });
  }
  return out;
}

/**
 * Open a case from the space's case form — the fields it asks when a case is
 * opened. Its ID is the next the pattern gives; the patient ID is kept
 * encrypted; uploaded files are kept with it.
 */
export async function createCase(formData: FormData): Promise<CaseActionResult> {
  await assertSameOrigin();
  const actor = await caseTeamMember();
  const spaceId = actor.space.id;
  const setup = await getCaseSetup(spaceId, actor.space.name);
  if (setup.source !== "local") return fail("Cases come from the 3D Surgical Platform in this space — they are not opened here.");

  const requested = String(formData.get("form") ?? "");
  const form = caseFormFor(setup, requested);
  if (requested && form.id !== requested) return fail("That case form is gone — reload the page.");
  const fields = form.sections.flatMap((s) => s.fields).filter(askedOnCreate);
  const [catalog, people, hospitals] = await Promise.all([caseCatalog(spaceId), casePeople(spaceId), caseHospitals(spaceId)]);
  const read = await readAnswers(fields, formData, { catalog, people, hospitals, formName: form.name, productIds: form.productIds });
  if ("error" in read) return fail(read.error);
  const { product, subscope, columns, details, pending } = read;
  if (!product) return fail("Choose the project type (product).");
  if (subscope && subscope.productId !== product.id) return fail(`"${subscope.name}" is not a sub-scope of ${product.name}.`);
  if (product.mode === "scopes" && !subscope) return fail(`Choose the sub-scope of ${product.name}.`);

  // --- Store the files, then the case, numbered from the pattern -----------------------------
  const stored: Array<(typeof pending)[number] & { id: string; storageKey: string }> = [];
  try {
    for (const file of pending) stored.push({ ...file, id: randomUUID(), storageKey: await saveFile(spaceId, file.bytes) });

    const now = new Date();
    // A case starts at the first of its stages — its sub-scope's own, else its product's.
    const caseStatus = caseStagesFor(product, subscope?.id ?? null)[0]?.name ?? "Case received";
    let created: { id: string; caseNumber: string | null } | null = null;
    // Two cases opened at the same moment could be given the same number; the
    // second is numbered again.
    for (let attempt = 0; attempt < 4 && !created; attempt += 1) {
      const fieldsForId = {
        SURGEON: initialsOf(columns.surgeon ?? ""),
        PATIENT: details.find((d) => d.var === "case.patientInitials")?.value ?? "",
        PID: columns.patientId ?? "",
        SURGERY: idDate(columns.surgeryDate),
        DELIVERY: idDate(columns.deliveryDate),
        HOSPITAL: hospitals.find((h) => h.name === columns.hospital)?.code ?? "",
      };
      const caseNumber = nextId(setup.idPattern, { type: product.code || product.name, now, fields: fieldsForId, start: setup.idStart }, await caseNumbersInUse(spaceId));
      if (!caseNumber) return fail("The case ID pattern has no free number left — widen its running part in Case Form Setup.");
      created = await db.$transaction(async (tx) => {
        if (await tx.caseRecord.findFirst({ where: { spaceId, caseNumber }, select: { id: true } })) return null;
        return tx.caseRecord.create({
          data: {
            spaceId,
            origin: "local",
            platformCaseId: null,
            caseNumber,
            caseNumberSort: caseSortKey(caseNumber),
            productId: product.id,
            productName: product.name,
            productCode: product.code || null,
            subscopeId: subscope?.id ?? null,
            scopeName: subscope?.name ?? null,
            caseStatus,
            caseState: "Active",
            isArchived: false,
            bucket: classifyCase({ caseStatus, caseState: "Active", isArchived: false }),
            priority: columns.priority ?? null,
            surgeryDate: columns.surgeryDate ?? null,
            anticipatedShipDate: columns.deliveryDate ?? null,
            surgeonName: columns.surgeon ?? null,
            hospitalName: columns.hospital ?? null,
            representativeName: columns.salesRep ?? null,
            patientIdEncrypted: columns.patientId ? encryptSecret(columns.patientId) : null,
            details: details as unknown as Prisma.InputJsonArray,
            caseFormId: form.id,
            createdByName: actor.name,
            platformCreatedAt: now,
            files: {
              create: stored.map((f) => ({
                id: f.id,
                spaceId,
                field: f.field,
                name: f.name,
                contentType: f.contentType,
                size: f.bytes.length,
                storageKey: f.storageKey,
                uploadedByName: actor.name,
              })),
            },
          },
          select: { id: true, caseNumber: true },
        });
      });
    }
    if (!created) throw new Error("Could not number the case.");
    // Its Order tab starts with its product's automatic forms — the surgeon sees them at once.
    await ensureOrderForms({ id: created.id, spaceId, productId: product.id, origin: "local", ordersReadyAt: null });
    await audit(actor, "case.create", { id: created.id, name: created.caseNumber ?? "" }, `Opened case ${created.caseNumber} — ${product.name}${subscope ? ` · ${subscope.name}` : ""}`);
    revalidatePath("/cases");
    redirect(`/cases/${created.id}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw error;
    await Promise.all(stored.map((f) => deleteStoredFile(f.storageKey).catch(() => undefined)));
    console.error("[cases] create failed", error instanceof Error ? error.message : error);
    return fail("The case could not be saved. Try again.");
  }
}

/**
 * Edit a case opened here: every field its form shows — the ones left out
 * when it was opened included. The case ID, product and sub-scope stay as they
 * are; files already uploaded stay, new ones are added.
 */
export async function updateCase(caseId: string, formData: FormData): Promise<CaseActionResult> {
  await assertSameOrigin();
  const actor = await caseTeamMember();
  const spaceId = actor.space.id;
  const record = await db.caseRecord.findFirst({ where: { id: caseId, spaceId, origin: "local" } });
  if (!record) return fail("This case is not one opened here.");
  const locked = await caseInfoLock(actor, record);
  if (locked) return fail(locked);
  const setup = await getCaseSetup(spaceId, actor.space.name);
  const form = caseFormFor(setup, record.caseFormId);
  const fields = form.sections.flatMap((s) => s.fields).filter((f) => f.show && !["caseid", "product", "subscope"].includes(f.type));
  const [catalog, people, hospitals, held] = await Promise.all([
    caseCatalog(spaceId),
    casePeople(spaceId),
    caseHospitals(spaceId),
    db.caseFile.findMany({ where: { caseId: record.id, spaceId }, select: { field: true, name: true } }),
  ]);
  const heldFiles = new Map<string, string[]>();
  for (const file of held) if (file.field) heldFiles.set(file.field, [...(heldFiles.get(file.field) ?? []), file.name]);
  const read = await readAnswers(fields, formData, { catalog, people, hospitals, formName: form.name, productIds: [], heldFiles });
  if ("error" in read) return fail(read.error);
  const { columns, details, pending } = read;

  // Answers to these fields are replaced; any other answer the case holds stays.
  const asked = new Set(fields.map((f) => caseFieldVar(f)));
  const kept = caseDetails(record).filter((d) => !asked.has(d.var));
  const has = (key: keyof Answers["columns"]) => key in columns;

  const stored: Array<(typeof pending)[number] & { id: string; storageKey: string }> = [];
  try {
    for (const file of pending) stored.push({ ...file, id: randomUUID(), storageKey: await saveFile(spaceId, file.bytes) });
    await db.caseRecord.update({
      where: { id: record.id },
      data: {
        ...(has("priority") ? { priority: columns.priority ?? null } : {}),
        ...(has("surgeryDate") ? { surgeryDate: columns.surgeryDate ?? null } : {}),
        ...(has("deliveryDate") ? { anticipatedShipDate: columns.deliveryDate ?? null } : {}),
        ...(has("surgeon") ? { surgeonName: columns.surgeon ?? null } : {}),
        ...(has("hospital") ? { hospitalName: columns.hospital ?? null } : {}),
        ...(has("salesRep") || fields.some((f) => f.key === "salesPeople") ? { representativeName: columns.salesRep ?? null } : {}),
        ...(has("patientId") ? { patientIdEncrypted: columns.patientId ? encryptSecret(columns.patientId) : null } : {}),
        details: [...kept, ...details] as unknown as Prisma.InputJsonArray,
        files: {
          create: stored.map((f) => ({
            id: f.id,
            spaceId,
            field: f.field,
            name: f.name,
            contentType: f.contentType,
            size: f.bytes.length,
            storageKey: f.storageKey,
            uploadedByName: actor.name,
          })),
        },
      },
    });
    await audit(actor, "case.update", { id: record.id, name: record.caseNumber ?? "" }, `Edited case ${record.caseNumber}${stored.length ? ` — ${stored.length} file${stored.length === 1 ? "" : "s"} added` : ""}`);
    revalidatePath("/cases");
    revalidatePath(`/cases/${record.id}`);
  } catch (error) {
    await Promise.all(stored.map((f) => deleteStoredFile(f.storageKey).catch(() => undefined)));
    console.error("[cases] update failed", error instanceof Error ? error.message : error);
    return fail("The case could not be saved. Try again.");
  }
  redirect(`/cases/${record.id}`);
}

// --- Owner, stages, picture and files of a case opened here ----------------------------------

/** Why this person may not change the case's information at its status (its product's lock) — or null. */
async function caseInfoLock(actor: Actor, record: Parameters<typeof caseStages>[1] & Parameters<typeof caseStageIndex>[1]): Promise<string | null> {
  const stages = await caseStages(actor.space.id, record);
  return infoLockedFor(stages, caseStageIndex(stages, record), userRoleNames(actor), "case");
}

async function localCase(actor: Actor, caseId: string) {
  return db.caseRecord.findFirst({ where: { id: caseId, spaceId: actor.space.id, origin: "local" } });
}

function revalidateCase(id: string) {
  revalidatePath("/cases");
  revalidatePath(`/cases/${id}`);
}

/** Take a case on ("me"), or let it go (null). */
export async function assignCase(caseId: string, to: "me" | null): Promise<CaseActionResult> {
  await assertSameOrigin();
  const actor = await caseTeamMember();
  const record = await localCase(actor, caseId);
  if (!record) return fail("This case is not one opened here.");
  const person = to === "me" ? { id: actor.id, name: actor.name } : null;
  if ((person?.id ?? null) === record.assigneeId) return { ok: true };
  await db.caseRecord.update({ where: { id: record.id }, data: { assigneeId: person?.id ?? null, assigneeName: person?.name ?? null } });
  await audit(
    actor,
    "case.assign",
    { id: record.id, name: record.caseNumber ?? "" },
    person ? `Assigned case ${record.caseNumber} to ${person.name}` : `Unassigned case ${record.caseNumber}${record.assigneeName ? ` (was ${record.assigneeName})` : ""}`,
  );
  revalidateCase(record.id);
  return { ok: true };
}

/**
 * Move a case to its next stage, or back one — only by the person it is
 * assigned to. Reaching the last stage completes it (its end date); moving
 * back from there re-opens it.
 */
export async function moveCase(caseId: string, direction: 1 | -1): Promise<CaseActionResult> {
  await assertSameOrigin();
  const actor = await caseTeamMember();
  const record = await localCase(actor, caseId);
  if (!record) return fail("This case is not one opened here.");
  if (record.assigneeId !== actor.id) return fail("Assign this case to yourself to move its stage.");
  if (/hold/i.test(record.caseState ?? "")) return fail("This case is on hold — resume it to move its stage.");
  if (/cancel/i.test(record.caseState ?? "") || record.isArchived) return fail("This case is cancelled or archived — its stages no longer move.");
  const stages = await caseStages(actor.space.id, record);
  if (stages.length === 0) return fail("This case's product has no case stages — set them on the Products page.");
  const from = caseStageIndex(stages, record);
  const to = from + (direction === 1 ? 1 : -1);
  if (to < 0 || to >= stages.length) return fail(direction === 1 ? "This case has completed all stages." : "This case is on its first stage.");

  // Forward only when this status's quality forms are approved — unless the product says they need not hold the case back.
  if (direction === 1 && stages[from].formsRequired !== false) {
    const open = (
      await db.partForm.findMany({ where: { caseId: record.id, stageIndex: from, status: { not: "Approved" } }, select: { name: true, code: true } })
    ).find((f) => !isOptionalForm(stages[from], f));
    if (open) return fail(`Approve "${open.name}" before moving on`);
  }
  // …and when its tasks are done.
  if (direction === 1) {
    const task = await db.task.findFirst({ where: { caseId: record.id, type: "Default", stageIndex: from, status: { not: "Done" } }, select: { name: true } });
    if (task) return fail(`Finish the task "${task.name}" before moving on`);
  }

  const marks = readStageMarks(record.stageMeta);
  while (marks.length < stages.length) marks.push({});
  if (direction === 1) marks[from] = { ...marks[from], by: actor.name, at: new Date().toISOString() };
  else marks[to] = { ...marks[to], by: null, at: null };
  // Moving on hands the case to whoever the next status is planned for.
  const handTo = direction === 1 && marks[to]?.ownerId ? { id: marks[to].ownerId!, name: marks[to].ownerName ?? "" } : null;

  const last = to === stages.length - 1;
  const status = stages[to].name;
  const bucket = record.isArchived ? "ARCHIVED" : last ? "COMPLETED" : to === 0 ? classifyCase({ caseStatus: status, caseState: record.caseState, isArchived: false }) : "ACTIVE";
  // The position is part of the condition, so two clicks cannot skip a stage.
  const moved = await db.caseRecord.updateMany({
    where: { id: record.id, assigneeId: actor.id, stageIndex: record.stageIndex },
    data: {
      stageIndex: to,
      caseStatus: status,
      ...(handTo ? { assigneeId: handTo.id, assigneeName: handTo.name } : {}),
      stageMeta: marks as unknown as Prisma.InputJsonArray,
      bucket,
      completedAt: last ? new Date() : null,
      caseState: last ? "Completed" : record.caseState === "Completed" ? "Active" : record.caseState,
    },
  });
  if (moved.count === 0) return fail("This case was just changed by someone else — reload and try again.");
  // The forms of the status just reached are now the ones to fill.
  if (direction === 1) await db.partForm.updateMany({ where: { caseId: record.id, stageIndex: to, status: "Upcoming" }, data: { status: "In progress" } });
  const detail = `${stages[from].name} → ${status}`;
  await audit(actor, "case.stage", { id: record.id, name: record.caseNumber ?? "" }, `${direction === 1 ? "Advanced" : "Moved back"} case ${record.caseNumber}: ${detail}`, {
    before: { stage: stages[from].name },
    after: { stage: status },
  });
  revalidateCase(record.id);
  if (handTo && handTo.id !== actor.id) return { ok: true, message: `${record.caseNumber} → ${status}, handed to ${handTo.name}` };
  return { ok: true, message: last ? `${record.caseNumber} completed` : `${record.caseNumber} → ${status}` };
}

const CASE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/** The case's own picture — shown for it wherever it appears, before its product's image. */
export async function setCaseImage(caseId: string, formData: FormData): Promise<CaseActionResult> {
  await assertSameOrigin();
  const actor = await caseTeamMember();
  const record = await localCase(actor, caseId);
  if (!record) return fail("This case is not one opened here.");
  const locked = await caseInfoLock(actor, record);
  if (locked) return fail(locked);
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) return fail("Choose an image.");
  if (!CASE_IMAGE_TYPES.has(file.type)) return fail("Use a JPG, PNG, WebP or GIF image.");
  if (file.size > MAX_FILE_BYTES) return fail("That image is too large (25 MB at most).");
  const storageKey = await saveFile(actor.space.id, Buffer.from(await file.arrayBuffer()));
  try {
    const created = await db.caseFile.create({
      data: { spaceId: actor.space.id, caseId: record.id, field: "caseImage", name: cleanFileName(file.name), contentType: file.type, size: file.size, storageKey, uploadedByName: actor.name },
      select: { id: true },
    });
    await db.caseRecord.update({ where: { id: record.id }, data: { imageFileId: created.id } });
  } catch (error) {
    await deleteStoredFile(storageKey).catch(() => undefined);
    console.error("[cases] image failed", error instanceof Error ? error.message : error);
    return fail("The image could not be saved. Try again.");
  }
  await removeOldImage(record);
  await audit(actor, "case.image", { id: record.id, name: record.caseNumber ?? "" }, `${record.imageFileId ? "Changed" : "Added"} the image of case ${record.caseNumber}`);
  revalidateCase(record.id);
  return { ok: true, message: "Case image saved" };
}

/** Back to the product's image. */
export async function clearCaseImage(caseId: string): Promise<CaseActionResult> {
  await assertSameOrigin();
  const actor = await caseTeamMember();
  const record = await localCase(actor, caseId);
  if (!record) return fail("This case is not one opened here.");
  const locked = await caseInfoLock(actor, record);
  if (locked) return fail(locked);
  if (!record.imageFileId) return { ok: true };
  await db.caseRecord.update({ where: { id: record.id }, data: { imageFileId: null } });
  await removeOldImage(record);
  await audit(actor, "case.image", { id: record.id, name: record.caseNumber ?? "" }, `Removed the image of case ${record.caseNumber}`);
  revalidateCase(record.id);
  return { ok: true, message: "Case image removed" };
}

async function removeOldImage(record: { id: string; imageFileId: string | null }) {
  if (!record.imageFileId) return;
  const old = await db.caseFile.findFirst({ where: { id: record.imageFileId, caseId: record.id, field: "caseImage" } });
  if (!old) return;
  await db.caseFile.delete({ where: { id: old.id } });
  await deleteStoredFile(old.storageKey).catch(() => undefined);
}

/** More files for a case — reports, photos, documents — not tied to a field of its form. */
export async function addCaseFiles(caseId: string, formData: FormData): Promise<CaseActionResult> {
  await assertSameOrigin();
  const actor = await caseTeamMember();
  const record = await localCase(actor, caseId);
  if (!record) return fail("This case is not one opened here.");
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return fail("Choose one or more files.");
  const tooBig = files.find((f) => f.size > MAX_FILE_BYTES);
  if (tooBig) return fail(`"${tooBig.name}" is too large (25 MB at most).`);
  const stored: string[] = [];
  try {
    for (const file of files) {
      const storageKey = await saveFile(actor.space.id, Buffer.from(await file.arrayBuffer()));
      stored.push(storageKey);
      await db.caseFile.create({
        data: { spaceId: actor.space.id, caseId: record.id, field: null, name: cleanFileName(file.name), contentType: file.type || "application/octet-stream", size: file.size, storageKey, uploadedByName: actor.name },
      });
    }
  } catch (error) {
    await Promise.all(stored.map((k) => deleteStoredFile(k).catch(() => undefined)));
    console.error("[cases] files failed", error instanceof Error ? error.message : error);
    return fail("The files could not be saved. Try again.");
  }
  await audit(actor, "case.files", { id: record.id, name: record.caseNumber ?? "" }, `Added ${files.length} file${files.length === 1 ? "" : "s"} to case ${record.caseNumber}`);
  revalidateCase(record.id);
  return { ok: true, message: `${files.length} file${files.length === 1 ? "" : "s"} added` };
}

/**
 * Plan a status of a case: who it is for, and when it is due. The person the
 * case is assigned to, or a space admin, may. A status already moved on from
 * keeps its plan as it was.
 */
export async function setStagePlan(caseId: string, index: number, change: { ownerId: string | null } | { due: string | null }): Promise<CaseActionResult> {
  await assertSameOrigin();
  const actor = await caseTeamMember();
  const record = await localCase(actor, caseId);
  if (!record) return fail("This case is not one opened here.");
  if (record.assigneeId !== actor.id && !canManageSpace(actor)) return fail("Only the person this case is assigned to, or an admin, can plan its statuses.");
  const stages = await caseStages(actor.space.id, record);
  if (!Number.isInteger(index) || index < 0 || index >= stages.length) return fail("That status is not one of this case's.");
  const marks = readStageMarks(record.stageMeta);
  while (marks.length < stages.length) marks.push({});
  const name = stages[index].name;
  let summary: string;
  if ("ownerId" in change) {
    const person = change.ownerId ? (await casePeople(actor.space.id)).find((p) => p.id === change.ownerId) : null;
    if (change.ownerId && !person) return fail("That person is not in this space.");
    marks[index] = { ...marks[index], ownerId: person?.id ?? null, ownerName: person?.name ?? null };
    summary = person ? `${name} of case ${record.caseNumber} planned for ${person.name}` : `${name} of case ${record.caseNumber} unassigned`;
  } else {
    if (change.due && !/^\d{4}-\d{2}-\d{2}$/.test(change.due)) return fail("That is not a date.");
    marks[index] = { ...marks[index], due: change.due || null };
    summary = change.due ? `${name} of case ${record.caseNumber} due ${change.due}` : `Due date of ${name} cleared on case ${record.caseNumber}`;
  }
  // The status being worked on now: its planned owner takes the case.
  const current = caseStageIndex(stages, record);
  const takeOver = "ownerId" in change && index === current && !record.completedAt;
  await db.caseRecord.update({
    where: { id: record.id },
    data: {
      stageMeta: marks as unknown as Prisma.InputJsonArray,
      ...(takeOver ? { assigneeId: marks[index].ownerId ?? null, assigneeName: marks[index].ownerName ?? null } : {}),
    },
  });
  await audit(actor, "case.plan", { id: record.id, name: record.caseNumber ?? "" }, summary);
  revalidateCase(record.id);
  return { ok: true, message: "Saved" };
}

/**
 * Tick a stage task off (or open it again), give it to someone, or set when
 * it is due. Who did it, and when, is kept with it.
 */
export async function setCaseTask(taskId: string, change: { done: boolean } | { assigneeId: string | null } | { due: string | null }): Promise<CaseActionResult> {
  await assertSameOrigin();
  const actor = await caseTeamMember();
  const task = await db.task.findFirst({ where: { id: taskId, spaceId: actor.space.id, caseId: { not: null } } });
  if (!task) return fail("That task no longer exists.");
  const record = await localCase(actor, task.caseId!);
  if (!record) return fail("This case is not one opened here.");
  let data: Prisma.TaskUpdateInput;
  let summary: string;
  if ("done" in change) {
    data = change.done
      ? { status: "Done", completedByName: actor.name, completedAt: new Date() }
      : { status: "Open", completedByName: null, completedAt: null };
    summary = `${change.done ? "Done" : "Re-opened"}: ${task.name} — case ${record.caseNumber}`;
  } else if ("assigneeId" in change) {
    const person = change.assigneeId ? (await casePeople(actor.space.id)).find((p) => p.id === change.assigneeId) : null;
    if (change.assigneeId && !person) return fail("That person is not in this space.");
    data = { assigneeId: person?.id ?? null, assigneeName: person?.name ?? null };
    summary = `Task ${task.name} of case ${record.caseNumber} → ${person?.name ?? "Unassigned"}`;
  } else {
    if (change.due && !/^\d{4}-\d{2}-\d{2}$/.test(change.due)) return fail("That is not a date.");
    data = { dueOn: change.due ? new Date(`${change.due}T00:00:00Z`) : null };
    summary = change.due ? `Task ${task.name} of case ${record.caseNumber} due ${change.due}` : `Due date of task ${task.name} cleared on case ${record.caseNumber}`;
  }
  await db.task.update({ where: { id: task.id }, data });
  await audit(actor, "case.task", { id: record.id, name: record.caseNumber ?? "" }, summary);
  revalidateCase(record.id);
  return { ok: true, message: "done" in change ? (change.done ? "Task done" : "Task re-opened") : "Saved" };
}

export type CaseStateChange = "hold" | "resume" | "cancel" | "archive" | "restore" | "delete";

/** What each change is called, and whether it needs a reason. */
const STATE_CHANGES: Record<CaseStateChange, { done: string; needsComment: boolean; adminOnly: boolean }> = {
  hold: { done: "Put on hold", needsComment: true, adminOnly: false },
  resume: { done: "Resumed", needsComment: false, adminOnly: false },
  cancel: { done: "Cancelled", needsComment: true, adminOnly: true },
  archive: { done: "Archived", needsComment: false, adminOnly: true },
  restore: { done: "Restored from the archive", needsComment: false, adminOnly: true },
  delete: { done: "Deleted", needsComment: true, adminOnly: true },
};

/**
 * Hold a case (or resume it), cancel it, archive it (or restore it), or delete
 * it — each with a comment, kept on its trail; holding, cancelling and deleting
 * say why. A case with parts is not deleted: its parts would go with it.
 */
export async function changeCaseState(caseId: string, change: CaseStateChange, comment: string): Promise<CaseActionResult> {
  await assertSameOrigin();
  const actor = await caseTeamMember();
  const rule = STATE_CHANGES[change];
  if (!rule) return fail("Unknown change.");
  const record = await localCase(actor, caseId);
  if (!record) return fail("This case is not one opened here.");
  const why = String(comment ?? "").trim().slice(0, 1000);
  if (rule.needsComment && why.length < 3) return fail("Add a comment — say why.");
  if (rule.adminOnly && !canManageSpace(actor)) return fail("Only a space admin can do that.");
  if (change === "hold" || change === "resume") {
    if (!canManageSpace(actor) && record.assigneeId !== actor.id) return fail("Only the person this case is assigned to, or an admin, can hold or resume it.");
  }
  const name = record.caseNumber ?? "";
  const summary = `${rule.done} case ${name}${why ? ` — “${why}”` : ""}`;

  if (change === "delete") {
    const parts = await db.part.count({ where: { caseId: record.id } });
    if (parts) return fail(`This case has ${parts} part${parts === 1 ? "" : "s"} — cancel or archive it instead; deleting it would delete them too.`);
    const files = await db.caseFile.findMany({ where: { caseId: record.id }, select: { storageKey: true } });
    const formFiles = await db.partFile.findMany({ where: { caseId: record.id }, select: { storageKey: true } });
    await db.caseRecord.delete({ where: { id: record.id } });
    await Promise.all([...files, ...formFiles].map((f) => deleteStoredFile(f.storageKey).catch(() => undefined)));
    await audit(actor, "case.delete", { id: record.id, name }, summary, { comment: why });
    revalidatePath("/cases");
    redirect("/cases");
  }

  const state =
    change === "hold" ? "On hold" : change === "resume" ? "Active" : change === "cancel" ? "Cancelled" : record.caseState;
  const isArchived = change === "archive" ? true : change === "restore" ? false : record.isArchived;
  if (change === "hold" && /hold/i.test(record.caseState ?? "")) return fail("It is on hold already.");
  if (change === "resume" && !/hold/i.test(record.caseState ?? "")) return fail("It is not on hold.");
  if (change === "cancel" && /cancel/i.test(record.caseState ?? "")) return fail("It is cancelled already.");
  // Completed stays completed; otherwise the bucket follows the state.
  const bucket = isArchived || /cancel/i.test(state ?? "") ? "ARCHIVED" : record.completedAt ? "COMPLETED" : classifyCase({ caseStatus: record.caseStatus, caseState: state, isArchived: false });
  await db.caseRecord.update({ where: { id: record.id }, data: { caseState: state, isArchived, bucket } });
  await audit(actor, `case.${change}`, { id: record.id, name }, summary, { comment: why, state, isArchived });
  revalidateCase(record.id);
  return { ok: true, message: `${rule.done}` };
}
