import "server-only";

import { userRoleNames } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { readCaseSetup, type CaseSetup } from "@/lib/cases/case-form";
import { readDepartments, type HospitalDepartment } from "@/lib/cases/hospitals";
import { readCatalog, type ProductExtras, type ProductMode, type ProductScope } from "@/lib/cases/catalog";
import type { WorkflowStage } from "@/lib/resources/config";

/** The space's case form, case ID pattern and case source — the default until saved. */
export async function getCaseSetup(spaceId: string, spaceName: string): Promise<CaseSetup & { saved: boolean }> {
  const row = await db.spaceSetting.findUnique({ where: { spaceId_key: { spaceId, key: "caseSetup" } } });
  return { ...readCaseSetup(row?.value, spaceName), saved: Boolean(row) };
}

export interface CatalogProduct extends ProductExtras {
  id: string;
  name: string;
  code: string;
  category: string;
  description: string;
  tags: string[];
  /** The manufacturing workflows its parts may use — none: any. */
  workflowIds: string[];
  mode: ProductMode;
  /** The case stages of a product with one workflow. */
  stages: WorkflowStage[];
  scopes: ProductScope[];
}

export interface CatalogSubscope {
  id: string;
  name: string;
  productId: string;
  /** Its own selection, else its product's — none: any. */
  workflowIds: string[];
}

/** The active products a case can be opened for, and their sub-scopes (kept inside them). */
export async function caseCatalog(spaceId: string): Promise<{ products: CatalogProduct[]; subscopes: CatalogSubscope[] }> {
  const rows = await db.resource.findMany({
    where: { spaceId, kind: "products", archivedAt: null, NOT: { status: "Inactive" } },
    select: { id: true, kind: true, name: true, data: true },
    orderBy: { name: "asc" },
  });
  const str = (data: unknown, key: string) => String(((data ?? {}) as Record<string, unknown>)[key] ?? "");
  const named = rows.filter((r) => r.name.trim());
  const products = named.map((r) => {
    const data = readCatalog(r.data);
    return { id: r.id, name: r.name, code: str(r.data, "code"), category: data.category, description: data.description, tags: data.tags, workflowIds: data.workflowIds, mode: data.mode, stages: data.stages, scopes: data.mode === "scopes" ? data.scopes : [], imageId: data.imageId, viewerIds: data.viewerIds, protocols: data.protocols };
  });
  return {
    products,
    subscopes: products.flatMap((p) => p.scopes.filter((s) => s.name.trim()).map((s) => ({ id: s.id, name: s.name, productId: p.id, workflowIds: s.workflowIds.length ? s.workflowIds : p.workflowIds }))),
  };
}

/** Case numbers already given in the space, for the next case ID. */
export async function caseNumbersInUse(spaceId: string): Promise<string[]> {
  const rows = await db.caseRecord.findMany({ where: { spaceId, caseNumber: { not: null } }, select: { caseNumber: true } });
  return rows.map((r) => r.caseNumber!).filter(Boolean);
}

/** How many cases each form opened — those from before forms could be chosen count for the default. */
export async function caseFormUsage(spaceId: string, setup: CaseSetup): Promise<Map<string, number>> {
  const rows = await db.caseRecord.groupBy({ by: ["caseFormId"], where: { spaceId, origin: "local" }, _count: { _all: true } });
  const fallback = (setup.forms.find((f) => f.isDefault) ?? setup.forms[0]).id;
  const usage = new Map<string, number>();
  for (const row of rows) {
    const id = row.caseFormId && setup.forms.some((f) => f.id === row.caseFormId) ? row.caseFormId : fallback;
    usage.set(id, (usage.get(id) ?? 0) + row._count._all);
  }
  return usage;
}

export interface CasePerson {
  id: string;
  name: string;
  /** Their roles, by name: "Member", "Surgeon"… */
  roles: string[];
  hospitalIds: string[];
}

export interface CaseHospital {
  id: string;
  name: string;
  code: string;
  departments: HospitalDepartment[];
}

/** People a case form can offer as surgeon — everyone active, with their roles and hospitals. */
export async function casePeople(spaceId: string): Promise<CasePerson[]> {
  const users = await db.user.findMany({
    where: { spaceId, isActive: true },
    select: { id: true, name: true, role: true, platformRoleName: true, hospitalIds: true },
    orderBy: { name: "asc" },
  });
  return users.map((u) => ({ id: u.id, name: u.name, roles: userRoleNames(u), hospitalIds: u.hospitalIds }));
}

/** The active hospitals of the Hospitals list. */
export async function caseHospitals(spaceId: string): Promise<CaseHospital[]> {
  const rows = await db.resource.findMany({
    where: { spaceId, kind: "hospitals", archivedAt: null, NOT: { status: "Inactive" } },
    select: { id: true, name: true, data: true },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, code: String(((r.data ?? {}) as Record<string, unknown>).code ?? ""), departments: readDepartments(r.data) }));
}

/** The people a person / people field lists: those holding one of its roles — any, when it names none. */
export function peopleFor(people: CasePerson[], roles: string[] | undefined): CasePerson[] {
  const wanted = (roles ?? []).map((r) => r.toLowerCase());
  return wanted.length ? people.filter((p) => p.roles.some((r) => wanted.includes(r.toLowerCase()))) : people;
}
