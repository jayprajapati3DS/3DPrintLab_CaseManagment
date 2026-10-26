"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Pill } from "@/components/setup/ui";
import { useToast } from "@/components/ui/toast";
import {
  confirmReceipt,
  decideLine,
  deleteDraftGrn,
  removeGrnDocument,
  removeGrnLine,
  saveGrnHeader,
  saveGrnLine,
  saveLineTests,
  uploadGrnDocuments,
  type GrnActionResult,
  type LinePayload,
} from "@/lib/grn/actions";
import {
  EQUIPMENT_CATEGORIES,
  lineBadge,
  list,
  LOT_TYPES,
  pieceWords,
  ruleText,
  STOCK_TYPES,
  testOutcome,
  TYPE_CHIPS,
  type GrnConfig,
  type LineType,
  type PieceResult,
  type TestEntry,
} from "@/lib/grn/config";
import type { LineOptions } from "@/lib/grn/queries";

/** The receipt screens' interactive parts: header, lines, inspection, documents. */

type Run = ReturnType<typeof useRun>["run"];

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { toast, node } = useToast();
  const run = (fn: () => Promise<GrnActionResult>, done?: string, after?: () => void) =>
    startTransition(async () => {
      try {
        const result = await fn();
        if (!result.ok) {
          toast(result.message ?? "That did not work.", true);
          return;
        }
        const message = result.message ?? done;
        if (message) toast(message);
        after?.();
        router.refresh();
      } catch (error) {
        // A redirect from the server (after deleting a draft) is not a failure.
        if (error && typeof error === "object" && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw error;
        toast("The request did not reach the server. Check the connection and try again.", true);
      }
    });
  return { run, pending, node, toast };
}

const INPUT = "border-field text-ink h-[38px] w-full min-w-0 rounded-lg border bg-white px-2.5 text-[13px] disabled:bg-subtle disabled:text-ink-3";
const LABEL = "text-ink-3 flex min-w-0 flex-col gap-[5px] text-[11px] font-semibold tracking-[0.5px] uppercase";

// --- Header -------------------------------------------------------------------------------------

export function HeaderForm({
  grnId,
  config,
  suppliers,
  initial,
  editable,
}: {
  grnId: string;
  config: GrnConfig;
  suppliers: LineOptions["suppliers"];
  initial: { supplierId: string; receivedOn: string; header: Record<string, string> };
  editable: boolean;
}) {
  const { run, pending, node } = useRun();
  const [state, setState] = useState(initial);
  // A receipt not created yet has its details to save from the start.
  const creating = grnId === "new";
  const dirty = creating || JSON.stringify(state) !== JSON.stringify(initial);
  const conditions = list(config.conditions);
  const supplier = suppliers.find((s) => s.id === state.supplierId);

  return (
    <fieldset disabled={!editable || pending} className="m-0 flex flex-col gap-4 border-0 p-4 sm:p-[22px]">
      <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2 lg:grid-cols-3">
        <label className={LABEL}>
          Supplier *
          <select value={state.supplierId} onChange={(e) => setState((s) => ({ ...s, supplierId: e.target.value }))} className={`${INPUT} tracking-normal normal-case`}>
            <option value="">— Select the supplier —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.kind ? ` · ${s.kind}` : ""} ({s.status})
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          Received on *
          <input type="date" value={state.receivedOn} onChange={(e) => setState((s) => ({ ...s, receivedOn: e.target.value }))} className={`${INPUT} font-mono tracking-normal`} />
        </label>
        {config.header
          .filter((h) => h.show)
          .map((h) => (
            <label key={h.k} className={LABEL}>
              <span>
                {h.label}
                {h.req ? " *" : ""}
              </span>
              {h.type === "select" ? (
                <select
                  value={state.header[h.k] ?? ""}
                  onChange={(e) => setState((s) => ({ ...s, header: { ...s.header, [h.k]: e.target.value } }))}
                  className={`${INPUT} tracking-normal normal-case`}
                >
                  <option value="">Select…</option>
                  {(h.k === "condition" ? conditions : list(h.opts)).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={h.type === "date" ? "date" : h.type === "number" ? "number" : "text"}
                  value={state.header[h.k] ?? ""}
                  onChange={(e) => setState((s) => ({ ...s, header: { ...s.header, [h.k]: e.target.value } }))}
                  className={`${INPUT} tracking-normal normal-case ${["po", "invoice", "dn"].includes(h.k) || h.type === "date" ? "font-mono" : ""}`}
                />
              )}
            </label>
          ))}
      </div>
      {supplier?.warn ? <div className="bg-warn-tint text-warn rounded-lg px-3 py-2 text-[12.5px]">⚠ {supplier.warn}</div> : null}
      {editable ? (
        <button
          type="button"
          disabled={!dirty || pending}
          onClick={() => run(() => saveGrnHeader(grnId, JSON.stringify(state)), "Receipt details saved")}
          className="bg-ink h-9 self-start rounded-[9px] border-0 px-3.5 text-[13px] font-semibold text-white disabled:opacity-45"
        >
          {pending ? "Saving…" : creating ? "Create receipt" : "Save receipt details"}
        </button>
      ) : null}
      {node}
    </fieldset>
  );
}

export function ConfirmReceipt({ grnId, hint, ready }: { grnId: string; hint: string; ready: boolean }) {
  const { run, pending, node } = useRun();
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[12px] border border-[#FEDF89] bg-[#FFFAEB] px-4 py-3">
      <div className="flex min-w-[220px] flex-1 flex-col gap-0.5">
        <span className="text-warn text-[13px] font-bold">Draft — goods not received into the system yet</span>
        <span className="text-ink-2 text-[12.5px]">{hint}</span>
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => confirmReceipt(grnId))}
        className={"h-9 rounded-[9px] border-0 px-3.5 text-[13px] font-bold text-white disabled:opacity-60 " + (ready ? "bg-brand" : "bg-[#F4A585]")}
      >
        Confirm receipt
      </button>
      {node}
    </div>
  );
}

export function DeleteDraft({ grnId, number }: { grnId: string; number: string }) {
  const { run, pending, node } = useRun();
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (window.confirm(`Delete the draft ${number}? Nothing has been received on it.`)) run(() => deleteDraftGrn(grnId));
        }}
        className="h-9 rounded-[9px] border border-[#FDA29B] bg-white px-3 text-[13px] font-semibold text-[#B42318]"
      >
        Delete draft
      </button>
      {node}
    </>
  );
}

// --- Lines ----------------------------------------------------------------------------------------

export interface LineView extends LinePayload {
  id: string;
  position: number;
  itemName: string | null;
  tests: Record<string, TestEntry>;
  rejectedQty: string;
  decision: string | null;
  reason: string | null;
  inspectedByName: string | null;
  inspectedAt: string | null;
  testSummary: string | null;
}

const blankLine = (type: LineType): LinePayload => ({
  type,
  itemId: "",
  lotMode: "new",
  lotNumber: "",
  existingLotId: "",
  supplierBatch: "",
  quantity: "",
  unit: "",
  expiry: "",
  coa: "",
  partIds: [],
  ref: "",
  calItemId: "",
  cert: "",
  calDate: "",
  category: "tooling",
  equipmentMode: "existing",
  newName: "",
  newAsset: "",
  description: "",
  extra: {},
});

export function LinesPanel({
  grnId,
  received,
  closed,
  lines,
  config,
  options,
  nextLotIds,
}: {
  grnId: string;
  received: boolean;
  closed: boolean;
  lines: LineView[];
  config: GrnConfig;
  options: LineOptions;
  /** What an auto lot ID would be now, per type. */
  nextLotIds: Record<string, string>;
}) {
  const { run, pending, node } = useRun();
  const [editing, setEditing] = useState<{ id: string | null; line: LinePayload } | null>(null);
  const [inspecting, setInspecting] = useState<string | null>(null);

  const types = (Object.keys(config.types) as LineType[]).filter((t) => config.types[t].on);

  return (
    <div className="flex flex-col gap-3 p-4 sm:p-[22px]">
      {lines.length === 0 && !editing ? (
        <div className="border-field text-muted rounded-xl border border-dashed px-5 py-8 text-center text-[13px]">No lines yet — add what arrived in this delivery.</div>
      ) : null}

      {lines.map((line) => {
        const badge = lineBadge({ type: line.type, decision: line.decision, rejectedQty: line.rejectedQty }, received);
        const decided = line.decision === "Accepted" || line.decision === "Rejected";
        const canEdit = !line.decision;
        const canInspect = received && !decided;
        if (editing?.id === line.id) {
          return (
            <LineForm
              key={line.id}
              grnId={grnId}
              lineId={line.id}
              initial={editing.line}
              config={config}
              options={options}
              nextLotIds={nextLotIds}
              run={run}
              pending={pending}
              onDone={() => setEditing(null)}
            />
          );
        }
        return (
          <div key={line.id} className="border-line flex flex-col gap-3 rounded-xl border px-4 py-3.5">
            <div className="flex flex-wrap items-start gap-3">
              <span className="bg-chip text-ink-2 flex h-7 w-7 flex-none items-center justify-center rounded-full font-mono text-xs font-bold">{line.position}</span>
              <div className="flex min-w-[200px] flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded px-[7px] py-px text-[10px] font-bold tracking-[0.4px] uppercase" style={{ background: TYPE_CHIPS[line.type].bg, color: TYPE_CHIPS[line.type].fg }}>
                    {config.types[line.type].label}
                  </span>
                  <span className="text-sm font-bold">{lineTitle(line)}</span>
                </div>
                <span className="text-muted font-mono text-[11.5px] break-words">{lineFacts(line).join(" · ")}</span>
                {line.reason ? <span className="text-ink-2 text-xs">Reason: {line.reason}</span> : null}
                {line.decision ? (
                  <span className="text-muted text-xs">
                    {line.decision === "Quarantine" ? "On hold" : line.decision} by {line.inspectedByName} · {line.inspectedAt}
                  </span>
                ) : null}
                {STOCK_TYPES.includes(line.type) && line.decision === "Accepted" ? (
                  <span className="text-ok text-xs font-semibold">
                    Received {line.quantity} · rejected {line.rejectedQty || 0} · released {Math.round((Number(line.quantity) - Number(line.rejectedQty || 0)) * 1000) / 1000} {line.unit}
                  </span>
                ) : null}
                {line.testSummary ? <span className="text-muted text-[11.5px] break-words">Results: {line.testSummary}</span> : null}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Pill tone={badge.tone}>{badge.label}</Pill>
                {canInspect ? (
                  <button
                    type="button"
                    onClick={() => setInspecting(inspecting === line.id ? null : line.id)}
                    className="bg-ink h-8 rounded-lg border-0 px-3 text-[12.5px] font-semibold text-white"
                  >
                    {inspecting === line.id ? "Close" : line.decision === "Quarantine" ? "Re-inspect" : "Inspect"}
                  </button>
                ) : null}
                {canEdit && !closed ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setEditing({ id: line.id, line: toPayload(line) })}
                      className="border-field h-8 rounded-lg border bg-white px-2.5 text-[12.5px] font-semibold"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove line ${line.position}`}
                      disabled={pending}
                      onClick={() => {
                        if (window.confirm(`Remove line ${line.position}?`)) run(() => removeGrnLine(line.id), "Line removed");
                      }}
                      className="h-8 w-8 rounded-lg border border-[#FECDCA] bg-white text-[#D92D20]"
                    >
                      ×
                    </button>
                  </>
                ) : null}
              </div>
            </div>
            {inspecting === line.id && canInspect ? <Inspection line={line} config={config} run={run} pending={pending} onDone={() => setInspecting(null)} /> : null}
          </div>
        );
      })}

      {editing?.id === null ? (
        <LineForm grnId={grnId} lineId={null} initial={editing.line} config={config} options={options} nextLotIds={nextLotIds} run={run} pending={pending} onDone={() => setEditing(null)} />
      ) : null}

      {!closed && !editing ? (
        <div className="flex flex-col gap-2">
          <span className="text-ink-2 text-[13px] font-semibold">+ Add a line — what arrived?</span>
          <div className="flex flex-wrap gap-1.5">
            {types.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setEditing({ id: null, line: blankLine(t) })}
                className="h-8 rounded-full border px-3 text-[12.5px] font-semibold"
                style={{ borderColor: TYPE_CHIPS[t].fg + "55", background: TYPE_CHIPS[t].bg, color: TYPE_CHIPS[t].fg }}
              >
                + {config.types[t].label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {node}
    </div>
  );
}

function toPayload(line: LineView): LinePayload {
  const { type, itemId, lotMode, lotNumber, existingLotId, supplierBatch, quantity, unit, expiry, coa, partIds, ref, calItemId, cert, calDate, category, equipmentMode, newName, newAsset, description, extra } = line;
  return { type, itemId, lotMode, lotNumber, existingLotId, supplierBatch, quantity, unit, expiry, coa, partIds, ref, calItemId, cert, calDate, category, equipmentMode, newName, newAsset, description, extra };
}

function lineTitle(line: LineView): string {
  if (line.type === "equipment" && line.equipmentMode === "new") return `${line.newName} (new)`;
  if (line.type === "other") return line.description || "—";
  return line.itemName ?? "—";
}

function lineFacts(line: LineView): string[] {
  const facts: string[] = [];
  if (line.lotNumber) facts.push(`Lot ${line.lotNumber}${line.lotMode === "existing" ? " (top-up)" : ""}`);
  if (line.supplierBatch) facts.push(`Batch ${line.supplierBatch}`);
  if (line.quantity) facts.push(`${line.quantity} ${line.unit}`.trim());
  if (line.expiry) facts.push(`Exp ${line.expiry}`);
  if (line.coa) facts.push(`CoA ${line.coa}`);
  if (line.cert) facts.push(`Cert ${line.cert}`);
  if (line.calDate) facts.push(`Calibrated ${line.calDate}`);
  if (line.ref) facts.push(`Ref ${line.ref}`);
  if (line.newAsset) facts.push(`Asset ${line.newAsset}`);
  for (const [k, v] of Object.entries(line.extra ?? {})) if (v) facts.push(`${k}: ${v}`);
  return facts;
}

function LineForm({
  grnId,
  lineId,
  initial,
  config,
  options,
  nextLotIds,
  run,
  pending,
  onDone,
}: {
  grnId: string;
  lineId: string | null;
  initial: LinePayload;
  config: GrnConfig;
  options: LineOptions;
  nextLotIds: Record<string, string>;
  run: Run;
  pending: boolean;
  onDone: () => void;
}) {
  const [line, setLine] = useState<LinePayload>(initial);
  const set = (patch: Partial<LinePayload>) => setLine((l) => ({ ...l, ...patch }));
  const type = line.type;
  const auto = config.lotId.mode === "auto";
  const lotType = LOT_TYPES.includes(type as (typeof LOT_TYPES)[number]);

  const items =
    type === "material" ? options.material : type === "component" ? options.component : type === "packaging" ? options.packaging : type === "calibration" ? options.calibration : [];
  const item = items.find((i) => i.id === line.itemId);

  return (
    <div className="border-brand-edge bg-brand-wash flex flex-col gap-3 rounded-xl border px-4 py-3.5">
      <span className="text-sm font-bold">{lineId ? "Edit line" : `New line — ${config.types[type].label}`}</span>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {type === "material" || type === "component" || type === "packaging" || type === "calibration" ? (
          <label className={LABEL}>
            {type === "calibration" ? "Instrument" : "Item"}
            <select value={line.itemId} onChange={(e) => set({ itemId: e.target.value, existingLotId: "", calItemId: "" })} className={`${INPUT} tracking-normal normal-case`}>
              <option value="">Select…</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </select>
            {item?.hint ? <span className="text-muted text-[11.5px] font-normal tracking-normal normal-case">{item.hint}</span> : null}
          </label>
        ) : null}

        {lotType ? (
          <div className="flex flex-col gap-[5px]">
            <span className="text-ink-3 text-[11px] font-semibold tracking-[0.5px] uppercase">Lot</span>
            <div className="bg-chip flex gap-0.5 self-start rounded-lg p-[3px]">
              {(["new", "existing"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={line.lotMode === m}
                  onClick={() => set({ lotMode: m })}
                  className={"h-7 rounded-md border-0 px-2.5 text-xs font-semibold " + (line.lotMode === m ? "text-ink bg-white" : "text-muted bg-transparent")}
                >
                  {m === "new" ? "New lot" : "Add to existing lot"}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {lotType && line.lotMode !== "existing" ? (
          auto ? (
            <div className={LABEL}>
              Lot ID (auto)
              <span className="text-ink font-mono text-[13px] font-semibold tracking-normal normal-case">{line.lotNumber || `${nextLotIds[type] ?? "—"} (assigned on add)`}</span>
            </div>
          ) : (
            <label className={LABEL}>
              Lot ID
              <input value={line.lotNumber} onChange={(e) => set({ lotNumber: e.target.value })} className={`${INPUT} font-mono tracking-normal`} />
            </label>
          )
        ) : null}

        {lotType && line.lotMode === "existing" ? (
          <label className={LABEL}>
            Existing lot
            <select value={line.existingLotId} onChange={(e) => set({ existingLotId: e.target.value })} className={`${INPUT} tracking-normal normal-case`}>
              <option value="">Select…</option>
              {(item?.lots ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {lotType ? (
          <>
            <label className={LABEL}>
              Supplier batch no.
              <input value={line.supplierBatch} onChange={(e) => set({ supplierBatch: e.target.value })} className={`${INPUT} font-mono tracking-normal`} />
            </label>
            <label className={LABEL}>
              Quantity received ({type === "material" ? (item?.unit ?? "unit") : "pcs"})
              <input inputMode="decimal" value={line.quantity} onChange={(e) => set({ quantity: e.target.value })} className={`${INPUT} font-mono tracking-normal`} />
            </label>
            <label className={LABEL}>
              Expiry
              <input type="date" value={line.expiry} onChange={(e) => set({ expiry: e.target.value })} className={`${INPUT} font-mono tracking-normal`} />
            </label>
            {type === "material" ? (
              <label className={LABEL}>
                CoA no.
                <input value={line.coa} onChange={(e) => set({ coa: e.target.value })} className={`${INPUT} font-mono tracking-normal`} />
              </label>
            ) : null}
          </>
        ) : null}

        {type === "calibration" ? (
          <>
            <label className={LABEL}>
              Calibration item
              <select value={line.calItemId} onChange={(e) => set({ calItemId: e.target.value })} className={`${INPUT} tracking-normal normal-case`}>
                <option value="">Select…</option>
                {(item?.items ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={LABEL}>
              Certificate no.
              <input value={line.cert} onChange={(e) => set({ cert: e.target.value })} className={`${INPUT} font-mono tracking-normal`} />
            </label>
            <label className={LABEL}>
              Calibrated on
              <input type="date" value={line.calDate} onChange={(e) => set({ calDate: e.target.value })} className={`${INPUT} font-mono tracking-normal`} />
            </label>
          </>
        ) : null}

        {type === "part" ? (
          <div className="col-span-full flex flex-col gap-1.5">
            <span className="text-ink-3 text-[11px] font-semibold tracking-[0.5px] uppercase">Parts returned (outsourced parts first)</span>
            <div className="flex max-h-[200px] flex-wrap gap-1.5 overflow-y-auto">
              {options.parts.length === 0 ? <span className="text-muted text-[12.5px]">No active parts.</span> : null}
              {options.parts.map((p) => {
                const on = line.partIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set({ partIds: on ? line.partIds.filter((x) => x !== p.id) : [...line.partIds, p.id] })}
                    className={"h-7 rounded-full border px-2.5 font-mono text-[11.5px] font-semibold " + (on ? "border-[#5925DC] bg-[#F4F3FF] text-[#5925DC]" : "border-field text-ink-2 bg-white")}
                  >
                    {on ? "✓ " : ""}
                    {p.label}
                  </button>
                );
              })}
            </div>
            <label className={LABEL}>
              Supplier CoC / certificate ref
              <input value={line.ref} placeholder="e.g. CoC-MM-2231 or sterilization cert." onChange={(e) => set({ ref: e.target.value })} className={`${INPUT} tracking-normal normal-case`} />
            </label>
          </div>
        ) : null}

        {type === "equipment" ? (
          <>
            <label className={LABEL}>
              Category
              <select value={line.category} onChange={(e) => set({ category: e.target.value, itemId: "" })} className={`${INPUT} tracking-normal normal-case`}>
                {EQUIPMENT_CATEGORIES.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-col gap-[5px]">
              <span className="text-ink-3 text-[11px] font-semibold tracking-[0.5px] uppercase">Item</span>
              <div className="bg-chip flex gap-0.5 self-start rounded-lg p-[3px]">
                {(["existing", "new"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={line.equipmentMode === m}
                    onClick={() => set({ equipmentMode: m })}
                    className={"h-7 rounded-md border-0 px-2.5 text-xs font-semibold " + (line.equipmentMode === m ? "text-ink bg-white" : "text-muted bg-transparent")}
                  >
                    {m === "existing" ? "Existing item" : "+ New item"}
                  </button>
                ))}
              </div>
            </div>
            {line.equipmentMode === "existing" ? (
              <label className={LABEL}>
                Existing item
                <select value={line.itemId} onChange={(e) => set({ itemId: e.target.value })} className={`${INPUT} tracking-normal normal-case`}>
                  <option value="">Select…</option>
                  {(options.equipment[line.category as keyof LineOptions["equipment"]] ?? []).map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <>
                <label className={LABEL}>
                  New item name
                  <input value={line.newName} placeholder="e.g. Ti build plate 250 mm #3" onChange={(e) => set({ newName: e.target.value })} className={`${INPUT} tracking-normal normal-case`} />
                </label>
                <label className={LABEL}>
                  Asset / tool ID
                  <input value={line.newAsset} onChange={(e) => set({ newAsset: e.target.value })} className={`${INPUT} font-mono tracking-normal`} />
                </label>
              </>
            )}
          </>
        ) : null}

        {type === "other" ? (
          <>
            <label className={LABEL}>
              Description
              <input value={line.description} placeholder="e.g. IPA 99% — 5 L cans" onChange={(e) => set({ description: e.target.value })} className={`${INPUT} tracking-normal normal-case`} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className={LABEL}>
                Qty
                <input inputMode="decimal" value={line.quantity} onChange={(e) => set({ quantity: e.target.value })} className={`${INPUT} font-mono tracking-normal`} />
              </label>
              <label className={LABEL}>
                Unit
                <input value={line.unit} onChange={(e) => set({ unit: e.target.value })} className={`${INPUT} tracking-normal normal-case`} />
              </label>
            </div>
          </>
        ) : null}

        {config.types[type].extra.map((f) => (
          <label key={f.k} className={LABEL}>
            <span>
              {f.label}
              {f.req ? " *" : ""}
            </span>
            {f.type === "select" ? (
              <select value={line.extra[f.k] ?? ""} onChange={(e) => set({ extra: { ...line.extra, [f.k]: e.target.value } })} className={`${INPUT} tracking-normal normal-case`}>
                <option value="">Select…</option>
                {list(f.opts).map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input
                type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"}
                value={line.extra[f.k] ?? ""}
                onChange={(e) => set({ extra: { ...line.extra, [f.k]: e.target.value } })}
                className={`${INPUT} tracking-normal normal-case`}
              />
            )}
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="border-field h-9 rounded-lg border bg-white px-3 text-[13px] font-semibold">
          Cancel
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => saveGrnLine(grnId, lineId, JSON.stringify(line)), lineId ? "Line updated" : "Line added", onDone)}
          className="bg-brand h-9 rounded-lg border-0 px-3.5 text-[13px] font-bold text-white disabled:opacity-60"
        >
          {pending ? "Saving…" : lineId ? "Save line" : "Add line"}
        </button>
      </div>
    </div>
  );
}

// --- Inspection -------------------------------------------------------------------------------------

function Inspection({
  line,
  config,
  run,
  pending,
  onDone,
}: {
  line: LineView;
  config: GrnConfig;
  run: Run;
  pending: boolean;
  onDone: () => void;
}) {
  const checks = config.types[line.type].checks;
  const [tests, setTests] = useState<Record<string, TestEntry>>(() =>
    Object.fromEntries(checks.map((c) => [c.id, line.tests[c.id] ?? { n: Math.max(1, c.n), res: [] }])),
  );
  const [rejected, setRejected] = useState(line.rejectedQty || "");
  const [reason, setReason] = useState(line.reason ?? "");
  const stock = STOCK_TYPES.includes(line.type);
  const received = Number(line.quantity || 0);
  const release = Math.round((received - (Number(rejected.replace(",", ".")) || 0)) * 1000) / 1000;

  const outcomes = checks.map((c) => testOutcome(c, tests[c.id]));
  const passed = outcomes.filter((o) => o.state === "pass").length;
  const failed = outcomes.filter((o) => o.state === "fail").length;
  const overall = failed ? "FAIL" : passed === checks.length ? "PASS" : "in progress";

  const setPiece = (id: string, i: number) =>
    setTests((t) => {
      const entry = t[id];
      const res = [...entry.res];
      const cycle: PieceResult[] = ["", "Pass", "Fail"];
      res[i] = cycle[(cycle.indexOf(res[i] ?? "") + 1) % 3];
      return { ...t, [id]: { ...entry, res } };
    });

  const decide = (decision: "Accepted" | "Rejected" | "Quarantine") =>
    run(() => decideLine(line.id, JSON.stringify({ decision, tests, rejectedQty: stock ? rejected : "", reason })), undefined, onDone);

  const effect =
    line.type === "material"
      ? `Release adds the released quantity to lot ${line.lotNumber ?? "—"} on the material's Lots & stock tab. Rejected quantity never enters stock and is recorded against the supplier.`
      : line.type === "component" || line.type === "packaging"
        ? "Release adds the released quantity to the item's stock and sets its current lot."
        : line.type === "calibration"
          ? "Accepting records the calibration on the instrument and moves its next due date on."
          : line.type === "equipment"
            ? line.equipmentMode === "new"
              ? "Accepting adds the item to its register with an installation qualification due in a month."
              : "Accepting records the receipt."
            : line.type === "part"
              ? "Accepting logs this GRN on the parts and moves each to its next stage (if its current-stage forms are approved)."
              : "Accepting records the receipt; this is not stock-tracked.";

  return (
    <div className="border-line-2 bg-subtle flex flex-col gap-3 rounded-[10px] border p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px] font-bold">Incoming inspection — acceptance tests and release</span>
        <span className="text-ink-3 text-xs">
          {passed} / {checks.length} tests passed · {failed} failed · Overall:{" "}
          <b className={failed ? "text-bad" : overall === "PASS" ? "text-ok" : "text-warn"}>{overall}</b>
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {checks.map((c, ci) => {
          const entry = tests[c.id];
          const o = outcomes[ci];
          const [yes, no] = pieceWords(c.rt);
          return (
            <div key={c.id} className="border-line flex flex-col gap-2 rounded-lg border bg-white p-2.5 lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.6fr)_auto] lg:items-center lg:gap-3">
              <span className="flex flex-col">
                <span className="text-[13px] font-semibold">
                  {c.label}
                  {!c.req ? <span className="text-muted font-normal"> (optional)</span> : null}
                </span>
                <span className="text-muted text-[11px]">{ruleText(c)}</span>
              </span>
              <span className="text-ink-3 text-xs">{c.spec}</span>
              <span className="flex flex-wrap items-center gap-1">
                {Array.from({ length: entry.n }, (_, i) => {
                  const r = entry.res[i] ?? "";
                  return (
                    <button
                      key={i}
                      type="button"
                      aria-label={`${c.label} piece ${i + 1}: ${r || "not checked"}`}
                      onClick={() => setPiece(c.id, i)}
                      className={
                        "h-7 min-w-[52px] rounded-md border px-1.5 font-mono text-[11px] font-semibold " +
                        (r === "Pass" ? "border-[#75E0A7] bg-ok-tint text-ok" : r === "Fail" ? "border-[#FDA29B] bg-bad-tint text-bad" : "border-field text-faint bg-white")
                      }
                    >
                      #{i + 1} {r === "Pass" ? yes : r === "Fail" ? no : "—"}
                    </button>
                  );
                })}
                <button type="button" onClick={() => setTests((t) => ({ ...t, [c.id]: { ...t[c.id], n: Math.min(50, t[c.id].n + 1) } }))} className="border-field h-7 rounded-md border bg-white px-1.5 text-[11px]">
                  + piece
                </button>
                {entry.n > 1 ? (
                  <button type="button" onClick={() => setTests((t) => ({ ...t, [c.id]: { n: t[c.id].n - 1, res: t[c.id].res.slice(0, t[c.id].n - 1) } }))} className="border-field h-7 rounded-md border bg-white px-1.5 text-[11px]">
                    −
                  </button>
                ) : null}
                <button type="button" onClick={() => setTests((t) => ({ ...t, [c.id]: { ...t[c.id], res: Array(t[c.id].n).fill("Pass") } }))} className="text-brand-ink h-7 border-0 bg-transparent px-1 text-[11px] font-semibold">
                  All {yes}
                </button>
              </span>
              <span className={"justify-self-start rounded-md px-2 py-0.5 text-[11.5px] font-bold " + (o.state === "pass" ? "bg-ok-tint text-ok" : o.state === "fail" ? "bg-bad-tint text-bad" : "bg-chip text-ink-3")}>{o.label}</span>
            </div>
          );
        })}
      </div>
      <label className={LABEL}>
        Notes / reason (required to hold or reject)
        <input value={reason} placeholder="e.g. CoA grade mismatch — return to supplier" onChange={(e) => setReason(e.target.value)} className={`${INPUT} tracking-normal normal-case`} />
      </label>
      {stock ? (
        <div className="grid grid-cols-3 gap-2">
          <div className={LABEL}>
            Quantity received
            <span className="text-ink font-mono text-[13px] tracking-normal">
              {line.quantity} {line.unit}
            </span>
          </div>
          <label className={LABEL}>
            Rejected quantity
            <input inputMode="decimal" value={rejected} onChange={(e) => setRejected(e.target.value)} className={`${INPUT} font-mono tracking-normal`} />
          </label>
          <div className={LABEL}>
            Release to stock
            <span className={"font-mono text-[13px] tracking-normal " + (release < 0 ? "text-bad" : "text-ok")}>
              {release} {line.unit}
            </span>
          </div>
        </div>
      ) : null}
      <span className="text-muted text-[11.5px] leading-[1.5]">{effect}</span>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" disabled={pending} onClick={() => run(() => saveLineTests(line.id, JSON.stringify(tests)))} className="border-field h-9 rounded-lg border bg-white px-3 text-[13px] font-semibold">
          Save results
        </button>
        <button type="button" disabled={pending} onClick={() => decide("Rejected")} className="h-9 rounded-lg border border-[#FDA29B] bg-white px-3 text-[13px] font-semibold text-[#B42318]">
          Reject
        </button>
        <button type="button" disabled={pending} onClick={() => decide("Quarantine")} className="border-field text-warn h-9 rounded-lg border bg-white px-3 text-[13px] font-semibold">
          Hold (quarantine)
        </button>
        <button type="button" disabled={pending} onClick={() => decide("Accepted")} className="bg-ok h-9 rounded-lg border-0 px-3.5 text-[13px] font-bold text-white">
          {stock ? (release <= 0 ? "Reject all" : `Release ${release} ${line.unit} to stock`) : "Accept"}
        </button>
      </div>
    </div>
  );
}

// --- Documents --------------------------------------------------------------------------------------

export function DocsPanel({
  grnId,
  kinds,
  documents,
}: {
  grnId: string;
  kinds: string[];
  documents: Array<{ id: string; name: string; kind: string; by: string; at: string }>;
}) {
  const { run, pending, node, toast } = useRun();
  const [kind, setKind] = useState(kinds[0] ?? "Other");
  return (
    <div className="flex flex-col gap-3 p-4 sm:p-[22px]">
      <div className="flex flex-wrap items-center gap-2.5">
        <select aria-label="Document kind" value={kind} onChange={(e) => setKind(e.target.value)} className="border-field h-9 rounded-lg border bg-white px-2 text-[13px]">
          {kinds.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <label className="bg-ink relative inline-flex h-9 cursor-pointer items-center overflow-hidden rounded-lg px-3.5 text-[13px] font-semibold text-white">
          {pending ? "Uploading…" : "+ Upload files"}
          <input
            type="file"
            multiple
            aria-label="Upload documents"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length === 0) return;
              if (files.some((f) => f.size > 25 * 1024 * 1024)) {
                toast("Files are limited to 25 MB each.", true);
                return;
              }
              const fd = new FormData();
              fd.set("kind", kind);
              for (const f of files) fd.append("files", f);
              run(() => uploadGrnDocuments(grnId, fd));
            }}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
      </div>
      {documents.length === 0 ? (
        <div className="border-field text-muted rounded-xl border border-dashed px-5 py-8 text-center text-[13px]">No documents yet — attach the delivery note and CoA.</div>
      ) : (
        <div className="border-line flex flex-col rounded-[10px] border">
          {documents.map((d) => (
            <div key={d.id} className="border-line-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2.5 text-[13px] last:border-b-0">
              <a href={`/api/grn-files/${d.id}`} className="text-ink min-w-0 flex-1 truncate font-semibold no-underline">
                {d.name}
              </a>
              <span className="bg-chip text-ink-3 rounded-full px-2 py-0.5 text-[11px] font-semibold">{d.kind}</span>
              <span className="text-muted text-xs">
                {d.by} · {d.at}
              </span>
              <button
                type="button"
                aria-label={`Remove ${d.name}`}
                onClick={() => {
                  if (window.confirm(`Remove "${d.name}"?`)) run(() => removeGrnDocument(d.id), "Document removed");
                }}
                className="text-faint h-7 w-7 border-0 bg-transparent"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {node}
    </div>
  );
}
