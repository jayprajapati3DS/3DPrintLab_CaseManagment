"use server";

import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { recordAudit } from "@/lib/audit";
import { infoLockedFor, isOptionalForm } from "@/lib/resources/config";
import { partScope } from "@/lib/sites/scope";
import { assertSameOrigin } from "@/lib/auth/origin";
import { requireSpaceAdmin, requireSpaceUser, userRoleNames } from "@/lib/auth/rbac";
import type { SessionSpace, SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { cleanFileName, deleteStoredFile, MAX_FILE_BYTES, saveFile } from "@/lib/files";
import {
  emptyStageMeta,
  findRequestCases,
  formsRequiredAt,
  optionalFormsAt,
  vendorStage,
  getRequestSetup,
  partDetails,
  partRequestForm,
  requestCase,
  requestCopy,
  type RequestCopy,
  partLockStages,
  partStageMeta,
  partStages,
  requestOptions,
  sitesFor,
  type CaseChoice,
  type StageMeta,
} from "@/lib/parts/queries";
import {
  askedOnRequest,
  buildPartNumber,
  EDITABLE_ON_PART,
  fieldVar,
  fileAllowed,
  IMAGE_SIZE_LABELS,
  imageSize,
  IMAGE_TYPES,
  inspectionSchema,
  normaliseLink,
  PRIORITIES,
  defaultSections,
  formsProblem,
  formsSchema,
  SOURCING,
  type Inspection,
  type PartDetail,
  type RequestField,
  type IdRule,
  type ImageSize,
  type RequestFormDef,
  type RequestForms,
} from "@/lib/parts/request-form";
import { nextPartNumber } from "@/lib/parts/numbering";
import { createPartForms } from "@/lib/qa/queries";
import type { WorkflowData, WorkflowStage } from "@/lib/resources/config";

/**
 * Every change to a part, and to how parts are requested.
 *
 * The same two rules as the master data: each action first establishes who is
 * acting and in which space, and each leaves a trace — a line in the part's
 * own activity log, which is what people read, and an entry in the audit
 * trail, which is what cannot be edited.
 */

export interface PartActionResult {
  ok: boolean;
  message?: string;
  partId?: string;
  partNumber?: string;
}

type Actor = SessionUser & { space: SessionSpace };

const OK: PartActionResult = { ok: true };
const fail = (message: string): PartActionResult => ({ ok: false, message });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const toDate = (value: string) => new Date(`${value}T00:00:00Z`);

/** A photo of the product or a drawing: a few megabytes at most. */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_FILES_PER_FIELD = 20;
const MAX_LINKS = 10;

async function admin(): Promise<Actor> {
  await assertSameOrigin();
  return requireSpaceAdmin();
}

async function member(): Promise<Actor> {
  await assertSameOrigin();
  return requireSpaceUser();
}

function audit(
  actor: Actor,
  action: `part.${string}` | `setup.${string}`,
  entity: { id: string; name: string } | null,
  summary: string,
  extra: { before?: unknown; after?: unknown; entityType?: string } = {},
) {
  return recordAudit({
    action,
    entityType: extra.entityType ?? "part",
    spaceId: actor.space.id,
    entityId: entity?.id ?? null,
    entityName: entity?.name ?? null,
    summary,
    before: extra.before,
    after: extra.after,
    actorId: actor.id,
    actorEmail: actor.email,
  });
}

function revalidatePart(part: { id: string; caseId: string | null }) {
  revalidatePath("/parts");
  revalidatePath(`/parts/${part.id}`);
  if (part.caseId) revalidatePath(`/cases/${part.caseId}`);
}

const json = (value: unknown) => value as Prisma.InputJsonValue;

// --- Part request setup ------------------------------------------------------------------

/**
 * The space's setup as stored: its ID rule row and its forms. Until something
 * is saved a space runs on defaults that exist nowhere; the first change saves
 * them, so the list a person sees is the list that is kept.
 */
async function storedSetup(actor: Actor) {
  const spaceId = actor.space.id;
  const setup = await getRequestSetup(actor.space);
  const rows = await db.partRequestForm.count({ where: { spaceId } });
  if (rows === 0) {
    const first = setup.forms[0];
    await db.partRequestForm.create({
      data: { id: first.id, spaceId, name: first.name, description: first.description, isDefault: true, position: 0, sections: json(first.sections), updatedByName: actor.name },
    });
  }
  const ruleData = {
    idPrefix: setup.rule.prefix,
    idSeparator: setup.rule.sep,
    idTokens: setup.rule.tokens,
    idScope: setup.rule.scope ?? "case",
    idWidth: setup.rule.width ?? 2,
  };
  await db.partRequestSetup.upsert({
    where: { spaceId },
    create: { spaceId, ...ruleData, sections: json(setup.sections), updatedByName: actor.name },
    update: {},
  });
  return getRequestSetup(actor.space);
}

const ruleSchema = formsSchema.shape.rule;

/** The part-ID rule, which every request form shares. */
export async function saveRequestRule(payload: string): Promise<PartActionResult> {
  const actor = await admin();
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return fail("The rule could not be read — reload the page and try again.");
  }
  const parsed = ruleSchema.safeParse(raw);
  if (!parsed.success) return fail("The ID rule is not valid.");
  const rule = parsed.data as IdRule;
  const before = await storedSetup(actor);
  await db.partRequestSetup.update({
    where: { spaceId: actor.space.id },
    data: { idPrefix: rule.prefix, idSeparator: rule.sep, idTokens: rule.tokens, idScope: rule.scope ?? "case", idWidth: rule.width ?? 2, updatedByName: actor.name },
  });
  const sample = buildPartNumber(rule, { spaceName: actor.space.name, now: new Date() }, true);
  await audit(actor, "setup.part_request_save", { id: actor.space.id, name: "Part ID rule" }, `Changed the part ID rule to ${sample}`, {
    entityType: "partsetup",
    before: { rule: before.rule },
    after: { rule },
  });
  revalidatePath("/partsetup");
  revalidatePath("/parts");
  return OK;
}

const formSchema = formsSchema.shape.forms.element;

/** Save one request form — its name, description and fields — checked against the others. */
export async function saveRequestForm(payload: string): Promise<PartActionResult> {
  const actor = await admin();
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return fail("The form could not be read — reload the page and try again.");
  }
  const parsed = formSchema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "The form is not valid.");
  const form = parsed.data as RequestFormDef;

  const setup = await storedSetup(actor);
  const current = setup.forms.find((f) => f.id === form.id);
  if (!current) return fail("That request form no longer exists — it may have been deleted.");
  const combined: RequestForms = { rule: setup.rule, forms: setup.forms.map((f) => (f.id === form.id ? { ...form, isDefault: f.isDefault } : f)) };
  const problem = formsProblem(combined);
  if (problem) return fail(problem);

  await db.partRequestForm.update({
    where: { id: form.id },
    data: { name: form.name.trim(), description: form.description.trim(), sections: json(form.sections), updatedByName: actor.name },
  });
  // The setup row keeps the default form's fields too, for anything reading the single form of old.
  if (current.isDefault) await db.partRequestSetup.update({ where: { spaceId: actor.space.id }, data: { sections: json(form.sections), updatedByName: actor.name } });

  const fields = form.sections.reduce((n, sec) => n + sec.fields.length, 0);
  await audit(actor, "setup.part_request_save", { id: form.id, name: form.name }, `Saved the request form "${form.name}" — ${form.sections.length} sections, ${fields} fields`, {
    entityType: "partsetup",
  });
  revalidatePath("/partsetup");
  revalidatePath("/parts");
  return { ok: true, message: `"${form.name}" saved — new requests with it use these fields` };
}

/**
 * A new request form: the default fields, or a copy of another form — a copy
 * keeps every field and variable, so QA forms read both the same way.
 */
export async function createRequestForm(name: string, description: string, copyFromId: string | null): Promise<PartActionResult & { formId?: string }> {
  const actor = await admin();
  const setup = await storedSetup(actor);
  if (setup.forms.length >= 30) return fail("A space can keep at most 30 request forms.");
  const source = copyFromId ? setup.forms.find((f) => f.id === copyFromId) : null;
  if (copyFromId && !source) return fail("The form to copy no longer exists.");

  const base = String(name ?? "").trim().slice(0, 80) || (source ? `${source.name} (copy)` : "New request form");
  let unique = base;
  for (let n = 2; setup.forms.some((f) => f.name.toLowerCase() === unique.toLowerCase()); n += 1) unique = `${base} ${n}`;

  const last = await db.partRequestForm.aggregate({ where: { spaceId: actor.space.id }, _max: { position: true } });
  const created = await db.partRequestForm.create({
    data: {
      id: `rf-${randomUUID().slice(0, 12)}`,
      spaceId: actor.space.id,
      name: unique,
      description: String(description ?? "").trim().slice(0, 200) || source?.description || "",
      sections: json(source ? source.sections : defaultSections()),
      isDefault: false,
      position: (last._max.position ?? 0) + 1,
      updatedByName: actor.name,
    },
  });
  await audit(
    actor,
    "setup.part_request_save",
    { id: created.id, name: created.name },
    source ? `Added the request form "${created.name}", copied from "${source.name}"` : `Added the request form "${created.name}"`,
    { entityType: "partsetup" },
  );
  revalidatePath("/partsetup");
  revalidatePath("/parts");
  return { ok: true, formId: created.id, message: `"${created.name}" added` };
}

/** The form offered first, and used for parts from before forms could be chosen. */
export async function setDefaultRequestForm(formId: string): Promise<PartActionResult> {
  const actor = await admin();
  const setup = await storedSetup(actor);
  const form = setup.forms.find((f) => f.id === String(formId));
  if (!form) return fail("That request form no longer exists.");
  if (form.isDefault) return OK;
  await db.$transaction([
    db.partRequestForm.updateMany({ where: { spaceId: actor.space.id }, data: { isDefault: false } }),
    db.partRequestForm.update({ where: { id: form.id }, data: { isDefault: true } }),
    db.partRequestSetup.update({ where: { spaceId: actor.space.id }, data: { sections: json(form.sections) } }),
  ]);
  await audit(actor, "setup.part_request_save", { id: form.id, name: form.name }, `Made "${form.name}" the default request form`, { entityType: "partsetup" });
  revalidatePath("/partsetup");
  revalidatePath("/parts");
  return { ok: true, message: `"${form.name}" is now the default` };
}

/** Remove a request form — archived when parts were requested with it, so they still show what was asked. */
export async function deleteRequestForm(formId: string): Promise<PartActionResult> {
  const actor = await admin();
  const setup = await storedSetup(actor);
  const form = setup.forms.find((f) => f.id === String(formId));
  if (!form) return fail("That request form no longer exists.");
  if (setup.forms.length === 1) return fail("Keep at least one request form.");
  const used = await db.part.count({ where: { spaceId: actor.space.id, requestFormId: form.id } });
  const next = form.isDefault ? setup.forms.find((f) => f.id !== form.id)! : null;
  await db.$transaction(async (tx) => {
    if (used) await tx.partRequestForm.update({ where: { id: form.id }, data: { archivedAt: new Date(), isDefault: false } });
    else await tx.partRequestForm.delete({ where: { id: form.id } });
    if (next) {
      await tx.partRequestForm.update({ where: { id: next.id }, data: { isDefault: true } });
      await tx.partRequestSetup.update({ where: { spaceId: actor.space.id }, data: { sections: json(next.sections) } });
    }
  });
  await audit(
    actor,
    "setup.part_request_save",
    { id: form.id, name: form.name },
    `${used ? "Archived" : "Deleted"} the request form "${form.name}"${used ? ` — ${used} part${used === 1 ? " was" : "s were"} requested with it` : ""}${next ? `; "${next.name}" is now the default` : ""}`,
    { entityType: "partsetup" },
  );
  revalidatePath("/partsetup");
  revalidatePath("/parts");
  return { ok: true, message: used ? `"${form.name}" archived — its parts keep it` : `"${form.name}" deleted` };
}

// --- Requesting a part --------------------------------------------------------------------

export async function searchRequestCases(query: string): Promise<CaseChoice[]> {
  const searcher = await requireSpaceUser();
  if (searcher.siteOnly || searcher.surgeonOnly) return [];
  const actor = await member();
  return findRequestCases(actor.space.id, String(query ?? "").slice(0, 100));
}

/** The ID the part being requested would get now — shown in the request form as it is filled. */
export async function previewPartNumber(caseId: string | null, partType: string, material: string): Promise<string> {
  const actor = await member();
  const spaceId = actor.space.id;
  const [setup, record, type] = await Promise.all([
    getRequestSetup(actor.space),
    caseId ? db.caseRecord.findFirst({ where: { id: String(caseId), spaceId }, select: { caseNumber: true, platformCaseId: true, productName: true } }) : null,
    partType ? db.partType.findFirst({ where: { spaceId, name: String(partType) }, select: { code: true } }) : null,
  ]);
  const { partNumber } = await nextPartNumber(
    db,
    spaceId,
    setup.rule,
    {
      noCase: !record,
      product: record?.productName,
      caseNumber: record ? (record.caseNumber ?? String(record.platformCaseId)) : null,
      partTypeCode: type?.code ?? null,
      material: String(material ?? "").slice(0, 200) || null,
      spaceName: actor.space.name,
      now: new Date(),
    },
    { caseId: record ? String(caseId) : null, partType: type ? String(partType) : null },
  );
  return partNumber;
}

/** An earlier part offered as a starting point for a new request. */
export interface EarlierPart {
  id: string;
  partNumber: string;
  name: string;
  partType: string | null;
  workflowName: string;
  caseNumber: string | null;
  requestedOn: string;
}

/** Earlier parts to start a request from — newest first, matched on ID, name, type or workflow. */
export async function searchEarlierParts(query: string): Promise<EarlierPart[]> {
  const actor = await member();
  const q = String(query ?? "").trim().slice(0, 100);
  const parts = await db.part.findMany({
    where: {
      spaceId: actor.space.id,
      ...(q
        ? {
            OR: [
              { partNumber: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
              { partType: { contains: q, mode: "insensitive" } },
              { workflowName: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: {
      id: true,
      partNumber: true,
      name: true,
      partType: true,
      workflowName: true,
      createdAt: true,
      case: { select: { caseNumber: true, platformCaseId: true } },
    },
  });
  return parts.map((p) => ({
    id: p.id,
    partNumber: p.partNumber,
    name: p.name,
    partType: p.partType,
    workflowName: p.workflowName,
    caseNumber: p.case ? (p.case.caseNumber ?? `#${p.case.platformCaseId}`) : null,
    requestedOn: p.createdAt.toISOString().slice(0, 10),
  }));
}

export type { RequestCopy } from "@/lib/parts/queries";

export async function earlierPartRequest(partId: string): Promise<RequestCopy | null> {
  const actor = await member();
  return requestCopy(actor.space.id, String(partId));
}

const requestPayload = z.object({
  /** The request form filled in; the default when absent. */
  formId: z.string().max(80).optional(),
  /** The case the part is for; empty for a part that belongs to none. */
  caseId: z.string().max(60),
  values: z.record(z.string().max(60), z.string().max(4000)),
  links: z.record(z.string().max(60), z.array(z.string().max(2000)).max(MAX_LINKS)),
  inspection: z.record(z.string().max(60), inspectionSchema),
});

/** Built-in fields with a column of their own; the rest are kept as details. */
const CORE_KEYS = new Set([
  "case",
  "name",
  "type",
  "qty",
  "workflow",
  "material",
  "printer",
  "sourcing",
  "vendor",
  "site",
  "due",
  "priority",
  "notes",
  "files",
  "balloon",
]);

interface PendingFile {
  id: string;
  kind: "print" | "image" | "drawing";
  field: string | null;
  /** A request image: how large it is shown. */
  displaySize?: ImageSize;
  name: string;
  contentType: string;
  bytes: Buffer;
}

const isFile = (value: FormDataEntryValue | null): value is File =>
  typeof value === "object" && value !== null && "arrayBuffer" in value && value.size > 0;

export async function requestPart(formData: FormData): Promise<PartActionResult> {
  const requester = await requireSpaceUser();
  if (requester.siteOnly || requester.surgeonOnly) return fail("Parts are requested by the hospital team.");
  const actor = await member();
  const spaceId = actor.space.id;

  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return fail("The request could not be read — reload the page and try again.");
  }
  const parsed = requestPayload.safeParse(raw);
  if (!parsed.success) return fail("Part of the request is too long or not valid. Check the fields and try again.");
  const { values, links: linkInput, inspection: inspectionInput } = parsed.data;
  const caseId = parsed.data.caseId.trim();

  const [setup, options] = await Promise.all([getRequestSetup(actor.space), requestOptions(spaceId)]);
  const form = setup.forms.find((f) => f.id === parsed.data.formId) ?? setup.forms.find((f) => f.isDefault) ?? setup.forms[0];
  if (parsed.data.formId && form.id !== parsed.data.formId) return fail("That request form is no longer offered — choose another.");
  // Only what the form asks when requesting; the rest is answered on the part.
  const shown = form.sections.flatMap((s) => s.fields).filter(askedOnRequest);
  const byKey = (key: string) => shown.find((f) => f.key === key);
  const valueOf = (field: RequestField | undefined) => (field ? (values[field.id] ?? "").trim() : "");

  // --- Gather what was sent, field by field --------------------------------------------
  // A vendor is only asked for when the part is made outside.
  const workflowChoice = options.workflows.find((w) => w.id === valueOf(byKey("workflow")));
  if (workflowChoice && caseId) {
    const allowed = (await requestCase(spaceId, caseId))?.workflowIds;
    if (allowed && !allowed.includes(workflowChoice.id)) return fail(`${workflowChoice.name} is not one of the workflows this case's product allows.`);
  }
  const outsourced = (valueOf(byKey("sourcing")) || workflowChoice?.sourcing) === "Outsourced";

  const pending: PendingFile[] = [];
  const links: string[] = [];
  let inspection: Inspection | null = null;
  const missing: string[] = [];
  const details: PartDetail[] = [];

  for (const field of shown) {
    let filled: boolean;

    if (field.type === "file") {
      const files = formData.getAll(`file:${field.id}`).filter(isFile);
      if (files.length > MAX_FILES_PER_FIELD) return fail(`"${field.label}" takes at most ${MAX_FILES_PER_FIELD} files.`);
      for (const file of files) {
        if (!fileAllowed(file.name, field.fileTypes)) {
          return fail(`"${cleanFileName(file.name)}" is not one of the file types "${field.label}" accepts (${field.fileTypes.join(", ")}).`);
        }
        if (file.size > MAX_FILE_BYTES) {
          return fail(`"${cleanFileName(file.name)}" is larger than 25 MB — add it as a download link instead.`);
        }
        pending.push({
          id: randomUUID(),
          kind: "print",
          field: field.key || field.var || null,
          name: cleanFileName(file.name),
          contentType: file.type || "application/octet-stream",
          bytes: Buffer.from(await file.arrayBuffer()),
        });
      }
      const fieldLinks: string[] = [];
      for (const typed of field.allowLinks ? (linkInput[field.id] ?? []) : []) {
        const url = normaliseLink(typed);
        if (!url) return fail(`"${typed.slice(0, 80)}" is not a valid link.`);
        if (!fieldLinks.includes(url)) fieldLinks.push(url);
      }
      links.push(...fieldLinks.filter((l) => !links.includes(l)));
      filled = files.length > 0 || fieldLinks.length > 0;
    } else if (field.type === "image") {
      const file = formData.get(`image:${field.id}`);
      filled = isFile(file);
      if (isFile(file)) {
        if (!IMAGE_TYPES.includes(file.type)) return fail(`"${field.label}" must be a PNG, JPEG, WebP or GIF image.`);
        if (file.size > MAX_IMAGE_BYTES) return fail(`"${field.label}" is larger than 12 MB.`);
        pending.push({
          id: randomUUID(),
          kind: "image",
          displaySize: imageSize(String(formData.get(`imageSize:${field.id}`) ?? "")),
          field: field.var || field.key || null,
          name: cleanFileName(file.name),
          contentType: file.type,
          bytes: Buffer.from(await file.arrayBuffer()),
        });
      }
    } else if (field.type === "balloon") {
      const sent = inspectionInput[field.id];
      filled = Boolean(sent && (sent.images.length > 0 || sent.rows.length > 0));
      if (sent && filled) {
        const images: Inspection["images"] = [];
        for (const image of sent.images) {
          const file = formData.get(`drawing:${image.id}`);
          if (!isFile(file)) return fail(`The drawing "${image.name}" did not upload — add it again.`);
          if (!IMAGE_TYPES.includes(file.type)) return fail(`The drawing "${image.name}" must be a PNG, JPEG, WebP or GIF image.`);
          if (file.size > MAX_IMAGE_BYTES) return fail(`The drawing "${image.name}" is larger than 12 MB.`);
          const id = randomUUID();
          pending.push({
            id,
            kind: "drawing",
            field: null,
            name: cleanFileName(file.name || image.name),
            contentType: file.type,
            bytes: Buffer.from(await file.arrayBuffer()),
          });
          images.push({ id: image.id, name: cleanFileName(image.name), w: image.w, h: image.h, fileId: id });
        }
        const imageIds = new Set(images.map((i) => i.id));
        const columnIds = new Set(field.columns.map((c) => c.id));
        inspection = {
          images,
          points: sent.points.filter((p) => imageIds.has(p.imgId)),
          columns: field.columns.map((c) => ({ ...c })),
          rows: sent.rows.map((r) => ({
            id: r.id,
            imgId: imageIds.has(r.imgId) ? r.imgId : "",
            balloon: r.balloon.trim(),
            vals: Object.fromEntries(
              Object.entries(r.vals)
                .filter(([k]) => columnIds.has(k))
                .map(([k, v]) => [k, v.trim()]),
            ),
          })),
        };
      }
    } else if (field.type === "case") {
      filled = caseId !== "";
    } else {
      const value = valueOf(field);
      filled = value !== "";
      if (filled) {
        if (field.type === "number" && !Number.isFinite(Number(value.replace(",", ".")))) {
          return fail(`"${field.label}" must be a number.`);
        }
        if (field.type === "date" && !isoDate.safeParse(value).success) {
          return fail(`"${field.label}" must be a date.`);
        }
        if (field.type === "select" && !field.options.includes(value)) {
          return fail(`"${value}" is not one of the choices for "${field.label}".`);
        }
        if (!CORE_KEYS.has(field.key)) {
          const name = fieldVar(field);
          if (name) details.push({ label: field.label, var: name, value });
        }
      }
    }

    // The vendor is asked only when made outside — and then not when the site is asked: it is the site's.
    if (field.req && !filled && !(field.key === "vendor" && (!outsourced || Boolean(byKey("site"))))) missing.push(field.label);
  }

  if (missing.length > 0) return fail(`Please fill in: ${missing.join(", ")}`);

  // --- The built-in answers ------------------------------------------------------------
  // A part may belong to no case; one that names a case must name a real, open one.
  const record = caseId ? await db.caseRecord.findFirst({ where: { id: caseId, spaceId } }) : null;
  if (caseId && !record) return fail("That case could not be found — choose it again.");
  if (record?.bucket === "ARCHIVED") return fail("That case is archived or cancelled — parts cannot be requested for it.");

  const name = valueOf(byKey("name")).slice(0, 160);
  if (!name) return fail("Enter a part name.");

  const quantity = Number(valueOf(byKey("qty")));
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999) {
    return fail("Quantity must be a whole number between 1 and 9999.");
  }

  // The workflow may be left for later: the part then has no stages, and
  // gets them — and its quality forms — when a workflow is chosen on it.
  const workflowOption = workflowChoice ?? null;
  if (valueOf(byKey("workflow")) && !workflowOption) return fail("That workflow is no longer available — choose it again.");
  const workflow = workflowOption
    ? await db.resource.findFirst({ where: { id: workflowOption.id, spaceId, kind: "workflows", archivedAt: null } })
    : null;
  const stages = ((workflow?.data ?? {}) as Partial<WorkflowData>).stages ?? [];
  if (workflowOption && (!workflow || stages.length === 0)) {
    return fail("That workflow has no stages yet — add them in Manufacturing Workflow Setup.");
  }

  const pick = (key: string, allowed: readonly string[], what: string): string | null | PartActionResult => {
    const value = valueOf(byKey(key));
    if (!value) return null;
    return allowed.includes(value) ? value : fail(`"${value}" is not an available ${what}.`);
  };
  const picked = {
    partType: pick("type", options.partTypes.map((t) => t.name), "part type"),
    material: pick("material", options.materials, "material"),
    printer: pick("printer", options.printers, "printer"),
    vendor: pick("vendor", options.vendors, "vendor"),
    priority: pick("priority", PRIORITIES, "priority"),
    sourcing: pick("sourcing", SOURCING, "sourcing"),
  };
  for (const value of Object.values(picked)) {
    if (value && typeof value === "object") return value;
  }
  const chosen = picked as Record<keyof typeof picked, string | null>;

  const sourcing = chosen.sourcing ?? workflowOption?.sourcing ?? "In-house";
  // The workflow must be one for how the part is made.
  if (workflowOption && chosen.sourcing && workflowOption.sourcing !== chosen.sourcing) {
    return fail(`${workflowOption.name} is an ${workflowOption.sourcing === "Outsourced" ? "outsourced" : "in-house"} workflow — choose one for ${chosen.sourcing.toLowerCase()} parts.`);
  }
  // Where it is made: the site chosen — one that fits how it is made and that the workflow runs at —
  // else the workflow's default site, else the only one that fits.
  const fittingSites = sitesFor(options.sites, sourcing, "").filter((x) => !workflowOption || workflowOption.sites.length === 0 || workflowOption.sites.includes(x.id));
  const siteValue = valueOf(byKey("site"));
  if (siteValue && !options.sites.some((x) => x.id === siteValue)) return fail("Choose a site from Manufacturing Sites.");
  if (siteValue && !fittingSites.some((x) => x.id === siteValue)) {
    if (workflowOption && workflowOption.sites.length && !workflowOption.sites.includes(siteValue)) return fail(`${workflowOption.name} does not run at that site.`);
    return fail(sourcing === "Outsourced" ? "An outsourced part is made at a vendor's site." : "An in-house part is made at an in-house or partner site.");
  }
  const site =
    fittingSites.find((x) => x.id === siteValue) ?? fittingSites.find((x) => x.id === workflowOption?.site) ?? (fittingSites.length === 1 ? fittingSites[0] : null);
  if (sourcing === "Outsourced" && !site) return fail("Choose the manufacturing site that makes this part.");
  // An outsourced part's vendor is its site's.
  const vendor = sourcing === "Outsourced" ? (site?.vendor || chosen.vendor || null) : null;
  const route = workflow ? ` via ${workflow.name}` : " — no workflow yet";
  const dueValue = valueOf(byKey("due"));
  const notes = valueOf(byKey("notes")) || null;
  const partTypeCode = options.partTypes.find((t) => t.name === chosen.partType)?.code ?? null;

  // --- Store the files, then the part ------------------------------------------------------
  const stored: Array<PendingFile & { storageKey: string }> = [];
  try {
    for (const file of pending) {
      stored.push({ ...file, storageKey: await saveFile(spaceId, file.bytes) });
    }

    const snapshot: WorkflowStage[] = stages.map((s) => ({ ...s }));
    const now = new Date();

    // The next number is read from the IDs already given, and two people can
    // request a part at the same moment; the unique index on the ID catches
    // that, and the request is tried again with the next number.
    let created: { id: string; partNumber: string } | null = null;
    for (let attempt = 0; attempt < 4 && !created; attempt += 1) {
      try {
        created = await db.$transaction(async (tx) => {
          const { partNumber, sequence } = await nextPartNumber(
            tx,
            spaceId,
            setup.rule,
            {
              noCase: !record,
              product: record?.productName,
              caseNumber: record ? (record.caseNumber ?? String(record.platformCaseId)) : null,
              partTypeCode,
              material: chosen.material,
              spaceName: actor.space.name,
              now,
            },
            { caseId: record?.id ?? null, partType: chosen.partType },
          );

          const part = await tx.part.create({
            data: {
              spaceId,
              caseId: record?.id ?? null,
              partNumber,
              sequence,
              name,
              quantity,
              dueOn: dueValue ? toDate(dueValue) : null,
              partType: chosen.partType,
              priority: chosen.priority,
              notes,
              workflowId: workflow?.id ?? null,
              workflowName: workflow?.name ?? "",
              requestFormId: form.id,
              requestFormName: form.name,
              stages: json(snapshot),
              stageCount: snapshot.length,
              stageIndex: 0,
              stageMeta: json(snapshot.map(() => emptyStageMeta())),
              technology: workflowOption?.technology || null,
              material: chosen.material,
              printer: chosen.printer,
              sourcing,
              vendor,
              siteId: site?.id ?? null,
              siteName: site?.name ?? null,
              details: json(details),
              inspection: inspection ? json(inspection) : Prisma.JsonNull,
              links,
              requestedById: actor.id,
              requestedByName: actor.name,
              files: {
                create: stored.map((f) => ({
                  id: f.id,
                  spaceId,
                  kind: f.kind,
                  field: f.field,
                  name: f.name,
                  contentType: f.contentType,
                  size: f.bytes.length,
                  storageKey: f.storageKey,
                  displaySize: f.displaySize ?? null,
                  uploadedByName: actor.name,
                })),
              },
              activity: {
                create: {
                  title: "Part requested",
                  detail: `${partNumber} · ${name}${route}`,
                  byId: actor.id,
                  byName: actor.name,
                },
              },
            },
            select: { id: true, partNumber: true, spaceId: true, stageIndex: true, stages: true },
          });
          // The quality forms its workflow's stages call for, copied from the
          // templates as they are now.
          await createPartForms(tx, part);
          return part;
        });
      } catch (error) {
        const clash = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
        if (!clash || attempt === 3) throw error;
      }
    }
    if (!created) return fail("The part could not be saved. Try again.");

    await audit(
      actor,
      "part.request",
      { id: created.id, name: created.partNumber },
      `Requested part ${created.partNumber} · ${name}${route} ${
        record ? `for case ${record.caseNumber ?? record.platformCaseId}` : "without a case"
      }`,
    );
    revalidatePart({ id: created.id, caseId: record?.id ?? null });
    return { ok: true, partId: created.id, partNumber: created.partNumber };
  } catch (error) {
    // Nothing points at these files if the part was not saved.
    await Promise.all(stored.map((f) => deleteStoredFile(f.storageKey).catch(() => undefined)));
    console.error("[parts] request failed", error instanceof Error ? error.message : error);
    return fail("The part could not be saved. Try again.");
  }
}

// --- Working on a part ----------------------------------------------------------------------

async function loadPart(actor: Actor, id: string) {
  // A site-only person reaches only the parts made at their sites.
  return db.part.findFirst({ where: { id: String(id), spaceId: actor.space.id, ...partScope(actor) } });
}

type LoadedPart = NonNullable<Awaited<ReturnType<typeof loadPart>>>;

const activity = (actor: Actor, title: string, detail?: string | null) => ({
  title,
  detail: detail ?? null,
  byId: actor.id,
  byName: actor.name,
});

async function personIn(actor: Actor, userId: string) {
  return db.user.findFirst({
    where: { id: userId, spaceId: actor.space.id, isActive: true },
    select: { id: true, name: true },
  });
}

/**
 * How large a request image is shown — on the part, its QA forms and their
 * print. Only the display changes; the image itself stays as uploaded.
 */
export async function setPartImageSize(fileId: string, size: string): Promise<PartActionResult> {
  const actor = await member();
  const file = await db.partFile.findFirst({ where: { id: String(fileId), spaceId: actor.space.id, kind: "image" }, select: { id: true, partId: true, name: true } });
  if (!file) return fail("That image is no longer on the part.");
  const chosen = imageSize(size);
  await db.partFile.update({ where: { id: file.id }, data: { displaySize: chosen } });
  revalidatePath(`/parts/${file.partId}`);
  return { ok: true, message: `Image shown ${IMAGE_SIZE_LABELS[chosen].toLowerCase()}` };
}

/** Give the part to someone — `"me"`, a person's id, or null to clear its owner. */
export async function assignPart(partId: string, to: string | null): Promise<PartActionResult> {
  const actor = await member();
  const part = await loadPart(actor, partId);
  if (!part) return fail("That part no longer exists.");

  const person = to === null ? null : to === "me" ? { id: actor.id, name: actor.name } : await personIn(actor, to);
  if (to !== null && !person) return fail("That person is not an active member of this space.");
  if ((person?.id ?? null) === part.assigneeId) return OK;

  const [title, detail] = !person
    ? ["Unassigned part", "Part owner cleared"]
    : to === "me"
      ? ["Assigned part", `Part assigned to ${person.name}`]
      : ["Reassigned part", `${part.assigneeName ?? "Unassigned"} → ${person.name}`];

  await db.part.update({
    where: { id: part.id },
    data: {
      assigneeId: person?.id ?? null,
      assigneeName: person?.name ?? null,
      activity: { create: activity(actor, title, detail) },
    },
  });
  await audit(actor, "part.assign", { id: part.id, name: part.partNumber }, `${title} ${part.partNumber} — ${detail}`);
  revalidatePart(part);
  return OK;
}

/**
 * Move a part to its next stage, or back one. Only its owner may: the person
 * a part is assigned to is the one answerable for where it is.
 */
export async function movePart(partId: string, direction: 1 | -1): Promise<PartActionResult> {
  const actor = await member();
  const part = await loadPart(actor, partId);
  if (!part) return fail("That part no longer exists.");
  if (part.assigneeId !== actor.id) return fail("Assign this part to yourself to move its stage.");

  const stages = partStages(part);
  if (stages.length === 0) return fail("Choose a production workflow for this part first — its stages come from it.");
  const meta = partStageMeta(part);
  const from = part.stageIndex;
  const to = from + (direction === 1 ? 1 : -1);
  if (to < 0 || to >= stages.length) return fail(direction === 1 ? "This part has completed all stages." : "This part is on its first stage.");

  if (direction === 1) {
    meta[from] = { ...meta[from], by: actor.name, at: new Date().toISOString() };
  } else {
    // Going back re-opens the stage being returned to.
    meta[to] = { ...meta[to], by: null, at: null };
  }

  // Forward only when every quality form at this stage is approved — unless
  // the workflow says this stage's forms need not hold the part back.
  if (direction === 1 && (await formsRequiredAt(part, from))) {
    const stage = await optionalFormsAt(part, from);
    const open = (
      await db.partForm.findMany({ where: { partId: part.id, stageIndex: from, status: { not: "Approved" } }, select: { name: true, code: true } })
    ).find((f) => !isOptionalForm(stage, f));
    if (open) return fail(`Approve "${open.name}" before advancing`);
  }
  if (direction === 1) {

    // An outsourced part leaves the vendor by coming back through goods
    // receipt, where it is inspected — not by a click.
    if (from === vendorStage(part)) {
      const received = await db.grnLine.findFirst({
        where: { spaceId: actor.space.id, type: "part", decision: "Accepted", partIds: { has: part.id } },
        select: { id: true },
      });
      if (!received) {
        return fail(`${part.partNumber} is at the vendor — it moves on when it is received and accepted on a goods receipt (GRN).`);
      }
    }
  }

  const title = direction === 1 ? "Advanced stage" : "Moved stage back";
  const detail = `${stages[from].name} → ${stages[to].name}`;
  // The index is part of the condition, so two clicks cannot skip a stage.
  const moved = await db.part.updateMany({
    where: { id: part.id, stageIndex: from, assigneeId: actor.id },
    data: { stageIndex: to, stageMeta: json(meta) },
  });
  if (moved.count === 0) return fail("This part was just changed by someone else — reload and try again.");
  await db.partActivity.create({ data: { partId: part.id, ...activity(actor, title, detail) } });
  if (direction === 1) {
    // The forms of the stage just reached are now the ones to fill.
    await db.partForm.updateMany({ where: { partId: part.id, stageIndex: to, status: "Upcoming" }, data: { status: "In progress" } });
  }

  await audit(actor, "part.stage", { id: part.id, name: part.partNumber }, `${title}: ${part.partNumber} · ${detail}`, {
    before: { stage: stages[from].name },
    after: { stage: stages[to].name },
  });
  revalidatePart(part);
  return { ok: true, message: `${part.partNumber} → ${stages[to].name}` };
}

const FIELDS = ["workflow", "partType", "sourcing", "vendor", "due", "printer", "notes", "priority", "material"] as const;
type EditableField = (typeof FIELDS)[number];

/** Change one production detail of a part; each change is logged on it. */
export async function updatePartField(partId: string, field: EditableField, value: string): Promise<PartActionResult> {
  const actor = await member();
  if (!FIELDS.includes(field)) return fail("That cannot be changed here.");
  const part = await loadPart(actor, partId);
  if (!part) return fail("That part no longer exists.");
  const locked = infoLockedFor(await partLockStages(part), part.stageIndex, userRoleNames(actor), "part");
  if (locked) return fail(locked);
  const next = String(value ?? "").trim();
  const options = await requestOptions(actor.space.id);

  let data: Prisma.PartUpdateInput;
  let title: string;
  let detail: string;
  let message: string | undefined;

  switch (field) {
    case "workflow": {
      if (next === part.workflowId) return OK;
      const workflow = await db.resource.findFirst({
        where: { id: next, spaceId: actor.space.id, kind: "workflows", archivedAt: null },
      });
      const data_ = (workflow?.data ?? {}) as Partial<WorkflowData>;
      const stages = data_.stages ?? [];
      if (!workflow || stages.length === 0) return fail("Choose a workflow that has stages.");
      // Quality records belong to the stages they were filled at; a new
      // route would leave them pointing at stages the part no longer has.
      const recorded = await db.partForm.count({ where: { partId: part.id, savedAt: { not: null } } });
      if (recorded > 0) {
        return fail("This part already has quality records — its workflow cannot be changed. Request a new part instead.");
      }
      // A different route starts from its beginning: the stages the part had
      // been through do not exist on the new one.
      data = {
        workflowId: workflow.id,
        workflowName: workflow.name,
        stages: json(stages),
        stageCount: stages.length,
        stageIndex: 0,
        stageMeta: json(stages.map(() => emptyStageMeta())),
        technology: data_.method || null,
      };
      title = "Changed production workflow";
      if (part.stageCount === 0) {
        title = "Set production workflow";
        detail = `${workflow.name} — ${stages.length} stages, starting at ${stages[0].name}`;
        message = `Workflow set — the part starts at ${stages[0].name}`;
      } else {
        detail = `${part.workflowName} → ${workflow.name} (stages reset)`;
        message = `Workflow changed — stages reset to ${stages[0].name}`;
      }
      break;
    }
    case "partType": {
      if (next && !options.partTypes.some((t) => t.name === next)) return fail("Choose a part type from the list.");
      data = { partType: next || null };
      title = "Set part type";
      detail = next || "Cleared";
      break;
    }
    case "sourcing": {
      if (!SOURCING.includes(next as (typeof SOURCING)[number])) return fail("Choose In-house or Outsourced.");
      data = { sourcing: next, ...(next === "In-house" ? { vendor: null } : {}) };
      title = "Changed sourcing";
      detail = `${part.sourcing} → ${next}`;
      break;
    }
    case "vendor": {
      if (next && !options.vendors.includes(next)) return fail("Choose a vendor from the approved supplier list.");
      data = { vendor: next || null };
      title = "Set outsource vendor";
      detail = next || "Cleared";
      break;
    }
    case "printer": {
      if (next && !options.printers.includes(next)) return fail("Choose a machine from the list.");
      data = { printer: next || null };
      title = "Set printer / resource";
      detail = next || "Cleared";
      break;
    }
    case "material": {
      if (next && !options.materials.includes(next)) return fail("Choose a material from the list.");
      data = { material: next || null };
      title = "Set material";
      detail = next || "Cleared";
      break;
    }
    case "priority": {
      if (next && !PRIORITIES.includes(next as (typeof PRIORITIES)[number])) return fail("Choose a priority from the list.");
      data = { priority: next || null };
      title = "Set priority";
      detail = next || "Cleared";
      break;
    }
    case "due": {
      if (next && !isoDate.safeParse(next).success) return fail("Enter a valid date.");
      data = { dueOn: next ? toDate(next) : null };
      title = "Changed due date";
      detail = next || "Cleared";
      break;
    }
    case "notes": {
      if (next.length > 4000) return fail("Notes are limited to 4000 characters.");
      if (next === (part.notes ?? "")) return OK;
      data = { notes: next || null };
      title = "Updated notes";
      detail = next ? (next.length > 120 ? `${next.slice(0, 119)}…` : next) : "Cleared";
      break;
    }
  }

  await db.$transaction(async (tx) => {
    const updated = await tx.part.update({
      where: { id: part.id },
      data: { ...data, activity: { create: activity(actor, title, detail) } },
      select: { id: true, spaceId: true, stageIndex: true, stages: true },
    });
    if (field === "workflow") {
      await tx.partForm.deleteMany({ where: { partId: part.id } });
      await createPartForms(tx, updated);
    }
  });
  await audit(actor, "part.update", { id: part.id, name: part.partNumber }, `${title}: ${part.partNumber} · ${detail}`);
  revalidatePart(part);
  return { ok: true, message };
}

/** Who owns one stage of a part, and when it is due. */
export async function updatePartStage(
  partId: string,
  stageIndex: number,
  change: { assigneeId?: string | null; due?: string | null },
): Promise<PartActionResult> {
  const actor = await member();
  const part = await loadPart(actor, partId);
  if (!part) return fail("That part no longer exists.");

  const stages = partStages(part);
  const meta = partStageMeta(part);
  const index = Number(stageIndex);
  if (!Number.isInteger(index) || index < 0 || index >= stages.length) return fail("That stage does not exist.");

  const next: StageMeta = { ...meta[index] };
  let title = "";
  let detail = "";

  if (change.assigneeId !== undefined) {
    const person = change.assigneeId ? await personIn(actor, change.assigneeId) : null;
    if (change.assigneeId && !person) return fail("That person is not an active member of this space.");
    next.assigneeId = person?.id ?? null;
    next.assignee = person?.name ?? null;
    title = "Assigned stage owner";
    detail = `${stages[index].name} → ${person?.name ?? "Unassigned"}`;
  }
  if (change.due !== undefined) {
    if (change.due && !isoDate.safeParse(change.due).success) return fail("Enter a valid date.");
    next.due = change.due || null;
    title ||= "Set stage due date";
    detail ||= `${stages[index].name} → ${change.due || "no date"}`;
  }
  if (!title) return OK;

  meta[index] = next;
  await db.part.update({
    where: { id: part.id },
    data: { stageMeta: json(meta), activity: { create: activity(actor, title, detail) } },
  });
  await audit(actor, "part.stage_meta", { id: part.id, name: part.partNumber }, `${title}: ${part.partNumber} · ${detail}`);
  revalidatePart(part);
  return OK;
}

// --- A part's files ------------------------------------------------------------------------------

/** The file types any part accepts after it has been requested. */
const LATER_FILE_TYPES = ["STL", "3MF", "STEP", "OBJ", "DICOM", "PDF", "Image", "ZIP"];

export async function addPartFiles(partId: string, formData: FormData): Promise<PartActionResult> {
  const actor = await member();
  const part = await loadPart(actor, partId);
  if (!part) return fail("That part no longer exists.");

  const files = formData.getAll("files").filter(isFile);
  if (files.length === 0) return fail("Choose at least one file.");
  if (files.length > MAX_FILES_PER_FIELD) return fail(`Add at most ${MAX_FILES_PER_FIELD} files at a time.`);
  for (const file of files) {
    if (!fileAllowed(file.name, LATER_FILE_TYPES)) {
      return fail(`"${cleanFileName(file.name)}" is not an accepted file type (${LATER_FILE_TYPES.join(", ")}).`);
    }
    if (file.size > MAX_FILE_BYTES) {
      return fail(`"${cleanFileName(file.name)}" is larger than 25 MB — add it as a download link instead.`);
    }
  }

  const keys: string[] = [];
  try {
    const rows = [];
    for (const file of files) {
      const storageKey = await saveFile(actor.space.id, Buffer.from(await file.arrayBuffer()));
      keys.push(storageKey);
      rows.push({
        spaceId: actor.space.id,
        kind: "print",
        field: "files",
        name: cleanFileName(file.name),
        contentType: file.type || "application/octet-stream",
        size: file.size,
        storageKey,
        uploadedByName: actor.name,
      });
    }
    const names = rows.map((r) => r.name).join(", ");
    await db.part.update({
      where: { id: part.id },
      data: { files: { create: rows }, activity: { create: activity(actor, "Added files", names) } },
    });
    await audit(actor, "part.file_add", { id: part.id, name: part.partNumber }, `Added files to ${part.partNumber}: ${names}`);
  } catch (error) {
    await Promise.all(keys.map((k) => deleteStoredFile(k).catch(() => undefined)));
    console.error("[parts] file upload failed", error instanceof Error ? error.message : error);
    return fail("The files could not be saved. Try again.");
  }
  revalidatePart(part);
  return OK;
}

export async function removePartFile(partId: string, fileId: string): Promise<PartActionResult> {
  const actor = await member();
  const part = await loadPart(actor, partId);
  if (!part) return fail("That part no longer exists.");
  const file = await db.partFile.findFirst({ where: { id: String(fileId), partId: part.id, kind: "print" } });
  if (!file) return fail("That file is no longer attached.");

  await db.$transaction([
    db.partFile.delete({ where: { id: file.id } }),
    db.partActivity.create({ data: { partId: part.id, ...activity(actor, "Removed file", file.name) } }),
  ]);
  await deleteStoredFile(file.storageKey).catch(() => undefined);
  await audit(actor, "part.file_remove", { id: part.id, name: part.partNumber }, `Removed file ${file.name} from ${part.partNumber}`);
  revalidatePart(part);
  return OK;
}

export async function addPartLink(partId: string, link: string): Promise<PartActionResult> {
  const actor = await member();
  const part = await loadPart(actor, partId);
  if (!part) return fail("That part no longer exists.");
  const url = normaliseLink(String(link ?? "").slice(0, 2000));
  if (!url) return fail("Enter a valid link, e.g. https://drive.google.com/…");
  if (part.links.includes(url)) return OK;
  if (part.links.length >= 30) return fail("This part already has 30 links.");

  await db.part.update({
    where: { id: part.id },
    data: { links: { push: url }, activity: { create: activity(actor, "Added download link", url) } },
  });
  await audit(actor, "part.link_add", { id: part.id, name: part.partNumber }, `Added a download link to ${part.partNumber}`);
  revalidatePart(part);
  return OK;
}

export async function removePartLink(partId: string, link: string): Promise<PartActionResult> {
  const actor = await member();
  const part: LoadedPart | null = await loadPart(actor, partId);
  if (!part) return fail("That part no longer exists.");
  if (!part.links.includes(link)) return OK;

  await db.part.update({
    where: { id: part.id },
    data: {
      links: part.links.filter((l) => l !== link),
      activity: { create: activity(actor, "Removed download link", link) },
    },
  });
  await audit(actor, "part.link_remove", { id: part.id, name: part.partNumber }, `Removed a download link from ${part.partNumber}`);
  revalidatePart(part);
  return OK;
}

/**
 * Answer — or change — a part's own request questions on its page: those the
 * form leaves for later, and any text, number, date, choice or tick it asked.
 * Every change is logged on the part.
 */
export async function updatePartDetails(partId: string, answers: Record<string, string>): Promise<PartActionResult> {
  const actor = await member();
  const part = await loadPart(actor, partId);
  if (!part) return fail("That part no longer exists.");
  const locked = infoLockedFor(await partLockStages(part), part.stageIndex, userRoleNames(actor), "part");
  if (locked) return fail(locked);
  const form = await partRequestForm(actor.space, part.requestFormId);
  const fields = form.sections.flatMap((sec) => sec.fields).filter((f) => f.show && !f.key && EDITABLE_ON_PART.includes(f.type));
  const current = partDetails(part);
  const asked = new Set(fields.map((f) => fieldVar(f)).filter(Boolean));
  const next: PartDetail[] = current.filter((d) => !asked.has(d.var));
  const changed: string[] = [];
  const missing: string[] = [];
  for (const f of fields) {
    const name = fieldVar(f);
    if (!name) continue;
    const raw = String(answers?.[f.id] ?? "").trim().slice(0, 4000);
    const value = f.type === "checkbox" ? (raw ? "Yes" : "") : raw;
    if (value) {
      if (f.type === "number" && !Number.isFinite(Number(value.replace(",", ".")))) return fail(`"${f.label}" must be a number.`);
      if (f.type === "date" && !isoDate.safeParse(value).success) return fail(`"${f.label}" must be a date.`);
      if (f.type === "select" && !f.options.includes(value)) return fail(`"${value}" is not one of the choices for "${f.label}".`);
      next.push({ label: f.label, var: name, value });
    } else if (f.req) missing.push(f.label);
    if ((current.find((d) => d.var === name)?.value ?? "") !== value) changed.push(f.label);
  }
  if (missing.length) return fail(`Fill in: ${missing.join(", ")}.`);
  if (changed.length === 0) return OK;
  await db.part.update({ where: { id: part.id }, data: { details: json(next) } });
  await db.partActivity.create({ data: { partId: part.id, ...activity(actor, "Updated request details", changed.join(", ")) } });
  await audit(actor, "part.details", { id: part.id, name: part.partNumber }, `Updated the request details of ${part.partNumber}: ${changed.join(", ")}.`, {
    before: current,
    after: next,
  });
  revalidatePart(part);
  return { ok: true, message: "Details saved" };
}
