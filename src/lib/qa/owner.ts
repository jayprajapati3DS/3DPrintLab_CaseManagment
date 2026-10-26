import "server-only";

import type { Prisma } from "@prisma/client";

import { caseStageIndex, caseStages } from "@/lib/cases/stages";
import { db } from "@/lib/db";
import { getPart, partInspection, partLockStages } from "@/lib/parts/queries";
import type { Inspection } from "@/lib/parts/request-form";
import { caseContext, partContext } from "@/lib/qa/context";
import type { Context } from "@/lib/qa/variables";
import { getCase } from "@/lib/queries/cases";
import { orderWaiting, type WorkflowStage } from "@/lib/resources/config";

/**
 * What a quality form is filled for: a part, at a stage of its production
 * workflow — or a case, at one of its product's case stages. Everything the
 * form engine needs from it, whichever it is.
 */
export interface FormOwner {
  kind: "part" | "case";
  id: string;
  /** Its number: the part ID, or the case ID. */
  label: string;
  stages: WorkflowStage[];
  /** Its {…} variables, for the person filling the form. */
  context: (space: { id: string; name: string }, user: { id?: string; name: string; roles: string[]; siteOnly?: boolean }, today: string, timeZone: string) => Promise<Context>;
  inspection: Inspection | null;
  /** Where a signature or evidence file of its forms is kept. */
  fileRef: { partId: string } | { caseId: string };
  /** Its page. */
  href: string;
  /** The stage it is at; whether it has completed all of them. */
  current: number;
  completed: boolean;
}

/** The roles that approve the forms at one of its stages; "" when anyone may. */
export function ownerApprovers(owner: Pick<FormOwner, "stages">, stageIndex: number): string {
  return (owner.stages[stageIndex]?.approvers ?? "").trim();
}

export async function formOwner(spaceId: string, form: { partId: string | null; caseId: string | null }): Promise<FormOwner | null> {
  if (form.partId) {
    const part = await getPart(spaceId, form.partId);
    if (!part) return null;
    return {
      kind: "part",
      id: part.id,
      label: part.partNumber,
      stages: await partLockStages(part),
      context: (space, user, today, timeZone) => partContext(part, space, user, today, timeZone),
      inspection: partInspection(part),
      fileRef: { partId: part.id },
      href: `/parts/${part.id}`,
      current: part.stageIndex,
      completed: false,
    };
  }
  if (form.caseId) {
    const record = await getCase(spaceId, form.caseId);
    if (!record) return null;
    const stages = await caseStages(spaceId, record);
    return {
      kind: "case",
      id: record.id,
      label: record.caseNumber ?? `#${record.platformCaseId}`,
      stages,
      context: (space, user, today, timeZone) => caseContext(record, space, user, today, timeZone),
      inspection: null,
      fileRef: { caseId: record.id },
      href: `/cases/${record.id}`,
      current: caseStageIndex(stages, record),
      completed: Boolean(record.completedAt),
    };
  }
  return null;
}

/**
 * Why a form cannot be filled now — or null. A case status's forms are filled
 * only while the case is at it, unless the status lets them be filled at any
 * time. (A part's forms follow its workflow as before.)
 */
export function fillClosed(owner: FormOwner, form: { name: string; stageIndex: number }): string | null {
  if (owner.kind !== "case") return null;
  const stage = owner.stages[form.stageIndex];
  if (!stage || stage.formsFill === "anytime") return null;
  if (form.stageIndex > owner.current) return `"${form.name}" opens when the case reaches ${stage.name}.`;
  // Completed: the case is at its last status, whose forms are filled then.
  if (form.stageIndex < owner.current) return `"${form.name}" closed when the case moved on from ${stage.name}.`;
  return null;
}

/** Why a form waits for another of its stage — its stage fills them in order — or null. */
export async function orderClosed(owner: FormOwner, form: { name: string; code: string; stageIndex: number }): Promise<string | null> {
  const stage = owner.stages[form.stageIndex];
  if (!stage || stage.formsOrder !== "sequence") return null;
  const siblings = await db.partForm.findMany({
    where: { ...(owner.kind === "part" ? { partId: owner.id } : { caseId: owner.id, partId: null }), stageIndex: form.stageIndex },
    select: { name: true, code: true, status: true },
  });
  const before = orderWaiting(stage, form, siblings);
  return before ? `Fill "${before}" first — the forms of ${stage.name} are filled in order.` : null;
}

/** A line on a part's activity; a case's trail is its audit log. */
export function ownerActivity(owner: FormOwner, entry: { title: string; detail: string; byId: string; byName: string }): Prisma.PrismaPromise<unknown>[] {
  return owner.kind === "part" ? [db.partActivity.create({ data: { partId: owner.id, ...entry } })] : [];
}
