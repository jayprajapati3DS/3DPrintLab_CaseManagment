"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { useToast } from "@/components/ui/toast";
import { addStandardTemplates, createTemplate, deleteTemplate, duplicateTemplate, saveQaSettings } from "@/lib/qa/actions";

export interface TemplateRowView {
  id: string;
  name: string;
  code: string;
  clause: string;
  sections: number;
  items: number;
  measurements: number;
  variables: number;
  parts: number;
  attach: string[];
  /** product | manufacturing | generic */
  usedFor: string;
}

const USED_FOR_TAG: Record<string, { label: string; cls: string }> = {
  product: { label: "Product", cls: "bg-[#EFF8FF] text-[#175CD3]" },
  manufacturing: { label: "Manufacturing", cls: "bg-[#FFF4ED] text-[#C4320A]" },
  generic: { label: "Generic", cls: "bg-[#F2F4F7] text-[#344054]" },
};

function UsedForTag({ usedFor }: { usedFor: string }) {
  const t = USED_FOR_TAG[usedFor] ?? USED_FOR_TAG.generic;
  return <span className={"self-start rounded-md px-1.5 py-[1px] text-[10.5px] font-semibold " + t.cls}>{t.label}</span>;
}

const CLIPBOARD = "M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1zM8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2M9 13l2 2 4-4";

export function QaList({
  rows,
  canEdit,
  separateApprover,
}: {
  rows: TemplateRowView[];
  canEdit: boolean;
  separateApprover: boolean;
}) {
  const router = useRouter();
  const { toast, node } = useToast();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [usedFor, setUsedFor] = useState("all");
  const [view, setView] = useState<"table" | "card">("table");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byUse = usedFor === "all" ? rows : rows.filter((r) => r.usedFor === usedFor);
    return q ? byUse.filter((r) => `${r.name} ${r.code} ${r.clause}`.toLowerCase().includes(q)) : byUse;
  }, [rows, query, usedFor]);

  const act = (fn: () => Promise<{ ok: boolean; message?: string; id?: string }>, then?: (id?: string) => void) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        toast(result.message ?? "That did not work.", true);
        return;
      }
      if (result.message) toast(result.message);
      router.refresh();
      then?.(result.id);
    });

  // How the form will look on a part, without opening the editor.
  const previewLink = (row: TemplateRowView) => (
    <Link
      href={`/qaforms?preview=${row.id}`}
      scroll={false}
      aria-label={`Preview ${row.name}`}
      className="border-field text-ink-2 flex h-8 items-center gap-1 rounded-lg border bg-white px-2.5 text-[12.5px] font-semibold no-underline"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
      Preview
    </Link>
  );

  const actions = (row: TemplateRowView) =>
    canEdit ? (
      <div className="flex flex-wrap gap-1.5">
        {previewLink(row)}
        <Link href={`/qaforms/${row.id}`} className="border-field text-ink-2 flex h-8 items-center rounded-lg border bg-white px-2.5 text-[12.5px] font-semibold no-underline">
          Edit
        </Link>
        <button type="button" disabled={pending} onClick={() => act(() => duplicateTemplate(row.id))} className="border-field text-ink-2 h-8 rounded-lg border bg-white px-2.5 text-[12.5px] font-semibold">
          Duplicate
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (window.confirm(`Delete "${row.name}"? Records already filled on parts are kept.`)) act(() => deleteTemplate(row.id));
          }}
          className="h-8 rounded-lg border border-[#FDA29B] bg-white px-2.5 text-[12.5px] font-semibold text-[#B42318]"
        >
          Delete
        </button>
      </div>
    ) : (
      <div className="flex flex-wrap gap-1.5">
        {previewLink(row)}
        <Link href={`/qaforms/${row.id}`} className="border-field text-ink-2 flex h-8 items-center rounded-lg border bg-white px-2.5 text-[12.5px] font-semibold no-underline">
          View
        </Link>
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <section className="border-line flex flex-col gap-3.5 rounded-[14px] border bg-white px-4 py-[18px] sm:px-[22px]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="m-0 text-[15px] font-bold">QA forms</h2>
            <p className="text-muted m-0 text-[12.5px]">
              {rows.length} form{rows.length === 1 ? "" : "s"} · click a form to edit it. A form is added to a part at the workflow stages chosen in its Form details.
            </p>
          </div>
          {canEdit ? (
            <form action={createTemplate}>
              <button type="submit" className="bg-brand h-9 rounded-[9px] border-0 px-3.5 text-[13px] font-bold text-white">
                + New QA form
              </button>
            </form>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="search"
            aria-label="Search QA forms"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, code or standard…"
            className="border-line h-9 w-full rounded-[9px] border bg-white px-3 text-[13px] sm:w-[320px]"
          />
          <select
            aria-label="Used for"
            value={usedFor}
            onChange={(e) => setUsedFor(e.target.value)}
            className="border-line h-9 rounded-[9px] border bg-white px-2.5 text-[13px]"
          >
            <option value="all">All forms</option>
            <option value="product">Product (case stages)</option>
            <option value="manufacturing">Manufacturing (part workflows)</option>
            <option value="generic">Generic</option>
          </select>
          <div className="hidden flex-1 sm:block" />
          <div className="bg-chip hidden rounded-[9px] p-[3px] md:flex">
            {(["table", "card"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={"h-8 rounded-[7px] border-0 px-3 text-xs font-semibold " + (view === v ? "text-ink bg-white shadow-[0_1px_2px_rgba(16,24,40,.08)]" : "text-muted bg-transparent")}
              >
                {v === "table" ? "Table" : "Cards"}
              </button>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="border-field flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-9 text-center">
            <div className="text-[15px] font-bold">No QA forms yet</div>
            <p className="text-muted m-0 max-w-[520px] text-[13px] leading-[1.5]">
              Start from the six standard forms — QAC, batch manufacturing record, polymer build record, final inspection,
              sterilization checklist and device history record — and adapt them, or build your own.
            </p>
            {canEdit ? (
              <button type="button" disabled={pending} onClick={() => act(() => addStandardTemplates())} className="bg-ink mt-1 h-9 rounded-[9px] border-0 px-3.5 text-[13px] font-semibold text-white">
                Add the six standard forms
              </button>
            ) : (
              <p className="text-muted m-0 text-[13px]">Ask a space admin to set QA forms up.</p>
            )}
          </div>
        ) : shown.length === 0 ? (
          <div className="text-muted py-8 text-center text-[13px]">No QA forms match your search.</div>
        ) : (
          <>
            <div className={(view === "table" ? "hidden md:block" : "hidden") + " border-line overflow-x-auto rounded-[10px] border"}>
              <table className="w-full min-w-[860px] border-collapse">
                <thead className="bg-subtle">
                  <tr>
                    {["Form", "Standard / clause", "Sections", "Items", "Measurements", "Variables", "Used on parts", "Actions"].map((h) => (
                      <th key={h} className="text-muted px-3 py-2.5 text-left text-[10.5px] font-bold tracking-[0.5px] uppercase">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => (
                    <tr key={row.id}>
                      <td className="border-line-3 border-t px-3 py-2.5 align-top">
                        <Link href={`/qaforms/${row.id}`} className="text-ink flex flex-col no-underline">
                          <span className="text-[13.5px] font-semibold">{row.name}</span>
                          <span className="text-brand-ink font-mono text-[11.5px]">{row.code || "—"}</span>
                          <UsedForTag usedFor={row.usedFor} />
                        </Link>
                      </td>
                      <td className="border-line-3 text-ink-2 border-t px-3 py-2.5 align-top text-[13px]">{row.clause || "—"}</td>
                      {[row.sections, row.items, row.measurements, row.variables, row.parts].map((n, i) => (
                        <td key={i} className="border-line-3 border-t px-3 py-2.5 align-top font-mono text-[13px]">
                          {n}
                        </td>
                      ))}
                      <td className="border-line-3 border-t px-3 py-2.5 align-top">{actions(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={"grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 " + (view === "table" ? "md:hidden" : "")}>
              {shown.map((row) => (
                <div key={row.id} className="border-line border-l-brand flex flex-col gap-3 rounded-xl border border-l-[3px] bg-white p-4">
                  <Link href={`/qaforms/${row.id}`} className="text-ink flex items-start gap-3 no-underline">
                    <span className="bg-brand-wash text-brand flex h-10 w-10 flex-none items-center justify-center rounded-[10px]">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d={CLIPBOARD} />
                      </svg>
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="text-sm font-bold">{row.name}</span>
                      <span className="text-brand-ink font-mono text-[11.5px]">{row.code || "—"}</span>
                      <UsedForTag usedFor={row.usedFor} />
                      <span className="text-muted text-xs">{row.clause}</span>
                    </span>
                  </Link>
                  <div className="text-ink-3 grid grid-cols-4 gap-1 text-center text-[11px]">
                    {[
                      [row.sections, "sections"],
                      [row.items, "items"],
                      [row.variables, "variables"],
                      [row.parts, "parts"],
                    ].map(([n, l]) => (
                      <span key={l} className="bg-subtle flex flex-col rounded-lg py-1.5">
                        <span className="text-ink font-mono text-sm font-semibold">{n}</span>
                        {l}
                      </span>
                    ))}
                  </div>
                  {actions(row)}
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="border-line flex flex-wrap items-center justify-between gap-3 rounded-[14px] border bg-white px-4 py-4 sm:px-[22px]">
        <div className="flex min-w-[240px] flex-1 flex-col gap-0.5">
          <h3 className="m-0 text-sm font-bold">Approval rule</h3>
          <p className="text-muted m-0 text-[12.5px] leading-[1.5]">
            {separateApprover
              ? "A form is submitted for approval, and approved by a different person from the one who submitted it."
              : "Anyone may approve a form, including the person who filled it in."}{" "}
            Approvals are recorded with the signed-in account and the time.
          </p>
        </div>
        <label className="flex items-center gap-2.5 text-[13px] font-semibold">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={separateApprover}
            disabled={!canEdit || pending}
            onChange={(e) => act(() => saveQaSettings(e.target.checked))}
          />
          Approver must be a different person
        </label>
      </section>
      {node}
    </div>
  );
}
