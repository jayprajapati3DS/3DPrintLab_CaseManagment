import Link from "next/link";

import { Pill, S_TD, S_TH, SectionCard } from "@/components/setup/ui";
import { db } from "@/lib/db";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { receiveViaGrn } from "@/lib/grn/actions";
import { grnStatus, lineBadge } from "@/lib/grn/config";
import { iso } from "@/lib/resources/queries";
import { currentLot, materialStock, type ResourceView } from "@/lib/resources/status";

/**
 * What came in, as the item and the supplier see it. Everything here is read
 * from goods receipts and lots — nothing on these panels is typed by hand.
 */

const n3 = (n: number) => Math.round(n * 1000) / 1000;

// --- An item's receipts ----------------------------------------------------------------------

export async function ItemReceipts({
  spaceId,
  resource,
  lotIds,
  canReceive,
  timeZone,
}: {
  spaceId: string;
  resource: { id: string; kind: string };
  lotIds: string[];
  canReceive: boolean;
  timeZone: string;
}) {
  const lines = await db.grnLine.findMany({
    where: {
      spaceId,
      OR: [
        { itemId: resource.id },
        { resultId: resource.id },
        ...(lotIds.length ? [{ resultId: { in: lotIds } }, { existingLotId: { in: lotIds } }] : []),
      ],
    },
    include: { grn: true },
    orderBy: { createdAt: "desc" },
  });
  const decided = lines.filter((l) => l.decision === "Accepted" || l.decision === "Rejected");
  const rejected = lines.filter((l) => l.decision === "Rejected" || Number(l.rejectedQty ?? 0) > 0).length;
  const receivable = ["materials", "components", "packaging", "measuring"].includes(resource.kind);

  return (
    <SectionCard
      title="Receipts"
      hint="Every goods receipt line for this item — received, inspected, and what was released or turned away."
      action={
        canReceive && receivable ? (
          <form action={receiveViaGrn}>
            <input type="hidden" name="resourceId" value={resource.id} />
            <button type="submit" className="bg-ink h-9 rounded-[9px] border-0 px-3.5 text-[13px] font-semibold whitespace-nowrap text-white">
              + Receive via GRN
            </button>
          </form>
        ) : null
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Receipt lines", String(lines.length)],
          ["Decided", String(decided.length)],
          ["With rejections", String(rejected)],
          ["Last received", lines[0] ? fmtDate(lines[0].grn.receivedOn, timeZone) : "—"],
        ].map(([label, value]) => (
          <div key={label} className="border-line flex flex-col gap-0.5 rounded-xl border px-3.5 py-3">
            <span className="text-muted text-[10.5px] font-semibold tracking-[0.5px] uppercase">{label}</span>
            <span className="text-[15px] font-bold">{value}</span>
          </div>
        ))}
      </div>
      {lines.length === 0 ? (
        <p className="text-muted m-0 text-[13px]">Nothing received on a GRN yet.</p>
      ) : (
        <div className="border-line overflow-x-auto rounded-[10px] border">
          <table className="w-full min-w-[820px] border-collapse">
            <thead className="bg-subtle">
              <tr>
                {["GRN", "Received", "Supplier", "What arrived", "Decision", "Inspected"].map((h) => (
                  <th key={h} className={S_TH}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const badge = lineBadge(line, line.grn.received);
                const qty = line.quantity !== null ? `${n3(Number(line.quantity))} ${line.unit ?? ""}`.trim() : "";
                const what = [
                  line.lotNumber ? `Lot ${line.lotNumber}${line.lotMode === "existing" ? " (top-up)" : ""}` : null,
                  qty || null,
                  line.rejectedQty ? `${n3(Number(line.rejectedQty))} rejected` : null,
                  line.cert ? `Certificate ${line.cert}` : null,
                  line.type === "equipment" && line.equipmentMode === "new" ? `New item${line.newAsset ? ` · ${line.newAsset}` : ""}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <tr key={line.id}>
                    <td className={`${S_TD} font-mono text-[12.5px]`}>
                      <Link href={`/grn/${line.grnId}?tab=lines`} className="text-brand-ink no-underline">
                        {line.grn.number}
                      </Link>
                    </td>
                    <td className={`${S_TD} font-mono text-xs`}>{iso(line.grn.receivedOn)}</td>
                    <td className={S_TD}>{line.grn.supplierName ?? "—"}</td>
                    <td className={`${S_TD} text-[12.5px]`}>{what || "—"}</td>
                    <td className={S_TD}>
                      <Pill tone={badge.tone}>{badge.label}</Pill>
                      {line.reason ? <span className="text-muted block pt-1 text-[11.5px]">{line.reason}</span> : null}
                    </td>
                    <td className={`${S_TD} text-[12.5px]`}>
                      {line.inspectedByName ?? "—"}
                      {line.inspectedAt ? <span className="text-muted block font-mono text-[11px]">{fmtDateTime(line.inspectedAt, timeZone)}</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

// --- A supplier's receipts -----------------------------------------------------------------------

export async function SupplierReceipts({ spaceId, vendorId, timeZone }: { spaceId: string; vendorId: string; timeZone: string }) {
  const grns = await db.grn.findMany({
    where: { spaceId, supplierId: vendorId },
    include: { lines: true },
    orderBy: { receivedOn: "desc" },
  });
  const lines = grns.filter((g) => g.received).flatMap((g) => g.lines);
  const accepted = lines.filter((l) => l.decision === "Accepted").length;
  const rejected = lines.filter((l) => l.decision === "Rejected").length;
  const partial = lines.filter((l) => l.decision === "Accepted" && Number(l.rejectedQty ?? 0) > 0).length;
  const held = lines.filter((l) => l.decision === "Quarantine").length;
  const decided = accepted + rejected;
  // A line counts against the supplier when it was rejected, whole or in part.
  const rate = decided ? Math.round(((rejected + partial) / decided) * 100) : null;

  return (
    <SectionCard
      title="Receipts and incoming inspection"
      hint="Deliveries from this supplier and how they did at incoming inspection — the record behind its evaluation (ISO 13485 §7.4.1)."
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["Deliveries", String(grns.filter((g) => g.received).length), ""],
          ["Lines accepted", String(accepted), "text-ok"],
          ["Rejected (whole or part)", String(rejected + partial), rejected + partial ? "text-bad" : ""],
          ["On hold", String(held), held ? "text-warn" : ""],
          ["Rejection rate", rate === null ? "—" : `${rate}%`, rate !== null && rate > 10 ? "text-bad" : rate ? "text-warn" : ""],
        ].map(([label, value, tone]) => (
          <div key={label} className="border-line flex flex-col gap-0.5 rounded-xl border px-3.5 py-3">
            <span className="text-muted text-[10.5px] font-semibold tracking-[0.5px] uppercase">{label}</span>
            <span className={`text-[15px] font-bold ${tone}`}>{value}</span>
          </div>
        ))}
      </div>
      {grns.length === 0 ? (
        <p className="text-muted m-0 text-[13px]">No goods receipts from this supplier yet.</p>
      ) : (
        <div className="border-line overflow-x-auto rounded-[10px] border">
          <table className="w-full min-w-[720px] border-collapse">
            <thead className="bg-subtle">
              <tr>
                {["GRN", "Received", "Lines", "Status"].map((h) => (
                  <th key={h} className={S_TH}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grns.map((g) => {
                const status = grnStatus(g);
                const acc = g.lines.filter((l) => l.decision === "Accepted").length;
                const rej = g.lines.filter((l) => l.decision === "Rejected").length;
                return (
                  <tr key={g.id}>
                    <td className={`${S_TD} font-mono text-[12.5px]`}>
                      <Link href={`/grn/${g.id}`} className="text-brand-ink no-underline">
                        {g.number}
                      </Link>
                    </td>
                    <td className={`${S_TD} font-mono text-xs`}>{fmtDate(g.receivedOn, timeZone)}</td>
                    <td className={`${S_TD} text-[12.5px]`}>
                      {g.lines.length} line{g.lines.length === 1 ? "" : "s"}
                      {acc ? ` · ${acc} accepted` : ""}
                      {rej ? ` · ${rej} rejected` : ""}
                    </td>
                    <td className={S_TD}>
                      <Pill tone={status.tone}>{status.label}</Pill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

// --- Facts on an Overview -------------------------------------------------------------------------

/** Stock, the lot in use and where it came from — read from the lots. */
export function StockFacts({ view, lots }: { view: ResourceView; lots: Array<{ supplier: string | null; grnNumber: string | null }> }) {
  const { quantity, unit } = materialStock(view);
  const lot = currentLot(view);
  const nextExpiry = view.lots
    .filter((l) => l.remaining > 0 && l.expiresOn)
    .map((l) => l.expiresOn!)
    .sort()[0];
  const suppliers = [...new Set(lots.map((l) => l.supplier).filter(Boolean))];
  const facts: Array<[string, string]> = [
    ["In stock", `${n3(quantity)} ${unit}`],
    ["Lot in use", lot ? lot.lotNumber : "—"],
    ["Next expiry", nextExpiry ?? "—"],
    ["Lots", String(view.lots.length)],
    ["Supplied by", suppliers.length ? suppliers.join(", ") : "—"],
  ];
  return (
    <section className="border-line flex min-w-0 flex-col gap-3 rounded-[14px] border bg-white px-4 py-4 sm:px-[22px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 text-sm font-bold">Stock</h3>
        <span className="text-muted text-xs">From goods receipts and lots — see the Lots &amp; stock tab.</span>
      </div>
      <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
        {facts.map(([k, v]) => (
          <div key={k} className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted text-[10.5px] font-semibold tracking-[0.5px] uppercase">{k}</dt>
            <dd className="m-0 font-mono text-[13px] font-semibold break-words">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The last calibration of an instrument — lab, certificate, date — from its record. */
export async function CalibrationFacts({ resourceId, timeZone }: { resourceId: string; timeZone: string }) {
  const record = await db.scheduleRecord.findFirst({
    where: { resourceId, track: "maintenance" },
    orderBy: [{ doneOn: "desc" }, { createdAt: "desc" }],
  });
  const grn = record?.note?.match(/GRN[-/\w]*/)?.[0] ?? null;
  const facts: Array<[string, string]> = [
    ["Last calibrated", record ? fmtDate(record.doneOn, timeZone) : "—"],
    ["Calibration lab", record?.doneBy ?? "—"],
    ["Certificate no.", record?.ref ?? "—"],
    ["Received on", grn ?? (record ? "Recorded on the item" : "—")],
  ];
  return (
    <section className="border-line flex min-w-0 flex-col gap-3 rounded-[14px] border bg-white px-4 py-4 sm:px-[22px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 text-sm font-bold">Last calibration</h3>
        <span className="text-muted text-xs">From the latest calibration record — returns from a lab come in through Goods Receipt.</span>
      </div>
      <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        {facts.map(([k, v]) => (
          <div key={k} className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted text-[10.5px] font-semibold tracking-[0.5px] uppercase">{k}</dt>
            <dd className="m-0 text-[13px] font-semibold break-words">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
