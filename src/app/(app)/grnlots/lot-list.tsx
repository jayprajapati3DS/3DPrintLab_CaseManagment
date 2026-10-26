"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Pill } from "@/components/setup/ui";
import type { LotRow } from "@/lib/grn/queries";

export function LotList({ rows }: { rows: LotRow[] }) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => `${r.lot} ${r.batch} ${r.grn} ${r.item} ${r.supplier}`.toLowerCase().includes(q)) : rows;
  }, [rows, query]);

  return (
    <section className="border-line flex flex-col gap-3 rounded-[14px] border bg-white px-4 py-[18px] sm:px-[22px]">
      <div className="flex max-w-[760px] flex-col gap-0.5">
        <h2 className="m-0 text-[15px] font-bold">Lots</h2>
        <p className="text-muted m-0 text-[12.5px] leading-[1.5]">
          Search any lot ID, supplier batch, CoA or GRN to see its full history — receipt, inspection, release, every part made from it, adjustments and expiry.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <input
          type="search"
          aria-label="Search lots"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Lot ID, supplier batch, CoA, GRN, item…"
          className="border-line h-9 w-full rounded-[9px] border bg-white px-3 text-[13px] sm:w-[320px]"
        />
        <span className="text-muted text-xs">
          {shown.length} of {rows.length} lots
        </span>
      </div>

      <div className="border-line hidden overflow-x-auto rounded-[10px] border md:block">
        <table className="w-full min-w-[860px] border-collapse">
          <thead className="bg-subtle">
            <tr>
              {["Lot ID", "Item", "Supplier · batch", "GRN", "Expiry", "Remaining", "Status"].map((h) => (
                <th key={h} className="text-muted px-3 py-2.5 text-left text-[10.5px] font-bold tracking-[0.5px] uppercase">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key} className="hover:bg-subtle">
                <td className="border-line-3 border-t px-3 py-2.5 font-mono text-[13px] font-semibold">
                  <Link href={`/grnlots/${r.key}`} className="text-ink no-underline">
                    {r.lot}
                  </Link>
                </td>
                <td className="border-line-3 border-t px-3 py-2.5 text-[13px]">
                  <span className="font-semibold">{r.item}</span>
                  <span className="text-muted block text-[11.5px]">{r.kind}</span>
                </td>
                <td className="border-line-3 text-ink-2 border-t px-3 py-2.5 text-[12.5px]">
                  {r.supplier || "—"}
                  {r.batch ? <span className="text-muted block font-mono text-[11.5px]">{r.batch}</span> : null}
                </td>
                <td className="border-line-3 border-t px-3 py-2.5 font-mono text-[12.5px]">
                  {r.grnId ? (
                    <Link href={`/grn/${r.grnId}`} className="text-brand-ink no-underline">
                      {r.grn}
                    </Link>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </td>
                <td className="border-line-3 border-t px-3 py-2.5 font-mono text-[12.5px]">{r.expiry ?? "—"}</td>
                <td className="border-line-3 border-t px-3 py-2.5 font-mono text-[12.5px]">{r.remaining}</td>
                <td className="border-line-3 border-t px-3 py-2.5">
                  <Pill tone={r.tone}>{r.status}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 ? <div className="text-muted px-3 py-8 text-center text-[13px]">No lots match.</div> : null}
      </div>

      <div className="flex flex-col gap-2.5 md:hidden">
        {shown.map((r) => (
          <Link key={r.key} href={`/grnlots/${r.key}`} className="border-line text-ink flex flex-col gap-1 rounded-xl border bg-white p-3.5 no-underline">
            <div className="flex items-start justify-between gap-2">
              <span className="font-mono text-[13px] font-semibold">{r.lot}</span>
              <Pill tone={r.tone} small>
                {r.status}
              </Pill>
            </div>
            <span className="text-ink-2 text-[13px]">{r.item}</span>
            <span className="text-muted text-xs">
              {[r.supplier, r.grn, r.expiry ? `exp ${r.expiry}` : null, r.remaining].filter(Boolean).join(" · ")}
            </span>
          </Link>
        ))}
        {shown.length === 0 ? <div className="text-muted py-6 text-center text-[13px]">No lots match.</div> : null}
      </div>
    </section>
  );
}
