import { caseStagesFor, readCatalog } from "@/lib/cases/catalog";
import { db } from "@/lib/db";
import type { WorkflowStage } from "@/lib/resources/config";

/**
 * A case opened here moves through its product's case stages — or its
 * sub-scope's — the way a part moves through its workflow: one stage at a
 * time, by the person it is assigned to. Each stage left records who moved it
 * on, and when.
 */

export interface CaseStageMark {
  /** Who moved the case on from this stage, and when (ISO); cleared when it comes back. */
  by?: string | null;
  at?: string | null;
  /** Who the status is planned for — the case is handed to them when it gets there. */
  ownerId?: string | null;
  ownerName?: string | null;
  /** A due date set for the status (YYYY-MM-DD), in place of start + its working days. */
  due?: string | null;
}

/** The stages of a case's product, or of its sub-scope. */
export async function caseStages(spaceId: string, record: { productId: string | null; subscopeId: string | null }): Promise<WorkflowStage[]> {
  if (!record.productId) return [];
  const product = await db.resource.findFirst({ where: { id: record.productId, spaceId, kind: "products" }, select: { data: true } });
  if (!product) return [];
  // Stages saved before a setting existed lack it: read them with the defaults.
  return caseStagesFor(readCatalog(product.data), record.subscopeId).map((s) => ({
    ...s,
    role: s.role ?? "",
    days: s.days ?? null,
    forms: s.forms ?? [],
    tasks: s.tasks ?? [],
    emailsNext: s.emailsNext ?? [],
    emailsBack: s.emailsBack ?? [],
    viewers: s.viewers ?? [],
  }));
}

/** Where a case is: its stored position, else the stage its status names, else the first. */
export function caseStageIndex(stages: WorkflowStage[], record: { stageIndex: number | null; caseStatus: string | null }): number {
  if (record.stageIndex !== null && record.stageIndex >= 0 && record.stageIndex < stages.length) return record.stageIndex;
  const status = (record.caseStatus ?? "").trim().toLowerCase();
  const found = stages.findIndex((s) => s.name.trim().toLowerCase() === status);
  return Math.max(0, found);
}

export function readStageMarks(value: unknown): CaseStageMark[] {
  return Array.isArray(value) ? value.map((m) => (m && typeof m === "object" ? (m as CaseStageMark) : {})) : [];
}

/** A date some working days on — weekends skipped. */
export function addWorkingDays(from: Date, days: number): Date {
  const d = new Date(from);
  let left = Math.max(0, Math.round(days));
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return d;
}

export interface StageTimes {
  /** When the case reached the stage — for one still to come, when it would at this pace. */
  startedAt: Date | null;
  /** Start plus the stage's expected working days; null when it has none. */
  dueAt: Date | null;
  /** When it was moved on from, and by whom. */
  doneAt: Date | null;
  doneBy: string | null;
  /** Upcoming: the dates are estimates. */
  planned: boolean;
}

/** Each stage's start, due date and finish — from when the case opened and who moved it on when. */
export function stageTimes(stages: WorkflowStage[], current: number, completed: boolean, openedAt: Date, marks: CaseStageMark[]): StageTimes[] {
  const out: StageTimes[] = [];
  let start: Date | null = openedAt;
  stages.forEach((s, i) => {
    const mark = marks[i];
    const done = i < current || (completed && i === current);
    const doneAt = done && mark?.at ? new Date(mark.at) : null;
    const set = mark?.due && /^\d{4}-\d{2}-\d{2}$/.test(mark.due) ? new Date(`${mark.due}T00:00:00Z`) : null;
    const dueAt = set ?? (start && s.days ? addWorkingDays(start, s.days) : null);
    out.push({ startedAt: start, dueAt, doneAt, doneBy: done ? (mark?.by ?? null) : null, planned: i > current });
    // The next one starts when this one finished — or, still to come, when it is due.
    start = doneAt ?? (i >= current ? (dueAt ?? start) : start);
  });
  return out;
}

/**
 * A case's stage tasks, as records to tick off: one per task its product's
 * stages list, made the first time the case is opened. A due date set on one
 * replaces start + its days.
 */
export async function ensureCaseTasks(record: { id: string; spaceId: string }, stages: WorkflowStage[]): Promise<void> {
  if (!stages.some((s) => s.tasks.length)) return;
  if (await db.task.count({ where: { caseId: record.id, type: "Default" } })) return;
  await db.task.createMany({
    data: stages.flatMap((s, stageIndex) =>
      s.tasks.map((t) => ({ spaceId: record.spaceId, caseId: record.id, type: "Default", stageIndex, name: t.name, checklist: [], reminders: [], tags: [] })),
    ),
  });
}

export async function caseTasks(spaceId: string, caseId: string) {
  return db.task.findMany({ where: { spaceId, caseId, type: "Default" }, orderBy: [{ stageIndex: "asc" }, { createdAt: "asc" }] });
}
