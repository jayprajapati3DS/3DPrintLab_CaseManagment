import { LockIcon } from "@/components/stages/timeline";
import { caseDetails, caseFieldVar, caseFormFor, type CaseField, type CaseSetup } from "@/lib/cases/case-form";
import { decryptSecret } from "@/lib/crypto";
import { fmtDate, fmtDateTime } from "@/lib/format";

/**
 * A case opened in this app: its answers, laid out as the case form it was
 * opened with asks them, and the files uploaded with it. Answers that form no
 * longer asks are listed after it.
 */

interface LocalRecord {
  caseNumber: string | null;
  productName: string | null;
  scopeName: string | null;
  priority: string | null;
  surgeryDate: Date | null;
  anticipatedShipDate: Date | null;
  completedAt: Date | null;
  surgeonName: string | null;
  hospitalName: string | null;
  patientIdEncrypted: string | null;
  details: unknown;
  caseFormId: string | null;
  productId: string | null;
  subscopeId: string | null;
  createdByName: string | null;
  platformCreatedAt: Date;
}

interface LocalFile {
  id: string;
  field: string | null;
  name: string;
  size: number;
}

/** A section's columns — the same as the case form's. */
const GRID: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-1 sm:grid-cols-2", 3: "grid-cols-1 sm:grid-cols-3" };

/** Only the last few characters: a patient ID identifies the patient. */
function masked(value: string | null): string | null {
  if (!value) return null;
  return value.length <= 3 ? "•••" : `${"•".repeat(Math.min(6, value.length - 3))}${value.slice(-3)}`;
}

export interface CaseExtras {
  imageId: string;
  protocols: Array<{ id: string; name: string }>;
  viewers: Array<{ id: string; name: string; logoId: string | null; type: string; url: string }>;
}

export function LocalCaseInfo({
  record,
  setup,
  files,
  timeZone,
  extras,
  lastEdit = null,
  editHref,
  locked,
}: {
  record: LocalRecord;
  setup: CaseSetup;
  files: LocalFile[];
  timeZone: string;
  extras: CaseExtras | null;
  /** Its last edit — when, and by whom. */
  lastEdit?: { at: Date; by: string } | null;
  /** Where Edit information opens the case form. */
  editHref?: string;
  /** Why the information cannot be changed now — shown in place of "Edit information". */
  locked?: string | null;
}) {
  const form = caseFormFor(setup, record.caseFormId);
  const answers = new Map(caseDetails(record).map((d) => [d.var, d.value]));
  const asked = new Set(form.sections.flatMap((s) => s.fields).map((f) => caseFieldVar(f)));
  const other = caseDetails(record).filter((d) => !asked.has(d.var));
  const value = (field: CaseField): React.ReactNode => {
    switch (field.key) {
      case "caseId":
        return record.caseNumber;
      case "product":
        return record.productName;
      case "subscope":
        return record.scopeName;
      case "priority":
        return record.priority;
      case "surgeryDate":
        return record.surgeryDate ? fmtDate(record.surgeryDate, timeZone) : null;
      case "deliveryDate":
        return record.anticipatedShipDate ? fmtDate(record.anticipatedShipDate, timeZone) : null;
      case "surgeon":
        return record.surgeonName;
      case "hospital":
        return record.hospitalName;
      case "patientId":
        return masked(decryptSecret(record.patientIdEncrypted));
    }
    if (field.type === "file") {
      const own = files.filter((f) => f.field === field.var);
      const links = (answers.get(caseFieldVar(field)) ?? "")
        .split(", ")
        .filter((v) => /^https?:\/\//.test(v));
      if (!own.length && !links.length) return null;
      return (
        <span className="flex flex-col gap-1">
          {own.map((f) => (
            <a key={f.id} href={`/api/case-files/${f.id}`} className="text-brand-ink font-semibold underline [overflow-wrap:anywhere]">
              ⤓ {f.name} <span className="text-muted font-normal no-underline">({(f.size / 1024 / 1024).toFixed(1)} MB)</span>
            </a>
          ))}
          {links.map((url) => (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#155EEF] underline [overflow-wrap:anywhere]">
              {url}
            </a>
          ))}
        </span>
      );
    }
    return answers.get(caseFieldVar(field)) ?? null;
  };

  return (
    <div className="flex flex-col gap-7" data-testid="local-case">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="m-0 text-[15px] font-bold">Case Information</h3>
          {locked ? (
            <span data-testid="info-locked" title={locked} className="flex h-10 items-center gap-2 rounded-[9px] border border-[#D0D5DD] bg-[#F2F4F7] px-4 text-[13px] font-semibold text-[#344054]">
              <LockIcon size={14} />
              Locked
            </span>
          ) : editHref ? (
            <a href={editHref} className="bg-brand flex h-10 items-center gap-2 rounded-[9px] px-4 text-[13px] font-semibold text-white no-underline">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" />
              </svg>
              Edit information
            </a>
          ) : null}
        </div>
        <p className="text-muted m-0 text-[12.5px]">
          Created on {fmtDateTime(record.platformCreatedAt, timeZone)}
          {record.createdByName ? ` by ${record.createdByName}` : ""}
          {setup.forms.length > 1 ? `, with the ${form.name} form` : ""}.
        </p>
        <p className="text-muted m-0 text-[12.5px]" data-testid="last-update">
          {lastEdit ? `Last updated on ${fmtDateTime(lastEdit.at, timeZone)} by ${lastEdit.by}.` : "Not updated since."}
        </p>
      </div>
      {/* Laid out as Case Form Setup lays out the form: its sections, in order, each with its own columns. */}
      {form.sections.map((section) => {
        // The sub-scope only for a case that has one — as the form asks it only for products with scopes.
        const shown = section.fields.filter((f) => f.show && (f.type !== "subscope" || record.scopeName));
        if (!shown.length) return null;
        return (
          <div key={section.id} className="flex flex-col gap-3" data-testid="case-section">
            <div className="border-line-3 text-brand-ink border-b pb-1.5 text-[11px] font-bold tracking-[0.8px] uppercase">{section.title}</div>
            <div className={`grid gap-x-6 gap-y-4 ${GRID[section.cols] ?? GRID[2]}`}>
              {shown.map((f) => {
                const v = value(f);
                const wide = f.type === "textarea" || f.type === "file" || f.type === "people" || ((f.type === "product" || f.type === "subscope") && f.display === "cards");
                return (
                  <div key={f.id} className={"flex min-w-0 flex-col gap-1 " + (wide ? "col-span-full" : "")}>
                    <span className="text-muted text-[12px]">{f.label}</span>
                    <span className={"flex items-center gap-2.5 text-[13.5px] font-semibold [overflow-wrap:anywhere] whitespace-pre-wrap " + (v ? "text-ink" : "text-faint")}>
                      {f.type === "product" && extras?.imageId ? (
                        // eslint-disable-next-line @next/next/no-img-element -- a stored upload, served by the files route
                        <img src={`/api/files/${extras.imageId}`} alt="" className="border-line h-10 w-10 flex-none rounded-md border bg-white object-contain" />
                      ) : null}
                      {v || "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {/* Its dates, kept by the app: opened, and — once marked completed — closed. */}
      <div className="flex flex-col gap-3" data-testid="case-dates">
        <div className="border-line-3 text-brand-ink border-b pb-1.5 text-[11px] font-bold tracking-[0.8px] uppercase">Case dates</div>
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-muted text-[12px]">Case start date</span>
            <span className="text-ink text-[13.5px] font-semibold">{fmtDate(record.platformCreatedAt, timeZone)}</span>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-muted text-[12px]">Case end date</span>
            <span className={"text-[13.5px] font-semibold " + (record.completedAt ? "text-ink" : "text-faint")}>
              {record.completedAt ? fmtDate(record.completedAt, timeZone) : "Open — set when the case is marked completed"}
            </span>
          </div>
        </div>
      </div>
      {other.length ? (
        <div className="flex flex-col gap-3">
          <div className="border-line-3 text-brand-ink border-b pb-1.5 text-[11px] font-bold tracking-[0.8px] uppercase">Other answers</div>
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {other.map((d) => (
              <div key={d.var} className="flex min-w-0 flex-col gap-1">
                <span className="text-muted text-[12px]">{d.label}</span>
                <span className="text-ink text-[13.5px] font-semibold [overflow-wrap:anywhere] whitespace-pre-wrap">{d.value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
