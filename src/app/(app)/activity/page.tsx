import type { Metadata } from "next";

import { CARD, CARD_HEADER, TABLE_HEAD, TABLE_ROW } from "@/components/ui/styles";
import { requireSuperAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Admin Activity Log" };
export const dynamic = "force-dynamic";

const COLUMNS = "grid min-w-[860px] grid-cols-[180px_170px_minmax(0,1fr)_minmax(0,0.6fr)_120px] items-start gap-3";

const LABELS: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.login_failed": "Sign-in failed",
  "auth.logout": "Signed out",
  "user.password_change": "Password changed",
  "space.create": "Space created",
  "space.suspend": "Space suspended",
  "space.reactivate": "Space reactivated",
  "space.admin_password_reset": "Admin password reset",
};

/**
 * What has happened in the admin console: sign-ins to it, and everything done
 * to a company space from it. What happens *inside* a space is that space's
 * own audit log, which the console deliberately does not show.
 */
export default async function ActivityPage() {
  await requireSuperAdmin();

  const events = await db.auditLog.findMany({
    where: { OR: [{ spaceId: null }, { action: { startsWith: "space." } }] },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { space: { select: { name: true } } },
  });

  return (
    <section className={`${CARD} overflow-x-auto`}>
      <div className={CARD_HEADER}>
        <h2 className="m-0 text-[15px] font-semibold">Admin console activity</h2>
        <span className="text-muted font-mono text-xs">latest {events.length}</span>
      </div>
      <div className={`${TABLE_HEAD} ${COLUMNS}`}>
        <div>When</div>
        <div>Event</div>
        <div>Detail</div>
        <div>By</div>
        <div>From</div>
      </div>
      {events.length === 0 ? (
        <div className="text-muted px-5 py-10 text-center text-[13px]">Nothing recorded yet.</div>
      ) : (
        events.map((e) => (
          <div key={e.id} className={`${TABLE_ROW} ${COLUMNS}`}>
            <div className="font-mono text-[12.5px]">{fmtDateTime(e.createdAt)}</div>
            <div className="font-semibold">{LABELS[e.action] ?? e.action}</div>
            <div className="text-ink-3 min-w-0">
              {e.summary ?? "—"}
              {e.space ? <span className="text-muted"> · {e.space.name}</span> : null}
            </div>
            <div className="text-ink-3 truncate">{e.actorEmail ?? "—"}</div>
            <div className="text-muted truncate font-mono text-xs">{e.ip ?? "—"}</div>
          </div>
        ))
      )}
    </section>
  );
}
