"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Pill } from "@/components/setup/ui";
import { createGrn } from "@/lib/grn/actions";
import type { Tone } from "@/lib/grn/config";

export interface GrnRowView {
  id: string;
  number: string;
  po: string;
  invoice: string;
  date: string;
  supplier: string;
  supplierApproved: boolean;
  lines: string;
  types: string;
  status: { label: string; tone: Tone };
  toInspect: number;
  rejectedLines: number;
}

type Filter = "awaiting" | "draft" | "closed" | null;

export function GrnList({ rows }: { rows: GrnRowView[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(null);

  const awaiting = rows.filter((r) => r.status.label === "Awaiting inspection" || r.status.label === "Partly inspected" || r.status.label === "Received — no lines");
  const drafts = rows.filter((r) => r.status.label === "Draft");
  const closed = rows.filter((r) => r.status.label.startsWith("Closed"));
  const rejected = rows.reduce((n, r) => n + r.rejectedLines, 0);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = filter === "awaiting" ? awaiting : filter === "draft" ? drafts : filter === "closed" ? closed : rows;
    return q ? base.filter((r) => `${r.number} ${r.supplier} ${r.po} ${r.invoice}`.toLowerCase().includes(q)) : base;
  }, [rows, query, filter, awaiting, drafts, closed]);

  const kpis: Array<{ key: Filter; label: string; value: number; sub: string; tone: string }> = [
    { key: "awaiting", label: "Awaiting inspection", value: awaiting.length, sub: `${awaiting.reduce((n, r) => n + r.toInspect, 0)} line(s) to inspect`, tone: "text-warn" },
    { key: "draft", label: "Drafts", value: drafts.length, sub: "Receipt not confirmed yet", tone: "text-ink" },
    { key: "closed", label: "Closed", value: closed.length, sub: "All lines decided", tone: "text-ok" },
    { key: null, label: "Rejected lines", value: rejected, sub: "Counted in supplier evaluation", tone: rejected ? "text-bad" : "text-ink" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => {
          const on = k.key !== null && filter === k.key;
          return (
            <button
              key={k.label}
              type="button"
              disabled={k.key === null}
              aria-pressed={on}
              onClick={() => setFilter(on ? null : k.key)}
              className={"flex flex-col gap-1 rounded-xl border bg-white px-4 py-3.5 text-left disabled:cursor-default " + (on ? "border-brand-edge bg-brand-wash" : "border-line")}
            >
              <span className="text-muted text-[11px] font-semibold tracking-[0.5px] uppercase">{k.label}</span>
              <span className={`text-[22px] leading-tight font-bold ${k.tone}`}>{k.value}</span>
              <span className="text-faint text-[11.5px]">{k.sub}</span>
            </button>
          );
        })}
      </div>

      <section className="border-line flex flex-col gap-3 rounded-[14px] border bg-white px-4 py-[18px] sm:px-[22px]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex max-w-[720px] flex-col gap-0.5">
            <h2 className="m-0 text-[15px] font-bold">Goods receipt notes (GRN)</h2>
            <p className="text-muted m-0 text-[12.5px] leading-[1.5]">
              Receive → incoming inspection → accept into stock. Materials, components, packaging, outsourced parts, calibration returns and equipment.
            </p>
          </div>
          <form action={createGrn}>
            <NewGrnButton />
          </form>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="search"
            aria-label="Search receipts"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search GRN, supplier, PO, invoice…"
            className="border-line h-9 w-full rounded-[9px] border bg-white px-3 text-[13px] sm:w-[320px]"
          />
          <span className="text-muted text-xs">
            {shown.length} of {rows.length} receipts
          </span>
        </div>

        <div className="border-line hidden overflow-x-auto rounded-[10px] border md:block">
          <table className="w-full min-w-[820px] border-collapse">
            <thead className="bg-subtle">
              <tr>
                {["GRN", "Date", "Supplier", "Lines", "Item types", "Status"].map((h) => (
                  <th key={h} className="text-muted px-3 py-2.5 text-left text-[10.5px] font-bold tracking-[0.5px] uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="hover:bg-subtle">
                  <td className="border-line-3 border-t px-3 py-2.5 align-top">
                    <Link href={`/grn/${r.id}`} className="text-ink flex flex-col no-underline">
                      <span className="font-mono text-[13px] font-semibold">{r.number}</span>
                      {r.po ? <span className="text-muted text-[11.5px]">PO {r.po}</span> : null}
                    </Link>
                  </td>
                  <td className="border-line-3 border-t px-3 py-2.5 align-top font-mono text-[12.5px]">{r.date}</td>
                  <td className="border-line-3 border-t px-3 py-2.5 align-top text-[13px]">
                    {r.supplier || <span className="text-faint">—</span>}
                    {r.supplier && !r.supplierApproved ? <span className="text-bad block text-[11.5px] font-semibold">Not approved</span> : null}
                  </td>
                  <td className="border-line-3 text-ink-2 border-t px-3 py-2.5 align-top text-[12.5px]">{r.lines}</td>
                  <td className="border-line-3 text-ink-2 border-t px-3 py-2.5 align-top text-[12.5px]">{r.types || "—"}</td>
                  <td className="border-line-3 border-t px-3 py-2.5 align-top">
                    <Pill tone={r.status.tone}>{r.status.label}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 ? <div className="text-muted px-3 py-8 text-center text-[13px]">{rows.length ? "No receipts match." : "No receipts yet. Start one with “+ New GRN”."}</div> : null}
        </div>

        <div className="flex flex-col gap-2.5 md:hidden">
          {shown.map((r) => (
            <Link key={r.id} href={`/grn/${r.id}`} className="border-line text-ink flex flex-col gap-1.5 rounded-xl border bg-white p-3.5 no-underline">
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-[13px] font-semibold">{r.number}</span>
                <Pill tone={r.status.tone} small>
                  {r.status.label}
                </Pill>
              </div>
              <span className="text-ink-2 text-[13px]">
                {r.supplier || "No supplier yet"} · {r.date}
              </span>
              <span className="text-muted text-xs">{r.lines}</span>
            </Link>
          ))}
          {shown.length === 0 ? <div className="text-muted py-6 text-center text-[13px]">{rows.length ? "No receipts match." : "No receipts yet."}</div> : null}
        </div>
      </section>
    </div>
  );
}

function NewGrnButton() {
  return (
    <button type="submit" className="bg-brand h-9 rounded-[9px] border-0 px-3.5 text-[13px] font-bold text-white">
      + New GRN
    </button>
  );
}
