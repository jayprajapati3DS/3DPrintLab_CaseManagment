"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { QaFormView } from "@/components/qa/form-view";
import { useToast } from "@/components/ui/toast";
import { deleteTemplate, previewEnvironment, saveTemplate } from "@/lib/qa/actions";
import { FUNCTIONS, formulaProblem, renameRef } from "@/lib/qa/calc";
import { customOptions, IMAGE_ABLE, roleAllowed, USED_FOR, USED_FOR_LABELS, type UsedFor } from "@/lib/qa/template";
import { emptyState, type Libraries } from "@/lib/qa/evaluate";
import type { Inspection } from "@/lib/parts/request-form";
import {
  COLUMN_KIND_LABELS,
  COLUMN_KINDS,
  newColumn,
  PALETTE,
  paletteItem,
  SHOW_OP_LABELS,
  SHOW_OPS,
  SIGN_STYLE_LABELS,
  SIGNER_LABELS,
  SIGNER_TAGS,
  SIGNERS,
  type Signer,
  SIGN_STYLES,
  type SignStyle,
  type ColumnKind,
  type GridColumn,
  type ShowOp,
  QTY_SOURCES,
  section as newSection,
  SOURCE_LABELS,
  SOURCES,
  templateProblem,
  templateStats,
  typeName,
  type ItemType,
  type QaItem,
  type QaSection,
  type QaTemplateData,
  type Source,
} from "@/lib/qa/template";
import { GROUP_LABELS, mapping, tokensIn, type Context, type VarDef, type VarGroup } from "@/lib/qa/variables";
import { BUILT_IN_LAYOUTS, layoutFor, type DocLayoutDef } from "@/lib/qa/layouts";

/**
 * The QA form editor: an outline, the sections with their fields, and a panel
 * with the selected field's settings, a live preview filled from a real part,
 * and the form's document details. Nothing is saved until "Save form".
 */

type PanelTab = "settings" | "preview" | "details";

function move<T>(list: T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

const OPERATOR_INPUT: ItemType[] = ["text", "number", "check", "sign", "select", "date", "datetime", "time", "duration"];

/** Fields a formula can use: anything that holds a value. */
const CALC_SOURCES: ItemType[] = ["number", "date", "datetime", "time", "duration", "calc", "info", "text", "select", "grid", "yesno"];

/** Fields whose value another field's show-if can test. */
const CONDITION_SOURCES: ItemType[] = ["number", "date", "datetime", "time", "duration", "calc", "text", "select", "check", "yesno", "grid", "file", "info"];

/** A formula's quoted column name, renamed when the column is — in formulas that name that table. */
function renameColumnRef(formula: string, table: string, from: string, to: string): string {
  if (!formula.toLowerCase().includes(`[${table.trim().toLowerCase()}]`.toLowerCase()) && !formula.includes(`[${table.trim()}]`)) return formula;
  return formula.replace(/(["'])([^"']*)\1/g, (whole, q: string, name: string) => (name.trim() === from.trim() ? `${q}${to}${q}` : whole));
}

/** What each function of a formula does, for the help under the formula box. */
const FUNCTION_HELP: Record<(typeof FUNCTIONS)[number], string> = {
  round: "round(x, 1) — to 1 decimal",
  min: "min(a, b)",
  max: "max(a, b)",
  abs: "abs(x)",
  addDays: "addDays([Date], 7)",
  addMonths: "addMonths([Mfd. date], 24)",
  hours: "hours([Duration]) — as a number",
  minutes: "minutes([Duration])",
  days: "days([Duration])",
  sum: 'sum([Table], "Column") or sum([A], [B])',
  avg: 'avg([Table], "Column")',
  count: "count([Table]) — its rows",
};
const CHIP: Record<string, string> = {
  green: "bg-ok-tint text-ok",
  amber: "bg-warn-tint text-warn",
  red: "bg-bad-tint text-bad",
  grey: "bg-chip text-ink-3",
};

export function QaEditor({
  id,
  initial,
  canEdit,
  stages,
  variables,
  libraries,
  parts,
  initialPartId,
  initialContext,
  initialInspection,
  usedOnParts,
  roles,
  layouts = BUILT_IN_LAYOUTS,
}: {
  id: string;
  initial: QaTemplateData;
  canEdit: boolean;
  stages: string[];
  variables: VarDef[];
  libraries: Libraries;
  parts: Array<{ id: string; label: string }>;
  initialPartId: string | null;
  initialContext: Context;
  initialInspection: Inspection | null;
  usedOnParts: number;
  /** Roles a signature can be kept for. */
  roles: string[];
  /** The space's header & footer designs (QA Form Setup → Header & footer). */
  layouts?: DocLayoutDef[];
}) {
  const router = useRouter();
  const { toast, node } = useToast();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<QaTemplateData>(initial);
  // A form opened from "+ New QA form" is not saved yet: there is something to save from the start.
  const [baseline, setBaseline] = useState(() => (id === "new" ? "" : JSON.stringify(initial)));
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelTab>("settings");
  const [sheet, setSheet] = useState(false);
  const [palette, setPalette] = useState<string | null>(null);
  const [partId, setPartId] = useState(initialPartId);
  const [env, setEnv] = useState<{ context: Context; inspection: Inspection | null }>({ context: initialContext, inspection: initialInspection });
  const [varQuery, setVarQuery] = useState("");
  // Dragging: a field or a section, and where it would land.
  const [drag, setDrag] = useState<{ kind: "item" | "section"; id: string } | null>(null);
  const [dropAt, setDropAt] = useState<{ sectionId: string; index: number } | null>(null);
  const [sectionDrop, setSectionDrop] = useState<number | null>(null);
  const endDrag = () => {
    setDrag(null);
    setDropAt(null);
    setSectionDrop(null);
  };

  const dirty = JSON.stringify(form) !== baseline;
  const known = useMemo(() => new Set(variables.map((v) => v.token)), [variables]);
  const stats = templateStats(form.sections);

  const setSections = (fn: (s: QaSection[]) => QaSection[]) => setForm((f) => ({ ...f, sections: fn(f.sections) }));
  const setItem = (itemId: string, fn: (i: QaItem) => QaItem) =>
    setSections((list) => list.map((s) => ({ ...s, items: s.items.map((i) => (i.id === itemId ? fn(i) : i)) })));

  const location = (itemId: string | null) => {
    if (!itemId) return null;
    for (const s of form.sections) {
      const index = s.items.findIndex((i) => i.id === itemId);
      if (index >= 0) return { section: s, index, item: s.items[index] };
    }
    return null;
  };
  const current = location(selected);

  // The variable check across the whole form, against the preview part.
  const check = useMemo(() => {
    const tokens = new Set(form.sections.flatMap((s) => s.items.flatMap((i) => tokensIn(`${i.label} ${i.value} ${i.lsl} ${i.usl} ${i.formula ?? ""}`))));
    const unknown = [...tokens].filter((t) => !known.has(t));
    const blank = [...tokens].filter((t) => known.has(t) && !env.context[t]);
    if (unknown.length) return { tone: "red", title: "Some variables are not recognised", detail: unknown.map((t) => `{${t}}`).join(", ") };
    if (blank.length) return { tone: "amber", title: "All variables recognised — some have no value for this part", detail: blank.map((t) => `{${t}}`).join(", ") };
    return { tone: "green", title: "All variables recognised and filled for the preview part", detail: "" };
  }, [form.sections, known, env.context]);

  // The panel is a column on wide screens; below that it opens as a sheet.
  const openSheet = () => {
    if (window.matchMedia("(max-width: 1023px)").matches) setSheet(true);
  };

  function select(itemId: string) {
    setSelected(itemId);
    setPanel("settings");
    openSheet();
  }

  function addItem(sectionId: string, type: ItemType) {
    const fresh = paletteItem(type);
    setSections((list) => list.map((s) => (s.id === sectionId ? { ...s, items: [...s.items, fresh] } : s)));
    setPalette(null);
    select(fresh.id);
  }

  function removeItem(itemId: string) {
    setSections((list) => list.map((s) => ({ ...s, items: s.items.filter((i) => i.id !== itemId) })));
    if (selected === itemId) setSelected(null);
  }

  function duplicateItem(itemId: string) {
    const at = location(itemId);
    if (!at) return;
    const copy = { ...at.item, id: `i-${crypto.randomUUID().slice(0, 8)}`, label: `${at.item.label} (copy)` };
    setSections((list) =>
      list.map((s) => (s.id === at.section.id ? { ...s, items: [...s.items.slice(0, at.index + 1), copy, ...s.items.slice(at.index + 1)] } : s)),
    );
    select(copy.id);
  }

  /** Put a field at a place in a section — its own or another. */
  function moveItemTo(itemId: string, sectionId: string, index: number) {
    const at = location(itemId);
    if (!at) return;
    // Taking it out first shifts the places after it in its own section.
    const to = at.section.id === sectionId && at.index < index ? index - 1 : index;
    if (at.section.id === sectionId && to === at.index) return;
    setSections((list) => {
      const without = list.map((sec) => (sec.id === at.section.id ? { ...sec, items: sec.items.filter((i) => i.id !== itemId) } : sec));
      return without.map((sec) => (sec.id === sectionId ? { ...sec, items: [...sec.items.slice(0, to), at.item, ...sec.items.slice(to)] } : sec));
    });
  }

  /** Put a section at a place among the sections. */
  function moveSectionTo(sectionId: string, index: number) {
    setSections((list) => {
      const from = list.findIndex((sec) => sec.id === sectionId);
      if (from < 0) return list;
      const to = from < index ? index - 1 : index;
      if (to === from) return list;
      const next = list.filter((sec) => sec.id !== sectionId);
      next.splice(to, 0, list[from]);
      return next;
    });
  }

  /** Whether the pointer is in the upper half of an element. */
  const upperHalf = (e: React.DragEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return e.clientY < box.top + box.height / 2;
  };

  function moveToSection(itemId: string, sectionId: string) {
    const at = location(itemId);
    if (!at || at.section.id === sectionId) return;
    setSections((list) =>
      list.map((s) =>
        s.id === at.section.id ? { ...s, items: s.items.filter((i) => i.id !== itemId) } : s.id === sectionId ? { ...s, items: [...s.items, at.item] } : s,
      ),
    );
  }

  function changePart(next: string) {
    setPartId(next);
    startTransition(async () => {
      const loaded = await previewEnvironment(next);
      if (loaded) setEnv(loaded);
    });
  }

  function save() {
    const problem = templateProblem(form);
    if (problem) {
      toast(problem, true);
      return;
    }
    const payload = JSON.stringify(form);
    startTransition(async () => {
      const result = await saveTemplate(id, payload);
      if (!result.ok) {
        toast(result.message ?? "The form could not be saved.", true);
        return;
      }
      setBaseline(payload);
      toast(result.message ?? "QA form saved");
      if ("createdId" in result && result.createdId) {
        router.replace(`/qaforms/${result.createdId}`);
        return;
      }
      router.refresh();
    });
  }

  function remove() {
    if (!window.confirm(`Delete "${form.name}"? Records already filled on parts are kept.`)) return;
    startTransition(async () => {
      const result = await deleteTemplate(id);
      if (!result.ok) {
        toast(result.message ?? "The form could not be deleted.", true);
        return;
      }
      router.push("/qaforms");
    });
  }

  function insertToken(token: string) {
    if (!current) return;
    setItem(current.item.id, (i) => ({ ...i, value: `${i.value}${i.value && !i.value.endsWith(" ") ? " " : ""}{${token}}` }));
  }

  const groupedVars = useMemo(() => {
    const q = varQuery.trim().toLowerCase();
    const list = variables.filter((v) => !q || `${v.label} ${v.token}`.toLowerCase().includes(q));
    const groups = new Map<VarGroup, VarDef[]>();
    for (const v of list) groups.set(v.group, [...(groups.get(v.group) ?? []), v]);
    return [...groups.entries()];
  }, [variables, varQuery]);

  const attachOptions = [...new Set([...stages, ...form.attach])];

  // --- The panel --------------------------------------------------------------------------------
  const panelBody = (
    <div className="flex min-w-0 flex-col">
      <div role="tablist" className="border-line-2 flex gap-1 overflow-x-auto border-b px-3">
        {(
          [
            ["settings", "Field settings"],
            ["preview", "Live preview"],
            ["details", "Form details"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={panel === key}
            onClick={() => setPanel(key)}
            className={"h-11 flex-none border-0 border-b-2 bg-transparent px-2.5 text-[13px] font-semibold whitespace-nowrap " + (panel === key ? "border-brand text-brand-ink" : "text-ink-3 border-transparent")}
          >
            {label}
          </button>
        ))}
      </div>

      {panel === "settings" ? (
        current ? (
          <fieldset disabled={!canEdit} className="m-0 flex min-w-0 flex-col gap-3.5 border-0 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex min-w-0 flex-col">
                <span className="text-muted text-[10.5px] font-bold tracking-[0.6px] uppercase">Field · {current.section.title || "Untitled section"}</span>
                <span className="truncate text-sm font-bold">{current.item.label}</span>
              </div>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => duplicateItem(current.item.id)} className="border-field h-8 rounded-lg border bg-white px-2.5 text-xs font-semibold">
                  Duplicate
                </button>
                <button type="button" onClick={() => removeItem(current.item.id)} className="h-8 rounded-lg border border-[#FDA29B] bg-white px-2.5 text-xs font-semibold text-[#B42318]">
                  Delete
                </button>
              </div>
            </div>

            <label className="flex flex-col gap-1 text-xs font-semibold">
              Label
              <input
                value={current.item.label}
                onChange={(e) => {
                  const from = current.item.label;
                  const to = e.target.value;
                  setSections((list) =>
                    list.map((s) => ({
                      ...s,
                      items: s.items.map((i) => {
                        if (i.id === current.item.id) return { ...i, label: to };
                        if (!from.trim()) return i;
                        let next = i;
                        if (i.type === "calc" && i.formula) next = { ...next, formula: renameRef(i.formula, from, to) };
                        if (i.showIf && i.showIf.ref.trim() === from.trim()) next = { ...next, showIf: { ...i.showIf, ref: to } };
                        return next;
                      }),
                    })),
                  );
                }}
                className="border-field h-9 rounded-lg border px-2.5 text-[13px] font-normal"
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold">Field type</span>
              <div className="grid grid-cols-2 gap-1.5">
                {PALETTE.map((p) => (
                  <button
                    key={p.type}
                    type="button"
                    aria-pressed={current.item.type === p.type}
                    onClick={() =>
                      setItem(current.item.id, (i) => {
                        const fresh = paletteItem(p.type);
                        return { ...fresh, id: i.id, label: i.label, req: p.type === "info" || p.type === "image" ? false : i.req };
                      })
                    }
                    className={"flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-xs font-semibold " + (current.item.type === p.type ? "border-brand-edge bg-brand-wash text-brand-ink" : "border-line text-ink-2 bg-white")}
                  >
                    <TypeIcon d={p.icon} />
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            {current.item.type !== "info" && current.item.type !== "image" ? (
              <label className="flex items-center gap-2.5 text-[12.5px]">
                <Switch on={current.item.req} onToggle={() => setItem(current.item.id, (i) => ({ ...i, req: !i.req }))} label="Required" />
                {current.item.req ? "Required — the form cannot be submitted without it" : "Optional"}
              </label>
            ) : null}

            {current.item.type === "select" ? (
              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-1 text-xs font-semibold">
                  Options come from
                  <select
                    value={current.item.src}
                    onChange={(e) => setItem(current.item.id, (i) => ({ ...i, src: e.target.value as Source, qty: QTY_SOURCES.includes(e.target.value as Source) ? i.qty : false }))}
                    className="border-field h-9 rounded-lg border bg-white px-2 text-[13px] font-normal"
                  >
                    {SOURCES.map((s) => (
                      <option key={s} value={s}>
                        {SOURCE_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </label>
                {current.item.src === "custom" ? (
                  <label className="flex flex-col gap-1 text-xs font-semibold">
                    Choices (comma separated)
                    <input
                      value={current.item.opts}
                      placeholder="e.g. Accepted, Rework, Rejected"
                      onChange={(e) => setItem(current.item.id, (i) => ({ ...i, opts: e.target.value }))}
                      className="border-field h-9 rounded-lg border px-2.5 text-[13px] font-normal"
                    />
                  </label>
                ) : (
                  <span className="text-muted text-[11.5px] leading-[1.5]">
                    Live list from the setup pages — {(libraries[current.item.src as Source] ?? []).length} option(s) now. Pre-select with a variable in the value box, e.g. {"{part.printer}"}.
                  </span>
                )}
                {QTY_SOURCES.includes(current.item.src as Source) ? (
                  <label className="flex items-start gap-2 text-[12.5px]">
                    <input type="checkbox" className="mt-0.5 h-4 w-4" checked={current.item.qty} onChange={() => setItem(current.item.id, (i) => ({ ...i, qty: !i.qty }))} />
                    Also record quantity used — deducted from stock, shown on the item&apos;s page
                  </label>
                ) : null}
              </div>
            ) : null}

            {current.item.type === "calc" ? (
              <div className="flex flex-col gap-1.5">
                <label className="flex flex-col gap-1 text-xs font-semibold">
                  Formula
                  <textarea
                    rows={2}
                    aria-label="Formula"
                    value={current.item.formula ?? ""}
                    placeholder="e.g. [Print start] + [Print time]"
                    onChange={(e) => setItem(current.item.id, (i) => ({ ...i, formula: e.target.value }))}
                    className="border-field resize-y rounded-lg border px-2.5 py-2 font-mono text-[12.5px] font-normal"
                  />
                </label>
                {(() => {
                  const problem = (current.item.formula ?? "").trim() ? formulaProblem(current.item.formula ?? "") : "Write a formula — click fields below to add them.";
                  return problem ? (
                    <span className="bg-warn-tint text-warn self-start rounded-md px-2 py-0.5 text-[11.5px] font-semibold">{problem}</span>
                  ) : (
                    <span className="bg-ok-tint text-ok self-start rounded-md px-2 py-0.5 text-[11.5px] font-semibold">Formula reads correctly — see it work in Live preview</span>
                  );
                })()}
                <div className="border-line-2 flex flex-col gap-1.5 rounded-lg border p-2">
                  <span className="text-ink-3 text-[11px] font-semibold">Fields on this form — click to add</span>
                  <div className="flex flex-wrap gap-1">
                    {form.sections
                      .flatMap((s) => s.items)
                      .filter((i) => i.id !== current.item.id && CALC_SOURCES.includes(i.type) && i.label.trim())
                      .map((i) => (
                        <button
                          key={i.id}
                          type="button"
                          onClick={() => setItem(current.item.id, (c) => ({ ...c, formula: `${(c.formula ?? "").trimEnd()}${c.formula?.trim() ? " " : ""}[${i.label.trim()}]` }))}
                          className="border-field hover:bg-subtle rounded-md border bg-white px-1.5 py-0.5 text-left text-[11.5px]"
                        >
                          [{i.label.trim()}] <span className="text-faint">{typeName(i.type).toLowerCase()}</span>
                        </button>
                      ))}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {["+", "-", "*", "/", "(", ")"].map((op) => (
                      <button
                        key={op}
                        type="button"
                        onClick={() => setItem(current.item.id, (c) => ({ ...c, formula: `${(c.formula ?? "").trimEnd()} ${op} `.trimStart() }))}
                        className="border-field h-7 w-7 rounded-md border bg-white font-mono text-[13px]"
                        aria-label={`Add ${op}`}
                      >
                        {op}
                      </button>
                    ))}
                  </div>
                  <span className="text-muted text-[11px] leading-[1.55]">
                    Variables work too, e.g. {"{part.qty}"}. Durations can be written as 90m, 1h30m or 2d. Date & time + duration = date & time;
                    date & time − date & time = duration; date + number = date. Functions: {Object.values(FUNCTION_HELP).join(" · ")}.
                  </span>
                </div>
              </div>
            ) : null}

            {current.item.type === "grid" ? (
              <GridColumnsEditor
                columns={current.item.columns ?? []}
                onChange={(columns, rename) =>
                  setSections((list) =>
                    list.map((s) => ({
                      ...s,
                      items: s.items.map((i) =>
                        i.id === current.item.id
                          ? { ...i, columns }
                          : rename && i.type === "calc" && i.formula
                            ? { ...i, formula: renameColumnRef(i.formula, current.item.label, rename.from, rename.to) }
                            : i,
                      ),
                    })),
                  )
                }
              />
            ) : null}

            {current.item.type === "yesno" ? (
              <label className="flex flex-col gap-1 text-xs font-semibold">
                Answer that passes
                <select
                  value={current.item.expect ?? ""}
                  onChange={(e) => setItem(current.item.id, (i) => ({ ...i, expect: e.target.value as "" | "Yes" | "No" }))}
                  className="border-field h-9 rounded-lg border bg-white px-2 text-[13px] font-normal"
                >
                  <option value="">Either — no Pass / Fail</option>
                  <option value="Yes">Yes — &quot;No&quot; fails</option>
                  <option value="No">No — &quot;Yes&quot; fails</option>
                </select>
              </label>
            ) : null}

            {current.item.type === "select" && current.item.src === "custom" ? (
              <label className="flex items-center gap-2 text-xs font-semibold">
                <input
                  type="checkbox"
                  checked={Boolean(current.item.multi)}
                  onChange={(e) => setItem(current.item.id, (i) => ({ ...i, multi: e.target.checked }))}
                  className="accent-brand h-4 w-4"
                />
                Several can be chosen — tick-boxes instead of a dropdown
              </label>
            ) : null}

            {IMAGE_ABLE.includes(current.item.type) ? (
              <label className="flex items-center gap-2 text-xs font-semibold">
                <input
                  type="checkbox"
                  checked={Boolean(current.item.allowImages)}
                  onChange={(e) => setItem(current.item.id, (i) => ({ ...i, allowImages: e.target.checked }))}
                  className="accent-brand h-4 w-4"
                />
                Allow image — the person filling it can add pictures beside the value
              </label>
            ) : null}

            {current.item.type === "file" ? (
              <label className="flex items-center gap-2 text-xs font-semibold">
                <input
                  type="checkbox"
                  checked={Boolean(current.item.anyFile)}
                  onChange={(e) => setItem(current.item.id, (i) => ({ ...i, anyFile: e.target.checked }))}
                  className="accent-brand h-4 w-4"
                />
                Any file type — design files, videos… (off: photos and PDFs only)
              </label>
            ) : null}

            {current.item.type === "sign" ? (
              <label className="flex flex-col gap-1 text-xs font-semibold">
                Signed by
                <select
                  aria-label="Signed by"
                  value={current.item.signer ?? "anyone"}
                  onChange={(e) =>
                    setItem(current.item.id, (i) => {
                      const signer = e.target.value as Signer;
                      // The label follows the tag, unless it was given a name of its own.
                      const tags = [...Object.values(SIGNER_TAGS), "Signed by", ""];
                      const label = signer !== "anyone" && tags.includes(i.label.trim()) ? SIGNER_TAGS[signer] : i.label;
                      return { ...i, signer, label, ...(signer === "anyone" ? {} : { value: "" }) };
                    })
                  }
                  className="border-field h-9 rounded-lg border bg-white px-2 text-[13px] font-normal"
                >
                  {SIGNERS.map((who) => (
                    <option key={who} value={who}>
                      {SIGNER_LABELS[who]}
                    </option>
                  ))}
                </select>
                <span className="text-muted text-[11.5px] font-normal leading-[1.5]">
                  {(current.item.signer ?? "anyone") === "submitter"
                    ? "Shows the name of the person filling the form — no box to type in. It is signed, with the time, as they submit it."
                    : (current.item.signer ?? "anyone") === "reviewer"
                      ? "Whoever fills the form chooses one or more reviewers from a dropdown. After submitting, each reviewer signs in turn, before the approvers."
                      : (current.item.signer ?? "anyone") === "approver"
                        ? "Whoever fills the form chooses one or more approvers from a dropdown. They sign in turn after the reviewers; the last signature approves the form."
                        : "Typed by whoever fills the form."}
                </span>
              </label>
            ) : null}

            {current.item.type === "sign" ? (
              <label className="flex flex-col gap-1 text-xs font-semibold">
                Signature style
                <select
                  aria-label="Signature style"
                  value={current.item.style ?? "name"}
                  onChange={(e) => setItem(current.item.id, (i) => ({ ...i, style: e.target.value as SignStyle }))}
                  className="border-field h-9 rounded-lg border bg-white px-2 text-[13px] font-normal"
                >
                  {SIGN_STYLES.map((st) => (
                    <option key={st} value={st}>
                      {SIGN_STYLE_LABELS[st]}
                    </option>
                  ))}
                </select>
                <span className="text-muted text-[11.5px] font-normal leading-[1.5]">
                  {(current.item.style ?? "name") === "image"
                    ? "The signer adds the signature image saved under My account; a copy is kept with the record, with their name, role and the time."
                    : (current.item.style ?? "name") === "role"
                      ? "The typed name, with the role of the person who signed shown under it."
                      : "The typed name. The signed-in account and the time are recorded behind it."}
                </span>
              </label>
            ) : null}

            {current.item.type === "sign" ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold">Who may sign</span>
                <div className="flex flex-wrap gap-1.5">
                  {roles.map((role) => {
                    const on = (current.item.roles ?? "").split(",").map((r) => r.trim().toLowerCase()).includes(role.toLowerCase());
                    return (
                      <button
                        key={role}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setItem(current.item.id, (i) => {
                            const list = (i.roles ?? "").split(",").map((r) => r.trim()).filter(Boolean);
                            const next = on ? list.filter((r) => r.toLowerCase() !== role.toLowerCase()) : [...list, role];
                            return { ...i, roles: next.join(", ") };
                          })
                        }
                        className={"rounded-full border px-2.5 py-1 text-xs font-semibold " + (on ? "border-brand-edge bg-brand-wash text-brand-ink" : "border-field text-ink-2 bg-white")}
                      >
                        {role}
                      </button>
                    );
                  })}
                </div>
                <input
                  aria-label="Roles that may sign"
                  value={current.item.roles ?? ""}
                  placeholder="Anyone — or roles, comma separated, e.g. QA, Quality Manager"
                  onChange={(e) => setItem(current.item.id, (i) => ({ ...i, roles: e.target.value }))}
                  className="border-field h-9 rounded-lg border px-2.5 text-[13px] font-normal"
                />
                <span className="text-muted text-[11.5px] leading-[1.5]">
                  {current.item.roles?.trim()
                    ? `Only a person whose role contains ${current.item.roles} can sign it — anyone else's save is refused. ${roleAllowed(current.item.roles, env.context["user.role"] ?? "") ? "You can sign it." : "You cannot sign it."}`
                    : "Anyone filling the form can sign. Every signature records the account that signed it, and when."}
                </span>
              </div>
            ) : null}

            {current.item.type === "number" || current.item.type === "duration" || current.item.type === "calc" ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs font-semibold">
                  Lower limit (LSL)
                  <input value={current.item.lsl} placeholder="e.g. 1.95 or {variable}" onChange={(e) => setItem(current.item.id, (i) => ({ ...i, lsl: e.target.value }))} className="border-field h-9 rounded-lg border px-2.5 font-mono text-[13px] font-normal" />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold">
                  Upper limit (USL)
                  <input value={current.item.usl} placeholder="e.g. 2.05" onChange={(e) => setItem(current.item.id, (i) => ({ ...i, usl: e.target.value }))} className="border-field h-9 rounded-lg border px-2.5 font-mono text-[13px] font-normal" />
                </label>
                <span className="text-muted col-span-2 text-[11.5px]">
                  {current.item.type === "duration"
                    ? "Limits in h:mm (or minutes). Pass / Fail shows as the duration is entered — leave both empty for no check."
                    : current.item.type === "calc"
                      ? "Optional: Pass / Fail on the result — a number, or h:mm for a duration. Leave both empty for no check."
                      : "Pass / Fail is calculated automatically when the operator enters the measured value."}
                </span>
              </div>
            ) : null}

            {current.item.type === "table" ? (
              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-1 text-xs font-semibold">
                  Balloon source (part request field)
                  <select
                    value={current.item.value.includes("{balloon.table}") ? "balloon" : ""}
                    onChange={(e) => setItem(current.item.id, (i) => ({ ...i, value: e.target.value ? "{balloon.table}" : "" }))}
                    className="border-field h-9 rounded-lg border bg-white px-2 text-[13px] font-normal"
                  >
                    <option value="">— Select a balloon field —</option>
                    <option value="balloon">{"{balloon.table}"} · Drawing with balloon characteristics</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-[12.5px]">
                  <input type="checkbox" className="h-4 w-4" checked={!current.item.noMeasure} onChange={() => setItem(current.item.id, (i) => ({ ...i, noMeasure: !i.noMeasure }))} />
                  Capture measured values (Measured + Pass / Fail columns)
                </label>
              </div>
            ) : null}

            {!["check", "table", "criteria", "calc", "grid", "yesno", "file"].includes(current.item.type) && !(current.item.type === "sign" && current.item.style === "image") ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">
                    {current.item.type === "info" || current.item.type === "image" ? "Value (use variables)" : current.item.type === "sign" ? "Default signer" : "Pre-fill (optional)"}
                  </span>
                  <button type="button" onClick={() => setItem(current.item.id, (i) => ({ ...i, value: "" }))} className="text-brand-ink border-0 bg-transparent p-0 text-xs font-semibold">
                    Clear
                  </button>
                </div>
                <textarea
                  rows={2}
                  value={current.item.value}
                  onChange={(e) => setItem(current.item.id, (i) => ({ ...i, value: e.target.value }))}
                  className="border-field resize-y rounded-lg border px-2.5 py-2 font-mono text-[12.5px]"
                />
                {(() => {
                  const state = mapping(current.item.value, known, env.context, OPERATOR_INPUT.includes(current.item.type));
                  return <span className={`self-start rounded-md px-2 py-0.5 text-[11.5px] font-semibold ${CHIP[state.tone]}`}>{state.text}</span>;
                })()}
                <span className="text-muted text-[11.5px] break-words">
                  → {current.item.value ? current.item.value.replace(/\{([\w.]+)\}/g, (_w, t: string) => env.context[t] || "—") : "—"}
                </span>
                <div className="border-line-2 flex flex-col gap-1.5 rounded-lg border p-2">
                  <span className="text-ink-3 text-[11px] font-semibold">Insert a variable — click to add it to the value</span>
                  <input value={varQuery} onChange={(e) => setVarQuery(e.target.value)} placeholder="Search variables…" className="border-field h-8 rounded-md border px-2 text-xs" />
                  <div className="flex max-h-[220px] flex-col gap-2 overflow-y-auto">
                    {groupedVars.map(([group, list]) => (
                      <div key={group} className="flex flex-col gap-0.5">
                        <span className="text-muted text-[10.5px] font-bold tracking-[0.5px] uppercase">{GROUP_LABELS[group]}</span>
                        {list.map((v) => (
                          <button
                            key={v.token}
                            type="button"
                            onClick={() => insertToken(v.token)}
                            className="hover:bg-subtle flex flex-wrap items-baseline justify-between gap-x-2 rounded-md border-0 bg-transparent px-1.5 py-1 text-left text-xs"
                          >
                            <span className="font-semibold">{v.label}</span>
                            <span className="text-brand-ink font-mono text-[11px]">{`{${v.token}}`}</span>
                            {env.context[v.token] ? <span className="text-faint w-full truncate text-[11px]">e.g. {env.context[v.token]}</span> : null}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            <ShowIfEditor
              item={current.item}
              others={form.sections.flatMap((s) => s.items).filter((i) => i.id !== current.item.id && CONDITION_SOURCES.includes(i.type) && i.label.trim())}
              onChange={(showIf) => setItem(current.item.id, (i) => ({ ...i, showIf }))}
            />

            <div className="border-line-2 flex flex-wrap items-center gap-2 border-t pt-3">
              <label className="flex items-center gap-2 text-xs font-semibold">
                Section
                <select value={current.section.id} onChange={(e) => moveToSection(current.item.id, e.target.value)} className="border-field h-8 max-w-[180px] rounded-lg border bg-white px-2 text-xs">
                  {form.sections.map((s, i) => (
                    <option key={s.id} value={s.id}>
                      {i + 1}. {s.title || "Untitled"}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={() => setSections((l) => l.map((s) => (s.id === current.section.id ? { ...s, items: move(s.items, current.index, -1) } : s)))} className="border-field h-8 rounded-lg border bg-white px-2.5 text-xs">
                ↑ Up
              </button>
              <button type="button" onClick={() => setSections((l) => l.map((s) => (s.id === current.section.id ? { ...s, items: move(s.items, current.index, 1) } : s)))} className="border-field h-8 rounded-lg border bg-white px-2.5 text-xs">
                ↓ Down
              </button>
            </div>
          </fieldset>
        ) : (
          <div className="flex flex-col gap-1.5 p-6 text-center">
            <span className="text-sm font-bold">Select a field to edit it</span>
            <span className="text-muted text-[12.5px] leading-[1.5]">
              Click any row in the form. Its type, label, variables, limits and dropdown options appear here. Use “+ Add field” inside a section to add new ones.
            </span>
          </div>
        )
      ) : null}

      {panel === "preview" ? (
        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-center gap-2 p-3">
            <span className="bg-brand-tint text-brand-ink rounded-full px-[9px] py-[3px] text-[11px] font-bold">● LIVE PREVIEW</span>
            <label className="text-muted flex min-w-0 flex-1 items-center gap-1.5 text-xs">
              with part
              <select value={partId ?? ""} onChange={(e) => changePart(e.target.value)} className="border-field h-8 min-w-0 flex-1 rounded-lg border bg-white px-2 text-xs">
                {parts.length === 0 ? <option value="">No parts yet</option> : null}
                {parts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="bg-navy flex flex-col gap-0.5 px-4 py-3">
            <span className="text-sm font-bold text-white">{form.name}</span>
            <span className="text-brand-glow font-mono text-[11.5px]">{[form.code, form.clause].filter(Boolean).join(" · ")}</span>
            <span className="text-navy-muted text-xs">{env.context["part.id"] ? `${env.context["part.id"]} · ${env.context["part.name"]}` : "No part selected"}</span>
          </div>
          <QaFormView
            meta={{ id: null, name: form.name, code: form.code, clause: form.clause, issue: form.issue, effective: form.effective, rev: form.rev, docLayout: form.docLayout, validity: form.validity, docStyle: form.docStyle, layout: layoutFor(layouts, form.docStyle), stageName: "", status: "In progress" }}
            sections={form.sections}
            context={env.context}
            libraries={libraries}
            inspection={env.inspection}
            initial={emptyState()}
            partLine=""
            partId={null}
            editable={false}
            canApprove={false}
            approveHint={null}
            preview
          />
        </div>
      ) : null}

      {panel === "details" ? (
        <fieldset disabled={!canEdit} className="m-0 flex flex-col gap-3 border-0 p-4">
          {(
            [
              ["name", "Form name", "", false],
              ["code", "Document code", "e.g. QMS-FI-03", true],
              ["clause", "Standard / clause reference", "e.g. ISO 13485 §8.2.6", false],
              ["issue", "Issue No.", "e.g. 02", false],
              ["effective", "Effective date", "e.g. 06-03-2023", false],
              ["validity", "Validity (valid until)", "e.g. 13-08-2028", false],
              ["rev", "Rev. No.", "e.g. 02", false],
            ] as const
          ).map(([key, label, placeholder, upper]) => (
            <label key={key} className="flex flex-col gap-1 text-xs font-semibold">
              {label}
              <input
                value={form[key] ?? ""}
                placeholder={placeholder}
                onChange={(e) => setForm((f) => ({ ...f, [key]: upper ? e.target.value.toUpperCase().replace(/\s+/g, "") : e.target.value }))}
                className={"border-field h-9 rounded-lg border px-2.5 text-[13px] font-normal " + (upper ? "font-mono" : "")}
              />
            </label>
          ))}
          <label className="flex items-start gap-2.5 text-[12.5px]">
            <Switch on={form.docLayout} onToggle={() => setForm((f) => ({ ...f, docLayout: !f.docLayout }))} label="Controlled-document layout" />
            Controlled-document layout (a header & footer with the document no., issue, rev and effective date)
          </label>
          {form.docLayout ? (
            <div className="flex flex-col gap-1.5 pl-[46px]">
              <span className="text-xs font-semibold">Header & footer design</span>
              <select
                aria-label="Header and footer design"
                value={layoutFor(layouts, form.docStyle).id}
                onChange={(e) => setForm((f) => ({ ...f, docStyle: e.target.value }))}
                className="border-field h-9 max-w-[360px] self-start rounded-lg border bg-white px-2 text-[13px]"
              >
                {layouts.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <span className="text-muted text-[11.5px]">
                Its words come from this form — name, code, revision, effective date… — and Company details.{" "}
                <Link href="/qaforms?view=layouts" className="text-brand-ink font-semibold underline">
                  Design headers &amp; footers
                </Link>
              </span>
            </div>
          ) : null}
          <label className="flex flex-col gap-1.5 text-xs font-semibold">
            Used for
            <select
              aria-label="Used for"
              value={form.usedFor ?? "generic"}
              onChange={(e) => setForm((f) => ({ ...f, usedFor: e.target.value as UsedFor }))}
              className="border-field h-9 self-start rounded-lg border bg-white px-2 text-[13px] font-normal"
            >
              {USED_FOR.map((u) => (
                <option key={u} value={u}>
                  {USED_FOR_LABELS[u]}
                </option>
              ))}
            </select>
            <span className="text-muted text-[11.5px] font-normal">Product forms are offered on products&apos; case stages, manufacturing forms on production workflows&apos; stages; generic forms on both.</span>
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold">Add this form to parts at these workflow stages</span>
            <span className="text-muted text-[11.5px]">When a part reaches a selected stage, this form appears on its Current stage tab. Applies to parts requested from now on.</span>
            <div className="flex flex-wrap gap-1.5">
              {attachOptions.length === 0 ? <span className="text-faint text-xs">No workflow stages yet — set workflows up first.</span> : null}
              {attachOptions.map((name) => {
                const on = form.attach.includes(name);
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setForm((f) => ({ ...f, attach: on ? f.attach.filter((a) => a !== name) : [...f.attach, name] }))}
                    className={"h-7 rounded-full border px-2.5 text-xs font-semibold " + (on ? "border-brand-edge bg-brand-wash text-brand-ink" : "border-field text-ink-3 bg-white")}
                  >
                    {on ? "✓ " : "+ "}
                    {name}
                    {!stages.includes(name) ? " (no longer in a workflow)" : ""}
                  </button>
                );
              })}
            </div>
          </div>
          {canEdit && id !== "new" ? (
            <button type="button" onClick={remove} className="mt-2 h-9 self-start rounded-[9px] border border-[#FDA29B] bg-white px-3 text-[13px] font-semibold text-[#B42318]">
              Delete this QA form
            </button>
          ) : null}
        </fieldset>
      ) : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Top bar */}
      <section className="border-line flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[14px] border bg-white px-4 py-3.5 sm:px-5">
        <Link
          href="/qaforms"
          onClick={(e) => {
            if (dirty && !window.confirm("Leave without saving? Your changes to this form will be lost.")) e.preventDefault();
          }}
          className="text-ink-2 text-[13px] font-semibold whitespace-nowrap no-underline"
        >
          ← All QA forms
        </Link>
        <div className="flex min-w-[220px] flex-1 flex-col gap-0.5">
          <input
            aria-label="Form name"
            value={form.name}
            disabled={!canEdit}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="hover:border-line focus:border-field h-8 w-full rounded-md border border-transparent bg-white px-1.5 text-base font-bold disabled:bg-white"
          />
          <span className="text-muted px-1.5 text-xs">
            <span className="font-mono">{form.code || "No code"}</span> · {stats.sections} section{stats.sections === 1 ? "" : "s"} · {stats.items} field{stats.items === 1 ? "" : "s"} · {stats.required} required ·{" "}
            <button type="button" onClick={() => { setPanel("details"); openSheet(); }} className={"border-0 bg-transparent p-0 text-xs font-semibold " + (form.attach.length ? "text-brand-ink" : "text-warn")}>
              {form.attach.length ? `Added to parts at: ${form.attach.join(", ")}` : "Not added to any workflow stage yet"}
            </button>
            {usedOnParts ? ` · on ${usedOnParts} part${usedOnParts === 1 ? "" : "s"}` : ""}
          </span>
        </div>
        <button
          type="button"
          onClick={() => { setPanel("preview"); openSheet(); }}
          title={check.detail || check.title}
          className={`flex flex-col items-start rounded-lg border-0 px-2.5 py-1 text-left ${CHIP[check.tone]}`}
        >
          <span className="text-xs font-bold">{check.title}</span>
          <span className="text-[10.5px] opacity-80">Variable check with the preview part — click to preview</span>
        </button>
        <Link href={`/variables?from=${id}`} className="border-field text-ink-2 flex h-9 items-center rounded-[9px] border bg-white px-3 text-[13px] font-semibold no-underline">
          Variable library
        </Link>
        {canEdit ? (
          <button type="button" onClick={save} disabled={!dirty || pending} className="bg-brand h-9 rounded-[9px] border-0 px-3.5 text-[13px] font-bold text-white disabled:opacity-50">
            {pending ? "Saving…" : dirty ? "Save form" : "Saved"}
          </button>
        ) : null}
      </section>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-cols-[190px_minmax(0,1fr)_400px]">
        {/* Outline */}
        <nav aria-label="Outline" className="border-line hidden flex-col gap-1 rounded-[14px] border bg-white p-3 2xl:sticky 2xl:top-0 2xl:flex">
          <span className="text-muted px-1.5 pb-1 text-[10.5px] font-bold tracking-[0.6px] uppercase">Outline</span>
          {form.sections.map((s, i) => (
            <a key={s.id} href={`#sec-${s.id}`} className="text-ink-2 hover:bg-subtle flex items-center justify-between gap-2 rounded-lg px-1.5 py-1.5 text-[12.5px] no-underline">
              <span className="truncate">
                {i + 1}. {s.title || "Untitled"}
              </span>
              <span className="text-faint font-mono text-[11px]">{s.items.length}</span>
            </a>
          ))}
        </nav>

        {/* Sections */}
        <fieldset disabled={!canEdit} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
          {form.sections.map((section, si) => (
            <div
              key={section.id}
              id={`sec-${section.id}`}
              data-testid={`section-${si + 1}`}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (drag.kind === "section") setSectionDrop(upperHalf(e) ? si : si + 1);
                else setDropAt({ sectionId: section.id, index: section.items.length });
              }}
              onDrop={(e) => {
                if (!drag) return;
                e.preventDefault();
                if (drag.kind === "section" && sectionDrop !== null) moveSectionTo(drag.id, sectionDrop);
                if (drag.kind === "item" && dropAt) moveItemTo(drag.id, dropAt.sectionId, dropAt.index);
                endDrag();
              }}
              className={
                "border-line relative flex flex-col gap-2 rounded-[14px] border bg-white px-3.5 py-3 sm:px-4 " +
                (drag?.id === section.id ? "opacity-50 " : "") +
                (drag?.kind === "section" && sectionDrop === si ? "shadow-[0_-3px_0_0_var(--color-brand)] " : "") +
                (drag?.kind === "section" && sectionDrop === si + 1 && si === form.sections.length - 1 ? "shadow-[0_3px_0_0_var(--color-brand)] " : "")
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                {canEdit ? (
                  <span
                    draggable
                    aria-label={`Drag section ${section.title || si + 1}`}
                    title="Drag to move the section"
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", section.id);
                      const box = e.currentTarget.closest(`#sec-${CSS.escape(section.id)}`);
                      if (box) e.dataTransfer.setDragImage(box, 24, 18);
                      setDrag({ kind: "section", id: section.id });
                    }}
                    onDragEnd={endDrag}
                    className="text-faint hover:text-ink-3 flex h-6 w-4 flex-none cursor-grab items-center justify-center text-[13px] leading-none select-none active:cursor-grabbing"
                  >
                    ⋮⋮
                  </span>
                ) : null}
                <span className="bg-brand-tint text-brand-ink flex h-6 w-6 flex-none items-center justify-center rounded-full text-[11px] font-bold">{si + 1}</span>
                <input
                  aria-label="Section title"
                  value={section.title}
                  onChange={(e) => setSections((l) => l.map((s) => (s.id === section.id ? { ...s, title: e.target.value } : s)))}
                  className="hover:border-line focus:border-field h-8 min-w-[140px] flex-1 rounded-md border border-transparent bg-white px-1.5 text-sm font-bold"
                />
                <div className="bg-chip flex gap-0.5 rounded-lg p-[3px]">
                  {([1, 2, 3, 4] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={section.cols === c}
                      onClick={() => setSections((l) => l.map((s) => (s.id === section.id ? { ...s, cols: c } : s)))}
                      className={"h-6 rounded-md border-0 px-2 text-[11px] font-semibold " + (section.cols === c ? "text-ink bg-white" : "text-muted bg-transparent")}
                    >
                      {c} col
                    </button>
                  ))}
                </div>
                <SmallButton label="Move section up" disabled={si === 0} onClick={() => setSections((l) => move(l, si, -1))}>
                  ↑
                </SmallButton>
                <SmallButton label="Move section down" disabled={si === form.sections.length - 1} onClick={() => setSections((l) => move(l, si, 1))}>
                  ↓
                </SmallButton>
                <SmallButton
                  label="Delete section"
                  disabled={form.sections.length === 1}
                  onClick={() => {
                    if (section.items.length === 0 || window.confirm(`Delete the section "${section.title}" and its ${section.items.length} field(s)?`)) {
                      setSections((l) => l.filter((s) => s.id !== section.id));
                    }
                  }}
                  danger
                >
                  ×
                </SmallButton>
              </div>

              {section.items.map((item, ii) => {
                const state = mapping(item.value, known, env.context, OPERATOR_INPUT.includes(item.type));
                const on = selected === item.id;
                const lineBefore = drag?.kind === "item" && dropAt?.sectionId === section.id && dropAt.index === ii;
                const lineAfter = drag?.kind === "item" && dropAt?.sectionId === section.id && dropAt.index === ii + 1 && ii === section.items.length - 1;
                return (
                  <div
                    key={item.id}
                    data-testid={`field-${item.label}`}
                    draggable={canEdit}
                    onDragStart={(e) => {
                      e.stopPropagation();
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", item.id);
                      setDrag({ kind: "item", id: item.id });
                    }}
                    onDragEnd={endDrag}
                    onDragOver={(e) => {
                      if (drag?.kind !== "item") return;
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = "move";
                      setDropAt({ sectionId: section.id, index: upperHalf(e) ? ii : ii + 1 });
                    }}
                    onDrop={(e) => {
                      if (drag?.kind !== "item") return;
                      e.preventDefault();
                      e.stopPropagation();
                      if (dropAt) moveItemTo(drag.id, dropAt.sectionId, dropAt.index);
                      endDrag();
                    }}
                    className={
                      "flex flex-wrap items-center gap-2 rounded-[10px] border px-2.5 py-2 " +
                      (on ? "border-brand-edge bg-brand-wash " : "border-line-2 bg-white ") +
                      (drag?.id === item.id ? "opacity-40 " : "") +
                      (lineBefore ? "shadow-[0_-3px_0_0_var(--color-brand)] " : "") +
                      (lineAfter ? "shadow-[0_3px_0_0_var(--color-brand)] " : "")
                    }
                  >
                    {canEdit ? (
                      <span aria-hidden title="Drag to move the field" className="text-faint flex w-3 flex-none cursor-grab justify-center text-[13px] leading-none select-none active:cursor-grabbing">
                        ⋮⋮
                      </span>
                    ) : null}
                    <button type="button" onClick={() => select(item.id)} className="flex min-w-[180px] flex-1 items-center gap-2.5 border-0 bg-transparent p-0 text-left">
                      <span className="bg-chip text-ink-3 flex h-7 w-7 flex-none items-center justify-center rounded-md">
                        <TypeIcon d={PALETTE.find((p) => p.type === item.type)?.icon ?? ""} />
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="text-ink truncate text-[13px] font-semibold">
                          {item.label}
                          {item.req && item.type !== "info" && item.type !== "image" ? <span className="text-bad"> *</span> : null}
                        </span>
                        <span className="text-muted truncate text-[11.5px]">
                          {typeName(item.type)} · {summary(item)}
                        </span>
                      </span>
                      {state.tone === "red" || state.tone === "amber" ? (
                        <span className={`hidden flex-none rounded px-1.5 py-px text-[10px] font-bold sm:inline ${CHIP[state.tone]}`}>{state.tone === "red" ? "Unknown variable" : "Blank for preview"}</span>
                      ) : null}
                    </button>
                    <div className="flex gap-1">
                      <SmallButton label="Move field up" disabled={ii === 0} onClick={() => setSections((l) => l.map((s) => (s.id === section.id ? { ...s, items: move(s.items, ii, -1) } : s)))}>
                        ↑
                      </SmallButton>
                      <SmallButton label="Move field down" disabled={ii === section.items.length - 1} onClick={() => setSections((l) => l.map((s) => (s.id === section.id ? { ...s, items: move(s.items, ii, 1) } : s)))}>
                        ↓
                      </SmallButton>
                      <SmallButton label="Duplicate field" onClick={() => duplicateItem(item.id)}>
                        ⧉
                      </SmallButton>
                      <SmallButton label="Delete field" onClick={() => removeItem(item.id)} danger>
                        ×
                      </SmallButton>
                    </div>
                  </div>
                );
              })}

              {drag?.kind === "item" && section.items.length === 0 ? (
                <div className={"rounded-[10px] border border-dashed px-3 py-2.5 text-center text-[12px] " + (dropAt?.sectionId === section.id ? "border-brand text-brand-ink bg-brand-wash" : "border-field text-muted")}>
                  Drop the field here
                </div>
              ) : null}
              {palette === section.id ? (
                <div className="border-brand-edge bg-brand-wash grid grid-cols-1 gap-1.5 rounded-[10px] border p-2 sm:grid-cols-2">
                  {PALETTE.map((p) => (
                    <button key={p.type} type="button" onClick={() => addItem(section.id, p.type)} className="border-line flex items-start gap-2 rounded-lg border bg-white p-2 text-left">
                      <span className="text-brand mt-0.5">
                        <TypeIcon d={p.icon} />
                      </span>
                      <span className="flex flex-col">
                        <span className="text-[12.5px] font-bold">{p.name}</span>
                        <span className="text-muted text-[11px] leading-[1.4]">{p.description}</span>
                      </span>
                    </button>
                  ))}
                  <button type="button" onClick={() => setPalette(null)} className="text-ink-3 col-span-full h-8 border-0 bg-transparent text-xs font-semibold">
                    Cancel
                  </button>
                </div>
              ) : canEdit ? (
                <button type="button" onClick={() => setPalette(section.id)} className="border-field text-ink-2 h-8 self-start rounded-lg border border-dashed bg-white px-3 text-[12.5px] font-semibold">
                  + Add field to this section
                </button>
              ) : null}
            </div>
          ))}
          {canEdit ? (
            <button
              type="button"
              onClick={() => setSections((l) => [...l, newSection("New section", [], 1)])}
              className="border-field text-ink-2 h-11 rounded-xl border border-dashed bg-white text-[13px] font-semibold"
            >
              + Add section
            </button>
          ) : null}
        </fieldset>

        {/* Panel: a column on wide screens, a sheet on narrow ones */}
        <aside className="border-line hidden min-w-0 overflow-hidden rounded-[14px] border bg-white lg:sticky lg:top-0 lg:block lg:max-h-[calc(100dvh-140px)] lg:overflow-y-auto">
          {panelBody}
        </aside>
      </div>

      {sheet ? (
        <div className="fixed inset-0 z-40 flex items-end bg-[rgba(12,21,36,.45)] lg:hidden" onClick={() => setSheet(false)}>
          <div className="max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl bg-white" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 flex justify-end bg-white px-3 pt-2">
              <button type="button" onClick={() => setSheet(false)} className="bg-ink h-8 rounded-lg border-0 px-3 text-xs font-semibold text-white">
                Done
              </button>
            </div>
            {panelBody}
          </div>
        </div>
      ) : null}
      {node}
    </div>
  );
}

function summary(item: QaItem): string {
  switch (item.type) {
    case "number":
      return item.lsl || item.usl ? `${item.lsl || "—"} – ${item.usl || "—"}` : "no limits";
    case "select":
      return item.src ? `${SOURCE_LABELS[item.src as Source]}${item.qty ? " · records quantity" : ""}` : "no source";
    case "table":
      return item.noMeasure ? "balloons, no measuring" : "balloons, measured";
    case "check":
      return "Pass · Fail · N/A";
    case "duration":
      return item.lsl || item.usl ? `h:mm · ${item.lsl || "—"} – ${item.usl || "—"}` : "h:mm";
    case "calc":
      return item.formula ? `= ${item.formula}` : "no formula";
    case "date":
    case "datetime":
    case "time":
      return item.value ? `pre-filled ${item.value}` : typeName(item.type).toLowerCase();
    case "grid":
      return `${(item.columns ?? []).length} column${(item.columns ?? []).length === 1 ? "" : "s"}: ${(item.columns ?? []).map((c) => c.label).join(", ")}`;
    case "yesno":
      return item.expect ? `Yes / No · expects ${item.expect}` : "Yes / No";
    case "file":
      return "photo or PDF";
    case "sign":
      return [
        item.style && item.style !== "name" ? SIGN_STYLE_LABELS[item.style].replace(" (from My account)", "").toLowerCase() : "name",
        item.signer === "submitter" ? "the person filling it" : item.signer === "reviewer" ? "chosen reviewers" : item.signer === "approver" ? "chosen approvers" : "typed",
        item.roles ? `only ${item.roles}` : "anyone",
      ]
        .filter(Boolean)
        .join(" · ");
    default:
      return item.value || "blank";
  }
}

// --- Data table columns ------------------------------------------------------------------------

function GridColumnsEditor({
  columns,
  onChange,
}: {
  columns: GridColumn[];
  /** The new columns, and — when a column was renamed — its old and new name. */
  onChange: (columns: GridColumn[], rename?: { from: string; to: string }) => void;
}) {
  const set = (id: string, fn: (c: GridColumn) => GridColumn) => onChange(columns.map((c) => (c.id === id ? fn(c) : c)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...columns];
    const [c] = next.splice(index, 1);
    next.splice(index + by, 0, c);
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold">Columns</span>
      {columns.map((c, index) => (
        <div key={c.id} className="border-line-2 flex flex-col gap-1.5 rounded-lg border p-2">
          <div className="flex gap-1.5">
            <input
              aria-label="Column name"
              value={c.label}
              onChange={(e) => {
                const from = c.label;
                const to = e.target.value;
                // Formulas of the table's other columns follow the new name.
                onChange(
                  columns.map((o) => (o.id === c.id ? { ...o, label: to } : o.kind === "calc" && from.trim() ? { ...o, formula: renameRef(o.formula, from, to) } : o)),
                  from.trim() ? { from, to } : undefined,
                );
              }}
              className="border-field h-8 min-w-0 flex-1 rounded-md border px-2 text-[12.5px]"
            />
            <select
              aria-label="Column holds"
              value={c.kind}
              onChange={(e) => set(c.id, (o) => ({ ...o, kind: e.target.value as ColumnKind }))}
              className="border-field h-8 rounded-md border bg-white px-1.5 text-[12px]"
            >
              {COLUMN_KINDS.map((k) => (
                <option key={k} value={k}>
                  {COLUMN_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          {c.kind === "select" ? (
            <input
              aria-label="Column choices"
              value={c.opts}
              placeholder="Choices, comma separated"
              onChange={(e) => set(c.id, (o) => ({ ...o, opts: e.target.value }))}
              className="border-field h-8 rounded-md border px-2 text-[12.5px]"
            />
          ) : null}
          {c.kind === "calc" ? (
            <div className="flex flex-col gap-1">
              <input
                aria-label="Column formula"
                value={c.formula}
                placeholder="e.g. [Start] + [Time]"
                onChange={(e) => set(c.id, (o) => ({ ...o, formula: e.target.value }))}
                className="border-field h-8 rounded-md border px-2 font-mono text-[12px]"
              />
              <div className="flex flex-wrap gap-1">
                {columns
                  .filter((o) => o.id !== c.id && o.label.trim())
                  .map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => set(c.id, (x) => ({ ...x, formula: `${x.formula.trimEnd()}${x.formula.trim() ? " " : ""}[${o.label.trim()}]` }))}
                      className="border-field rounded border bg-white px-1.5 py-0.5 text-[11px]"
                    >
                      [{o.label.trim()}]
                    </button>
                  ))}
              </div>
              {c.formula.trim() && formulaProblem(c.formula) ? <span className="text-warn text-[11px]">{formulaProblem(c.formula)}</span> : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5">
            {c.kind !== "calc" ? (
              <label className="flex items-center gap-1.5 text-[11.5px]">
                <input type="checkbox" checked={c.req} onChange={() => set(c.id, (o) => ({ ...o, req: !o.req }))} className="h-3.5 w-3.5" />
                Required in every row
              </label>
            ) : (
              <span className="text-muted text-[11.5px]">Worked out within the row</span>
            )}
            <span className="flex-1" />
            <SmallButton label="Move column up" disabled={index === 0} onClick={() => move(index, -1)}>
              ↑
            </SmallButton>
            <SmallButton label="Move column down" disabled={index === columns.length - 1} onClick={() => move(index, 1)}>
              ↓
            </SmallButton>
            <SmallButton label="Remove column" danger disabled={columns.length === 1} onClick={() => onChange(columns.filter((o) => o.id !== c.id))}>
              ×
            </SmallButton>
          </div>
        </div>
      ))}
      <button
        type="button"
        disabled={columns.length >= 20}
        onClick={() => onChange([...columns, newColumn(`Column ${columns.length + 1}`)])}
        className="border-field text-ink-2 h-8 self-start rounded-lg border border-dashed bg-white px-2.5 text-xs font-semibold disabled:opacity-50"
      >
        + Add column
      </button>
      <span className="text-muted text-[11px] leading-[1.5]">
        Other fields can total a column: sum([Table], &quot;Column&quot;), avg(…), count([Table]).
      </span>
    </div>
  );
}

// --- Show only when ----------------------------------------------------------------------------

function ShowIfEditor({
  item,
  others,
  onChange,
}: {
  item: QaItem;
  others: QaItem[];
  onChange: (showIf: QaItem["showIf"]) => void;
}) {
  const showIf = item.showIf ?? null;
  const ref = others.find((o) => o.label.trim() === showIf?.ref.trim());
  const needsValue = showIf && showIf.op !== "filled" && showIf.op !== "empty";
  const choices = ref?.type === "yesno" ? ["Yes", "No"] : ref?.type === "check" ? ["Pass", "Fail", "N/A"] : ref?.type === "select" && ref.src === "custom" ? customOptions(ref.opts) : [];
  return (
    <div className="border-line-2 flex flex-col gap-1.5 border-t pt-3">
      <label className="flex items-center gap-2 text-[12.5px]">
        <input
          type="checkbox"
          checked={Boolean(showIf)}
          onChange={(e) => onChange(e.target.checked ? { ref: others[0]?.label.trim() ?? "", op: "eq", value: "" } : null)}
          className="h-4 w-4"
        />
        <span className="font-semibold">Show only when…</span>
      </label>
      {showIf ? (
        <div className="flex flex-col gap-1.5 pl-6">
          <select
            aria-label="Show when field"
            value={showIf.ref}
            onChange={(e) => onChange({ ...showIf, ref: e.target.value, value: "" })}
            className="border-field h-8 rounded-md border bg-white px-1.5 text-[12.5px]"
          >
            {!ref ? <option value={showIf.ref}>{showIf.ref || "— choose a field —"}</option> : null}
            {others.map((o) => (
              <option key={o.id} value={o.label.trim()}>
                {o.label.trim()}
              </option>
            ))}
          </select>
          <div className="flex gap-1.5">
            <select
              aria-label="Show when condition"
              value={showIf.op}
              onChange={(e) => onChange({ ...showIf, op: e.target.value as ShowOp })}
              className="border-field h-8 rounded-md border bg-white px-1.5 text-[12.5px]"
            >
              {SHOW_OPS.map((op) => (
                <option key={op} value={op}>
                  {SHOW_OP_LABELS[op]}
                </option>
              ))}
            </select>
            {needsValue ? (
              choices.length && (showIf.op === "eq" || showIf.op === "ne") ? (
                <select
                  aria-label="Show when value"
                  value={showIf.value}
                  onChange={(e) => onChange({ ...showIf, value: e.target.value })}
                  className="border-field h-8 min-w-0 flex-1 rounded-md border bg-white px-1.5 text-[12.5px]"
                >
                  <option value="">—</option>
                  {choices.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  aria-label="Show when value"
                  value={showIf.value}
                  placeholder={showIf.op === "gt" || showIf.op === "lt" ? "a number" : "value"}
                  onChange={(e) => onChange({ ...showIf, value: e.target.value })}
                  className="border-field h-8 min-w-0 flex-1 rounded-md border px-2 text-[12.5px]"
                />
              )
            ) : null}
          </div>
          <span className="text-muted text-[11px]">Hidden, it is not required, not checked and not saved.</span>
        </div>
      ) : null}
    </div>
  );
}

function TypeIcon({ d }: { d: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function SmallButton({
  label,
  disabled = false,
  danger = false,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={"h-7 w-7 flex-none rounded-md border bg-white p-0 text-xs disabled:opacity-35 " + (danger ? "border-[#FECDCA] text-[#D92D20]" : "border-line")}
    >
      {children}
    </button>
  );
}

function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={"relative h-5 w-9 flex-none rounded-full border-0 p-0 " + (on ? "bg-brand" : "bg-field")}
    >
      <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.2)]" style={{ left: on ? 18 : 2 }} />
    </button>
  );
}
