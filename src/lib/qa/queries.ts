import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { layoutFor, readLayouts, type DocLayoutDef } from "@/lib/qa/layouts";
import { readTemplate, templateLabel, type QaSection } from "@/lib/qa/template";
import type { WorkflowData, WorkflowStage } from "@/lib/resources/config";

/**
 * Reading QA templates and the forms made from them, and putting a part's
 * forms in place.
 */

// --- Settings ------------------------------------------------------------------------------

export interface QaSettings {
  /** The person who submits a form cannot also approve it. */
  separateApprover: boolean;
}

export const DEFAULT_QA_SETTINGS: QaSettings = { separateApprover: true };

export async function qaSettings(spaceId: string): Promise<QaSettings> {
  const row = await db.spaceSetting.findUnique({ where: { spaceId_key: { spaceId, key: "qa" } } });
  const value = (row?.value ?? {}) as Partial<QaSettings>;
  return { ...DEFAULT_QA_SETTINGS, ...(typeof value.separateApprover === "boolean" ? { separateApprover: value.separateApprover } : {}) };
}

/** The space's header & footer designs (QA Form Setup → Header & footer). */
export async function docLayouts(spaceId: string): Promise<DocLayoutDef[]> {
  const row = await db.spaceSetting.findUnique({ where: { spaceId_key: { spaceId, key: "qaLayouts" } } });
  return readLayouts(row?.value);
}

/** The design one form uses. */
export async function docLayoutFor(spaceId: string, docStyle: string | undefined): Promise<DocLayoutDef> {
  return layoutFor(await docLayouts(spaceId), docStyle);
}

// --- Templates -----------------------------------------------------------------------------------

export async function listTemplates(spaceId: string) {
  const rows = await db.qaTemplate.findMany({
    where: { spaceId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { partForms: true } } },
  });
  // Parts, not forms: a part with the same form at two stages counts once.
  const pairs = await db.partForm.findMany({
    where: { spaceId, templateId: { not: null } },
    distinct: ["templateId", "partId"],
    select: { templateId: true },
  });
  const partCounts = new Map<string, number>();
  for (const { templateId } of pairs) partCounts.set(templateId!, (partCounts.get(templateId!) ?? 0) + 1);
  return rows.map((row) => ({ row, data: readTemplate(row), parts: partCounts.get(row.id) ?? 0 }));
}

export async function getTemplate(spaceId: string, id: string) {
  return db.qaTemplate.findFirst({ where: { id, spaceId } });
}

/** Every stage name used by the space's workflows, for "Add this form to parts at". */
export async function stageNames(spaceId: string): Promise<string[]> {
  const workflows = await db.resource.findMany({ where: { spaceId, kind: "workflows", archivedAt: null }, select: { data: true } });
  const names = new Set<string>();
  for (const w of workflows) for (const s of ((w.data ?? {}) as Partial<WorkflowData>).stages ?? []) if (s.name) names.add(s.name);
  return [...names].sort((a, b) => a.localeCompare(b));
}

// --- A part's forms ----------------------------------------------------------------------------------

type Tx = Prisma.TransactionClient;

interface TemplateRow {
  id: string;
  name: string;
  code: string;
  clause: string;
  issue: string;
  effective: string;
  rev: string;
  docLayout: boolean;
  validity: string;
  docStyle: string;
  attach: string[];
  sections: Prisma.JsonValue;
}

/**
 * Which templates belong at a stage: those set to be added at a stage of that
 * name in QA Form Setup, and those the workflow itself lists for the stage.
 */
export function templatesForStage(stage: WorkflowStage, templates: TemplateRow[]): TemplateRow[] {
  const name = stage.name.trim().toLowerCase();
  const listed = new Set((stage.forms ?? []).map((f) => f.trim().toLowerCase()));
  return templates.filter(
    (t) =>
      t.attach.some((a) => a.trim().toLowerCase() === name) ||
      listed.has(templateLabel(t).toLowerCase()) ||
      listed.has(t.name.toLowerCase()) ||
      (t.code && listed.has(t.code.toLowerCase())),
  );
}

/** Create a part's forms for every stage of its workflow, with each template's content copied in. */
export async function createPartForms(
  tx: Tx,
  part: { id: string; spaceId: string; stageIndex: number; stages: Prisma.JsonValue },
): Promise<number> {
  const stages = Array.isArray(part.stages) ? (part.stages as unknown as WorkflowStage[]) : [];
  const templates = await tx.qaTemplate.findMany({ where: { spaceId: part.spaceId }, orderBy: { createdAt: "asc" } });
  const data: Prisma.PartFormCreateManyInput[] = [];
  stages.forEach((stage, index) => {
    for (const t of templatesForStage(stage, templates)) {
      data.push({
        spaceId: part.spaceId,
        partId: part.id,
        templateId: t.id,
        stageIndex: index,
        stageName: stage.name,
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
        status: index <= part.stageIndex ? "In progress" : "Upcoming",
        values: {},
        measured: {},
        quantities: {},
        snap: {},
      });
    }
  });
  if (data.length) await tx.partForm.createMany({ data });
  await tx.part.update({ where: { id: part.id }, data: { formsReadyAt: new Date() } });
  return data.length;
}

/**
 * A part requested before its space had QA templates gets its forms the
 * first time it is opened. Only once: after that, templates attach to new
 * parts only, as the design has it.
 */
export async function ensurePartForms(part: {
  id: string;
  spaceId: string;
  stageIndex: number;
  stages: Prisma.JsonValue;
  formsReadyAt: Date | null;
}): Promise<void> {
  if (part.formsReadyAt) return;
  const templates = await db.qaTemplate.count({ where: { spaceId: part.spaceId } });
  if (templates === 0) return;
  await db.$transaction(async (tx) => {
    const fresh = await tx.part.findUnique({ where: { id: part.id }, select: { formsReadyAt: true } });
    if (fresh?.formsReadyAt) return;
    await createPartForms(tx, part);
  });
}

/**
 * A case's forms: for each of its stages, the templates the stage calls for,
 * copied in — the stages reached open to fill, the rest upcoming. A form put on
 * a status later reaches the cases that have not passed it yet; a status
 * already passed keeps the forms it had.
 */
export async function ensureCaseForms(record: { id: string; spaceId: string; formsReadyAt: Date | null }, stages: WorkflowStage[], current: number): Promise<void> {
  if (!stages.some((st) => (st.forms ?? []).length)) return;
  await db.$transaction(async (tx) => {
    const templates = await tx.qaTemplate.findMany({ where: { spaceId: record.spaceId }, orderBy: { createdAt: "asc" } });
    const have = new Set((await tx.partForm.findMany({ where: { caseId: record.id }, select: { stageIndex: true, templateId: true } })).map((f) => `${f.stageIndex}:${f.templateId}`));
    const data: Prisma.PartFormCreateManyInput[] = [];
    stages.forEach((stage, index) => {
      if (record.formsReadyAt && index < current) return;
      // Only the forms the stage lists: QA Form Setup's "add at stage" is for parts' workflows.
      const listed = new Set((stage.forms ?? []).map((f) => f.trim().toLowerCase()));
      for (const t of templates.filter((t) => listed.has(templateLabel(t).toLowerCase()) || listed.has(t.name.toLowerCase()) || (t.code && listed.has(t.code.toLowerCase())))) {
        if (have.has(`${index}:${t.id}`)) continue;
        data.push({
          spaceId: record.spaceId,
          caseId: record.id,
          templateId: t.id,
          stageIndex: index,
          stageName: stage.name,
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
          status: index <= current || stage.formsFill === "anytime" ? "In progress" : "Upcoming",
          values: {},
          measured: {},
          quantities: {},
          snap: {},
        });
      }
    });
    if (data.length) await tx.partForm.createMany({ data });
    if (!record.formsReadyAt) await tx.caseRecord.update({ where: { id: record.id }, data: { formsReadyAt: new Date() } });
  });
}

/** A case's forms, by stage — with what they used and their kept versions. */
export async function caseForms(spaceId: string, caseId: string) {
  return db.partForm.findMany({
    where: { spaceId, caseId },
    orderBy: [{ stageIndex: "asc" }, { createdAt: "asc" }],
    include: {
      uses: { orderBy: { createdAt: "asc" } },
      versions: { orderBy: { createdAt: "desc" }, select: { id: true, version: true, event: true, reason: true, byName: true, createdAt: true } },
    },
  });
}

export async function partForms(spaceId: string, partId: string) {
  return db.partForm.findMany({
    where: { spaceId, partId },
    orderBy: [{ stageIndex: "asc" }, { createdAt: "asc" }],
    include: {
      uses: { orderBy: { createdAt: "asc" } },
      versions: { orderBy: { createdAt: "desc" }, select: { id: true, version: true, event: true, reason: true, byName: true, createdAt: true } },
    },
  });
}

/** One kept version of a form, in full. */
export async function formVersion(formId: string, id: string) {
  return db.partFormVersion.findFirst({ where: { id, formId } });
}

export type PartFormRow = Awaited<ReturnType<typeof partForms>>[number];

export function formSections(form: { sections: Prisma.JsonValue }): QaSection[] {
  return Array.isArray(form.sections) ? (form.sections as unknown as QaSection[]) : [];
}

// --- Usage records -------------------------------------------------------------------------------

/** Every form entry that picked an item: for its Usage records or Build history tab. */
export async function usageRecords(spaceId: string, itemIds: string[]) {
  if (itemIds.length === 0) return [];
  const uses = await db.formUse.findMany({
    where: { spaceId, itemId: { in: itemIds } },
    orderBy: { createdAt: "desc" },
    include: {
      form: {
        select: {
          id: true,
          name: true,
          code: true,
          status: true,
          stageName: true,
          savedByName: true,
          savedAt: true,
          part: {
            select: {
              id: true,
              partNumber: true,
              name: true,
              partType: true,
              case: { select: { id: true, caseNumber: true, platformCaseId: true } },
            },
          },
        },
      },
    },
  });
  // Listed by part: a case stage's form is on its case, not a part.
  return uses.flatMap((u) => (u.form.part ? [{ ...u, form: { ...u.form, part: u.form.part } }] : []));
}

/** Parts to take example values from — the ones with a drawing first, as the design does. */
export async function previewParts(spaceId: string) {
  const parts = await db.part.findMany({
    where: { spaceId },
    orderBy: { createdAt: "desc" },
    take: 80,
    select: { id: true, partNumber: true, name: true, inspection: true },
  });
  const withBalloons = (p: (typeof parts)[number]) => {
    const rows = (p.inspection as { rows?: unknown[] } | null)?.rows;
    return Array.isArray(rows) && rows.length > 0;
  };
  return parts
    .map((p) => ({ id: p.id, label: `${p.partNumber} · ${p.name}${withBalloons(p) ? " (has balloons)" : ""}`, balloons: withBalloons(p) }))
    .sort((a, b) => Number(b.balloons) - Number(a.balloons));
}
