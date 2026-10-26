"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { assertSameOrigin } from "@/lib/auth/origin";
import { requireSpaceUser } from "@/lib/auth/rbac";
import { decryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { cachedCaseDetail, loadCaseDetail } from "@/lib/queries/case-detail";

export interface PatientDetails {
  name: string | null;
  age: string | null;
  dateOfBirth: string | null;
  gender: string | null;
}

/**
 * Unmask a case's patient identifiers.
 *
 * They never reach the browser with the page: the case screens render a mask,
 * and the real values are only sent in answer to this action, which writes the
 * audit entry first. Anyone who has seen a patient's name is on record as
 * having asked for it.
 */
export async function revealPatientAction(caseId: string): Promise<PatientDetails | null> {
  await assertSameOrigin();
  const user = await requireSpaceUser();

  const record = await db.caseRecord.findFirst({
    where: { id: caseId, spaceId: user.space.id },
  });
  if (!record) return null;

  await recordAudit({
    action: "case.patient_reveal",
    entityType: "case",
    spaceId: user.space.id,
    entityId: record.id,
    actorId: user.id,
    actorEmail: user.email,
    summary: `Unmasked patient identifiers on case ${record.caseNumber ?? record.id}.`,
  });

  // The platform's case page knows more than its list does (date of birth,
  // gender), so it is preferred when it has been read.
  const patient = cachedCaseDetail(record)?.patient;

  return {
    name: patient?.name || decryptSecret(record.patientNameEncrypted),
    age: patient?.age || record.patientAge,
    dateOfBirth: patient?.dateOfBirth || null,
    gender: patient?.gender || record.patientGender,
  };
}

/** Read the case's page on the platform again now, rather than from the cache. */
export async function refreshCaseDetailAction(
  caseId: string,
): Promise<{ ok: boolean; message: string }> {
  await assertSameOrigin();
  const user = await requireSpaceUser();

  const record = await db.caseRecord.findFirst({
    where: { id: caseId, spaceId: user.space.id },
  });
  if (!record) return { ok: false, message: "This case is no longer available." };

  const result = await loadCaseDetail(record, { refresh: true });

  await recordAudit({
    action: "case.detail_refresh",
    entityType: "case",
    spaceId: user.space.id,
    entityId: record.id,
    actorId: user.id,
    actorEmail: user.email,
    summary: result.error
      ? `Could not refresh case ${record.caseNumber ?? record.id} from the platform: ${result.error}`
      : `Refreshed case ${record.caseNumber ?? record.id} from the platform.`,
  });

  revalidatePath(`/cases/${caseId}/edit`);
  return result.error
    ? { ok: false, message: result.error }
    : { ok: true, message: "Refreshed from the platform." };
}
