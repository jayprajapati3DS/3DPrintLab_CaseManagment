import { headers } from "next/headers";

import { db } from "@/lib/db";

/**
 * Append-only audit trail.
 *
 * Every sign-in, every change to a space or its platform connection, and every
 * unmasking of patient identifiers records who did it and from where. Failures
 * here are logged but never propagated — an audit problem must not roll back
 * the user's actual work.
 */

export type AuditAction =
  | "auth.login"
  | "auth.login_failed"
  | "auth.2fa_failed"
  | "auth.logout"
  | "space.create"
  | "space.suspend"
  | "space.reactivate"
  | "space.admin_password_reset"
  | "user.password_change"
  | "user.signature_save"
  | "user.signature_remove"
  | "case.patient_reveal"
  | "case.detail_refresh"
  | "user.active.update"
  | "user.person_add"
  | "user.person_update"
  | "site.member_add"
  | "site.member_remove"
  | "site.access"
  | "site.account_create"
  | "rolemapping.update"
  | "rolemapping.delete"
  | "connection.update"
  | "connection.test"
  | "sync.start"
  | "sync.finish"
  // Master data: one family per thing that can happen to a record.
  | `resource.${string}`
  | `schedule.${string}`
  | `document.${string}`
  | `stock.${string}`
  | `setup.${string}`
  // Parts: requests, stage moves, ownership and files.
  | `part.${string}`
  // Cases opened and changed in the app (case management).
  | `case.${string}`
  // Quality forms and goods receipt.
  | `qa.${string}`
  | `grn.${string}`;

interface AuditInput {
  action: AuditAction;
  entityType: string;
  /** Null for platform-level events that belong to no space. */
  spaceId?: string | null;
  entityId?: string | null;
  /** The record's name at the time, for the audit log's "Record" column. */
  entityName?: string | null;
  summary?: string | null;
  before?: unknown;
  after?: unknown;
  actorId?: string | null;
  actorEmail?: string | null;
}

/**
 * Read the caller's address and agent. `x-forwarded-for` is only trustworthy
 * behind a proxy that sets it; the first hop is taken and the rest ignored.
 */
export async function requestContext(): Promise<{
  ip: string;
  userAgent: string | null;
}> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");
    const ip =
      forwarded?.split(",")[0]?.trim() ||
      h.get("x-real-ip")?.trim() ||
      "unknown";
    return { ip, userAgent: h.get("user-agent")?.slice(0, 512) ?? null };
  } catch {
    return { ip: "unknown", userAgent: null };
  }
}

function asJson(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  // Decimal and Date do not survive Prisma's Json column directly.
  return JSON.parse(
    JSON.stringify(value, (_key, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
  );
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    const { ip, userAgent } = await requestContext();
    await db.auditLog.create({
      data: {
        action: input.action,
        entityType: input.entityType,
        spaceId: input.spaceId ?? null,
        entityId: input.entityId ?? null,
        entityName: input.entityName ?? null,
        summary: input.summary ?? null,
        before: asJson(input.before),
        after: asJson(input.after),
        actorId: input.actorId ?? null,
        actorEmail: input.actorEmail ?? null,
        ip,
        userAgent,
      },
    });
  } catch (error) {
    console.error("[audit] failed to record event", {
      action: input.action,
      entityType: input.entityType,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
