import type { WorkflowStage } from "@/lib/resources/config";

/**
 * Products: what a case is opened for, and the stages its cases go through —
 * set up like a manufacturing workflow's stages (forms, emails, tasks, time,
 * owner, approvers). A product is one of two kinds, chosen when it is made:
 *
 * - "single": one workflow — its own case stages;
 * - "scopes": sub-scopes, kept inside the product (PSI: orthognathic,
 *   mandible…), each with its own case stages. A case of it picks the scope.
 *
 * The manufacturing workflow its parts are made by is separate, and optional:
 * a 3D PDF case makes no part. Pure: the editor, the list and the server read it.
 */

export const PRODUCT_CATEGORIES = ["Planning / report", "Anatomical model", "Patient-specific instrument", "Mold", "Implant", "Other"] as const;

export type ProductMode = "single" | "scopes";

/** A scan protocol uploaded on a product or sub-scope (a document of the product). */
export interface ProductFile {
  id: string;
  name: string;
  /** Who uploaded it, and when (ISO) — absent on files from before this was kept. */
  by?: string;
  at?: string;
}

/**
 * What a product and each of its sub-scopes show alongside their stages: an
 * image (on the case form and case list), the viewers its cases are seen in,
 * and the scan protocols the hospital is sent. Files are the product's
 * documents (/api/files/<id>).
 */
export interface ProductExtras {
  /** The image document — "" for none. */
  imageId: string;
  /** Viewers (Viewer list) associated — none, one or more. */
  viewerIds: string[];
  protocols: ProductFile[];
}

export interface ProductScope extends ProductExtras {
  /** Kept on the cases opened for it (case_records.subscopeId). */
  id: string;
  name: string;
  code: string;
  description: string;
  /** The manufacturing workflows its parts may use — none chosen: the product's. */
  workflowIds: string[];
  stages: WorkflowStage[];
}

export interface CatalogData extends ProductExtras {
  code: string;
  description: string;
  category: string;
  /** Words to find and filter it by. */
  tags: string[];
  /** The manufacturing workflows its parts may use — none chosen: any. */
  workflowIds: string[];
  mode: ProductMode;
  /** The case stages of a "single" product. */
  stages: WorkflowStage[];
  /** The sub-scopes of a "scopes" product. */
  scopes: ProductScope[];
  /**
   * Its cases' Order tab — forms between the surgeon and the team, by label
   * ("Name (code)"): added to every new case, and offered to add by hand.
   */
  orderForms?: { auto: string[]; offered: string[] };
}

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2));

const stage = (name: string, days: number | null): WorkflowStage => ({
  id: uid(),
  name,
  role: "",
  days,
  forms: [],
  formsRequired: false,
  emailsNext: [],
  emailsBack: [],
  tasks: [],
});

/** New case stages — the full path of a manufactured case; remove what a product does not need. */
export function defaultCaseStages(): WorkflowStage[] {
  return [
    stage("Case received", 1),
    stage("Customer requirement", 1),
    stage("Quotation", 1),
    stage("Quotation confirmed", 1),
    stage("Segmentation", 2),
    stage("Design", 3),
    stage("Surgeon feedback", 2),
    stage("Production", 3),
    stage("Delivery", 2),
    stage("Case completed", null),
  ];
}

/** Stages copied, with ids of their own — for a new scope started from another's. */
export const copyStages = (stages: WorkflowStage[]) => stages.map((s) => ({ ...s, id: uid(), forms: [...s.forms], tasks: s.tasks.map((t) => ({ ...t })) }));

export function newScope(name: string, stages: WorkflowStage[]): ProductScope {
  return { id: `sc-${uid().slice(0, 12)}`, name, code: "", description: "", workflowIds: [], stages, imageId: "", viewerIds: [], protocols: [] };
}

/** A stored product, read safely: missing pieces get their defaults. */
export function readCatalog(data: unknown): CatalogData {
  const d = (data ?? {}) as Record<string, unknown>;
  const str = (value: unknown) => (typeof value === "string" ? value : "");
  const list = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "") : []);
  // Saved when a product named one workflow: that one is its selection.
  const workflows = (o: Record<string, unknown>) => (Array.isArray(o.workflowIds) ? list(o.workflowIds) : str(o.workflowId) ? [str(o.workflowId)] : []);
  const stages = (value: unknown) => (Array.isArray(value) ? (value as WorkflowStage[]) : []);
  const extras = (o: Record<string, unknown>): ProductExtras => ({
    imageId: str(o.imageId),
    viewerIds: Array.isArray(o.viewerIds) ? o.viewerIds.filter((v): v is string => typeof v === "string") : [],
    protocols: Array.isArray(o.protocols) ? (o.protocols as ProductFile[]).filter((f) => f && typeof f.id === "string").map((f) => ({ id: f.id, name: String(f.name ?? ""), ...(f.by ? { by: String(f.by) } : {}), ...(f.at ? { at: String(f.at) } : {}) })) : [],
  });
  const scopes = Array.isArray(d.scopes)
    ? (d.scopes as Array<Record<string, unknown>>).map((s) => ({
        id: str(s.id),
        name: str(s.name),
        code: str(s.code),
        description: str(s.description),
        workflowIds: workflows(s),
        stages: stages(s.stages),
        ...extras(s),
      }))
    : [];
  return {
    code: str(d.code),
    description: str(d.description),
    category: str(d.category),
    tags: list(d.tags),
    workflowIds: workflows(d),
    mode: d.mode === "scopes" ? "scopes" : "single",
    stages: stages(d.stages),
    scopes,
    orderForms: {
      auto: list((d.orderForms as Record<string, unknown> | undefined)?.auto),
      offered: list((d.orderForms as Record<string, unknown> | undefined)?.offered),
    },
    ...extras(d),
  };
}

/**
 * The manufacturing workflows a case's parts may use: its sub-scope's
 * selection, else its product's — null when any may be.
 */
export function workflowsFor(product: Pick<CatalogData, "mode" | "workflowIds" | "scopes">, scopeId: string | null): string[] | null {
  const scope = product.mode === "scopes" ? product.scopes.find((s) => s.id === scopeId) : undefined;
  const ids = scope?.workflowIds.length ? scope.workflowIds : product.workflowIds;
  return ids.length ? ids : null;
}

/** A case's image, viewers and protocols: its sub-scope's where it has them, else its product's. */
export function extrasFor(product: CatalogData, scopeId: string | null): ProductExtras {
  const scope = product.mode === "scopes" ? product.scopes.find((s) => s.id === scopeId) : undefined;
  return {
    imageId: scope?.imageId || product.imageId,
    viewerIds: scope?.viewerIds.length ? scope.viewerIds : product.viewerIds,
    protocols: scope?.protocols.length ? scope.protocols : product.protocols,
  };
}

/** The stages a case follows: its scope's, when the product has scopes, else the product's. */
export function caseStagesFor(product: Pick<CatalogData, "mode" | "stages" | "scopes">, scopeId: string | null): WorkflowStage[] {
  if (product.mode === "scopes") return product.scopes.find((s) => s.id === scopeId)?.stages ?? [];
  return product.stages;
}

/** What is wrong with a product's stages and scopes, in words — or null. */
export function catalogProblem(data: CatalogData): string | null {
  const stagesProblem = (stages: WorkflowStage[], where: string) => {
    if (stages.length === 0) return `${where}: add at least one case stage.`;
    const names = stages.map((s) => s.name.trim().toLowerCase());
    if (names.some((n) => !n)) return `${where}: every stage needs a name.`;
    if (new Set(names).size !== names.length) return `${where}: two case stages have the same name.`;
    return null;
  };
  if (data.mode === "single") return stagesProblem(data.stages, "Case stages");
  if (data.scopes.length === 0) return "Add at least one sub-scope.";
  const names = data.scopes.map((s) => s.name.trim().toLowerCase());
  if (names.some((n) => !n)) return "Every sub-scope needs a name.";
  if (new Set(names).size !== names.length) return "Two sub-scopes have the same name.";
  for (const scope of data.scopes) {
    const problem = stagesProblem(scope.stages, scope.name);
    if (problem) return problem;
  }
  return null;
}
