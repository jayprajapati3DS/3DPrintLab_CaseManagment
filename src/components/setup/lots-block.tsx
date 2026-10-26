"use client";

import { useState } from "react";

import { Pill, S_BTN_DARK, S_BTN_SMALL, S_INPUT, S_LABEL, S_TD, S_TH, SectionCard } from "@/components/setup/ui";
import { useFormAction } from "@/components/setup/use-form-action";
import Link from "next/link";

import { receiveViaGrn } from "@/lib/grn/actions";
import { addLotAction, adjustLotAction, removeLotAction } from "@/lib/resources/actions";
import type { Tone } from "@/lib/resources/status";

export interface LotRow {
  id: string;
  lotNumber: string;
  supplierLot: string | null;
  remaining: number;
  received: number;
  receivedOn: string | null;
  supplier: string | null;
  coa: string | null;
  expiresOn: string | null;
  expiry: null | { label: string; tone: Tone };
  /** The goods receipt it came in on; null for opening stock. */
  grn: { id: string; number: string } | null;
  adjustments: Array<{ quantity: number; reason: string; by: string; date: string }>;
  /** Untouched since it was entered, so removing it loses no history. */
  removable: boolean;
}

export function LotsBlock({
  resourceId,
  unit,
  stock,
  lots,
  suppliers,
  canEdit,
  canAdjust,
  today,
}: {
  resourceId: string;
  unit: string;
  stock: { quantity: string; consumed: string; note: string; tone: Tone };
  lots: LotRow[];
  suppliers: Array<{ id: string; name: string }>;
  canEdit: boolean;
  canAdjust: boolean;
  today: string;
}) {
  const [adding, setAdding] = useState(false);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const add = useFormAction(addLotAction, () => setAdding(false));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="border-line flex flex-col gap-1 rounded-xl border bg-white px-4 py-3.5">
          <span className="text-muted text-[11px] font-semibold tracking-[0.5px] uppercase">In stock</span>
          <span className="text-[22px] leading-tight font-bold">
            {stock.quantity} {unit}
          </span>
          <span className={"text-[12.5px] " + (stock.tone === "green" ? "text-muted" : stock.tone === "red" ? "text-bad" : "text-warn")}>
            {stock.note}
          </span>
        </div>
        <div className="border-line flex flex-col gap-1 rounded-xl border bg-white px-4 py-3.5">
          <span className="text-muted text-[11px] font-semibold tracking-[0.5px] uppercase">Consumed to date</span>
          <span className="text-[22px] leading-tight font-bold">
            {stock.consumed} {unit}
          </span>
          <span className="text-muted text-[12.5px]">Received minus remaining, across all lots.</span>
        </div>
      </div>

      <SectionCard
        title="Lot / batch inventory"
        hint="Deliveries come in through Goods Receipt: received, inspected, then released into a lot here. Stock changes only by a receipt, a quality form recording what was used, or an adjustment with a reason."
        action={
          !adding ? (
            <div className="flex flex-wrap gap-2">
              {canEdit ? (
                <button type="button" onClick={() => setAdding(true)} className={S_BTN_SMALL + " h-9"}>
                  Opening stock
                </button>
              ) : null}
              {canAdjust ? (
                <form action={receiveViaGrn}>
                  <input type="hidden" name="resourceId" value={resourceId} />
                  <button type="submit" className={S_BTN_DARK}>
                    + Receive via GRN
                  </button>
                </form>
              ) : null}
            </div>
          ) : null
        }
      >
        {adding ? (
          <form onSubmit={add.onSubmit} className="border-line bg-subtle flex flex-col gap-3 rounded-[10px] border px-3.5 py-3.5">
            <input type="hidden" name="resourceId" value={resourceId} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Lot / batch #">
                <input name="lotNumber" required autoFocus className={`${S_INPUT} font-mono`} />
              </Field>
              <Field label={`On hand (${unit})`}>
                <input name="received" type="number" step="any" min="0" required className={`${S_INPUT} font-mono`} />
              </Field>
              <Field label="Received on">
                <input name="receivedOn" type="date" defaultValue={today} max={today} className={`${S_INPUT} font-mono`} />
              </Field>
              <Field label="Expiry">
                <input name="expiresOn" type="date" className={`${S_INPUT} font-mono`} />
              </Field>
              <Field label="Supplier">
                <select name="supplierId" defaultValue="" className={S_INPUT}>
                  <option value="">Not known</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Supplier batch">
                <input name="supplierLot" className={`${S_INPUT} font-mono`} />
              </Field>
              <Field label="CoA / trace #">
                <input name="coa" className={`${S_INPUT} font-mono`} />
              </Field>
            </div>
            <p className="text-muted m-0 text-xs leading-[1.5]">
              <b>Opening stock</b> is for a lot that was already on the shelf when you started using
              the system. It is recorded without incoming inspection and marked “before GRN” in the lot
              register. New deliveries go through <b>Receive via GRN</b>.
            </p>
            {!add.state.ok && add.state.message ? (
              <p role="alert" className="text-bad m-0 text-[12.5px]">
                {add.state.message}
              </p>
            ) : null}
            <div className="flex gap-2">
              <button type="button" onClick={() => setAdding(false)} className={S_BTN_SMALL + " h-9"}>
                Cancel
              </button>
              <button type="submit" disabled={add.pending} className={S_BTN_DARK}>
                {add.pending ? "Saving…" : "Record opening stock"}
              </button>
            </div>
          </form>
        ) : null}

        <div className="border-line overflow-x-auto rounded-[10px] border">
          <table className="w-full min-w-[760px] border-collapse">
            <thead className="bg-subtle">
              <tr>
                {["Lot / batch #", "Remaining", "Received", "Recv date", "Supplier", "GRN", "CoA / trace #", "Expiry", ""].map((h, i) => (
                  <th key={i} className={S_TH}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lots.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-muted px-3 py-8 text-center text-[13px]">
                    No lots yet{canAdjust ? " — receive the first delivery with “+ Receive via GRN”." : "."}
                  </td>
                </tr>
              ) : null}
              {lots.map((lot) => (
                <LotRows
                  key={lot.id}
                  lot={lot}
                  unit={unit}
                  adjusting={adjusting === lot.id}
                  setAdjusting={(on) => setAdjusting(on ? lot.id : null)}
                  canEdit={canEdit}
                  canAdjust={canAdjust}
                />
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

function LotRows({
  lot,
  unit,
  adjusting,
  setAdjusting,
  canEdit,
  canAdjust,
}: {
  lot: LotRow;
  unit: string;
  adjusting: boolean;
  setAdjusting: (on: boolean) => void;
  canEdit: boolean;
  canAdjust: boolean;
}) {
  const adjust = useFormAction(adjustLotAction, () => setAdjusting(false));

  return (
    <>
      <tr>
        <td className={S_TD}>
          <span className="font-mono text-[12.5px] font-semibold">{lot.lotNumber}</span>
          {lot.supplierLot ? <span className="text-muted block text-[11.5px]">batch {lot.supplierLot}</span> : null}
          {canAdjust ? (
            <button
              type="button"
              onClick={() => setAdjusting(!adjusting)}
              className="text-brand-ink mt-1 block border-0 bg-transparent p-0 text-[11.5px] font-semibold"
            >
              ± Adjust stock
            </button>
          ) : null}
        </td>
        <td className={`${S_TD} font-mono text-[12.5px] font-semibold`}>
          {lot.remaining} {unit}
        </td>
        <td className={`${S_TD} font-mono text-[12.5px]`}>
          {lot.received} {unit}
        </td>
        <td className={`${S_TD} font-mono text-[12.5px]`}>{lot.receivedOn ?? "—"}</td>
        <td className={S_TD}>{lot.supplier ?? "—"}</td>
        <td className={`${S_TD} font-mono text-[12.5px]`}>
          {lot.grn ? (
            <Link href={`/grn/${lot.grn.id}`} className="text-brand-ink no-underline">
              {lot.grn.number}
            </Link>
          ) : (
            <span className="text-muted font-sans text-[11.5px]">Opening stock</span>
          )}
        </td>
        <td className={`${S_TD} font-mono text-[12.5px]`}>{lot.coa ?? "—"}</td>
        <td className={S_TD}>
          <span className="font-mono text-[12.5px]">{lot.expiresOn ?? "—"}</span>
          {lot.expiry ? (
            <span className="mt-0.5 block">
              <Pill tone={lot.expiry.tone} small>
                {lot.expiry.label}
              </Pill>
            </span>
          ) : null}
        </td>
        <td className={S_TD}>
          {canEdit && lot.removable ? (
            <form action={removeLotAction} className="flex justify-end">
              <input type="hidden" name="lotId" value={lot.id} />
              <button
                type="submit"
                aria-label={`Remove lot ${lot.lotNumber}`}
                title="Remove — entered in error"
                className="text-muted hover:text-bad h-7 w-7 rounded-md border-0 bg-transparent text-base"
              >
                ×
              </button>
            </form>
          ) : null}
        </td>
      </tr>
      {lot.adjustments.length > 0 ? (
        <tr>
          <td colSpan={9} className="text-muted bg-[#FCFCFD] px-3 pb-2.5 text-[11.5px]">
            Adjustments:{" "}
            {lot.adjustments
              .map((a) => `${a.quantity > 0 ? "+" : ""}${a.quantity} ${unit} (${a.reason}, ${a.by}, ${a.date})`)
              .join(" · ")}
          </td>
        </tr>
      ) : null}
      {adjusting ? (
        <tr>
          <td colSpan={9} className="border-line-3 bg-subtle border-t px-3 py-3">
            <form onSubmit={adjust.onSubmit} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="lotId" value={lot.id} />
              <label className="flex flex-col gap-[5px]">
                <span className={S_LABEL}>Quantity (+ / −)</span>
                <input name="quantity" type="number" step="any" required autoFocus placeholder="e.g. -0.2" className={`${S_INPUT} w-[140px] font-mono`} />
              </label>
              <label className="flex min-w-[200px] flex-1 flex-col gap-[5px]">
                <span className={S_LABEL}>Reason</span>
                <input name="reason" required placeholder="Reason — spill, scrap, stock count…" className={S_INPUT} />
              </label>
              <button type="button" onClick={() => setAdjusting(false)} className={S_BTN_SMALL + " h-[38px]"}>
                Cancel
              </button>
              <button type="submit" disabled={adjust.pending} className={S_BTN_DARK + " h-[38px]"}>
                Save adjustment
              </button>
              {!adjust.state.ok && adjust.state.message ? (
                <span role="alert" className="text-bad w-full text-[12.5px]">
                  {adjust.state.message}
                </span>
              ) : null}
            </form>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-[5px]">
      <span className={S_LABEL}>{label}</span>
      {children}
    </label>
  );
}
