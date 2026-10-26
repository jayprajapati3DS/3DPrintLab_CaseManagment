"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { DocLayoutPart } from "@/components/qa/doc-layout";
import { useToast } from "@/components/ui/toast";
import { saveDocLayouts } from "@/lib/qa/actions";
import { BUILT_IN_LAYOUTS, cell, FORM_TOKENS, LAYOUT_COLUMNS, newLayoutId, type DocLayoutDef, type LayoutCell, type LayoutPart } from "@/lib/qa/layouts";

/**
 * Header & footer designs for controlled-document QA forms: each a grid of
 * cells — what each says (the form's own words, as {form.…} variables, or
 * fixed labels), how wide and tall it is, aligned how, bold, how large, on what
 * colour. Each QA form chooses its design; the words stay on the form.
 */

const INPUT = "border-field text-ink h-8 rounded-md border bg-white px-2 text-[12.5px]";
const LABEL = "text-muted text-[10.5px] font-semibold tracking-[0.4px] uppercase";

export function LayoutDesigner({
  initial,
  usage,
  sample,
  canEdit,
}: {
  initial: DocLayoutDef[];
  /** How many QA forms use each design, by id. */
  usage: Record<string, number>;
  /** Words to preview with: a form's own and the company details. */
  sample: Record<string, string>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast, node } = useToast();
  const [pending, start] = useTransition();
  const [layouts, setLayouts] = useState(initial);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initial));
  const [selected, setSelected] = useState(initial[0]?.id ?? "");
  const layout = layouts.find((l) => l.id === selected) ?? layouts[0];
  const dirty = JSON.stringify(layouts) !== baseline;
  const builtIn = (id: string) => BUILT_IN_LAYOUTS.some((b) => b.id === id);

  const update = (fn: (l: DocLayoutDef) => DocLayoutDef) => setLayouts((all) => all.map((l) => (l.id === layout?.id ? fn(l) : l)));
  const updatePart = (which: "header" | "footer", fn: (p: LayoutPart) => LayoutPart) => update((l) => ({ ...l, [which]: fn(l[which]) }));

  function add(copyOf?: DocLayoutDef) {
    const fresh: DocLayoutDef = copyOf
      ? { ...structuredClone(copyOf), id: newLayoutId(), name: `${copyOf.name} (copy)` }
      : {
          id: newLayoutId(),
          name: "New design",
          header: { border: true, cells: [cell("{company.name}", { kind: "logo", span: 3, align: "center" }), cell("{form.name}", { span: 9, align: "center", bold: true, size: "lg" })] },
          footer: { border: false, cells: [] },
        };
    setLayouts((all) => [...all, fresh]);
    setSelected(fresh.id);
  }
  function remove() {
    if (!layout) return;
    const used = usage[layout.id] ?? 0;
    const sure = builtIn(layout.id)
      ? `Put "${layout.name}" back as it first was?`
      : `Remove "${layout.name}"?${used ? ` ${used} QA form${used === 1 ? " uses" : "s use"} it — they will use "Reference standards" instead.` : ""}`;
    if (!window.confirm(sure)) return;
    if (builtIn(layout.id)) {
      const original = BUILT_IN_LAYOUTS.find((b) => b.id === layout.id)!;
      setLayouts((all) => all.map((l) => (l.id === layout.id ? structuredClone(original) : l)));
      return;
    }
    const rest = layouts.filter((l) => l.id !== layout.id);
    setLayouts(rest);
    setSelected(rest[0]?.id ?? "");
  }
  function save() {
    start(async () => {
      try {
        // A built-in design left as it first was is not stored: it follows any improvement to it.
        const stored = layouts.filter((l) => !builtIn(l.id) || JSON.stringify(l) !== JSON.stringify(BUILT_IN_LAYOUTS.find((b) => b.id === l.id)));
        const result = await saveDocLayouts(stored);
        if (!result.ok) return toast(result.message ?? "Could not save.", true);
        setBaseline(JSON.stringify(layouts));
        toast(result.message ?? "Saved");
        router.refresh();
      } catch {
        toast("The server could not be reached. Try again.", true);
      }
    });
  }

  return (
    <section className="border-line flex flex-col gap-4 rounded-[14px] border bg-white px-4 py-[18px] sm:px-[22px]" aria-label="Header and footer designs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex max-w-[760px] flex-col gap-0.5">
          <h2 className="m-0 text-[15px] font-bold">Header & footer designs</h2>
          <p className="text-muted m-0 text-[12.5px] leading-[1.5]">
            The header above and the footer below a controlled-document QA form. Lay out the cells here; the words come from each QA form — its name, code, revision,
            effective date… — and from Company details. Each QA form chooses its design on its Details tab.
          </p>
        </div>
        {canEdit ? (
          <div className="flex items-center gap-2">
            <span className={"text-[12.5px] " + (dirty ? "text-warn font-semibold" : "text-muted")}>{dirty ? "Unsaved changes" : "Saved"}</span>
            <button type="button" onClick={save} disabled={!dirty || pending} className="bg-brand h-9 rounded-[9px] px-4 text-[13px] font-semibold text-white disabled:opacity-50">
              {pending ? "Saving…" : "Save designs"}
            </button>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* The designs */}
        <div className="flex flex-col gap-1.5">
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="Designs">
            {layouts.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  aria-current={l.id === layout?.id ? "true" : undefined}
                  onClick={() => setSelected(l.id)}
                  className={"flex w-full flex-col rounded-[10px] border px-3 py-2 text-left " + (l.id === layout?.id ? "border-brand bg-brand-wash" : "border-line hover:border-field bg-white")}
                >
                  <span className="text-ink text-[13px] font-semibold">{l.name}</span>
                  <span className="text-muted text-[11.5px]">
                    {usage[l.id] ?? 0} form{(usage[l.id] ?? 0) === 1 ? "" : "s"}
                    {builtIn(l.id) ? " · built in" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {canEdit ? (
            <div className="flex gap-1.5">
              <button type="button" onClick={() => add()} className="border-field text-ink-2 h-8 flex-1 rounded-[9px] border border-dashed bg-white text-[12.5px] font-semibold">
                + New design
              </button>
              {layout ? (
                <button type="button" onClick={() => add(layout)} className="border-field text-ink-2 h-8 rounded-[9px] border bg-white px-2.5 text-[12.5px] font-semibold">
                  Duplicate
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* The design chosen */}
        {layout ? (
          <fieldset disabled={!canEdit} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex min-w-[220px] flex-1 flex-col gap-1">
                <span className={LABEL}>Design name</span>
                <input aria-label="Design name" value={layout.name} onChange={(e) => update((l) => ({ ...l, name: e.target.value }))} className={`${INPUT} h-9 font-semibold`} />
              </label>
              <button type="button" onClick={remove} className="text-bad h-9 border-0 bg-transparent px-2 text-[12.5px] font-semibold">
                {builtIn(layout.id) ? "Reset to original" : "Remove design"}
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className={LABEL}>Preview — with a form&apos;s own words</span>
              <div className="border-line rounded-[10px] border bg-[#FCFCFD] p-3">
                <DocLayoutPart part={layout.header} values={sample} testId="design-header" />
                <div className="text-faint my-3 border-y border-dashed border-[#E4E7EC] py-3 text-center text-[11.5px]">… the form&apos;s sections …</div>
                <DocLayoutPart part={layout.footer} values={sample} testId="design-footer" />
              </div>
            </div>

            {(["header", "footer"] as const).map((which) => (
              <PartEditor key={which} title={which === "header" ? "Header" : "Footer"} part={layout[which]} onChange={(fn) => updatePart(which, fn)} />
            ))}
          </fieldset>
        ) : null}
      </div>
      {node}
    </section>
  );
}

function PartEditor({ title, part, onChange }: { title: string; part: LayoutPart; onChange: (fn: (p: LayoutPart) => LayoutPart) => void }) {
  const setCell = (i: number, patch: Partial<LayoutCell>) => onChange((p) => ({ ...p, cells: p.cells.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const move = (i: number, to: number) =>
    onChange((p) => {
      if (to < 0 || to >= p.cells.length) return p;
      const cells = [...p.cells];
      const [c] = cells.splice(i, 1);
      cells.splice(to, 0, c);
      return { ...p, cells };
    });
  // How the cells fill the rows of twelve columns, to say where each row ends.
  const endsRow = part.cells.map((_, i) => part.cells.slice(0, i + 1).reduce((n, c) => n + c.span, 0) % LAYOUT_COLUMNS === 0);
  return (
    <div className="border-line flex flex-col gap-2 rounded-[12px] border p-3" aria-label={`${title} cells`} role="group">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-ink text-[13px] font-bold">{title}</span>
        <label className="text-ink-2 flex items-center gap-2 text-[12.5px]">
          <input type="checkbox" checked={part.border} onChange={(e) => onChange((p) => ({ ...p, border: e.target.checked }))} className="h-4 w-4" />
          Lines around the cells
        </label>
      </div>
      {part.cells.length === 0 ? <span className="text-muted text-[12.5px]">No {title.toLowerCase()} — add a cell to have one.</span> : null}
      {part.cells.map((c, i) => {
        return (
          <div key={i} className={"flex flex-wrap items-end gap-1.5 rounded-lg bg-[#F9FAFB] p-2 " + (endsRow[i] ? "mb-1.5" : "")}>
            <span className="text-faint w-5 self-center text-right font-mono text-[11px]">{i + 1}</span>
            <label className="flex min-w-[220px] flex-[2] flex-col gap-0.5">
              <span className={LABEL}>{c.kind === "logo" ? "Logo (company name)" : "Text"}</span>
              <span className="flex gap-1">
                <input aria-label={`${title} cell ${i + 1} text`} value={c.text} onChange={(e) => setCell(i, { text: e.target.value })} className={`${INPUT} min-w-0 flex-1`} />
                <select
                  aria-label={`${title} cell ${i + 1} insert`}
                  value=""
                  onChange={(e) => e.target.value && setCell(i, { text: `${c.text}${c.text && !c.text.endsWith(" ") ? " " : ""}${e.target.value}` })}
                  className={`${INPUT} w-[88px]`}
                >
                  <option value="">+ Insert</option>
                  {FORM_TOKENS.map((t) => (
                    <option key={t.token} value={t.token}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </span>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className={LABEL}>Kind</span>
              <select aria-label={`${title} cell ${i + 1} kind`} value={c.kind} onChange={(e) => setCell(i, { kind: e.target.value as LayoutCell["kind"] })} className={INPUT}>
                <option value="text">Text</option>
                <option value="logo">Logo</option>
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className={LABEL}>Width</span>
              <select aria-label={`${title} cell ${i + 1} width`} value={c.span} onChange={(e) => setCell(i, { span: Number(e.target.value) })} className={INPUT}>
                {Array.from({ length: LAYOUT_COLUMNS }, (_, n) => n + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}/{LAYOUT_COLUMNS}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className={LABEL}>Height</span>
              <select aria-label={`${title} cell ${i + 1} height`} value={c.rows} onChange={(e) => setCell(i, { rows: Number(e.target.value) })} className={INPUT}>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>
                    {n} row{n === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className={LABEL}>Align</span>
              <select aria-label={`${title} cell ${i + 1} align`} value={c.align} onChange={(e) => setCell(i, { align: e.target.value as LayoutCell["align"] })} className={INPUT}>
                <option value="left">Left</option>
                <option value="center">Centre</option>
                <option value="right">Right</option>
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className={LABEL}>Size</span>
              <select aria-label={`${title} cell ${i + 1} size`} value={c.size} onChange={(e) => setCell(i, { size: e.target.value as LayoutCell["size"] })} className={INPUT}>
                <option value="sm">Small</option>
                <option value="md">Normal</option>
                <option value="lg">Large</option>
                <option value="xl">Title</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 self-center pt-3 text-[12.5px]">
              <input type="checkbox" checked={c.bold} aria-label={`${title} cell ${i + 1} bold`} onChange={(e) => setCell(i, { bold: e.target.checked })} className="h-4 w-4" />
              Bold
            </label>
            <label className="flex flex-col gap-0.5">
              <span className={LABEL}>Fill</span>
              <span className="flex items-center gap-1">
                <input
                  type="color"
                  aria-label={`${title} cell ${i + 1} fill`}
                  value={c.fill || "#ffffff"}
                  onChange={(e) => setCell(i, { fill: e.target.value === "#ffffff" ? "" : e.target.value })}
                  className="border-field h-8 w-9 cursor-pointer rounded-md border bg-white p-0.5"
                />
                {c.fill ? (
                  <button type="button" onClick={() => setCell(i, { fill: "" })} className="text-muted border-0 bg-transparent p-0 text-[11.5px]">
                    none
                  </button>
                ) : null}
              </span>
            </label>
            <span className="ml-auto flex gap-1 self-center pt-3">
              <button type="button" aria-label={`Move ${title} cell ${i + 1} earlier`} onClick={() => move(i, i - 1)} className="border-field h-7 w-7 rounded-md border bg-white text-[11px]">
                ▲
              </button>
              <button type="button" aria-label={`Move ${title} cell ${i + 1} later`} onClick={() => move(i, i + 1)} className="border-field h-7 w-7 rounded-md border bg-white text-[11px]">
                ▼
              </button>
              <button
                type="button"
                aria-label={`Remove ${title} cell ${i + 1}`}
                onClick={() => onChange((p) => ({ ...p, cells: p.cells.filter((_, j) => j !== i) }))}
                className="text-bad border-field h-7 w-7 rounded-md border bg-white text-[13px]"
              >
                ×
              </button>
            </span>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => onChange((p) => ({ ...p, cells: [...p.cells, cell("", { span: 6 })] }))}
        className="text-brand-ink self-start border-0 bg-transparent p-0 text-[12.5px] font-semibold"
      >
        + Add cell
      </button>
      <span className="text-muted text-[11.5px]">Cells fill rows of {LAYOUT_COLUMNS} columns, left to right; a taller cell leaves room beside it for the cells after it.</span>
    </div>
  );
}
