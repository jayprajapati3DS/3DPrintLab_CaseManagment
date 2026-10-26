import type { Metadata } from "next";

import { ConnectionPanel } from "@/app/(app)/integrations/connection-panel";
import { CARD, CARD_HEADER, TABLE_HEAD, TABLE_ROW } from "@/components/ui/styles";
import { requireSpaceAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { DEFAULT_TIMEZONE, fmtDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Integrations & API" };
export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  SUCCESS: "bg-ok-tint text-ok",
  PARTIAL: "bg-warn-tint text-warn",
  FAILED: "bg-bad-tint text-bad",
  RUNNING: "bg-info-tint text-info",
};

const COLUMNS = "grid min-w-[720px] grid-cols-[170px_90px_110px_minmax(0,1fr)_130px] items-start gap-3";

export default async function IntegrationsPage() {
  const user = await requireSpaceAdmin();

  const connection = await db.platformConnection.findUnique({
    where: { spaceId: user.space.id },
    include: {
      syncRuns: {
        orderBy: { startedAt: "desc" },
        take: 10,
        include: { triggeredBy: { select: { name: true } } },
      },
    },
  });

  const timeZone = connection?.timezone || DEFAULT_TIMEZONE;
  const caseCount = await db.caseRecord.count({ where: { spaceId: user.space.id } });

  return (
    <div className="flex max-w-[980px] flex-col gap-5">
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <Fact label="Platform">
          {connection ? (
            <span className="flex items-center gap-2">
              <span
                className={
                  "h-2 w-2 rounded-full " + (connection.verifiedAt ? "bg-[#12B76A]" : "bg-[#F79009]")
                }
              />
              {connection.verifiedAt
                ? (connection.verifiedName ?? "Verified")
                : "Saved, not tested"}
            </span>
          ) : (
            <span className="text-warn flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#F79009]" />
              Not connected
            </span>
          )}
        </Fact>
        <Fact label="Last sync">
          {connection?.lastSyncAt
            ? `${fmtDateTime(connection.lastSyncAt, timeZone)} · ${connection.lastSyncStatus?.toLowerCase()}`
            : "Never"}
        </Fact>
        <Fact label="Cases in this space">{caseCount.toLocaleString("en-IN")}</Fact>
      </div>

      <ConnectionPanel
        // Remount when the saved values change, so the inputs show them — but
        // not on a test or a sync, which would throw away the test report.
        key={
          connection
            ? [
                connection.domainUrl,
                connection.serviceEmail,
                connection.dateFormat,
                connection.timezone,
                Boolean(connection.servicePasswordEncrypted),
              ].join("|")
            : "new"
        }
        connection={
          connection
            ? {
                domainUrl: connection.domainUrl,
                serviceEmail: connection.serviceEmail ?? "",
                hasPassword: Boolean(connection.servicePasswordEncrypted),
                dateFormat: connection.dateFormat,
                timezone: connection.timezone,
              }
            : null
        }
      />

      <section className={`${CARD} overflow-x-auto`}>
        <div className={CARD_HEADER}>
          <h2 className="m-0 text-[15px] font-semibold">Sync history</h2>
          <span className="text-muted font-mono text-xs">last 10 runs</span>
        </div>
        <div className={`${TABLE_HEAD} ${COLUMNS}`}>
          <div>Started</div>
          <div>Trigger</div>
          <div>Result</div>
          <div>Cases</div>
          <div>By</div>
        </div>
        {!connection || connection.syncRuns.length === 0 ? (
          <div className="text-muted px-5 py-10 text-center text-[13px]">
            No sync has run yet. Save a connection with a service account, then press Sync now.
          </div>
        ) : (
          connection.syncRuns.map((run) => {
            const warnings =
              (run.details as { warnings?: string[] } | null)?.warnings?.filter(Boolean) ?? [];
            return (
              <div key={run.id} className={`${TABLE_ROW} ${COLUMNS}`}>
                <div className="font-mono text-[12.5px]">{fmtDateTime(run.startedAt, timeZone)}</div>
                <div className="text-ink-3 capitalize">{run.trigger}</div>
                <div>
                  <span
                    className={
                      "rounded-full px-2 py-0.5 text-[11px] font-semibold " +
                      (STATUS_STYLE[run.status] ?? "bg-chip text-ink-2")
                    }
                  >
                    {run.status.toLowerCase()}
                  </span>
                </div>
                <div className="text-ink-3 flex min-w-0 flex-col gap-1">
                  <span>
                    {run.casesSeen.toLocaleString("en-IN")} seen · {run.casesCreated.toLocaleString("en-IN")}{" "}
                    new · {run.casesUpdated.toLocaleString("en-IN")} updated
                  </span>
                  {run.errorMessage ? <span className="text-bad">{run.errorMessage}</span> : null}
                  {warnings.slice(0, 3).map((w) => (
                    <span key={w} className="text-warn text-[12.5px]">
                      {w}
                    </span>
                  ))}
                  {warnings.length > 3 ? (
                    <span className="text-muted text-[12.5px]">+ {warnings.length - 3} more warnings</span>
                  ) : null}
                </div>
                <div className="text-ink-3 truncate">{run.triggeredBy?.name ?? "—"}</div>
              </div>
            );
          })
        )}
      </section>

      <section className={`${CARD} flex flex-col gap-2 px-5 py-4`}>
        <h2 className="m-0 text-[15px] font-semibold">Scheduled sync</h2>
        <p className="text-muted m-0 text-[13px] leading-[1.5]">
          To sync every connected space on a schedule, have cron call this endpoint with the
          server&rsquo;s <code className="font-mono text-xs">CRON_SECRET</code>:
        </p>
        <pre className="bg-navy m-0 overflow-x-auto rounded-[10px] px-3.5 py-3 font-mono text-xs leading-[1.6] text-[#C6CEDA]">
          {`curl -X POST https://admin.$BASE_DOMAIN/api/cron/sync \\\n  -H "Authorization: Bearer $CRON_SECRET"`}
        </pre>
      </section>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={`${CARD} flex flex-col gap-1 px-4 py-3.5`}>
      <span className="text-muted text-[11px] font-semibold tracking-[0.5px] uppercase">{label}</span>
      <span className="text-[14px] font-semibold">{children}</span>
    </div>
  );
}
