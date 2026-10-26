import type { Metadata } from "next";
import Link from "next/link";

import { CaseEditTabs, type CaseEditView } from "@/app/(app)/cases/[id]/edit/case-edit-tabs";
import { RefreshButton } from "@/app/(app)/cases/[id]/edit/refresh-button";
import { StatusBadge } from "@/components/ui/badges";
import { assertVisible, requireSpaceUser } from "@/lib/auth/rbac";
import { decryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import type { CaseStatusRow } from "@/lib/platform/case-detail";
import { loadCaseDetail } from "@/lib/queries/case-detail";
import { getCase, spaceTimeZone } from "@/lib/queries/cases";
import { formatInTimeZone } from "date-fns-tz";

export const metadata: Metadata = { title: "Edit case" };
export const dynamic = "force-dynamic";

/**
 * The platform's case edit page, reproduced here.
 *
 * Same sections, same fields, same order — so someone who knows the platform
 * finds everything where they expect it. The data is read from the platform's
 * own page when the case is opened. It is a copy: nothing here writes back.
 */
export default async function CaseEditPage({ params }: PageProps<"/cases/[id]/edit">) {
  const user = await requireSpaceUser();
  const { id } = await params;
  const record = assertVisible(await getCase(user.space.id, id));

  const [{ detail, fetchedAt, error }, timeZone, connection] = await Promise.all([
    loadCaseDetail(record),
    spaceTimeZone(user.space.id),
    db.platformConnection.findUnique({
      where: { spaceId: user.space.id },
      select: { domainUrl: true },
    }),
  ]);

  // loadCaseDetail may just have learnt the edit path; read it back.
  const editPath =
    record.platformEditPath ??
    (await db.caseRecord.findUnique({ where: { id: record.id }, select: { platformEditPath: true } }))
      ?.platformEditPath;
  const platformUrl = connection && editPath ? `${connection.domainUrl}${editPath}` : null;

  const dmy = (date: Date | null) => (date ? formatInTimeZone(date, timeZone, "dd-MM-yyyy") : "");
  const patientName = detail?.patient.name || decryptSecret(record.patientNameEncrypted) || "";

  // What the page shows: the platform's page when it has been read, and
  // otherwise as much as the case list alone provides.
  const view: CaseEditView = {
    caseId: record.id,
    caseNumber: detail?.caseNumber || record.caseNumber || `#${record.platformCaseId}`,
    surgeon: detail?.surgeon || record.surgeonName || "",
    caseCode: detail?.caseCode || record.caseCode || "",
    productCode: detail?.productCode || record.productCode || "",
    representative: detail?.representative || record.representativeName || "",
    scanType: detail?.scanType ?? "",
    surgeryDate: detail?.surgeryDate || dmy(record.surgeryDate),
    anticipatedShipDate: detail?.anticipatedShipDate || dmy(record.anticipatedShipDate),
    product: detail?.product || record.productName || "",
    scopes: detail?.scopes.length
      ? detail.scopes
      : record.scopeName
        ? [{ name: record.scopeName, selected: true }]
        : [],
    notes: detail?.notes ?? "",
    shippingAddress: detail?.shippingAddress ?? "",
    priority: detail?.priority || record.priority || "",
    createdBy: detail?.createdBy || formatInTimeZone(record.platformCreatedAt, timeZone, "dd-MM-yyyy HH:mm:ss"),
    preferenceTemplate: detail?.preferenceTemplate ?? "",
    additionalNote: detail?.additionalNote ?? "",
    statuses: detail?.statuses ?? [],
    scanFiles: detail?.scanFiles ?? [],
    caseFiles: detail?.caseFiles ?? [],
    sharedLinks: detail?.sharedLinks ?? [],
    hasDetail: Boolean(detail),
    // The mask: whether there is anything to reveal, and the name's initial.
    patient: {
      initial: patientName.trim()[0]?.toUpperCase() ?? "",
      hasAny: Boolean(
        patientName || detail?.patient.age || detail?.patient.dateOfBirth || detail?.patient.gender,
      ),
      usesDateOfBirth: detail?.patient.usesDateOfBirth ?? false,
    },
  };

  const status = detail?.currentStatus || record.caseStatus;
  const statuses = view.statuses;
  const completed = statuses.filter((s) => s.state === "completed").length;

  return (
    <div className="flex flex-col gap-4">
      {/* Title bar */}
      <section className="border-line flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[14px] border bg-white px-4 py-3.5 sm:px-5">
        <Link
          href={`/cases/${record.id}`}
          aria-label="Back to the case"
          className="text-ink-3 border-line flex h-9 w-9 flex-none items-center justify-center rounded-[9px] border no-underline"
        >
          <Chevron d="M15 18l-6-6 6-6" />
        </Link>
        <div className="flex flex-col">
          <span className="text-muted text-[10.5px] font-semibold tracking-[0.8px] uppercase">
            Edit case
          </span>
          <span className="text-[17px] leading-tight font-bold">{view.caseNumber}</span>
        </div>
        <span className="bg-line h-7 w-px" />
        <StatusBadge status={status} />
        {record.caseState ? (
          <span className="text-muted text-xs font-semibold capitalize">{record.caseState}</span>
        ) : null}

        <div className="hidden flex-1 sm:block" />

        <div className="flex w-full flex-col gap-0.5 sm:w-auto sm:items-end">
          <span className="text-muted text-[11.5px]">
            {fetchedAt
              ? `Read from the platform ${fmtDateTime(fetchedAt, timeZone)}`
              : "Not read from the platform yet"}
          </span>
        </div>
        <RefreshButton caseId={record.id} />
        {platformUrl ? (
          <a
            href={platformUrl}
            target="_blank"
            rel="noreferrer"
            className="bg-brand flex h-9 items-center rounded-[9px] px-3.5 text-[13px] font-semibold whitespace-nowrap text-white no-underline"
          >
            Open on platform ↗
          </a>
        ) : null}
      </section>

      {error ? (
        <div
          role="alert"
          className="bg-warn-tint text-warn rounded-[12px] border border-[#FEDF89] px-4 py-3 text-[13px] leading-[1.5]"
        >
          <strong>The platform&rsquo;s case page could not be read just now.</strong> {error}{" "}
          {detail
            ? "Showing what was read last time."
            : "Showing only what the case list provides; the rest is blank."}
        </div>
      ) : null}

      {/* Progress */}
      {statuses.length > 0 ? (
        <section className="border-line flex flex-col gap-4 rounded-[14px] border bg-white px-5 py-4">
          <div className="flex items-center gap-3.5">
            <ProgressRing percent={detail?.progressPercent ?? 0} />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-bold">
                {completed} of {statuses.length} completed
              </span>
              <span className="text-ink-3 flex items-center gap-1.5 text-[12.5px]">
                <span className="bg-brand h-2 w-2 rounded-full" />
                {status}
              </span>
            </div>
          </div>
          <Stepper statuses={statuses} />
        </section>
      ) : null}

      <CaseEditTabs view={view} platformUrl={platformUrl} />
    </div>
  );
}

function ProgressRing({ percent }: { percent: number }) {
  const r = 19;
  const c = 2 * Math.PI * r;
  const p = Math.min(100, Math.max(0, percent));
  return (
    <span className="relative flex h-12 w-12 flex-none items-center justify-center">
      <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true" className="-rotate-90">
        <circle cx="24" cy="24" r={r} fill="none" stroke="#F2F4F7" strokeWidth="4" />
        <circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          stroke="#12B76A"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${(p / 100) * c} ${c}`}
        />
      </svg>
      <span className="absolute font-mono text-[11px] font-semibold">{p}%</span>
    </span>
  );
}

function Stepper({ statuses }: { statuses: CaseStatusRow[] }) {
  return (
    <ol className="m-0 flex list-none overflow-x-auto p-0 pb-1">
      {statuses.map((s, i) => {
        const done = s.state === "completed";
        const current = s.state === "current";
        return (
          <li key={s.index} className="relative flex min-w-[104px] flex-1 flex-col items-center gap-1.5 px-1">
            {/* The rail to the next step, green once this one is done. */}
            {i < statuses.length - 1 ? (
              <span
                className={"absolute top-[17px] left-1/2 h-0.5 w-full " + (done ? "bg-[#12B76A]" : "bg-line")}
              />
            ) : null}
            <span
              className={
                "relative z-[1] flex h-9 w-9 items-center justify-center rounded-full text-[12px] font-bold " +
                (done
                  ? "bg-[#12B76A] text-white"
                  : current
                    ? "border-brand text-brand border-[3px] bg-white"
                    : "border-field text-faint border bg-white")
              }
            >
              {done ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              ) : current ? (
                <span className="bg-brand h-2.5 w-2.5 rounded-full" />
              ) : (
                s.index
              )}
            </span>
            <span
              className={
                "max-w-full truncate text-center text-[11.5px] " +
                (done ? "text-ok font-semibold" : current ? "text-brand-ink font-bold" : "text-muted")
              }
              title={s.internalStatus}
            >
              {s.internalStatus}
            </span>
            {s.completedOn ? (
              <span className="text-faint font-mono text-[10.5px]">{s.completedOn.slice(0, 10)}</span>
            ) : null}
            {s.completedBy || (current && s.assignee) ? (
              <span className="text-faint max-w-full truncate text-[10.5px]">
                {s.completedBy ?? s.assignee}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function Chevron({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
