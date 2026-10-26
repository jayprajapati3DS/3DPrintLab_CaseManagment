"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useToast } from "@/components/ui/toast";
import { saveGrnConfig } from "@/lib/grn/actions";
import {
  defaultGrnConfig,
  LINE_TYPES,
  LOT_PRESETS,
  LOT_TYPES,
  nextGrnNumber,
  nextLotId,
  ruleText,
  type ExtraField,
  type GrnConfig,
  type GrnTest,
  type HeaderField,
  type LineType,
} from "@/lib/grn/config";

/** GRN setup: everything about receiving, configured per space. Nothing changes until "Save setup". */

const newKey = (p: string) => `${p}${crypto.randomUUID().slice(0, 6)}`;
function move<T>(list: T[], i: number, by: -1 | 1): T[] {
  const to = i + by;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[i], next[to]] = [next[to], next[i]];
  return next;
}

const INPUT = "border-field text-ink h-9 w-full min-w-0 rounded-lg border bg-white px-2.5 text-[13px] disabled:bg-subtle";
const CARD = "border-line flex min-w-0 flex-col gap-3.5 rounded-[14px] border bg-white px-4 py-[18px] sm:px-[22px]";

export function GrnSetup({
  initial,
  canEdit,
  existingNumbers,
  lotIds,
  today,
  savedNote,
}: {
  initial: GrnConfig;
  canEdit: boolean;
  existingNumbers: string[];
  lotIds: string[];
  today: string;
  savedNote: string | null;
}) {
  const router = useRouter();
  const { toast, node } = useToast();
  const [pending, startTransition] = useTransition();
  const [config, setConfig] = useState<GrnConfig>(initial);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initial));
  const [open, setOpen] = useState<LineType | null>(null);
  const [newField, setNewField] = useState({ label: "", type: "text" as HeaderField["type"], opts: "" });
  const dirty = JSON.stringify(config) !== baseline;
  const now = new Date(`${today}T00:00:00Z`);

  const set = (patch: Partial<GrnConfig>) => setConfig((c) => ({ ...c, ...patch }));
  const setType = (t: LineType, fn: (x: GrnConfig["types"][LineType]) => GrnConfig["types"][LineType]) =>
    setConfig((c) => ({ ...c, types: { ...c.types, [t]: fn(c.types[t]) } }));
  const setTest = (t: LineType, id: string, patch: Partial<GrnTest>) =>
    setType(t, (x) => ({ ...x, checks: x.checks.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));

  function save() {
    const payload = JSON.stringify(config);
    startTransition(async () => {
      const result = await saveGrnConfig(payload);
      if (!result.ok) {
        toast(result.message ?? "The setup could not be saved.", true);
        return;
      }
      setBaseline(payload);
      toast(result.message ?? "GRN setup saved");
      router.refresh();
    });
  }

  return (
    <fieldset disabled={!canEdit || pending} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
      <section className="border-line flex flex-wrap items-center gap-3 rounded-[14px] border bg-white px-4 py-[18px] sm:px-[22px]">
        <div className="flex min-w-[240px] flex-1 flex-col gap-0.5">
          <h2 className="m-0 text-[15px] font-bold">GRN setup</h2>
          <p className="text-muted m-0 text-[12.5px] leading-[1.5]">
            Configure numbering, receipt fields, which item types can be received, their inspection checklists and extra fields, and the acceptance rules. Changes apply to new and open GRNs once saved.
          </p>
          <span className="text-faint text-[11.5px]">{!canEdit ? "Only this space's admins can change the setup." : dirty ? "Unsaved changes." : (savedNote ?? "Using the default setup.")}</span>
        </div>
        {canEdit ? (
          <div className="flex gap-2">
            <button type="button" onClick={() => { setConfig(defaultGrnConfig()); toast("Defaults restored — Save setup to apply them"); }} className="border-field h-9 rounded-lg border bg-white px-3 text-[12.5px] font-semibold">
              Reset to defaults
            </button>
            <button type="button" onClick={save} disabled={!dirty} className="bg-brand h-9 rounded-lg border-0 px-3.5 text-[12.5px] font-semibold text-white disabled:opacity-50">
              {pending ? "Saving…" : "Save setup"}
            </button>
          </div>
        ) : null}
      </section>

      {/* 1. GRN number */}
      <section className={CARD}>
        <h3 className="m-0 text-sm font-bold">1. GRN number</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Prefix
            <input value={config.prefix} onChange={(e) => set({ prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) })} className={`${INPUT} font-mono`} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Separator
            <select value={config.sep} onChange={(e) => set({ sep: e.target.value as GrnConfig["sep"] })} className={INPUT}>
              <option value="-">Dash -</option>
              <option value="/">Slash /</option>
              <option value="">None</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Digits
            <select value={config.pad} onChange={(e) => set({ pad: Number(e.target.value) as GrnConfig["pad"] })} className={INPUT}>
              {[3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-[13px] font-semibold">
            <input type="checkbox" className="h-4 w-4" checked={config.year} onChange={(e) => set({ year: e.target.checked })} />
            Include year
          </label>
        </div>
        <span className="text-ink-3 text-[12.5px]">
          Next number: <b className="font-mono">{nextGrnNumber(config, existingNumbers, now)}</b>
        </span>
      </section>

      {/* 2. Lot ID */}
      <section className={CARD}>
        <div className="flex flex-col gap-0.5">
          <h3 className="m-0 text-sm font-bold">2. Lot ID</h3>
          <p className="text-muted m-0 text-[12.5px] leading-[1.5]">
            Your own lot ID for everything received (the supplier&apos;s batch no. is kept separately). Build any format from fixed text and tokens — generic like IIR001, or by what was received like RM-2026-0001.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {LOT_PRESETS.map((p) => (
            <button key={p.name} type="button" onClick={() => set({ lotId: { ...config.lotId, format: p.format, pad: p.pad, scope: p.scope } })} className="border-field text-ink-2 h-8 rounded-full border bg-white px-3 text-xs font-semibold">
              {p.name}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Lot ID mode
            <select value={config.lotId.mode} onChange={(e) => set({ lotId: { ...config.lotId, mode: e.target.value as "auto" | "manual" } })} className={INPUT}>
              <option value="auto">Auto-assign</option>
              <option value="manual">Manual entry</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Format
            <input value={config.lotId.format} placeholder="e.g. IIR{SEQ}" onChange={(e) => set({ lotId: { ...config.lotId, format: e.target.value.slice(0, 40) } })} className={`${INPUT} font-mono`} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Digits
            <select value={config.lotId.pad} onChange={(e) => set({ lotId: { ...config.lotId, pad: Number(e.target.value) } })} className={INPUT}>
              {[2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Running number
            <select value={config.lotId.scope} onChange={(e) => set({ lotId: { ...config.lotId, scope: e.target.value as "type" | "global" } })} className={INPUT}>
              <option value="global">One sequence for everything</option>
              <option value="type">Separate sequence per item type</option>
            </select>
          </label>
        </div>
        <span className="text-muted text-[11.5px]">
          Tokens: <code>{"{TYPE}"}</code> item-type code · <code>{"{YYYY}"}</code> year · <code>{"{YY}"}</code> short year · <code>{"{MM}"}</code> month · <code>{"{SEQ}"}</code> running number (added at the end if missing).
        </span>
        <div className="border-line overflow-x-auto rounded-[10px] border">
          <table className="w-full min-w-[480px] border-collapse text-[13px]">
            <thead className="bg-subtle">
              <tr>
                {["Received as", "Type code ({TYPE})", "Next lot ID"].map((h) => (
                  <th key={h} className="text-muted px-3 py-2 text-left text-[10.5px] font-bold tracking-[0.5px] uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LOT_TYPES.map((t) => (
                <tr key={t}>
                  <td className="border-line-3 border-t px-3 py-2">{config.types[t].label}</td>
                  <td className="border-line-3 border-t px-3 py-2">
                    <input
                      aria-label={`Type code for ${config.types[t].label}`}
                      value={config.lotId.codes[t]}
                      onChange={(e) => set({ lotId: { ...config.lotId, codes: { ...config.lotId.codes, [t]: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) } } })}
                      className="border-field h-8 w-24 rounded-md border px-2 font-mono text-[13px]"
                    />
                  </td>
                  <td className="border-line-3 border-t px-3 py-2 font-mono font-semibold">{config.lotId.mode === "auto" ? nextLotId(config, t, lotIds, now) : "Typed in on each line"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3. Receipt fields */}
      <section className={CARD}>
        <div className="flex flex-col gap-0.5">
          <h3 className="m-0 text-sm font-bold">3. Receipt fields (GRN header)</h3>
          <p className="text-muted m-0 text-[12.5px]">Supplier and received date are always shown. Rename, show / hide, make required, reorder, or add your own fields.</p>
        </div>
        <div className="flex flex-col gap-2">
          {config.header.map((h, i) => (
            <div key={h.k} className="border-line-2 grid grid-cols-1 items-center gap-2 rounded-[10px] border px-3 py-2 sm:grid-cols-[minmax(0,1.3fr)_120px_minmax(0,1fr)_auto]">
              <input aria-label="Field name" value={h.label} onChange={(e) => set({ header: config.header.map((x) => (x.k === h.k ? { ...x, label: e.target.value } : x)) })} className={INPUT} />
              <span className="text-muted text-xs">
                {h.type === "select" ? "Dropdown" : h.type[0].toUpperCase() + h.type.slice(1)} · {h.custom ? "custom" : "built-in"}
              </span>
              {h.type === "select" && h.custom ? (
                <input aria-label="Dropdown choices" value={h.opts} placeholder="Choices, comma separated" onChange={(e) => set({ header: config.header.map((x) => (x.k === h.k ? { ...x, opts: e.target.value } : x)) })} className={INPUT} />
              ) : (
                <span className="text-faint text-xs">{h.k === "condition" ? "Choices from the Lists section" : ""}</span>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" className="h-4 w-4" checked={h.show} onChange={(e) => set({ header: config.header.map((x) => (x.k === h.k ? { ...x, show: e.target.checked, req: e.target.checked ? x.req : false } : x)) })} />
                  Show
                </label>
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" className="h-4 w-4" checked={h.req} onChange={(e) => set({ header: config.header.map((x) => (x.k === h.k ? { ...x, req: e.target.checked, show: e.target.checked ? true : x.show } : x)) })} />
                  Required
                </label>
                <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => set({ header: move(config.header, i, -1) })} className="border-line h-7 w-7 rounded-md border bg-white disabled:opacity-35">
                  ↑
                </button>
                <button type="button" aria-label="Move down" disabled={i === config.header.length - 1} onClick={() => set({ header: move(config.header, i, 1) })} className="border-line h-7 w-7 rounded-md border bg-white disabled:opacity-35">
                  ↓
                </button>
                {h.custom ? (
                  <button type="button" aria-label={`Remove ${h.label}`} onClick={() => set({ header: config.header.filter((x) => x.k !== h.k) })} className="h-7 w-7 rounded-md border border-[#FECDCA] bg-white text-[#D92D20]">
                    ×
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        {canEdit ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1.4fr)_140px_minmax(0,1fr)_auto]">
            <input value={newField.label} placeholder="New field name, e.g. Gate entry no." onChange={(e) => setNewField((f) => ({ ...f, label: e.target.value }))} className={INPUT} />
            <select value={newField.type} onChange={(e) => setNewField((f) => ({ ...f, type: e.target.value as HeaderField["type"] }))} className={INPUT}>
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="date">Date</option>
              <option value="select">Dropdown</option>
            </select>
            <input value={newField.opts} disabled={newField.type !== "select"} placeholder="Choices, comma separated" onChange={(e) => setNewField((f) => ({ ...f, opts: e.target.value }))} className={INPUT} />
            <button
              type="button"
              onClick={() => {
                if (!newField.label.trim()) {
                  toast("Enter a field name", true);
                  return;
                }
                set({ header: [...config.header, { k: newKey("x_"), label: newField.label.trim(), type: newField.type, show: true, req: false, custom: true, opts: newField.opts }] });
                setNewField({ label: "", type: "text", opts: "" });
              }}
              className="bg-ink h-9 rounded-lg border-0 px-3 text-[13px] font-semibold text-white"
            >
              + Add field
            </button>
          </div>
        ) : null}
      </section>

      {/* 4. Line types and tests */}
      <section className={CARD}>
        <div className="flex flex-col gap-0.5">
          <h3 className="m-0 text-sm font-bold">4. What can be received — acceptance tests</h3>
          <p className="text-muted m-0 text-[12.5px] leading-[1.5]">
            Turn line types on or off, rename them, and customize each one&apos;s inspection checklist and extra fields (e.g. storage location, temperature on arrival, sample size).
          </p>
        </div>
        {LINE_TYPES.map((t) => {
          const type = config.types[t];
          return (
            <div key={t} className="border-line-2 flex flex-col gap-3 rounded-[10px] border px-3 py-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <input type="checkbox" aria-label={`Receive ${type.label}`} className="h-4 w-4" checked={type.on} onChange={(e) => setType(t, (x) => ({ ...x, on: e.target.checked }))} />
                <input aria-label="Line type name" value={type.label} onChange={(e) => setType(t, (x) => ({ ...x, label: e.target.value }))} className="border-field h-8 min-w-[160px] flex-1 rounded-md border px-2 text-[13px] font-semibold sm:max-w-[280px] sm:flex-none" />
                <span className="text-muted flex-1 text-xs">
                  {type.checks.length} acceptance test{type.checks.length === 1 ? "" : "s"} · {type.extra.length} extra field{type.extra.length === 1 ? "" : "s"}
                  {type.on ? "" : " · hidden"}
                </span>
                <button type="button" onClick={() => setOpen(open === t ? null : t)} className="border-field h-8 rounded-lg border bg-white px-3 text-xs font-semibold">
                  {open === t ? "Close" : "Customize"}
                </button>
              </div>
              {open === t ? (
                <div className="flex flex-col gap-2">
                  {type.checks.map((c, i) => (
                    <div key={c.id} className="bg-subtle grid grid-cols-1 gap-2 rounded-lg p-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.3fr)_70px_120px_80px_auto] lg:items-center">
                      <input aria-label="Test" value={c.label} onChange={(e) => setTest(t, c.id, { label: e.target.value })} className={INPUT} />
                      <input aria-label="Specification" value={c.spec} placeholder="Specification" onChange={(e) => setTest(t, c.id, { spec: e.target.value })} className={INPUT} />
                      <input aria-label="Pieces" type="number" min={1} max={50} value={c.n} onChange={(e) => setTest(t, c.id, { n: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} className={`${INPUT} font-mono`} />
                      <select aria-label="Result" value={c.rt} onChange={(e) => setTest(t, c.id, { rt: e.target.value as GrnTest["rt"] })} className={INPUT}>
                        <option value="passfail">Pass / Fail</option>
                        <option value="yesno">Yes / No</option>
                      </select>
                      <input aria-label="Minimum pieces to pass" value={c.minPass} placeholder="All" onChange={(e) => setTest(t, c.id, { minPass: e.target.value.replace(/\D/g, "").slice(0, 2) })} className={`${INPUT} font-mono`} />
                      <div className="flex items-center gap-1.5">
                        <label className="flex items-center gap-1 text-xs">
                          <input type="checkbox" className="h-4 w-4" checked={c.req} onChange={(e) => setTest(t, c.id, { req: e.target.checked })} />
                          Req.
                        </label>
                        <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => setType(t, (x) => ({ ...x, checks: move(x.checks, i, -1) }))} className="border-line h-7 w-7 rounded-md border bg-white disabled:opacity-35">
                          ↑
                        </button>
                        <button type="button" aria-label="Move down" disabled={i === type.checks.length - 1} onClick={() => setType(t, (x) => ({ ...x, checks: move(x.checks, i, 1) }))} className="border-line h-7 w-7 rounded-md border bg-white disabled:opacity-35">
                          ↓
                        </button>
                        <button type="button" aria-label={`Remove ${c.label}`} onClick={() => setType(t, (x) => ({ ...x, checks: x.checks.filter((y) => y.id !== c.id) }))} className="h-7 w-7 rounded-md border border-[#FECDCA] bg-white text-[#D92D20]">
                          ×
                        </button>
                      </div>
                      <span className="text-muted text-[11px] lg:col-span-6">{ruleText(c)}</span>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setType(t, (x) => ({ ...x, checks: [...x.checks, { id: newKey("t"), label: "New test", spec: "", n: 1, rt: "passfail", minPass: "", req: true }] }))}
                    className="border-field text-ink-2 h-8 self-start rounded-lg border border-dashed bg-white px-3 text-xs font-semibold"
                  >
                    + Add test
                  </button>

                  <span className="text-ink-2 pt-1 text-xs font-bold">Extra fields on this line</span>
                  {type.extra.length === 0 ? <span className="text-faint text-xs">No extra fields.</span> : null}
                  {type.extra.map((f) => (
                    <div key={f.k} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1.2fr)_120px_minmax(0,1fr)_auto] sm:items-center">
                      <input aria-label="Extra field name" value={f.label} onChange={(e) => setType(t, (x) => ({ ...x, extra: x.extra.map((y) => (y.k === f.k ? { ...y, label: e.target.value } : y)) }))} className={INPUT} />
                      <select aria-label="Extra field type" value={f.type} onChange={(e) => setType(t, (x) => ({ ...x, extra: x.extra.map((y) => (y.k === f.k ? { ...y, type: e.target.value as ExtraField["type"] } : y)) }))} className={INPUT}>
                        <option value="text">Text</option>
                        <option value="number">Number</option>
                        <option value="date">Date</option>
                        <option value="select">Dropdown</option>
                      </select>
                      <input aria-label="Choices" value={f.opts} disabled={f.type !== "select"} placeholder="Choices, comma separated" onChange={(e) => setType(t, (x) => ({ ...x, extra: x.extra.map((y) => (y.k === f.k ? { ...y, opts: e.target.value } : y)) }))} className={INPUT} />
                      <div className="flex items-center gap-1.5">
                        <label className="flex items-center gap-1 text-xs">
                          <input type="checkbox" className="h-4 w-4" checked={f.req} onChange={(e) => setType(t, (x) => ({ ...x, extra: x.extra.map((y) => (y.k === f.k ? { ...y, req: e.target.checked } : y)) }))} />
                          Req.
                        </label>
                        <button type="button" aria-label={`Remove ${f.label}`} onClick={() => setType(t, (x) => ({ ...x, extra: x.extra.filter((y) => y.k !== f.k) }))} className="h-7 w-7 rounded-md border border-[#FECDCA] bg-white text-[#D92D20]">
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setType(t, (x) => ({ ...x, extra: [...x.extra, { k: newKey("f"), label: "Storage location", type: "text", opts: "", req: false }] }))}
                    className="border-field text-ink-2 h-8 self-start rounded-lg border border-dashed bg-white px-3 text-xs font-semibold"
                  >
                    + Add field
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </section>

      {/* 5. Rules */}
      <section className={CARD}>
        <h3 className="m-0 text-sm font-bold">5. Acceptance rules</h3>
        <label className="flex items-start gap-2.5 text-[13px]">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={config.rules.allChecks} onChange={(e) => set({ rules: { ...config.rules, allChecks: e.target.checked } })} />
          Every test must meet its pass criteria to accept (off = only tests marked &quot;Req.&quot;). A failed test blocks full release — enter a rejected quantity, hold or reject.
        </label>
        <label className="flex items-center gap-2.5 text-[13px]">
          <input type="checkbox" className="h-4 w-4" checked={config.rules.reasonReq} onChange={(e) => set({ rules: { ...config.rules, reasonReq: e.target.checked } })} />
          Reason is required to hold or reject a line
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Inspect within (days)
            <input type="number" min={0} max={90} value={config.rules.inspDays} onChange={(e) => set({ rules: { ...config.rules, inspDays: Math.max(0, Math.min(90, Number(e.target.value) || 0)) } })} className={`${INPUT} font-mono`} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Supplier not approved
            <select value={config.rules.supplier} onChange={(e) => set({ rules: { ...config.rules, supplier: e.target.value as "warn" | "block" } })} className={INPUT}>
              <option value="warn">Warn only</option>
              <option value="block">Block receipt</option>
            </select>
          </label>
        </div>
      </section>

      {/* 6. Lists */}
      <section className={CARD}>
        <h3 className="m-0 text-sm font-bold">6. Lists</h3>
        <label className="flex flex-col gap-1 text-xs font-semibold">
          Delivery condition choices
          <input value={config.conditions} onChange={(e) => set({ conditions: e.target.value })} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">
          Document types
          <input value={config.docKinds} onChange={(e) => set({ docKinds: e.target.value })} className={INPUT} />
        </label>
      </section>
      {node}
    </fieldset>
  );
}
