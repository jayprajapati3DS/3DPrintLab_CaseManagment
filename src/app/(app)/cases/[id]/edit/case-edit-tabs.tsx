"use client";

import { useState, useTransition } from "react";

import { revealPatientAction, type PatientDetails } from "@/app/(app)/cases/actions";
import type {
  CaseFile,
  CaseScanFile,
  CaseScope,
  CaseSharedLink,
  CaseStatusRow,
} from "@/lib/platform/case-detail";

/** Everything the page shows, with the patient reduced to a mask. */
export interface CaseEditView {
  caseId: string;
  caseNumber: string;
  surgeon: string;
  caseCode: string;
  productCode: string;
  representative: string;
  scanType: string;
  surgeryDate: string;
  anticipatedShipDate: string;
  product: string;
  scopes: CaseScope[];
  notes: string;
  shippingAddress: string;
  priority: string;
  createdBy: string;
  preferenceTemplate: string;
  additionalNote: string;
  statuses: CaseStatusRow[];
  scanFiles: CaseScanFile[];
  caseFiles: CaseFile[];
  sharedLinks: CaseSharedLink[];
  /** False when the platform's page has not been read and only list data shows. */
  hasDetail: boolean;
  patient: { initial: string; hasAny: boolean; usesDateOfBirth: boolean };
}

// The platform's tabs, in its order.
const TABS = [
  { key: "info", label: "Case Info", icon: "M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1zM8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2M9 12h6M9 16h4" },
  { key: "documents", label: "Documents", icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6" },
  { key: "preferences", label: "Preferences", icon: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" },
  { key: "status", label: "Status", icon: "M22 12h-4l-3 9L9 3l-3 9H2" },
  { key: "links", label: "Links", icon: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" },
  { key: "files", label: "Files", icon: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const FIELD =
  "border-field bg-subtle text-ink-2 flex min-h-[42px] w-full items-center rounded-[9px] border px-3 py-2 text-sm";
const LABEL = "text-ink-3 text-[13px] font-semibold";
const TH = "text-muted px-3 py-2.5 text-left text-[10.5px] font-bold tracking-[0.5px] uppercase whitespace-nowrap";
const TD = "border-line-3 text-ink-2 border-t px-3 py-2.5 align-top text-[13px]";

export function CaseEditTabs({
  view,
  platformUrl,
}: {
  view: CaseEditView;
  platformUrl: string | null;
}) {
  const [tab, setTab] = useState<TabKey>("info");

  return (
    <div className="flex flex-col gap-4 pb-16">
      <div role="tablist" className="border-line flex gap-1 overflow-x-auto rounded-[14px] border bg-white p-1.5">
        {TABS.map((t) => {
          const on = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t.key)}
              className={
                "flex h-10 items-center gap-2 rounded-[10px] border-0 px-4 text-[13.5px] font-semibold whitespace-nowrap " +
                (on ? "bg-brand text-white" : "text-ink-3 hover:bg-subtle bg-transparent")
              }
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={t.icon} />
              </svg>
              {t.label}
              {t.key === "documents" && view.scanFiles.length ? <Count n={view.scanFiles.length} on={on} /> : null}
              {t.key === "files" && view.caseFiles.length ? <Count n={view.caseFiles.length} on={on} /> : null}
              {t.key === "links" && view.sharedLinks.length ? <Count n={view.sharedLinks.length} on={on} /> : null}
            </button>
          );
        })}
      </div>

      {tab === "info" ? <CaseInfo view={view} /> : null}
      {tab === "documents" ? <Documents files={view.scanFiles} hasDetail={view.hasDetail} /> : null}
      {tab === "preferences" ? <Preferences view={view} /> : null}
      {tab === "status" ? <Statuses rows={view.statuses} hasDetail={view.hasDetail} /> : null}
      {tab === "links" ? <Links links={view.sharedLinks} hasDetail={view.hasDetail} /> : null}
      {tab === "files" ? <Files files={view.caseFiles} hasDetail={view.hasDetail} /> : null}

      {/* Where the platform has its Update / Cancel pill. */}
      <div className="border-line shadow-popover fixed right-3 bottom-4 z-10 flex max-w-[calc(100vw-24px)] items-center gap-3 rounded-2xl border bg-white py-2 pr-2 pl-4 sm:right-10 sm:bottom-6 sm:rounded-full">
        <span className="text-muted text-[12.5px]">
          A copy of the platform&rsquo;s case page. Changes are made on the platform.
        </span>
        {platformUrl ? (
          <a
            href={platformUrl}
            target="_blank"
            rel="noreferrer"
            className="bg-navy flex h-9 items-center rounded-full px-4 text-[13px] font-semibold whitespace-nowrap text-white no-underline"
          >
            Edit on platform ↗
          </a>
        ) : null}
      </div>
    </div>
  );
}

function Count({ n, on }: { n: number; on: boolean }) {
  return (
    <span
      className={
        "rounded-full px-1.5 font-mono text-[11px] font-semibold " +
        (on ? "bg-white/25 text-white" : "bg-chip text-ink-3")
      }
    >
      {n}
    </span>
  );
}

// --- Case Info ----------------------------------------------------------------

function CaseInfo({ view }: { view: CaseEditView }) {
  const [patient, setPatient] = useState<PatientDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const masked = !patient;

  function togglePatient() {
    if (patient) {
      setPatient(null);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await revealPatientAction(view.caseId);
        if (result) setPatient(result);
        else setError("This case is no longer available.");
      } catch {
        setError("Could not load patient details. Please try again.");
      }
    });
  }

  const ageOrDob = view.patient.usesDateOfBirth
    ? masked
      ? "••-••-••••"
      : patient.dateOfBirth
    : masked
      ? "••"
      : patient.age;

  return (
    <Card title="Case Information" icon={TABS[0].icon}>
      <Section title="Primary details" icon="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z">
        <Field label="Case ID" value={view.caseNumber} />
        <Field label="Surgeon" value={view.surgeon} />
        <Field label="Case Code" value={view.caseCode} placeholder="Case Code" />
        <Field label="Product Code" value={view.productCode} placeholder="Product Code" />
        <Field label="Representative" value={view.representative} placeholder="Select" select />
        <Field label="Scan Type" value={view.scanType} placeholder="Select" select />

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2.5">
            <span className={LABEL}>Patient Name</span>
            {view.patient.hasAny ? (
              <button
                type="button"
                onClick={togglePatient}
                disabled={pending}
                className="text-warn h-6 rounded-md border border-[#FEDF89] bg-[#FFFAEB] px-2 text-[11.5px] font-semibold disabled:opacity-60"
              >
                {pending ? "Loading…" : masked ? "View patient details" : "Hide patient details"}
              </button>
            ) : null}
          </div>
          <div className={FIELD + (masked && view.patient.hasAny ? " font-mono" : "")}>
            {view.patient.hasAny ? (
              masked ? (
                `${view.patient.initial}·······`
              ) : (
                patient.name || <Blank>Patient Name</Blank>
              )
            ) : (
              <Blank>Patient Name</Blank>
            )}
          </div>
          {error ? (
            <span role="alert" className="text-bad text-xs">
              {error}
            </span>
          ) : null}
        </div>
        <Field label="Surgery Date ( DD-MM-YYYY ) *" value={view.surgeryDate} placeholder="Surgery Date" mono />

        <Field
          label="Anticipated Ship Date ( DD-MM-YYYY )"
          value={view.anticipatedShipDate}
          placeholder="Anticipated Ship Date"
          mono
        />
        <div className="flex flex-col gap-1.5">
          {/* The platform's switch between an age and a date of birth. */}
          <div className="flex items-center gap-2">
            <span className={view.patient.usesDateOfBirth ? "text-muted text-[13px]" : LABEL}>
              Patient Age (Years)
            </span>
            <span
              aria-hidden="true"
              className={
                "relative h-[18px] w-8 rounded-full " +
                (view.patient.usesDateOfBirth ? "bg-brand" : "bg-field")
              }
            >
              <span
                className={
                  "absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white " +
                  (view.patient.usesDateOfBirth ? "left-4" : "left-0.5")
                }
              />
            </span>
            <span className={view.patient.usesDateOfBirth ? LABEL : "text-muted text-[13px]"}>
              Date of Birth
            </span>
          </div>
          <div className={FIELD + (masked && view.patient.hasAny ? " font-mono" : "")}>
            {view.patient.hasAny ? (
              ageOrDob || <Blank>{view.patient.usesDateOfBirth ? "Date of Birth" : "Patient Age"}</Blank>
            ) : (
              <Blank>{view.patient.usesDateOfBirth ? "Date of Birth" : "Patient Age"}</Blank>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className={LABEL}>Patient Gender</span>
          <div className={FIELD + (masked && view.patient.hasAny ? " font-mono" : "")}>
            {view.patient.hasAny ? (
              masked ? (
                "••••"
              ) : (
                patient.gender || <Blank>Select</Blank>
              )
            ) : (
              <Blank>Select</Blank>
            )}
          </div>
        </div>
        {view.patient.hasAny && masked ? (
          <p className="text-muted m-0 self-end text-xs">
            Viewing patient details is recorded in the audit log.
          </p>
        ) : (
          <div />
        )}
      </Section>

      <Section title="Product configuration" icon="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8M4.6 9a1.7 1.7 0 0 0-.3-1.8M12 2v3M12 19v3M2 12h3M19 12h3">
        <Field label="Product *" value={view.product} />
        <div className="flex flex-col gap-1.5">
          <span className={LABEL + " underline"}>Scopes</span>
          <div className="border-line-3 flex flex-col border-t">
            {view.scopes.length === 0 ? (
              <span className="text-muted py-3 text-[13px]">No scope recorded.</span>
            ) : (
              view.scopes.map((scope) => (
                <div
                  key={scope.name}
                  className={
                    "flex items-center justify-between gap-3 py-2.5 text-[13.5px] " +
                    (scope.selected ? "text-ink font-semibold" : "text-ink-3")
                  }
                >
                  {scope.name}
                  <span
                    aria-label={scope.selected ? "Selected" : "Not selected"}
                    className={
                      "flex h-4 w-4 flex-none items-center justify-center rounded-full border " +
                      (scope.selected ? "border-brand bg-brand" : "border-field bg-white")
                    }
                  >
                    {scope.selected ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </Section>

      <Section title="Notes & shipping" icon="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5">
        <Field label="Notes" value={view.notes} placeholder="Notes" multiline />
        <Field label="Shipping Address" value={view.shippingAddress} placeholder="Select an address" select />
      </Section>

      <Section title="Tracking" icon="M12 8v4l3 3M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0z" last>
        <Field label="Priority" value={view.priority} placeholder="Select" select />
        <Field label="Case created by / created on" value={view.createdBy} mono />
      </Section>
    </Card>
  );
}

// --- Other tabs ---------------------------------------------------------------

function Documents({ files, hasDetail }: { files: CaseScanFile[]; hasDetail: boolean }) {
  return (
    <Card title="Scan files" icon={TABS[1].icon}>
      <Table
        head={["File Name", "Size (MB)", "Uploaded By", "Uploaded On"]}
        empty={hasDetail ? "No scan files on this case." : NOT_READ}
        rows={files.map((f) => [<strong key="n">{f.name}</strong>, f.size, f.uploadedBy, <Mono key="d">{f.uploadedOn}</Mono>])}
      />
      <Note>Files stay on the platform. Open the case there to download, upload or delete them.</Note>
    </Card>
  );
}

function Files({ files, hasDetail }: { files: CaseFile[]; hasDetail: boolean }) {
  return (
    <Card title="Case files" icon={TABS[5].icon}>
      <Table
        head={["File Name", "File Type", "Size (MB)", "Version", "Uploaded By", "Uploaded On", "Status"]}
        empty={hasDetail ? "No files on this case." : NOT_READ}
        rows={files.map((f) => [
          <strong key="n">{f.name}</strong>,
          f.type,
          f.size,
          f.version,
          f.uploadedBy,
          <Mono key="d">{f.uploadedOn}</Mono>,
          <Switch key="s" on={f.locked} />,
        ])}
      />
      <Note>Files stay on the platform. Open the case there to download, upload or delete them.</Note>
    </Card>
  );
}

function Preferences({ view }: { view: CaseEditView }) {
  return (
    <Card title="Case preferences" icon={TABS[2].icon}>
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
        <Field label="Case Preferences" value={view.preferenceTemplate} placeholder="Select Template" select />
        <div />
        <div className="col-span-2">
          <Field label="Additional Attention Note" value={view.additionalNote} placeholder="No note" multiline />
        </div>
      </div>
    </Card>
  );
}

function Statuses({ rows, hasDetail }: { rows: CaseStatusRow[]; hasDetail: boolean }) {
  return (
    <Card title="Case statuses" icon={TABS[3].icon}>
      <Table
        head={["ID", "Internal Status", "External Status", "Checklist", "Checklist Status", "Assign User", "Due Date", "Completed By", "Completed On", "Status"]}
        empty={hasDetail ? "No statuses on this case." : NOT_READ}
        highlight={rows.map((r) => r.state === "current")}
        rows={rows.map((r) => [
          r.index,
          <strong key="i">{r.internalStatus}</strong>,
          r.externalStatus,
          r.checklist ?? "",
          r.checklistStatus ? <Pill key="c">{r.checklistStatus}</Pill> : "",
          r.assignee ?? "",
          r.dueDate ? <Mono key="d">{r.dueDate}</Mono> : "",
          r.completedBy ?? "",
          r.completedOn ? <Mono key="o">{r.completedOn}</Mono> : "",
          <Switch key="s" on={r.enabled} />,
        ])}
      />
      <Note>
        Moving a case to its next status, assigning people and filling checklists happen on the
        platform.
      </Note>
    </Card>
  );
}

function Links({ links, hasDetail }: { links: CaseSharedLink[]; hasDetail: boolean }) {
  return (
    <Card title="Share viewer open link" icon={TABS[4].icon}>
      <Table
        head={["Email", "Access", "Created By", "Created On", "Link Expiration (Days)"]}
        empty={hasDetail ? "No viewer links have been shared for this case." : NOT_READ}
        rows={links.map((l) => [l.email, l.access, l.createdBy, <Mono key="d">{l.createdOn}</Mono>, l.expiresInDays])}
      />
      <Note>
        The links themselves are not copied here: each one opens the 3D viewer without signing in.
      </Note>
    </Card>
  );
}

const NOT_READ = "The platform's case page has not been read, so this is not available yet.";

// --- Pieces ---------------------------------------------------------------------

function Card({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <section className="border-line overflow-hidden rounded-[14px] border bg-white">
      <div className="border-line-2 flex items-center gap-2.5 border-b px-6 py-4 text-[15px] font-semibold">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#E24E1B" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={icon} />
        </svg>
        {title}
      </div>
      <div className="px-6 py-6">{children}</div>
    </section>
  );
}

function Section({
  title,
  icon,
  last = false,
  children,
}: {
  title: string;
  icon: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={"flex flex-col gap-5 " + (last ? "" : "border-line mb-7 border-b border-dashed pb-7")}>
      <div className="flex items-center gap-2.5">
        <span className="bg-brand-tint text-brand flex h-7 w-7 items-center justify-center rounded-[7px]">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={icon} />
          </svg>
        </span>
        <h4 className="m-0 text-[12px] font-bold tracking-[0.8px] uppercase">{title}</h4>
      </div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  placeholder,
  select = false,
  multiline = false,
  mono = false,
}: {
  label: string;
  value: string;
  placeholder?: string;
  select?: boolean;
  multiline?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={LABEL}>{label}</span>
      <div
        className={
          FIELD +
          (multiline ? " min-h-[72px] items-start whitespace-pre-wrap" : "") +
          (mono && value ? " font-mono text-[13px]" : "") +
          (select ? " justify-between gap-2" : "")
        }
      >
        {value ? <span className="min-w-0 break-words">{value}</span> : <Blank>{placeholder ?? ""}</Blank>}
        {select ? <span className="text-faint flex-none text-[10px]">▼</span> : null}
      </div>
    </div>
  );
}

function Blank({ children }: { children: React.ReactNode }) {
  return <span className="text-faint">{children}</span>;
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[12.5px] whitespace-nowrap">{children}</span>;
}

function Pill({ children }: { children: React.ReactNode }) {
  const text = String(children);
  const tone = /approved|complete/i.test(text)
    ? "bg-ok-tint text-ok"
    : /reject|fail/i.test(text)
      ? "bg-bad-tint text-bad"
      : "bg-chip text-ink-2";
  return <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${tone}`}>{children}</span>;
}

function Switch({ on }: { on: boolean }) {
  return (
    <span
      role="img"
      aria-label={on ? "On" : "Off"}
      className={"relative inline-block h-[18px] w-8 rounded-full " + (on ? "bg-[#12B76A]" : "bg-field")}
    >
      <span className={"absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white " + (on ? "left-4" : "left-0.5")} />
    </span>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-muted mt-4 mb-0 text-[12.5px] leading-[1.5]">{children}</p>;
}

function Table({
  head,
  rows,
  empty,
  highlight,
}: {
  head: string[];
  rows: React.ReactNode[][];
  empty: string;
  highlight?: boolean[];
}) {
  return (
    <div className="border-line overflow-x-auto rounded-[10px] border">
      <table className="w-full min-w-[640px] border-collapse">
        <thead className="bg-subtle">
          <tr>
            {head.map((h) => (
              <th key={h} className={TH}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={head.length} className="text-muted px-3 py-8 text-center text-[13px]">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((cells, i) => (
              <tr key={i} className={highlight?.[i] ? "bg-[#FFFCF5]" : undefined}>
                {cells.map((cell, j) => (
                  <td key={j} className={TD}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
