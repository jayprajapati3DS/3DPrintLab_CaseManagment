"use server";

import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { recordAudit } from "@/lib/audit";
import { assertSameOrigin } from "@/lib/auth/origin";
import { requireSpaceAdmin, requireSpaceUser } from "@/lib/auth/rbac";
import type { SessionSpace, SessionUser } from "@/lib/auth/session";
import { catalogProblem, PRODUCT_CATEGORIES, type CatalogData } from "@/lib/cases/catalog";
import { db } from "@/lib/db";
import { cleanFileName, deleteStoredFile, MAX_FILE_BYTES, saveFile } from "@/lib/files";
import {
  DOCUMENT_KINDS,
  KINDS,
  NEW_ID,
  QUAL_RESULTS,
  RESOURCE_KINDS,
  STAGE_EMAILS,
  SWATCHES,
  type FieldDef,
  type KindConfig,
  type ResourceKind,
  type WorkflowData,
} from "@/lib/resources/config";
import { getIdRule, usedIds } from "@/lib/resources/id-queries";
import { idRuleSchema, nextId, patternProblem, type IdRule } from "@/lib/resources/ids";
import { iso, listTechnologies, spaceToday, technologyUse } from "@/lib/resources/queries";
import { addMonths } from "@/lib/resources/status";

/**
 * Every change to master data.
 *
 * Two rules hold throughout. A change is made by somebody: each action starts
 * by establishing who, in which space, and refuses a record from any other.
 * And a change leaves a trace: each writes an audit entry naming the record,
 * the person and what changed.
 *
 * Setting data up — creating, editing, archiving — is for a space's admins.
 * Keeping it current — recording a maintenance or a calibration, attaching its
 * report — is for anyone in the space, because the person who did the work is
 * the one who should record it.
 */

export interface ActionResult {
  ok: boolean;
  message?: string;
  /** A record created by this save — the editor moves to it. */
  createdId?: string;
}


type Actor = SessionUser & { space: SessionSpace };

const OK: ActionResult = { ok: true };
const fail = (message: string): ActionResult => ({ ok: false, message });

const kindSchema = z.enum(RESOURCE_KINDS);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const toDate = (value: string) => new Date(`${value}T00:00:00Z`);

async function admin(): Promise<Actor> {
  await assertSameOrigin();
  return requireSpaceAdmin();
}

async function member(): Promise<Actor> {
  await assertSameOrigin();
  return requireSpaceUser();
}

/** The record, if it belongs to the actor's space; archived ones are read-only. */
async function loadResource(actor: Actor, id: string, options: { allowArchived?: boolean } = {}) {
  const resource = await db.resource.findFirst({ where: { id, spaceId: actor.space.id } });
  if (!resource) return null;
  if (resource.archivedAt && !options.allowArchived) return null;
  return resource;
}

function paths(kind: ResourceKind, id?: string) {
  const route = KINDS[kind].route;
  revalidatePath(route);
  if (id) revalidatePath(`${route}/${id}`);
}

function audit(
  actor: Actor,
  action: `resource.${string}` | `schedule.${string}` | `document.${string}` | `stock.${string}` | `setup.${string}`,
  resource: { id: string; kind: string; name: string } | null,
  summary: string,
  extra: { before?: unknown; after?: unknown; entityType?: string; entityName?: string } = {},
) {
  return recordAudit({
    action,
    entityType: extra.entityType ?? resource?.kind ?? "setup",
    entityId: resource?.id ?? null,
    entityName: extra.entityName ?? resource?.name ?? null,
    spaceId: actor.space.id,
    actorId: actor.id,
    actorEmail: actor.email,
    summary,
    before: extra.before,
    after: extra.after,
  });
}

// ---------------------------------------------------------------------------
// Create and edit
// ---------------------------------------------------------------------------

async function defaultData(config: KindConfig, spaceId: string): Promise<Record<string, unknown>> {
  if (config.kind === "workflows") {
    const techs = await listTechnologies(spaceId);
    const workflow: WorkflowData = {
      method: techs[0]?.name ?? "3D Printing",
      sourcing: "In-house",
      vendorId: "",
      stages: [
        { id: randomUUID(), name: "Request received", role: "Manufacturing", days: 1, forms: [], emailsNext: [], emailsBack: [], tasks: [] },
        { id: randomUUID(), name: "Packaging & dispatch", role: "Logistics", days: 1, forms: ["Labelling & packaging check"], emailsNext: [], emailsBack: [], tasks: [] },
      ],
    };
    return { ...workflow };
  }

  const techs = config.fields.some((f) => f.optionsFrom) ? await listTechnologies(spaceId) : [];
  const data: Record<string, unknown> = {};
  for (const field of config.fields) {
    if (field.type === "swatch") data[field.key] = SWATCHES[0];
    else if (field.optionsFrom) data[field.key] = techs[0]?.name ?? "";
    else if (field.type === "select" && field.options && !field.ref) data[field.key] = field.options[0];
    else data[field.key] = "";
  }
  if (config.kind === "materials") data.threshold = "1";
  return data;
}

/**
 * "Add": opens an empty editor. Nothing is stored until it is saved, so an
 * add left without saving leaves no blank record behind.
 */
export async function createResourceAction(formData: FormData): Promise<void> {
  await admin();
  const kind = kindSchema.parse(formData.get("kind"));
  redirect(`${KINDS[kind].route}/${NEW_ID}`);
}

/**
 * What a new record of a kind starts with, before it is saved. It changes
 * nothing, so it needs no origin check — "Add" pages opened from the address
 * bar or a new tab (no Origin or Referer) render it too.
 */
export async function newResourceDraft(kind: ResourceKind): Promise<{ status: string; data: Record<string, unknown> }> {
  const actor = await requireSpaceAdmin();
  const config = KINDS[kind];
  // A new supplier is on trial until it has been evaluated.
  return { status: kind === "vendors" ? "Trial" : (config.statuses[0] ?? ""), data: await defaultData(config, actor.space.id) };
}

/** One field's value from the form, checked against what the field allows. */
function readField(field: FieldDef, raw: FormDataEntryValue | null, allowed: { techs: string[]; refs: Set<string> }): string | null {
  const value = typeof raw === "string" ? raw.trim().slice(0, 500) : "";
  if (value === "") return "";

  switch (field.type) {
    case "number":
      return Number.isFinite(Number(value)) ? value : null;
    case "date":
      return isoDate.safeParse(value).success ? value : null;
    case "swatch":
      return /^#[0-9a-f]{6}$/i.test(value) ? value : null;
    case "select":
      if (field.ref) return allowed.refs.has(value) ? value : null;
      if (field.optionsFrom) return allowed.techs.includes(value) ? value : null;
      return field.options?.includes(value) ? value : null;
    default:
      return value;
  }
}

export async function saveOverviewAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const actor = await admin();
  const creating = String(formData.get("id") ?? "") === NEW_ID;
  let resource: { id: string; kind: string; name: string; status: string; data: Prisma.JsonValue } | null;
  if (creating) {
    const parsedKind = kindSchema.safeParse(formData.get("kind"));
    if (!parsedKind.success) return fail("This kind of record cannot be added here.");
    const draft = await newResourceDraft(parsedKind.data);
    resource = { id: "", kind: parsedKind.data, name: "", status: draft.status, data: draft.data as Prisma.JsonObject };
  } else {
    resource = await loadResource(actor, String(formData.get("id") ?? ""));
  }
  if (!resource) return fail("This record is no longer available.");

  const config = KINDS[resource.kind as ResourceKind];
  const name = String(formData.get("name") ?? "").trim().slice(0, 200);
  if (!name) return fail(`Enter the ${config.nameLabel.toLowerCase()}.`);

  const status = String(formData.get("status") ?? "");
  if (config.statuses.length > 0 && !config.statuses.includes(status)) return fail("Choose a status.");

  const refKinds = [...new Set(config.fields.map((f) => f.ref).filter((k): k is ResourceKind => Boolean(k)))];
  const [techs, refRows] = await Promise.all([
    listTechnologies(actor.space.id),
    refKinds.length
      ? db.resource.findMany({ where: { spaceId: actor.space.id, kind: { in: refKinds } }, select: { id: true } })
      : [],
  ]);
  const allowed = { techs: techs.map((t) => t.name), refs: new Set(refRows.map((r) => r.id)) };

  const before = (resource.data ?? {}) as Record<string, unknown>;
  const data: Record<string, unknown> = { ...before };
  for (const field of config.fields) {
    const value = readField(field, formData.get(`f.${field.key}`), allowed);
    if (value === null) return fail(`"${field.label}" has a value that is not allowed.`);
    data[field.key] = value;
  }

  // The record's ID: typed by hand, or — left blank with automatic IDs on —
  // made from the pattern. Either way no two records of a kind share one.
  let assigned: string | null = null;
  if (config.ids) {
    const idField = config.fields.find((f) => f.key === config.ids!.field);
    const label = idField?.label ?? "ID";
    const others = await usedIds(actor.space.id, resource.kind as ResourceKind, resource.id);
    const typed = String(data[config.ids.field] ?? "").trim();
    if (typed) {
      const clash = others.find((o) => o.value.toUpperCase() === typed.toUpperCase());
      if (clash) return fail(`${label} "${typed}" is already used by ${clash.name || `another ${config.noun}`}.`);
    } else {
      const rule = await getIdRule(actor.space.id, resource.kind as ResourceKind);
      if (rule?.auto) {
        assigned = nextId(rule.pattern, { type: String(data[config.ids.type] ?? ""), now: new Date() }, others.map((o) => o.value));
        if (assigned) data[config.ids.field] = assigned;
      }
    }
  }

  // What changed, by label, for the audit entry — so it reads without the code.
  const changed = config.fields
    .filter((f) => String(before[f.key] ?? "") !== String(data[f.key] ?? ""))
    .map((f) => f.label);
  if (resource.name !== name) changed.unshift(config.nameLabel);
  if (resource.status !== status && config.statuses.length) changed.push(`Status → ${status}`);
  if (creating) {
    const created = await db.resource.create({
      data: { spaceId: actor.space.id, kind: resource.kind, name, status: config.statuses.length ? status : resource.status, data: data as Prisma.InputJsonObject },
    });
    await audit(actor, "resource.create", { ...created, name }, `Added a ${config.noun}.`, { after: { name, status, ...data } });
    paths(resource.kind as ResourceKind, created.id);
    redirect(`${config.route}/${created.id}`);
  }
  if (changed.length === 0) return { ok: true, message: "Nothing to save." };

  await db.resource.update({
    where: { id: resource.id },
    data: { name, status: config.statuses.length ? status : resource.status, data: data as Prisma.InputJsonObject },
  });
  await audit(actor, "resource.update", { ...resource, name }, `Changed ${changed.join(", ")}.`, {
    before: { name: resource.name, status: resource.status, ...before },
    after: { name, status, ...data },
  });

  paths(resource.kind as ResourceKind, resource.id);
  return { ok: true, message: assigned ? `Saved — ${assigned} assigned.` : "Saved." };
}

// ---------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------

/** The next ID for a record, from its kind's pattern and the type chosen on the form. */
export async function suggestIdAction(resourceId: string, type: string, newKind?: string): Promise<ActionResult & { id?: string }> {
  const actor = await admin();
  // A record not saved yet has no row; its kind comes with the request.
  const parsedKind = kindSchema.safeParse(newKind);
  const resource = String(resourceId) === NEW_ID && parsedKind.success ? { id: "", kind: parsedKind.data } : await loadResource(actor, String(resourceId));
  if (!resource) return fail("This record is no longer available.");
  const kind = resource.kind as ResourceKind;
  const rule = await getIdRule(actor.space.id, kind);
  if (!rule) return fail("This kind of record has no ID format.");
  const others = await usedIds(actor.space.id, kind, resource.id);
  const id = nextId(rule.pattern, { type: String(type ?? "").slice(0, 120), now: new Date() }, others.map((o) => o.value));
  return id ? { ok: true, id } : fail("No free ID is left in this format — widen its running part.");
}

/** Save how one kind of record is given its ID. */
export async function saveIdRuleAction(kind: string, rule: IdRule): Promise<ActionResult> {
  const actor = await admin();
  const parsedKind = kindSchema.safeParse(kind);
  if (!parsedKind.success || !KINDS[parsedKind.data].ids) return fail("That kind of record has no ID.");
  const parsed = idRuleSchema.safeParse(rule);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "The ID format is not valid.");
  const problem = patternProblem(parsed.data.pattern);
  if (problem) return fail(problem);

  const row = await db.spaceSetting.findUnique({ where: { spaceId_key: { spaceId: actor.space.id, key: "ids" } } });
  const value = { ...((row?.value ?? {}) as Record<string, unknown>), [parsedKind.data]: parsed.data };
  await db.spaceSetting.upsert({
    where: { spaceId_key: { spaceId: actor.space.id, key: "ids" } },
    create: { spaceId: actor.space.id, key: "ids", value: value as Prisma.InputJsonObject, updatedByName: actor.name },
    update: { value: value as Prisma.InputJsonObject, updatedByName: actor.name },
  });
  const config = KINDS[parsedKind.data];
  await audit(
    actor,
    "setup.id_rule",
    null,
    `Set the ID format of ${config.title.toLowerCase()} to ${parsed.data.pattern} — ${parsed.data.auto ? "assigned automatically when left blank" : "on request only"}.`,
    { entityType: parsedKind.data, entityName: config.title },
  );
  paths(parsedKind.data);
  return { ok: true, message: "ID format saved." };
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

const stageSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1, "Every stage needs a name.").max(120),
  role: z.string().trim().max(300),
  approvers: z.string().trim().max(300).optional(),
  days: z.number().int().min(0).max(365).nullable(),
  forms: z.array(z.string().trim().min(1).max(120)).max(20),
  formsRequired: z.boolean().optional(),
  optionalForms: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  formsFill: z.enum(["stage", "anytime"]).optional(),
  formsOrder: z.enum(["any", "sequence"]).optional(),
  emailsNext: z.array(z.enum(STAGE_EMAILS)).max(10),
  emailsBack: z.array(z.enum(STAGE_EMAILS)).max(10),
  tasks: z
    .array(z.object({ name: z.string().trim().min(1, "Every task needs a name.").max(160), days: z.number().int().min(0).max(365) }))
    .max(30),
  viewers: z.array(z.object({ viewerId: z.string().min(1).max(64), roles: z.string().trim().max(300) })).max(30).optional(),
  lockInfo: z.enum(["stage", "onward"]).optional(),
  lockRoles: z.string().trim().max(300).optional(),
});

const workflowSchema = z.object({
  name: z.string().trim().min(1, "Enter the workflow name.").max(200),
  method: z.string().trim().max(120),
  sourcing: z.enum(["In-house", "Outsourced"]).optional(),
  siteIds: z.array(z.string().min(1).max(64)).max(50).optional(),
  siteId: z.string().max(64).optional(),
  stages: z.array(stageSchema).min(1, "A workflow needs at least one stage.").max(40),
});

export async function saveWorkflowAction(id: string, input: unknown): Promise<ActionResult> {
  const actor = await admin();
  const creating = id === NEW_ID;
  const resource = creating ? null : await loadResource(actor, id);
  if (!creating && (!resource || resource.kind !== "workflows")) return fail("This workflow is no longer available.");

  const parsed = workflowSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the workflow.");
  if (creating && !parsed.data.name.trim()) return fail("Give the workflow a name.");

  const techs = (await listTechnologies(actor.space.id)).map((t) => t.name);
  if (parsed.data.method && !techs.includes(parsed.data.method)) {
    return fail("Choose a manufacturing method from the list.");
  }

  // How its parts are made, and at which sites — one of them the default. An outsourced
  // workflow runs at vendors' sites; an in-house one at the space's own and partners'.
  const sourcing = parsed.data.sourcing ?? "In-house";
  const siteRows = await db.resource.findMany({ where: { spaceId: actor.space.id, kind: "sites", archivedAt: null }, select: { id: true, name: true, data: true } });
  const siteOf = new Map(siteRows.map((x) => [x.id, x]));
  const outside = (id: string) => ((siteOf.get(id)?.data ?? {}) as { type?: string }).type === "External vendor";
  const siteIds = [...new Set(parsed.data.siteIds ?? [])];
  if (siteIds.some((x) => !siteOf.has(x))) return fail("Choose sites from Manufacturing Sites.");
  const wrong = siteIds.find((x) => outside(x) !== (sourcing === "Outsourced"));
  if (wrong) return fail(`${siteOf.get(wrong)!.name} is ${outside(wrong) ? "a vendor's site" : "not a vendor's site"} — ${sourcing === "Outsourced" ? "an outsourced workflow runs at vendors' sites" : "an in-house workflow runs at in-house or partner sites"}.`);
  const siteId = parsed.data.siteId ?? "";
  if (siteId && !siteOf.has(siteId)) return fail("Choose the default site from Manufacturing Sites.");
  if (siteId && siteIds.length && !siteIds.includes(siteId)) return fail("The default site must be one of the workflow's sites.");
  const vendorId = sourcing === "Outsourced" ? String(((siteOf.get(siteId)?.data ?? {}) as { vendorId?: string }).vendorId ?? "") : "";
  const making = { sourcing, siteIds, siteId, vendorId, vendorIds: [] as string[] };

  if (creating || !resource) {
    const draft = (await newResourceDraft("workflows")).data as unknown as WorkflowData;
    const fresh: WorkflowData = { ...draft, ...making, method: parsed.data.method, stages: parsed.data.stages };
    const created = await db.resource.create({
      data: { spaceId: actor.space.id, kind: "workflows", name: parsed.data.name, status: "", data: fresh as unknown as Prisma.InputJsonObject },
    });
    await audit(actor, "resource.create", created, `Added a workflow — ${fresh.stages.length} stage${fresh.stages.length === 1 ? "" : "s"}.`, {
      after: { name: parsed.data.name, ...fresh },
    });
    paths("workflows", created.id);
    return { ok: true, message: "Workflow saved.", createdId: created.id };
  }

  const before = resource.data as unknown as WorkflowData;
  const data: WorkflowData = { ...before, ...(parsed.data.sourcing ? making : {}), method: parsed.data.method, stages: parsed.data.stages };

  await db.resource.update({
    where: { id: resource.id },
    data: { name: parsed.data.name, data: data as unknown as Prisma.InputJsonObject },
  });
  await audit(
    actor,
    "resource.update",
    { ...resource, name: parsed.data.name },
    `Saved the workflow — ${data.stages.length} stage${data.stages.length === 1 ? "" : "s"}.`,
    { before: { name: resource.name, ...before }, after: { name: parsed.data.name, ...data } },
  );

  paths("workflows", resource.id);
  return { ok: true, message: "Workflow saved." };
}

// ---------------------------------------------------------------------------
// Products: like a workflow, with case stages — or sub-scopes, each with its own
// ---------------------------------------------------------------------------

const extrasSchema = {
  imageId: z.string().max(64).default(""),
  viewerIds: z.array(z.string().min(1).max(64)).max(30).default([]),
  protocols: z.array(z.object({ id: z.string().min(1).max(64), name: z.string().max(200), by: z.string().max(200).optional(), at: z.string().max(40).optional() })).max(30).default([]),
};

const productSchema = z.object({
  ...extrasSchema,
  name: z.string().trim().min(1, "Enter the product name.").max(200),
  status: z.enum(["Active", "Inactive"]),
  code: z.string().trim().max(40),
  description: z.string().trim().max(2000),
  category: z.string().max(80).default(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  workflowIds: z.array(z.string().min(1).max(64)).max(40).default([]),
  mode: z.enum(["single", "scopes"]),
  stages: z.array(stageSchema).max(40),
  orderForms: z
    .object({ auto: z.array(z.string().trim().min(1).max(200)).max(30), offered: z.array(z.string().trim().min(1).max(200)).max(60) })
    .default({ auto: [], offered: [] }),
  scopes: z
    .array(
      z.object({
        id: z.string().regex(/^[A-Za-z0-9_-]{3,64}$/),
        name: z.string().trim().max(120),
        code: z.string().trim().max(40),
        description: z.string().trim().max(2000),
        workflowIds: z.array(z.string().min(1).max(64)).max(40).default([]),
        stages: z.array(stageSchema).max(40),
        ...extrasSchema,
      }),
    )
    .max(40),
});

export async function saveProductAction(id: string, input: unknown): Promise<ActionResult> {
  const actor = await admin();
  const creating = id === NEW_ID;
  const resource = creating ? null : await loadResource(actor, id);
  if (!creating && (!resource || resource.kind !== "products")) return fail("This product is no longer available.");

  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the product.");
  const values = parsed.data;
  const data: CatalogData = {
    code: values.code,
    description: values.description,
    category: values.category,
    tags: [...new Set(values.tags)],
    workflowIds: [...new Set(values.workflowIds)],
    mode: values.mode,
    stages: values.mode === "single" ? values.stages : [],
    scopes: values.mode === "scopes" ? values.scopes : [],
    orderForms: { auto: [...new Set(values.orderForms.auto)], offered: [...new Set(values.orderForms.offered)] },
    imageId: values.imageId,
    viewerIds: values.viewerIds,
    protocols: values.protocols,
  };
  const problem = catalogProblem(data);
  if (problem) return fail(problem);

  // Images and protocols are this product's own documents; viewers come from the Viewer list.
  const all = [data, ...data.scopes];
  const fileIds = all.flatMap((x) => [x.imageId, ...x.protocols.map((f) => f.id)]).filter(Boolean);
  if (fileIds.length) {
    const owned = resource ? await db.resourceDocument.count({ where: { id: { in: [...new Set(fileIds)] }, resourceId: resource.id, spaceId: actor.space.id } }) : 0;
    if (owned !== new Set(fileIds).size) return fail("A file is no longer there — upload it again.");
  }
  const viewerIds = [...new Set(all.flatMap((x) => x.viewerIds))];
  if (viewerIds.length) {
    const found = await db.resource.count({ where: { id: { in: viewerIds }, spaceId: actor.space.id, kind: "viewers", archivedAt: null } });
    if (found !== viewerIds.length) return fail("Choose viewers from the Viewer list.");
  }
  if (data.category && !(PRODUCT_CATEGORIES as readonly string[]).includes(data.category)) return fail("Choose a category from the list.");

  const workflows = await db.resource.findMany({ where: { spaceId: actor.space.id, kind: "workflows", archivedAt: null }, select: { id: true } });
  const known = new Set(workflows.map((w) => w.id));
  if ([...data.workflowIds, ...data.scopes.flatMap((sc) => sc.workflowIds)].some((w) => !known.has(w))) return fail("Choose manufacturing workflows from the list.");
  const taken = await db.resource.findFirst({
    where: { spaceId: actor.space.id, kind: "products", archivedAt: null, name: { equals: values.name, mode: "insensitive" }, ...(resource ? { NOT: { id: resource.id } } : {}) },
    select: { id: true },
  });
  if (taken) return fail(`Another product is already called "${values.name}".`);

  // A sub-scope cases were opened for stays: they name it.
  if (resource) {
    const kept = new Set(data.scopes.map((sc) => sc.id));
    const dropped = ((resource.data as Record<string, unknown>)?.scopes as Array<{ id: string; name: string }> | undefined ?? []).filter((sc) => !kept.has(sc.id));
    for (const scope of dropped) {
      const used = await db.caseRecord.count({ where: { spaceId: actor.space.id, subscopeId: scope.id } });
      if (used) return fail(`${used} case${used === 1 ? " was" : "s were"} opened for "${scope.name}" — it cannot be removed.`);
    }
  }

  const summary = data.mode === "scopes" ? `${data.scopes.length} sub-scope${data.scopes.length === 1 ? "" : "s"}` : `${data.stages.length} case stage${data.stages.length === 1 ? "" : "s"}`;
  if (!resource) {
    const created = await db.resource.create({
      data: { spaceId: actor.space.id, kind: "products", name: values.name, status: values.status, data: data as unknown as Prisma.InputJsonObject },
    });
    await audit(actor, "resource.create", created, `Added a product — ${summary}.`, { after: { name: values.name, status: values.status, ...data } });
    paths("products", created.id);
    return { ok: true, message: "Product saved.", createdId: created.id };
  }
  await db.resource.update({
    where: { id: resource.id },
    data: { name: values.name, status: values.status, data: data as unknown as Prisma.InputJsonObject },
  });
  await audit(actor, "resource.update", { ...resource, name: values.name }, `Saved the product — ${summary}.`, {
    before: { name: resource.name, status: resource.status, ...(resource.data as object) },
    after: { name: values.name, status: values.status, ...data },
  });
  paths("products", resource.id);
  return { ok: true, message: "Product saved." };
}

const PRODUCT_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * A product's image or scan protocol, uploaded on its page: kept as one of its
 * documents. It is shown once the product is saved with it.
 */
export async function uploadProductFileAction(formData: FormData): Promise<ActionResult & { file?: { id: string; name: string; by: string; at: string } }> {
  const actor = await admin();
  const resource = await loadResource(actor, String(formData.get("productId") ?? ""));
  if (!resource || resource.kind !== "products") return fail("Save the product first, then add files.");
  const kind = formData.get("kind") === "Photo" ? "Photo" : "Scan protocol";
  const uploaded = await readFiles(formData, "file");
  if ("error" in uploaded) return fail(uploaded.error);
  const file = uploaded.files[0];
  if (!file) return fail("Choose a file.");
  if (kind === "Photo" && !PRODUCT_IMAGE_TYPES.has(file.type)) return fail("Use a JPG, PNG, WebP or GIF image.");
  const storageKey = await saveFile(actor.space.id, Buffer.from(await file.arrayBuffer()));
  const document = await db.resourceDocument.create({
    data: {
      spaceId: actor.space.id,
      resourceId: resource.id,
      name: cleanFileName(file.name),
      kind,
      contentType: file.type || "application/octet-stream",
      size: file.size,
      storageKey,
      uploadedById: actor.id,
      uploadedByName: actor.name,
    },
  });
  await audit(actor, "document.upload", resource, `Uploaded ${kind === "Photo" ? "an image" : "a scan protocol"}: ${document.name}.`);
  return { ok: true, message: "Uploaded — save the product to keep it.", file: { id: document.id, name: document.name, by: actor.name, at: document.createdAt.toISOString() } };
}

// ---------------------------------------------------------------------------
// Archive, restore, and permanent deletion
// ---------------------------------------------------------------------------

export async function archiveResourceAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const actor = await admin();
  const resource = await loadResource(actor, String(formData.get("id") ?? ""));
  if (!resource) return fail("This record is no longer available.");

  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);
  if (!reason) return fail("Give a reason for archiving.");

  await db.resource.update({
    where: { id: resource.id },
    data: { archivedAt: new Date(), archivedById: actor.id, archivedByName: actor.name, archiveReason: reason },
  });
  await audit(actor, "resource.archive", resource, reason);

  const kind = resource.kind as ResourceKind;
  paths(kind, resource.id);
  redirect(`${KINDS[kind].route}?view=archived`);
}

export async function restoreResourceAction(formData: FormData): Promise<void> {
  const actor = await admin();
  const resource = await loadResource(actor, String(formData.get("id") ?? ""), { allowArchived: true });
  if (!resource?.archivedAt) return;

  await db.resource.update({
    where: { id: resource.id },
    data: {
      archivedAt: null,
      archivedById: null,
      archivedByName: null,
      archiveReason: null,
      deletionRequestedAt: null,
      deletionRequestedById: null,
      deletionRequestedByName: null,
      deletionReason: null,
    },
  });
  await audit(actor, "resource.restore", resource, "Returned to the active list.");
  paths(resource.kind as ResourceKind, resource.id);
}

export async function requestDeletionAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const actor = await admin();
  const resource = await loadResource(actor, String(formData.get("id") ?? ""), { allowArchived: true });
  if (!resource?.archivedAt) return fail("Only an archived record can be deleted.");
  if (resource.deletionRequestedAt) return fail("Deletion has already been requested.");

  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);
  if (!reason) return fail("Give a reason for permanent deletion.");

  await db.resource.update({
    where: { id: resource.id },
    data: {
      deletionRequestedAt: new Date(),
      deletionRequestedById: actor.id,
      deletionRequestedByName: actor.name,
      deletionReason: reason,
    },
  });
  await audit(actor, "resource.deletion_request", resource, reason);
  paths(resource.kind as ResourceKind);
  return OK;
}

export async function cancelDeletionAction(formData: FormData): Promise<void> {
  const actor = await admin();
  const resource = await loadResource(actor, String(formData.get("id") ?? ""), { allowArchived: true });
  if (!resource?.deletionRequestedAt) return;

  await db.resource.update({
    where: { id: resource.id },
    data: { deletionRequestedAt: null, deletionRequestedById: null, deletionRequestedByName: null, deletionReason: null },
  });
  await audit(actor, "resource.deletion_cancel", resource, "Permanent deletion request withdrawn.");
  paths(resource.kind as ResourceKind);
}

/**
 * Erase a record for good. The one action here that cannot be undone, so it
 * takes two people: whoever approves must not be whoever asked, and must type
 * the record's name. Both are checked against the signed-in account, not
 * against a name typed into a box.
 */
export async function approveDeletionAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const actor = await admin();
  const resource = await db.resource.findFirst({
    where: { id: String(formData.get("id") ?? ""), spaceId: actor.space.id },
    include: { documents: true, _count: { select: { records: true, scheduleItems: true, lots: true } } },
  });
  if (!resource?.archivedAt || !resource.deletionRequestedAt) {
    return fail("There is no deletion request to approve for this record.");
  }
  if (resource.deletionRequestedById === actor.id) {
    return fail("The approver must be a different person from the requester.");
  }

  const config = KINDS[resource.kind as ResourceKind];
  const expected = resource.name || config.newName;
  if (String(formData.get("confirmName") ?? "").trim() !== expected) {
    return fail("Type the exact record name to confirm.");
  }
  if (formData.get("acknowledge") !== "on") return fail("Tick the confirmation to approve the deletion.");

  const erased = [
    `${resource._count.records} record${resource._count.records === 1 ? "" : "s"}`,
    `${resource.documents.length} document${resource.documents.length === 1 ? "" : "s"}`,
    `${resource._count.scheduleItems} schedule item${resource._count.scheduleItems === 1 ? "" : "s"}`,
    ...(resource._count.lots ? [`${resource._count.lots} lot${resource._count.lots === 1 ? "" : "s"}`] : []),
  ].join(", ");

  // The audit entry first: if anything after it fails, the trail shows an
  // approved deletion that did not complete, rather than a record that vanished.
  await audit(
    actor,
    "resource.delete",
    { ...resource, name: expected },
    `Requested by ${resource.deletionRequestedByName} on ${iso(resource.deletionRequestedAt)} (${resource.deletionReason}) · ` +
      `archived ${iso(resource.archivedAt)} by ${resource.archivedByName} · erased: ${erased}.`,
  );

  await db.resource.delete({ where: { id: resource.id } });
  await Promise.all(resource.documents.map((d) => deleteStoredFile(d.storageKey).catch(() => undefined)));

  paths(resource.kind as ResourceKind);
  return OK;
}

// ---------------------------------------------------------------------------
// Schedules and records
// ---------------------------------------------------------------------------

const trackSchema = z.enum(["maintenance", "qualification"]);

const itemInput = z.object({
  name: z.string().trim().min(1, "Give the item a name.").max(200),
  dueOn: z.union([isoDate, z.literal("")]),
  repeatMonths: z.union([z.coerce.number().int().min(1).max(240), z.literal("")]),
});

function readItem(formData: FormData) {
  return itemInput.safeParse({
    name: formData.get("name"),
    dueOn: String(formData.get("dueOn") ?? ""),
    repeatMonths: String(formData.get("repeatMonths") ?? ""),
  });
}

export async function addScheduleItemAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const actor = await admin();
  const resource = await loadResource(actor, String(formData.get("resourceId") ?? ""));
  if (!resource) return fail("This record is no longer available.");

  const track = trackSchema.safeParse(formData.get("track"));
  const parsed = readItem(formData);
  if (!track.success) return fail("Unknown schedule.");
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the item.");

  await db.scheduleItem.create({
    data: {
      resourceId: resource.id,
      track: track.data,
      name: parsed.data.name,
      dueOn: parsed.data.dueOn ? toDate(parsed.data.dueOn) : null,
      repeatMonths: parsed.data.repeatMonths === "" ? null : parsed.data.repeatMonths,
    },
  });
  await audit(actor, "schedule.item_add", resource, `Added "${parsed.data.name}" to the ${track.data} schedule.`);
  paths(resource.kind as ResourceKind, resource.id);
  return OK;
}

export async function updateScheduleItemAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const actor = await admin();
  const item = await db.scheduleItem.findFirst({
    where: { id: String(formData.get("itemId") ?? ""), resource: { spaceId: actor.space.id, archivedAt: null } },
    include: { resource: true },
  });
  if (!item) return fail("This item is no longer available.");

  const parsed = readItem(formData);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the item.");

  await db.scheduleItem.update({
    where: { id: item.id },
    data: {
      name: parsed.data.name,
      dueOn: parsed.data.dueOn ? toDate(parsed.data.dueOn) : null,
      repeatMonths: parsed.data.repeatMonths === "" ? null : parsed.data.repeatMonths,
    },
  });
  await audit(actor, "schedule.item_update", item.resource, `Changed "${item.name}" on the ${item.track} schedule.`, {
    before: { name: item.name, dueOn: iso(item.dueOn), repeatMonths: item.repeatMonths },
    after: parsed.data,
  });
  paths(item.resource.kind as ResourceKind, item.resourceId);
  return OK;
}

export async function removeScheduleItemAction(formData: FormData): Promise<void> {
  const actor = await admin();
  const item = await db.scheduleItem.findFirst({
    where: { id: String(formData.get("itemId") ?? ""), resource: { spaceId: actor.space.id, archivedAt: null } },
    include: { resource: true },
  });
  if (!item) return;

  // Its records stay: they carry the item's name and are history in their own right.
  await db.scheduleItem.delete({ where: { id: item.id } });
  await audit(actor, "schedule.item_remove", item.resource, `Removed "${item.name}" from the ${item.track} schedule. Its records are kept.`);
  paths(item.resource.kind as ResourceKind, item.resourceId);
}

/** Files from a form, checked. Returns an error message instead of throwing. */
async function readFiles(formData: FormData, field: string): Promise<{ files: File[] } | { error: string }> {
  const files = formData.getAll(field).filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > 10) return { error: "Attach at most 10 files at a time." };
  const tooBig = files.find((f) => f.size > MAX_FILE_BYTES);
  if (tooBig) return { error: `"${tooBig.name}" is larger than 25 MB.` };
  return { files };
}

async function storeDocuments(
  actor: Actor,
  resourceId: string,
  files: File[],
  kind: string,
  recordId: string | null,
): Promise<number> {
  for (const file of files) {
    const storageKey = await saveFile(actor.space.id, Buffer.from(await file.arrayBuffer()));
    await db.resourceDocument.create({
      data: {
        spaceId: actor.space.id,
        resourceId,
        recordId,
        name: cleanFileName(file.name),
        kind,
        contentType: file.type || "application/octet-stream",
        size: file.size,
        storageKey,
        uploadedById: actor.id,
        uploadedByName: actor.name,
      },
    });
  }
  return files.length;
}

const recordInput = z.object({
  doneOn: isoDate,
  doneBy: z.string().trim().min(1, "Say who did it.").max(200),
  result: z.union([z.enum(QUAL_RESULTS), z.literal("")]),
  ref: z.string().trim().max(200),
  note: z.string().trim().max(2000),
});

/**
 * Record that a scheduled item was done. This is what moves its due date on,
 * and it is the only thing that does.
 */
export async function recordScheduleItemAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const actor = await member();
  const item = await db.scheduleItem.findFirst({
    where: { id: String(formData.get("itemId") ?? ""), resource: { spaceId: actor.space.id, archivedAt: null } },
    include: { resource: true },
  });
  if (!item) return fail("This item is no longer available.");

  const parsed = recordInput.safeParse({
    doneOn: formData.get("doneOn"),
    doneBy: formData.get("doneBy"),
    result: String(formData.get("result") ?? ""),
    ref: String(formData.get("ref") ?? ""),
    note: String(formData.get("note") ?? ""),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(issue?.path[0] === "doneOn" ? "Enter the date it was done." : (issue?.message ?? "Check the record."));
  }
  if (parsed.data.doneOn > (await spaceToday(actor.space.id))) {
    return fail("The date it was done cannot be in the future.");
  }

  const uploaded = await readFiles(formData, "files");
  if ("error" in uploaded) return fail(uploaded.error);

  const isQual = item.track === "qualification";
  const result = isQual ? parsed.data.result || "Pass" : null;
  const affectsValidation = !isQual && formData.get("affectsValidation") === "yes";
  const nextDue = item.repeatMonths ? addMonths(parsed.data.doneOn, item.repeatMonths) : null;

  const record = await db.$transaction(async (tx) => {
    const created = await tx.scheduleRecord.create({
      data: {
        resourceId: item.resourceId,
        itemId: item.id,
        track: item.track,
        itemName: item.name,
        doneOn: toDate(parsed.data.doneOn),
        doneBy: parsed.data.doneBy,
        result,
        ref: parsed.data.ref || null,
        note: parsed.data.note || null,
        affectsValidation,
        recordedById: actor.id,
        recordedByName: actor.name,
      },
    });
    await tx.scheduleItem.update({
      where: { id: item.id },
      data: { lastDoneOn: toDate(parsed.data.doneOn), lastResult: result, dueOn: nextDue ? toDate(nextDue) : null },
    });
    return created;
  });

  const count = await storeDocuments(
    actor,
    item.resourceId,
    uploaded.files,
    isQual ? "Qualification report" : "Maintenance record",
    record.id,
  );

  await audit(
    actor,
    isQual ? "schedule.qualification_record" : "schedule.maintenance_record",
    item.resource,
    [
      `${item.name} done on ${parsed.data.doneOn} by ${parsed.data.doneBy}`,
      result,
      parsed.data.ref,
      `${count} document${count === 1 ? "" : "s"}`,
      nextDue ? `next due ${nextDue}` : "one-time",
      affectsValidation ? "change-control review opened" : "",
    ]
      .filter(Boolean)
      .join(" · "),
  );

  paths(item.resource.kind as ResourceKind, item.resourceId);
  return { ok: true, message: nextDue ? `Recorded. Next due ${nextDue}.` : "Recorded." };
}

const REVIEW_OUTCOMES = ["No impact on validated state", "Requalification required"] as const;

/** Close a change-control review opened by a maintenance record. */
export async function reviewChangeControlAction(formData: FormData): Promise<void> {
  const actor = await admin();
  const outcome = z.enum(REVIEW_OUTCOMES).safeParse(formData.get("outcome"));
  const record = await db.scheduleRecord.findFirst({
    where: {
      id: String(formData.get("recordId") ?? ""),
      affectsValidation: true,
      reviewOutcome: null,
      resource: { spaceId: actor.space.id, archivedAt: null },
    },
    include: { resource: true },
  });
  if (!record || !outcome.success) return;

  await db.scheduleRecord.update({
    where: { id: record.id },
    data: { reviewOutcome: outcome.data, reviewedByName: actor.name, reviewedAt: new Date() },
  });
  await audit(
    actor,
    "schedule.change_control_review",
    record.resource,
    `Change control closed — ${outcome.data} (${record.itemName} on ${iso(record.doneOn)}).`,
  );
  paths(record.resource.kind as ResourceKind, record.resourceId);
}

// ---------------------------------------------------------------------------
// Documents and photos
// ---------------------------------------------------------------------------

export async function uploadDocumentsAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const actor = await member();
  const resource = await loadResource(actor, String(formData.get("resourceId") ?? ""));
  if (!resource) return fail("This record is no longer available.");

  const kind = z.enum(DOCUMENT_KINDS).safeParse(formData.get("kind"));
  if (!kind.success) return fail("Choose what kind of document this is.");

  const uploaded = await readFiles(formData, "files");
  if ("error" in uploaded) return fail(uploaded.error);
  if (uploaded.files.length === 0) return fail("Choose at least one file.");

  const count = await storeDocuments(actor, resource.id, uploaded.files, kind.data, null);
  await audit(
    actor,
    "document.upload",
    resource,
    `Uploaded ${count} ${kind.data.toLowerCase()} document${count === 1 ? "" : "s"}: ${uploaded.files.map((f) => cleanFileName(f.name)).join(", ")}.`,
  );
  paths(resource.kind as ResourceKind, resource.id);
  return { ok: true, message: `${count} file${count === 1 ? "" : "s"} uploaded.` };
}

export async function removeDocumentAction(formData: FormData): Promise<void> {
  const actor = await admin();
  const document = await db.resourceDocument.findFirst({
    where: { id: String(formData.get("documentId") ?? ""), spaceId: actor.space.id, resource: { archivedAt: null } },
    include: { resource: true },
  });
  // Evidence attached to a record is part of that record and stays with it.
  if (!document || document.recordId || document.kind === "Photo") return;

  await db.resourceDocument.delete({ where: { id: document.id } });
  await deleteStoredFile(document.storageKey).catch(() => undefined);
  await audit(actor, "document.remove", document.resource, `Removed ${document.kind.toLowerCase()} document "${document.name}".`);
  paths(document.resource.kind as ResourceKind, document.resourceId);
}

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const LOGO_TYPES = new Set(["image/jpeg", "image/png", "image/svg+xml"]);

export async function setPhotoAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const actor = await admin();
  const resource = await loadResource(actor, String(formData.get("resourceId") ?? ""));
  if (!resource || !KINDS[resource.kind as ResourceKind].photo) return fail("This record has no photo.");

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return fail("Choose a photo.");
  // A logo may also be an SVG; it is served so that it can never run as a page (api/files).
  const logo = KINDS[resource.kind as ResourceKind].photoWord === "logo";
  if (logo ? !LOGO_TYPES.has(file.type) : !PHOTO_TYPES.has(file.type)) return fail(logo ? "Use a JPG, PNG or SVG image." : "Use a JPG, PNG or WebP image.");
  if (file.size > 4 * 1024 * 1024) return fail("That photo is larger than 4 MB.");

  const previous = resource.imageId
    ? await db.resourceDocument.findUnique({ where: { id: resource.imageId } })
    : null;

  const storageKey = await saveFile(actor.space.id, Buffer.from(await file.arrayBuffer()));
  const photo = await db.resourceDocument.create({
    data: {
      spaceId: actor.space.id,
      resourceId: resource.id,
      name: cleanFileName(file.name),
      kind: "Photo",
      contentType: file.type,
      size: file.size,
      storageKey,
      uploadedById: actor.id,
      uploadedByName: actor.name,
    },
  });
  await db.resource.update({ where: { id: resource.id }, data: { imageId: photo.id } });

  if (previous) {
    await db.resourceDocument.delete({ where: { id: previous.id } }).catch(() => undefined);
    await deleteStoredFile(previous.storageKey).catch(() => undefined);
  }

  await audit(actor, "document.photo", resource, previous ? "Replaced the photo." : "Added a photo.");
  paths(resource.kind as ResourceKind, resource.id);
  return OK;
}

export async function removePhotoAction(formData: FormData): Promise<void> {
  const actor = await admin();
  const resource = await loadResource(actor, String(formData.get("resourceId") ?? ""));
  if (!resource?.imageId) return;

  const photo = await db.resourceDocument.findUnique({ where: { id: resource.imageId } });
  await db.resource.update({ where: { id: resource.id }, data: { imageId: null } });
  if (photo) {
    await db.resourceDocument.delete({ where: { id: photo.id } }).catch(() => undefined);
    await deleteStoredFile(photo.storageKey).catch(() => undefined);
  }
  await audit(actor, "document.photo", resource, "Removed the photo.");
  paths(resource.kind as ResourceKind, resource.id);
}

// ---------------------------------------------------------------------------
// Lots and stock — materials, standard components and packaging
// ---------------------------------------------------------------------------

/** The kinds whose stock is kept in lots. */
const LOT_KINDS = new Set(["materials", "components", "packaging"]);
const unitOf = (resource: { kind: string; data: unknown }) =>
  resource.kind === "materials" ? String(((resource.data ?? {}) as Record<string, unknown>).unit ?? "") : "pcs";

const lotInput = z.object({
  lotNumber: z.string().trim().min(1, "Enter the lot / batch number.").max(120),
  supplierLot: z.string().trim().max(120),
  received: z.coerce.number().positive("Enter the quantity on hand.").max(1_000_000),
  receivedOn: z.union([isoDate, z.literal("")]),
  supplierId: z.string().trim().max(60),
  coa: z.string().trim().max(200),
  expiresOn: z.union([isoDate, z.literal("")]),
});

/**
 * Opening stock: a lot already on the shelf when the space starts using the
 * system. Deliveries come in through Goods Receipt, with incoming inspection;
 * this is only for what was there before. Admins only, and marked as such in
 * the lot register ("Released (before GRN)").
 */
export async function addLotAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const actor = await admin();
  const resource = await loadResource(actor, String(formData.get("resourceId") ?? ""));
  if (!resource || !LOT_KINDS.has(resource.kind)) return fail("This item is no longer available.");

  const parsed = lotInput.safeParse({
    lotNumber: formData.get("lotNumber"),
    supplierLot: String(formData.get("supplierLot") ?? ""),
    received: formData.get("received"),
    receivedOn: String(formData.get("receivedOn") ?? ""),
    supplierId: String(formData.get("supplierId") ?? ""),
    coa: String(formData.get("coa") ?? ""),
    expiresOn: String(formData.get("expiresOn") ?? ""),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the lot.");

  const duplicate = await db.materialLot.findFirst({
    where: { resourceId: resource.id, lotNumber: { equals: parsed.data.lotNumber, mode: "insensitive" } },
  });
  if (duplicate) return fail("This item already has a lot with that number.");

  // The supplier is a record on the approved list, not a typed name.
  const supplier = parsed.data.supplierId
    ? await db.resource.findFirst({ where: { id: parsed.data.supplierId, spaceId: actor.space.id, kind: "vendors" } })
    : null;
  if (parsed.data.supplierId && !supplier) return fail("Choose the supplier from the list.");

  const unit = unitOf(resource);
  await db.materialLot.create({
    data: {
      resourceId: resource.id,
      lotNumber: parsed.data.lotNumber,
      supplierLot: parsed.data.supplierLot || null,
      received: parsed.data.received,
      remaining: parsed.data.received,
      receivedOn: parsed.data.receivedOn ? toDate(parsed.data.receivedOn) : null,
      supplier: supplier?.name ?? null,
      supplierId: supplier?.id ?? null,
      coa: parsed.data.coa || null,
      expiresOn: parsed.data.expiresOn ? toDate(parsed.data.expiresOn) : null,
    },
  });
  await audit(
    actor,
    "stock.lot_receive",
    resource,
    `Opening stock: lot ${parsed.data.lotNumber} — ${parsed.data.received} ${unit}${supplier ? ` from ${supplier.name}` : ""} (before goods receipt).`,
  );
  paths(resource.kind as ResourceKind, resource.id);
  return OK;
}

/** Correct a lot's stock, with a reason. The only way stock changes by hand. */
export async function adjustLotAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const actor = await member();
  const lot = await db.materialLot.findFirst({
    where: { id: String(formData.get("lotId") ?? ""), resource: { spaceId: actor.space.id, archivedAt: null } },
    include: { resource: true },
  });
  if (!lot) return fail("This lot is no longer available.");

  const quantity = Number(String(formData.get("quantity") ?? "").trim());
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 300);
  if (!Number.isFinite(quantity) || quantity === 0 || !reason) {
    return fail("Enter a +/− quantity and a reason.");
  }

  const remaining = Math.max(0, Math.round((Number(lot.remaining) + quantity) * 1000) / 1000);
  await db.$transaction([
    db.materialLot.update({ where: { id: lot.id }, data: { remaining } }),
    db.lotAdjustment.create({
      data: { lotId: lot.id, quantity, reason, byId: actor.id, byName: actor.name },
    }),
  ]);

  const unit = unitOf(lot.resource);
  await audit(
    actor,
    "stock.adjust",
    lot.resource,
    `Lot ${lot.lotNumber}: ${quantity > 0 ? "+" : ""}${quantity} ${unit} · ${reason} · ${remaining} ${unit} left.`,
  );
  paths(lot.resource.kind as ResourceKind, lot.resourceId);
  return { ok: true, message: "Stock adjusted — logged in the audit trail." };
}

export async function removeLotAction(formData: FormData): Promise<void> {
  const actor = await admin();
  const lot = await db.materialLot.findFirst({
    where: { id: String(formData.get("lotId") ?? ""), resource: { spaceId: actor.space.id, archivedAt: null } },
    include: { resource: true, _count: { select: { adjustments: true } } },
  });
  // A lot that has been drawn from or adjusted is history, not a typing mistake;
  // one that came in on a goods receipt belongs to that receipt.
  if (!lot || lot.grnId || lot._count.adjustments > 0 || Number(lot.remaining) !== Number(lot.received)) return;

  await db.materialLot.delete({ where: { id: lot.id } });
  await audit(actor, "stock.lot_remove", lot.resource, `Removed lot ${lot.lotNumber} (entered in error, untouched).`);
  paths(lot.resource.kind as ResourceKind, lot.resourceId);
}

// ---------------------------------------------------------------------------
// Technologies and part types
// ---------------------------------------------------------------------------

export async function addTechnologyAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const actor = await admin();
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (!name) return fail("Enter a technology name.");

  const existing = await db.technology.findFirst({
    where: { spaceId: actor.space.id, name: { equals: name, mode: "insensitive" } },
  });
  if (existing) return fail("That technology already exists.");

  await db.technology.create({ data: { spaceId: actor.space.id, name } });
  await audit(actor, "setup.technology_add", null, `Added technology "${name}".`, { entityType: "tech", entityName: name });
  revalidatePath("/tech");
  return OK;
}

export async function removeTechnologyAction(formData: FormData): Promise<void> {
  const actor = await admin();
  const technology = await db.technology.findFirst({
    where: { id: String(formData.get("id") ?? ""), spaceId: actor.space.id },
  });
  if (!technology) return;

  const uses = await technologyUse(actor.space.id, technology.name);
  if (uses.workflows + uses.printers + uses.materials > 0) return;

  await db.technology.delete({ where: { id: technology.id } });
  await audit(actor, "setup.technology_remove", null, `Removed technology "${technology.name}".`, {
    entityType: "tech",
    entityName: technology.name,
  });
  revalidatePath("/tech");
}

const partTypeInput = z.object({
  name: z.string().trim().min(1, "Enter a part type.").max(80),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,6}$/, "A code is 1–6 letters or digits."),
});

export async function addPartTypeAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const actor = await admin();
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (!name) return fail("Enter a part type.");

  const existing = await db.partType.findFirst({
    where: { spaceId: actor.space.id, name: { equals: name, mode: "insensitive" } },
  });
  if (existing) return fail("That part type already exists.");

  // The code starts as the first three letters, as in the design.
  const code = name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 3).toUpperCase() || "PRT";
  await db.partType.create({ data: { spaceId: actor.space.id, name, code } });
  await audit(actor, "setup.part_type_add", null, `Added part type "${name}" (${code}).`, { entityType: "parttypes", entityName: name });
  revalidatePath("/parttypes");
  return OK;
}

export async function updatePartTypeAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  const actor = await admin();
  const partType = await db.partType.findFirst({
    where: { id: String(formData.get("id") ?? ""), spaceId: actor.space.id },
  });
  if (!partType) return fail("This part type is no longer available.");

  const parsed = partTypeInput.safeParse({ name: formData.get("name"), code: formData.get("code") });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the part type.");

  const clash = await db.partType.findFirst({
    where: { spaceId: actor.space.id, id: { not: partType.id }, name: { equals: parsed.data.name, mode: "insensitive" } },
  });
  if (clash) return fail("Another part type already has that name.");

  await db.partType.update({ where: { id: partType.id }, data: parsed.data });
  await audit(actor, "setup.part_type_update", null, `Changed part type "${partType.name}" (${partType.code}) to "${parsed.data.name}" (${parsed.data.code}).`, {
    entityType: "parttypes",
    entityName: parsed.data.name,
  });
  revalidatePath("/parttypes");
  return { ok: true, message: "Saved." };
}

export async function removePartTypeAction(formData: FormData): Promise<void> {
  const actor = await admin();
  const partType = await db.partType.findFirst({
    where: { id: String(formData.get("id") ?? ""), spaceId: actor.space.id },
  });
  if (!partType) return;

  await db.partType.delete({ where: { id: partType.id } });
  await audit(actor, "setup.part_type_remove", null, `Removed part type "${partType.name}".`, {
    entityType: "parttypes",
    entityName: partType.name,
  });
  revalidatePath("/parttypes");
}

// ---------------------------------------------------------------------------
// Hospitals: departments, and the people who work there
// ---------------------------------------------------------------------------

const teamSchema = z.object({
  departments: z
    .array(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{3,64}$/), name: z.string().trim().min(1, "Every department needs a name.").max(120), personIds: z.array(z.string().min(1).max(64)).max(200) }))
    .max(60),
  personIds: z.array(z.string().min(1).max(64)).max(500),
});

/**
 * A hospital's departments and its people: who works there (their hospitals,
 * as Users & Roles keeps them) and, within it, in which departments.
 */
export async function saveHospitalTeam(hospitalId: string, input: unknown): Promise<ActionResult> {
  const actor = await admin();
  const resource = await loadResource(actor, hospitalId);
  if (!resource || resource.kind !== "hospitals") return fail("This hospital is no longer available.");
  const parsed = teamSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the departments.");
  const names = parsed.data.departments.map((d) => d.name.toLowerCase());
  if (new Set(names).size !== names.length) return fail("Two departments have the same name.");

  const people = await db.user.findMany({ where: { spaceId: actor.space.id, isActive: true }, select: { id: true, hospitalIds: true } });
  const known = new Set(people.map((p) => p.id));
  const here = new Set(parsed.data.personIds.filter((id) => known.has(id)));
  // Someone in a department works at the hospital.
  for (const d of parsed.data.departments) for (const id of d.personIds) if (known.has(id)) here.add(id);
  const departments = parsed.data.departments.map((d) => ({ ...d, personIds: d.personIds.filter((id) => here.has(id)) }));

  await db.resource.update({
    where: { id: resource.id },
    data: { data: { ...((resource.data ?? {}) as object), departments } as Prisma.InputJsonObject },
  });
  for (const p of people) {
    const has = p.hospitalIds.includes(resource.id);
    if (here.has(p.id) && !has) await db.user.update({ where: { id: p.id }, data: { hospitalIds: [...p.hospitalIds, resource.id] } });
    if (!here.has(p.id) && has) await db.user.update({ where: { id: p.id }, data: { hospitalIds: p.hospitalIds.filter((h) => h !== resource.id) } });
  }
  await audit(actor, "resource.update", resource, `Saved the departments and people of ${resource.name} — ${departments.length} department${departments.length === 1 ? "" : "s"}, ${here.size} ${here.size === 1 ? "person" : "people"}.`);
  paths("hospitals", resource.id);
  revalidatePath("/users");
  return { ok: true, message: "Saved." };
}
