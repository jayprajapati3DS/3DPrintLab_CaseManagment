import Link from "next/link";

import { ProductDot, StatusBadge } from "@/components/ui/badges";
import { CARD } from "@/components/ui/styles";
import { canManageSpace, requireSpaceUser } from "@/lib/auth/rbac";
import { decryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { DEFAULT_TIMEZONE, fmtDate, fmtDateTime, plural, shortPatientName } from "@/lib/format";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

/**
 * The dashboard, as far as phase 1 can take it.
 *
 * The design's dashboard is drawn from parts — what is building, what is due,
 * which forms await approval. None of that exists until parts do, so for now
 * the same layout is filled from the one thing the space does have: its cases.
 */
export default async function DashboardPage() {
  const user = await requireSpaceUser();
  const spaceId = user.space.id;
  const now = new Date();
  const open = { spaceId, bucket: { in: ["NEW", "ACTIVE"] as ("NEW" | "ACTIVE")[] } };

  const [buckets, byStatus, byProduct, upcoming, dueThisWeek, overdue, connection] =
    await Promise.all([
      db.caseRecord.groupBy({ by: ["bucket"], where: { spaceId }, _count: { _all: true } }),
      db.caseRecord.groupBy({
        by: ["caseStatus"],
        where: open,
        _count: { _all: true },
        orderBy: { _count: { caseStatus: "desc" } },
        take: 7,
      }),
      db.caseRecord.groupBy({
        by: ["productName"],
        where: open,
        _count: { _all: true },
        orderBy: { _count: { productName: "desc" } },
        take: 7,
      }),
      db.caseRecord.findMany({
        where: {
          ...open,
          surgeryDate: { gte: new Date(now.getTime() - DAY_MS), lt: new Date(now.getTime() + 14 * DAY_MS) },
        },
        orderBy: { surgeryDate: "asc" },
        take: 8,
      }),
      db.caseRecord.count({
        where: { ...open, surgeryDate: { gte: now, lt: new Date(now.getTime() + 7 * DAY_MS) } },
      }),
      db.caseRecord.count({ where: { ...open, surgeryDate: { lt: now } } }),
      db.platformConnection.findUnique({ where: { spaceId } }),
    ]);

  const timeZone = connection?.timezone || DEFAULT_TIMEZONE;
  const count = (bucket: string) => buckets.find((b) => b.bucket === bucket)?._count._all ?? 0;
  const inProgress = count("NEW") + count("ACTIVE");
  const total = inProgress + count("COMPLETED") + count("ARCHIVED");

  const kpis: Array<{ label: string; n: number; sub: string; color?: string; href: string }> = [
    { label: "Open cases", n: inProgress, sub: `Of ${total.toLocaleString("en-IN")} in this space`, href: "/cases" },
    { label: "New", n: count("NEW"), sub: "Just created", color: "#175CD3", href: "/cases?tile=new" },
    { label: "Surgery in 7 days", n: dueThisWeek, sub: "Plan and prioritise", color: "#B54708", href: "/cases?tile=progress" },
    { label: "Surgery date passed", n: overdue, sub: "Still open on the platform", color: "#B42318", href: "/cases?tile=progress" },
    { label: "Completed", n: count("COMPLETED"), sub: "Shipped or closed", color: "#067647", href: "/cases?tile=completed" },
    { label: "Archived", n: count("ARCHIVED"), sub: "Archived or cancelled", href: "/cases?tile=archived" },
  ];

  if (total === 0) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <div className="border-field flex w-[460px] max-w-full flex-col items-center gap-2 rounded-[14px] border border-dashed bg-white p-9 text-center">
          <div className="text-brand-ink text-[11px] font-semibold tracking-[0.9px] uppercase">
            Getting started
          </div>
          <div className="text-xl font-bold tracking-[-0.3px]">No cases in {user.space.name} yet</div>
          <p className="text-muted m-0 text-[13px] leading-[1.5]">
            {connection
              ? "The space is connected. Run a sync to pull its cases from the 3D Surgical Platform."
              : "Connect this space to the 3D Surgical Platform, then sync to pull its cases."}
          </p>
          {canManageSpace(user) ? (
            <Link
              href="/integrations"
              className="bg-brand mt-2 flex h-10 items-center rounded-[9px] px-4 text-[13.5px] font-semibold text-white no-underline"
            >
              Open Integrations & API
            </Link>
          ) : (
            <p className="text-muted m-0 text-[13px]">Ask a space admin to set this up.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => (
          <Link
            key={k.label}
            href={k.href}
            className="border-line text-ink flex flex-col gap-1 rounded-xl border bg-white px-4 py-3.5 no-underline"
          >
            <span className="text-muted text-[11px] font-semibold tracking-[0.5px] uppercase">
              {k.label}
            </span>
            <span
              className="text-[26px] leading-tight font-bold"
              style={{ color: k.n > 0 && k.color ? k.color : "#101828" }}
            >
              {k.n.toLocaleString("en-IN")}
            </span>
            <span className="text-faint text-[11.5px]">{k.sub}</span>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <Bars
          title="Open cases by status"
          subtitle="Where open cases are on the platform."
          rows={byStatus.map((s) => ({ label: s.caseStatus ?? "No status", n: s._count._all }))}
        />
        <Bars
          title="Open cases by product"
          subtitle="What is being made."
          rows={byProduct.map((p) => ({ label: p.productName ?? "No product", n: p._count._all }))}
        />
      </div>

      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className={`${CARD} flex min-w-0 flex-col gap-2.5 px-4 py-[18px] sm:px-5`}>
          <div className="flex flex-col gap-0.5">
            <h3 className="m-0 text-sm font-bold">Surgery in the next 14 days</h3>
            <span className="text-muted text-xs">Open cases, soonest first.</span>
          </div>
          <div className="text-muted hidden grid-cols-[120px_minmax(0,1.3fr)_minmax(0,1fr)_110px_minmax(0,1fr)] gap-2.5 px-2.5 md:grid text-[10.5px] font-semibold tracking-[0.5px] uppercase">
            <div>Case</div>
            <div>Product</div>
            <div>Surgeon</div>
            <div>Surgery</div>
            <div>Status</div>
          </div>
          {upcoming.map((c) => {
            const days = c.surgeryDate
              ? Math.round((c.surgeryDate.getTime() - now.getTime()) / DAY_MS)
              : null;
            return (
              <Link
                key={c.id}
                href={`/cases/${c.id}`}
                className="border-line-2 text-ink grid grid-cols-2 items-center gap-2.5 md:grid-cols-[120px_minmax(0,1.3fr)_minmax(0,1fr)_110px_minmax(0,1fr)] rounded-[10px] border px-2.5 py-[9px] text-[12.5px] no-underline"
              >
                <span className="text-brand-ink truncate font-mono text-[11.5px] font-semibold">
                  {c.caseNumber ?? `#${c.platformCaseId}`}
                </span>
                <span className="flex min-w-0 flex-col gap-px">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <ProductDot product={c.productName} />
                    <span className="truncate font-semibold">{c.productName ?? "—"}</span>
                  </span>
                  <span className="text-muted truncate text-[11.5px]">
                    {shortPatientName(decryptSecret(c.patientNameEncrypted))}
                  </span>
                </span>
                <span className="text-ink-2 truncate">{c.surgeonName ?? "—"}</span>
                <span className="flex flex-col gap-px">
                  <span className="font-mono text-[11.5px]">{fmtDate(c.surgeryDate, timeZone)}</span>
                  {days !== null ? (
                    <span
                      className="text-[11.5px] font-bold"
                      style={{ color: days <= 3 ? "#B54708" : "#475467" }}
                    >
                      {days <= 0 ? "Today" : `In ${days}d`}
                    </span>
                  ) : null}
                </span>
                <span>
                  <StatusBadge status={c.caseStatus} />
                </span>
              </Link>
            );
          })}
          {upcoming.length === 0 ? (
            <span className="text-muted text-xs">No surgery scheduled in the next 14 days.</span>
          ) : null}
        </section>

        <div className="flex flex-col gap-3.5">
          <section className={`${CARD} flex min-w-0 flex-col gap-2.5 px-4 py-[18px] sm:px-5`}>
            <h3 className="m-0 text-sm font-bold">Platform sync</h3>
            <dl className="m-0 grid grid-cols-[110px_minmax(0,1fr)] gap-y-2 text-[12.5px]">
              <dt className="text-muted">Platform</dt>
              <dd className="m-0 truncate">{connection?.verifiedName ?? connection?.domainUrl ?? "Not connected"}</dd>
              <dt className="text-muted">Last sync</dt>
              <dd className="m-0">
                {connection?.lastSyncAt ? fmtDateTime(connection.lastSyncAt, timeZone) : "Never"}
              </dd>
              <dt className="text-muted">Result</dt>
              <dd className="m-0 capitalize">{connection?.lastSyncStatus?.toLowerCase() ?? "—"}</dd>
              <dt className="text-muted">Cases</dt>
              <dd className="m-0">{plural(total, "case")}</dd>
            </dl>
            {canManageSpace(user) ? (
              <Link href="/integrations" className="text-brand-ink text-[12.5px] font-semibold no-underline">
                Open Integrations & API →
              </Link>
            ) : null}
          </section>

          <section className="border-field flex flex-col gap-1.5 rounded-[14px] border border-dashed bg-white px-5 py-[18px]">
            <div className="text-brand-ink text-[11px] font-semibold tracking-[0.9px] uppercase">
              Planned
            </div>
            <h3 className="m-0 text-sm font-bold">Production dashboard</h3>
            <p className="text-muted m-0 text-[12.5px] leading-[1.5]">
              The pipeline, machine load, due dates and forms awaiting approval are all drawn from
              parts. They appear here once part requests are built.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

function Bars({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: Array<{ label: string; n: number }>;
}) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-3 px-4 py-[18px] sm:px-5`}>
      <div className="flex flex-col gap-0.5">
        <h3 className="m-0 text-sm font-bold">{title}</h3>
        <span className="text-muted text-xs">{subtitle}</span>
      </div>
      {rows.map((r) => (
        <div
          key={r.label}
          className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_40px] items-center gap-3 text-[13px] sm:grid-cols-[170px_minmax(0,1fr)_40px]"
        >
          <span className="text-ink-2 truncate">{r.label}</span>
          <div className="bg-chip h-3.5 overflow-hidden rounded-[7px]">
            <div
              className="bg-brand h-full rounded-[7px]"
              style={{ width: `${Math.round((r.n / max) * 100)}%` }}
            />
          </div>
          <span className="text-right font-bold">{r.n.toLocaleString("en-IN")}</span>
        </div>
      ))}
      {rows.length === 0 ? <span className="text-muted text-xs">No open cases.</span> : null}
    </section>
  );
}
