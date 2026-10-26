import "server-only";

import { Prisma } from "@prisma/client";

import { readCatalog, workflowsFor } from "@/lib/cases/catalog";
import { db } from "@/lib/db";
import {
  defaultForms,
  setupSchema,
  type IdRule,
  type Inspection,
  type PartDetail,
  type RequestFormDef,
  type RequestSection,
  type RequestSetup,
} from "@/lib/parts/request-form";
import type { WorkflowData, WorkflowStage } from "@/lib/resources/config";
import type { SiteOption } from "@/lib/parts/request-form";

export { sitesFor, type SiteOption } from "@/lib/parts/request-form";

/**
 * Reading parts, and everything a part request is built from.
 */

// --- Part request setup ------------------------------------------------------------

export interface LoadedSetup extends RequestSetup {
  /** Every active request form; `sections` are the default one's. */
  forms: RequestFormDef[];
  /** False until someone saves the setup: the defaults are in use. */
  saved: boolean;
  updatedAt: Date | null;
  updatedByName: string | null;
}

const sectionsSchema = setupSchema.shape.sections;

/**
 * A form's sections, read through the schema that saved them, so a row
 * written by an older version cannot put a malformed form on screen.
 */
function readSections(raw: unknown): RequestSection[] | null {
  const parsed = sectionsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const sections = parsed.data as RequestSection[];
  // The case and the workflow were once locked, required fields; a form saved
  // then keeps them but is no longer held to them. A workflow saved as locked
  // becomes optional, as it now is by default.
  for (const field of sections.flatMap((sec) => sec.fields)) {
    if (field.key === "case") field.locked = false;
    if (field.key === "workflow" && field.locked) {
      field.locked = false;
      field.req = false;
    }
  }
  return sections;
}

const toForm = (row: { id: string; name: string; description: string; isDefault: boolean; sections: Prisma.JsonValue }): RequestFormDef | null => {
  const sections = readSections(row.sections);
  return sections ? { id: row.id, name: row.name, description: row.description, isDefault: row.isDefault, sections } : null;
};

export async function getRequestSetup(space: { id: string; name: string }): Promise<LoadedSetup> {
  const [row, formRows] = await Promise.all([
    db.partRequestSetup.findUnique({ where: { spaceId: space.id } }),
    db.partRequestForm.findMany({ where: { spaceId: space.id, archivedAt: null }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
  ]);
  const defaults = defaultForms(space.id, space.name);
  const forms = formRows.map(toForm).filter((f): f is RequestFormDef => Boolean(f));
  if (forms.length && !forms.some((f) => f.isDefault)) forms[0].isDefault = true;
  const usable = forms.length ? forms : defaults.forms;
  const sections = (usable.find((f) => f.isDefault) ?? usable[0]).sections;

  if (!row) return { rule: defaults.rule, sections, forms: usable, saved: false, updatedAt: null, updatedByName: null };
  const rule = setupSchema.shape.rule.safeParse({ prefix: row.idPrefix, sep: row.idSeparator, tokens: row.idTokens, scope: row.idScope, width: row.idWidth });
  return {
    rule: rule.success ? (rule.data as IdRule) : defaults.rule,
    sections,
    forms: usable,
    saved: rule.success && forms.length > 0,
    updatedAt: row.updatedAt,
    updatedByName: row.updatedByName,
  };
}

/** A request form as the setup list shows it. */
export interface RequestFormSummary {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  sections: number;
  fields: number;
  /** Parts requested with it. */
  parts: number;
  updatedAt: Date | null;
  updatedByName: string | null;
}

export async function requestFormSummaries(space: { id: string; name: string }): Promise<RequestFormSummary[]> {
  const [setup, rows, counts] = await Promise.all([
    getRequestSetup(space),
    db.partRequestForm.findMany({ where: { spaceId: space.id, archivedAt: null }, select: { id: true, updatedAt: true, updatedByName: true } }),
    db.part.groupBy({ by: ["requestFormId"], where: { spaceId: space.id }, _count: { _all: true } }),
  ]);
  const meta = new Map(rows.map((r) => [r.id, r]));
  const used = new Map(counts.map((c) => [c.requestFormId, c._count._all]));
  return setup.forms.map((f) => ({
    id: f.id,
    name: f.name,
    description: f.description,
    isDefault: f.isDefault,
    sections: f.sections.length,
    fields: f.sections.reduce((n, sec) => n + sec.fields.filter((x) => x.show).length, 0),
    parts: used.get(f.id) ?? 0,
    updatedAt: meta.get(f.id)?.updatedAt ?? null,
    updatedByName: meta.get(f.id)?.updatedByName ?? null,
  }));
}

/**
 * The form a part was requested with — archived or not — so its Part info
 * shows what was asked; the space's default for a part from before forms
 * could be chosen.
 */
export async function partRequestForm(space: { id: string; name: string }, formId: string | null): Promise<RequestFormDef> {
  if (formId) {
    const row = await db.partRequestForm.findFirst({ where: { id: formId, spaceId: space.id } });
    const form = row ? toForm(row) : null;
    if (form) return form;
  }
  const setup = await getRequestSetup(space);
  return setup.forms.find((f) => f.isDefault) ?? setup.forms[0];
}

// --- Starting a request from an earlier part ------------------------------------------

/**
 * What an earlier part was requested with, to fill a new request from. The
 * case, the due date and anything stored as a file (print files, the product
 * image, drawings) belong to that part and are not offered; download links
 * and the characteristics of its balloon table are.
 */
export interface RequestCopy {
  partNumber: string;
  /** The form it was requested with — the new request opens on the same one. */
  requestFormId: string | null;
  name: string;
  partType: string | null;
  quantity: number;
  workflowId: string | null;
  material: string | null;
  printer: string | null;
  sourcing: string;
  vendor: string | null;
  priority: string | null;
  notes: string | null;
  details: PartDetail[];
  links: string[];
  /** Balloon table rows: balloon ID and the values by column id. */
  balloonRows: Array<{ balloon: string; vals: Record<string, string> }>;
}

/** What a part was requested with, for a new request to start from — see RequestCopy. */
export async function requestCopy(spaceId: string, partId: string): Promise<RequestCopy | null> {
  const part = await db.part.findFirst({ where: { id: partId, spaceId } });
  if (!part) return null;
  const inspection = part.inspection as unknown as Partial<Inspection> | null;
  return {
    partNumber: part.partNumber,
    requestFormId: part.requestFormId,
    name: part.name,
    partType: part.partType,
    quantity: part.quantity,
    workflowId: part.workflowId,
    material: part.material,
    printer: part.printer,
    sourcing: part.sourcing,
    vendor: part.vendor,
    priority: part.priority,
    notes: part.notes,
    details: Array.isArray(part.details) ? (part.details as unknown as PartDetail[]) : [],
    links: part.links,
    balloonRows: (inspection?.rows ?? []).map((r) => ({ balloon: r.balloon, vals: r.vals ?? {} })),
  };
}

// --- Choices offered by the request form --------------------------------------------

export interface WorkflowOption {
  id: string;
  name: string;
  technology: string;
  sourcing: "In-house" | "Outsourced";
  /** Outsourced: its default site's vendor (by name). */
  vendor: string;
  /** The sites it runs at (ids); none = any that fits how it is made. */
  sites: string[];
  /** The site a request starts with (id), or "". */
  site: string;
  stages: number;
}

export interface RequestOptions {
  workflows: WorkflowOption[];
  partTypes: Array<{ name: string; code: string }>;
  materials: string[];
  printers: string[];
  vendors: string[];
  sites: SiteOption[];
}


export async function requestOptions(spaceId: string): Promise<RequestOptions> {
  const [resources, partTypes] = await Promise.all([
    db.resource.findMany({
      where: { spaceId, archivedAt: null, kind: { in: ["workflows", "materials", "printers", "vendors", "sites"] } },
      select: { id: true, kind: true, name: true, status: true, data: true },
      orderBy: { name: "asc" },
    }),
    db.partType.findMany({ where: { spaceId }, orderBy: { createdAt: "asc" } }),
  ]);

  // A record is created blank and named afterwards; one left unnamed cannot be
  // chosen (and would give two dropdown entries the same empty key).
  const named = resources.filter((r) => r.name.trim() !== "");
  const names = (kind: string) => named.filter((r) => r.kind === kind).map((r) => r.name);
  const vendorById = new Map(resources.filter((r) => r.kind === "vendors").map((r) => [r.id, r.name]));

  return {
    workflows: named
      .filter((r) => r.kind === "workflows")
      .map((r): WorkflowOption => {
        const data = (r.data ?? {}) as Partial<WorkflowData>;
        return {
          id: r.id,
          name: r.name,
          technology: data.method ?? "",
          sourcing: data.sourcing === "Outsourced" ? "Outsourced" : "In-house",
          vendor: (data.vendorId && vendorById.get(data.vendorId)) || "",
          sites: data.siteIds ?? [],
          site: data.siteId ?? "",
          stages: Array.isArray(data.stages) ? data.stages.length : 0,
        };
      })
      // A workflow without stages has nowhere for a part to go.
      .filter((w) => w.stages > 0),
    partTypes: partTypes.map((t) => ({ name: t.name, code: t.code })),
    materials: names("materials"),
    printers: names("printers"),
    vendors: names("vendors"),
    sites: named
      .filter((r) => r.kind === "sites" && r.status !== "Suspended")
      .map((r) => {
        const d = (r.data ?? {}) as { type?: string; vendorId?: string };
        return { id: r.id, name: r.name, type: d.type || "In-house", vendor: (d.vendorId && vendorById.get(d.vendorId)) || "" };
      }),
  };
}

/**
 * Whether a part's quality forms at a stage must be approved before it moves
 * on. The workflow's setting as it is now decides — matched by the stage's id,
 * then its name — so switching it applies to parts already on the way; a part
 * whose workflow is gone goes by its own copy of the stages. Yes when unset.
 */
export async function formsRequiredAt(part: { spaceId: string; workflowId: string | null; stages: Prisma.JsonValue }, index: number): Promise<boolean> {
  const own = partStages(part)[index];
  if (!own) return true;
  const workflow = part.workflowId
    ? await db.resource.findFirst({ where: { id: part.workflowId, spaceId: part.spaceId, kind: "workflows" }, select: { data: true } })
    : null;
  const live = ((workflow?.data as { stages?: WorkflowStage[] } | null)?.stages ?? []) as WorkflowStage[];
  const match = live.find((s) => s.id === own.id) ?? live.find((s) => s.name.trim().toLowerCase() === own.name.trim().toLowerCase());
  return (match ?? own).formsRequired !== false;
}

/** The forms of a part's stage that need not be approved for it to move on — as the workflow says now. */
export async function optionalFormsAt(part: { spaceId: string; workflowId: string | null; stages: Prisma.JsonValue }, index: number): Promise<WorkflowStage | undefined> {
  const own = partStages(part)[index];
  if (!own) return undefined;
  const workflow = part.workflowId
    ? await db.resource.findFirst({ where: { id: part.workflowId, spaceId: part.spaceId, kind: "workflows" }, select: { data: true } })
    : null;
  const live = ((workflow?.data as { stages?: WorkflowStage[] } | null)?.stages ?? []) as WorkflowStage[];
  return live.find((s) => s.id === own.id) ?? live.find((s) => s.name.trim().toLowerCase() === own.name.trim().toLowerCase()) ?? own;
}

export interface CaseChoice {
  id: string;
  number: string;
  product: string;
  scope: string;
  surgeon: string;
  /** The production workflows its product (or sub-scope) allows — null: any. */
  workflowIds: string[] | null;
}

const CASE_CHOICE = {
  id: true,
  caseNumber: true,
  platformCaseId: true,
  productName: true,
  scopeName: true,
  surgeonName: true,
  productId: true,
  subscopeId: true,
} satisfies Prisma.CaseRecordSelect;

async function toChoices(spaceId: string, rows: Array<Prisma.CaseRecordGetPayload<{ select: typeof CASE_CHOICE }>>): Promise<CaseChoice[]> {
  // A case opened for a product that names its workflows offers only those for its parts.
  const productIds = [...new Set(rows.map((r) => r.productId).filter((id): id is string => Boolean(id)))];
  const products = productIds.length ? await db.resource.findMany({ where: { spaceId, id: { in: productIds }, kind: "products" }, select: { id: true, data: true } }) : [];
  const catalog = new Map(products.map((p) => [p.id, readCatalog(p.data)]));
  return rows.map((row) => {
    const product = row.productId ? catalog.get(row.productId) : undefined;
    return {
      id: row.id,
      number: row.caseNumber ?? String(row.platformCaseId),
      product: row.productName ?? "",
      scope: row.scopeName ?? "",
      surgeon: row.surgeonName ?? "",
      workflowIds: product ? workflowsFor(product, row.subscopeId) : null,
    };
  });
}

/** Cases a part can be requested for: anything not archived or cancelled. */
export async function findRequestCases(spaceId: string, query: string, take = 20): Promise<CaseChoice[]> {
  const q = query.trim();
  const rows = await db.caseRecord.findMany({
    where: {
      spaceId,
      bucket: { not: "ARCHIVED" },
      ...(q
        ? {
            OR: [
              { caseNumber: { contains: q, mode: "insensitive" } },
              { productName: { contains: q, mode: "insensitive" } },
              { scopeName: { contains: q, mode: "insensitive" } },
              { surgeonName: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: CASE_CHOICE,
    orderBy: [{ caseNumberSort: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    take,
  });
  return toChoices(spaceId, rows);
}

export async function requestCase(spaceId: string, id: string): Promise<CaseChoice | null> {
  const row = await db.caseRecord.findFirst({ where: { id, spaceId }, select: CASE_CHOICE });
  return row ? (await toChoices(spaceId, [row]))[0] : null;
}

/** People a part, a stage or a task can be given to. */
export async function spacePeople(spaceId: string): Promise<Array<{ id: string; name: string }>> {
  return db.user.findMany({
    where: { spaceId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

// --- A part's stored shapes ----------------------------------------------------------

/** One entry per workflow stage, in step with the part's `stages`. */
export interface StageMeta {
  assigneeId: string | null;
  assignee: string | null;
  /** ISO date. */
  due: string | null;
  /** Who completed the stage, and when (ISO timestamp). */
  by: string | null;
  at: string | null;
}

export const emptyStageMeta = (): StageMeta => ({ assigneeId: null, assignee: null, due: null, by: null, at: null });

export function partStages(part: { stages: Prisma.JsonValue }): WorkflowStage[] {
  return Array.isArray(part.stages) ? (part.stages as unknown as WorkflowStage[]) : [];
}

/**
 * A part's stages with the lock and the form order its workflow sets on them
 * now — a part keeps its own copy of the stages, but these are the workflow's
 * call, so a setting changed later holds parts already on it (matched by stage name).
 */
export async function partLockStages(part: { stages: Prisma.JsonValue; workflowId: string | null; spaceId: string }): Promise<WorkflowStage[]> {
  const own = partStages(part);
  if (!part.workflowId) return own;
  const wf = await db.resource.findFirst({ where: { id: part.workflowId, spaceId: part.spaceId, kind: "workflows" }, select: { data: true } });
  const live = ((wf?.data ?? {}) as unknown as WorkflowData).stages ?? [];
  if (live.length === 0) return own;
  return own.map((st) => {
    const now = live.find((l) => l.name === st.name);
    return now ? { ...st, lockInfo: now.lockInfo, lockRoles: now.lockRoles, formsOrder: now.formsOrder } : st;
  });
}

/** What a part without a workflow shows where its stage would be. */
export const NO_WORKFLOW = "No workflow yet";

/** The name of the stage a part is on — or, before it has a workflow, that it has none. */
export function stageLabel(part: { stages: Prisma.JsonValue; stageIndex: number }): string {
  const stages = partStages(part);
  return stages.length === 0 ? NO_WORKFLOW : (stages[part.stageIndex]?.name ?? "—");
}

export function partStageMeta(part: { stages: Prisma.JsonValue; stageMeta: Prisma.JsonValue }): StageMeta[] {
  const stored = Array.isArray(part.stageMeta) ? (part.stageMeta as unknown as Partial<StageMeta>[]) : [];
  return partStages(part).map((_, i) => ({ ...emptyStageMeta(), ...(stored[i] ?? {}) }));
}

/**
 * The stage an outsourced part is away at: the last one named for the vendor
 * ("Sent to vendor", "Machining at vendor"). -1 when it has none.
 */
export function vendorStage(part: { sourcing: string; stages: Prisma.JsonValue }): number {
  if (part.sourcing !== "Outsourced") return -1;
  return partStages(part).reduce((at, stage, i) => (/vendor/i.test(stage.name) ? i : at), -1);
}

export function partDetails(part: { details: Prisma.JsonValue }): PartDetail[] {
  return Array.isArray(part.details) ? (part.details as unknown as PartDetail[]) : [];
}

export function partInspection(part: { inspection: Prisma.JsonValue | null }): Inspection | null {
  const value = part.inspection as unknown as Partial<Inspection> | null;
  if (!value || typeof value !== "object") return null;
  return {
    images: value.images ?? [],
    points: value.points ?? [],
    columns: value.columns ?? [],
    rows: value.rows ?? [],
  };
}

// --- Parts list ---------------------------------------------------------------------------

export const PART_PAGE_SIZE = 50;

export const PART_TILES = ["all", "new", "progress", "completed", "archived"] as const;
export type PartTile = (typeof PART_TILES)[number];

/** The first is the default: the latest part ID on top. */
export const PART_SORTS = ["id", "idAsc", "due", "name", "material", "progress"] as const;
export type PartSort = (typeof PART_SORTS)[number];

export interface PartListParams {
  q: string;
  tile: PartTile;
  sort: PartSort;
  page: number;
}

type Raw = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

export function parsePartListParams(raw: Raw): PartListParams {
  const tile = first(raw.tile) as PartTile;
  const sort = first(raw.sort) as PartSort;
  const page = Number.parseInt(first(raw.page), 10);
  return {
    q: first(raw.q).trim().slice(0, 100),
    tile: PART_TILES.includes(tile) ? tile : "all",
    sort: PART_SORTS.includes(sort) ? sort : PART_SORTS[0],
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/**
 * Which tile a part counts under. A part follows its case into the archive;
 * otherwise it is new on its first stage (or before it has a workflow at all),
 * completed on its last, and in progress between them. A part without a case
 * is never archived.
 */
function tileWhere(tile: PartTile): Prisma.Sql {
  const live = Prisma.sql`c."bucket" IS DISTINCT FROM 'ARCHIVED'`;
  switch (tile) {
    case "all":
      return Prisma.sql`TRUE`;
    case "archived":
      return Prisma.sql`c."bucket" = 'ARCHIVED'`;
    case "completed":
      return Prisma.sql`${live} AND p."stageCount" > 0 AND p."stageIndex" >= p."stageCount" - 1`;
    case "new":
      return Prisma.sql`${live} AND (p."stageCount" = 0 OR (p."stageIndex" = 0 AND p."stageCount" > 1))`;
    case "progress":
      return Prisma.sql`${live} AND p."stageIndex" > 0 AND p."stageIndex" < p."stageCount" - 1`;
  }
}

export interface PartRow {
  id: string;
  partNumber: string;
  name: string;
  quantity: number;
  technology: string | null;
  workflowName: string;
  material: string | null;
  printer: string | null;
  stageName: string;
  stageIndex: number;
  stageCount: number;
  due: string | null;
  /** Null for a part that belongs to no case. */
  caseId: string | null;
  caseNumber: string | null;
  /** The product image given in the part request, when there is one. */
  imageId: string | null;
}

export interface PartListResult {
  rows: PartRow[];
  total: number;
  pageCount: number;
  tileCounts: Record<PartTile, number>;
}

interface RawPartRow {
  id: string;
  partNumber: string;
  name: string;
  quantity: number;
  technology: string | null;
  workflowName: string;
  material: string | null;
  printer: string | null;
  stages: Prisma.JsonValue;
  stageIndex: number;
  stageCount: number;
  dueOn: Date | null;
  caseId: string | null;
  caseNumber: string | null;
  platformCaseId: number | null;
  imageId: string | null;
}

const ORDER: Record<PartSort, Prisma.Sql> = {
  due: Prisma.sql`p."dueOn" ASC NULLS LAST, p."partNumber" ASC`,
  name: Prisma.sql`lower(p."name") ASC, p."partNumber" ASC`,
  // The latest part first: the order its ID was given in.
  id: Prisma.sql`p."createdAt" DESC, p."partNumber" DESC`,
  idAsc: Prisma.sql`p."partNumber" ASC`,
  material: Prisma.sql`lower(p."material") ASC NULLS LAST, p."partNumber" ASC`,
  progress: Prisma.sql`(p."stageIndex"::float / GREATEST(p."stageCount" - 1, 1)) DESC, p."partNumber" ASC`,
};

export async function listParts(spaceId: string, params: PartListParams, scope?: { siteOnly: boolean; siteIds: string[] }): Promise<PartListResult> {
  const like = `%${params.q.replace(/[\\%_]/g, "\\$&")}%`;
  const search = params.q
    ? Prisma.sql`AND (p."partNumber" ILIKE ${like} OR p."name" ILIKE ${like} OR c."caseNumber" ILIKE ${like}
        OR p."material" ILIKE ${like} OR p."printer" ILIKE ${like})`
    : Prisma.sql``;

  // A site-only person: just their sites' parts.
  const sites = scope?.siteOnly ? Prisma.sql` AND p."siteId" = ANY(${scope.siteIds})` : Prisma.sql``;
  const from = Prisma.sql`FROM parts p LEFT JOIN case_records c ON c.id = p."caseId" WHERE p."spaceId" = ${spaceId}${sites}`;

  const [counts, totalRows, rows] = await Promise.all([
    db.$queryRaw<Array<Record<PartTile, number>>>`
      SELECT
        count(*)::int AS "all",
        count(*) FILTER (WHERE ${tileWhere("new")})::int AS "new",
        count(*) FILTER (WHERE ${tileWhere("progress")})::int AS "progress",
        count(*) FILTER (WHERE ${tileWhere("completed")})::int AS "completed",
        count(*) FILTER (WHERE ${tileWhere("archived")})::int AS "archived"
      ${from}`,
    db.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n ${from} AND ${tileWhere(params.tile)} ${search}`,
    db.$queryRaw<RawPartRow[]>`
      SELECT p.id, p."partNumber", p."name", p."quantity", p."technology", p."workflowName", p."material",
             p."printer", p."stages", p."stageIndex", p."stageCount", p."dueOn", p."caseId",
             c."caseNumber", c."platformCaseId",
             (SELECT f.id FROM part_files f WHERE f."partId" = p.id AND f.kind = 'image' ORDER BY f."createdAt" LIMIT 1) AS "imageId"
      ${from} AND ${tileWhere(params.tile)} ${search}
      ORDER BY ${ORDER[params.sort]}
      LIMIT ${PART_PAGE_SIZE} OFFSET ${(params.page - 1) * PART_PAGE_SIZE}`,
  ]);

  const total = totalRows[0]?.n ?? 0;
  return {
    rows: rows.map((r) => ({
      id: r.id,
      partNumber: r.partNumber,
      name: r.name,
      quantity: r.quantity,
      technology: r.technology,
      workflowName: r.workflowName,
      material: r.material,
      printer: r.printer,
      stageName: stageLabel(r),
      stageIndex: r.stageIndex,
      stageCount: r.stageCount,
      due: r.dueOn ? r.dueOn.toISOString().slice(0, 10) : null,
      caseId: r.caseId,
      caseNumber: r.caseId ? (r.caseNumber ?? `#${r.platformCaseId}`) : null,
      imageId: r.imageId,
    })),
    total,
    pageCount: Math.max(1, Math.ceil(total / PART_PAGE_SIZE)),
    tileCounts: counts[0] ?? { all: 0, new: 0, progress: 0, completed: 0, archived: 0 },
  };
}

// --- One part ----------------------------------------------------------------------------------

const PART_INCLUDE = {
  case: true,
  files: { orderBy: { createdAt: "asc" } },
  activity: { orderBy: { createdAt: "desc" } },
} satisfies Prisma.PartInclude;

export type PartRecord = Prisma.PartGetPayload<{ include: typeof PART_INCLUDE }>;

export async function getPart(spaceId: string, id: string): Promise<PartRecord | null> {
  return db.part.findFirst({ where: { id, spaceId }, include: PART_INCLUDE });
}

/** A case's parts, for its Manufacturing tab. */
export async function caseParts(spaceId: string, caseId: string) {
  return db.part.findMany({ where: { spaceId, caseId }, orderBy: { sequence: "asc" } });
}
