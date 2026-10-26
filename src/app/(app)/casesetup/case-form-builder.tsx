"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { OptionsInput, SquareButton, Switch, TinyButton } from "@/app/(app)/partsetup/setup-builder";
import { useToast } from "@/components/ui/toast";
import { saveCaseForm } from "@/lib/cases/actions";
import {
  askedOnCreate,
  CASE_CUSTOM_TYPES,
  caseFieldVar,
  caseSetupProblem,
  caseVarFromLabel,
  defaultCaseSections,
  NEW_CASE_FORM,
  sharedCaseFields,
  type CaseField,
  type CaseFieldType,
  type CaseFormDef,
  type CaseSection,
} from "@/lib/cases/case-form";
import { FILE_TYPE_NAMES } from "@/lib/parts/request-form";
import { nextId } from "@/lib/resources/ids";

/**
 * One case form of Case Form Setup, built on the left and previewed on the
 * right — as a part request form is in Part Request Setup. Nothing changes for
 * anyone until "Save form". The list of forms, and the case source and case ID
 * pattern they share, are on the page above this one.
 */

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

function move<T>(list: T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

const SELECT_LIKE: CaseFieldType[] = ["select", "product", "subscope", "priority", "person", "hospital", "department"];

/** Fields that take the whole row, whatever the section's column count. */
const isWide = (field: CaseField) => field.type === "textarea" || field.type === "file" || (field.type === "product" && field.display === "cards");

const GRID: Record<1 | 2 | 3, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
};

const TYPE_TAG: Record<CaseFieldType, string> = {
  text: "text",
  textarea: "textarea",
  number: "number",
  date: "date",
  select: "select",
  checkbox: "checkbox",
  file: "file",
  caseid: "case id",
  product: "product",
  subscope: "sub-scope",
  priority: "priority",
  person: "person",
  people: "people",
  hospital: "hospital",
  department: "department",
};

export function CaseFormBuilder({
  initial,
  others,
  idPattern,
  idStart,
  products,
  used,
  canEdit,
  savedNote,
  roles,
}: {
  /** The form being edited — id "new" while it is being added. */
  initial: CaseFormDef;
  /** The space's other forms: for reusing their fields, and checking variables against them. */
  others: CaseFormDef[];
  /** The case ID pattern, for the preview. */
  idPattern: string;
  /** Where the running part starts, for the preview. */
  idStart?: number;
  products: Array<{ id: string; name: string; code: string }>;
  /** Case numbers given, so the preview shows the next one. */
  used: string[];
  canEdit: boolean;
  savedNote: string | null;
  /** The roles people hold here — what a surgeon field may list. */
  roles: string[];
}) {
  const router = useRouter();
  const { toast, node: toastNode } = useToast();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<CaseFormDef>(initial);
  const adding = form.id === NEW_CASE_FORM;
  const [baseline, setBaseline] = useState(() => (adding ? "" : JSON.stringify(initial)));
  const [panel, setPanel] = useState<string | null>(null);
  const [draft, setDraft] = useState({ label: "", type: "text" as CaseFieldType, options: "" });

  const dirty = JSON.stringify(form) !== baseline;
  // Checked with the other forms, so a shared variable keeps one type.
  const problem = useMemo(() => {
    if (!form.name.trim()) return "Give the form a name.";
    return caseSetupProblem({ source: "local", idPattern, forms: [...others, { ...form, id: adding ? "new-form" : form.id }] });
  }, [form, others, idPattern, adding]);
  const sections = form.sections;
  const allForms = [...others, form];

  // The preview's clock is fixed when the page opens, so typing does not make the year flicker.
  const [now] = useState(() => new Date());
  const previewProduct = products.find((p) => form.productIds.includes(p.id)) ?? products[0];
  const previewId = nextId(idPattern, { type: previewProduct ? previewProduct.code || previewProduct.name : "PSI", now, start: idStart }, used);

  const setSections = (fn: (sections: CaseSection[]) => CaseSection[]) => setForm((f) => ({ ...f, sections: fn(f.sections) }));
  const setSection = (id: string, fn: (section: CaseSection) => CaseSection) => setSections((list) => list.map((s) => (s.id === id ? fn(s) : s)));
  const setField = (sectionId: string, fieldId: string, fn: (field: CaseField) => CaseField) =>
    setSection(sectionId, (s) => ({ ...s, fields: s.fields.map((f) => (f.id === fieldId ? fn(f) : f)) }));

  const allFields = sections.flatMap((s) => s.fields);
  const varCounts = new Map<string, number>();
  for (const f of allFields) varCounts.set(caseFieldVar(f), (varCounts.get(caseFieldVar(f)) ?? 0) + 1);

  function addField(sectionId: string) {
    const label = draft.label.trim();
    if (!label) {
      toast("Enter a field label", true);
      return;
    }
    const taken = allFields.map((f) => caseFieldVar(f).slice("case.".length));
    const field: CaseField = {
      id: newId("c"),
      key: "",
      var: caseVarFromLabel(label, taken),
      label,
      type: draft.type,
      show: true,
      req: false,
      locked: false,
      def: "",
      options: draft.type === "select" ? splitOptions(draft.options) : [],
      fileTypes: draft.type === "file" ? ["PDF"] : [],
      allowLinks: draft.type === "file",
    };
    setSection(sectionId, (s) => ({ ...s, fields: [...s.fields, field] }));
    setPanel(null);
    setDraft({ label: "", type: "text", options: "" });
  }

  /** Add a field another form already has — same label, type and variable, so QA forms read both as one. */
  function reuseField(sectionId: string, source: CaseField) {
    if (allFields.some((f) => caseFieldVar(f) === caseFieldVar(source))) {
      toast("This form already has that field", true);
      return;
    }
    setSection(sectionId, (s) => ({ ...s, fields: [...s.fields, { ...source, id: newId("c"), options: [...source.options], fileTypes: [...source.fileTypes] }] }));
    setPanel(null);
  }

  function save() {
    if (problem) {
      toast(problem, true);
      return;
    }
    const payload = JSON.stringify(form);
    startTransition(async () => {
      try {
        const result = await saveCaseForm(payload);
        if (!result.ok) {
          toast(result.message ?? "The form could not be saved.", true);
          return;
        }
        toast(result.message ?? "Form saved");
        if (adding && result.formId) {
          // Now it exists: carry on editing it at its own address.
          const saved = { ...form, id: result.formId };
          setForm(saved);
          setBaseline(JSON.stringify(saved));
          router.replace(`/casesetup?form=${result.formId}`, { scroll: false });
          return;
        }
        setBaseline(payload);
        router.refresh();
      } catch {
        toast("The server could not be reached. Try again.", true);
      }
    });
  }

  function reset() {
    setSections(() => defaultCaseSections());
    setPanel(null);
    toast(`"${form.name || "This form"}" set back to the default fields — Save form to apply`);
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      toast(`${token} copied`);
    } catch {
      toast("Copying is blocked by this browser — select the variable and copy it by hand.", true);
    }
  }

  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
      <fieldset disabled={!canEdit || pending} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
        {/* Header */}
        <div className="border-line flex flex-col gap-3 rounded-[14px] border bg-white px-5 py-[18px]">
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
            <Link href="/casesetup" className="text-ink-2 text-[13px] font-semibold no-underline">
              ← All case forms
            </Link>
            {form.isDefault ? <span className="bg-chip text-muted rounded px-1.5 py-px text-[10px] font-bold tracking-[0.4px]">DEFAULT FORM</span> : null}
            <span className="flex-1" />
            {canEdit ? (
              <div className="flex gap-2.5">
                <button type="button" onClick={reset} className="border-field text-ink-2 h-9 rounded-lg border bg-white px-3 text-[12.5px] font-semibold disabled:opacity-50">
                  Reset fields
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={!dirty || pending}
                  className="bg-brand h-9 rounded-lg border-0 px-3.5 text-[12.5px] font-semibold text-white disabled:opacity-50"
                >
                  {pending ? "Saving…" : "Save form"}
                </button>
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <label className="flex flex-col gap-1 text-xs font-bold">
              Form name
              <input
                aria-label="Form name"
                value={form.name}
                maxLength={80}
                placeholder="e.g. 3D PDF case"
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="border-field h-9 rounded-lg border px-2.5 text-[14px] font-bold"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold">
              Shown when choosing (optional)
              <input
                aria-label="Form description"
                value={form.description}
                maxLength={200}
                placeholder="e.g. Segmentation and a 3D PDF — no manufacturing"
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="border-field h-9 rounded-lg border px-2.5 text-[13px] font-normal"
              />
            </label>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-bold">Opens cases for</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Products this form opens cases for">
              <button
                type="button"
                aria-pressed={form.productIds.length === 0}
                onClick={() => setForm((f) => ({ ...f, productIds: [] }))}
                className={"h-[26px] rounded-full border px-2.5 text-[11.5px] font-semibold " + (form.productIds.length === 0 ? "border-brand-edge bg-brand-wash text-brand-ink" : "border-field text-muted bg-white")}
              >
                Any product
              </button>
              {products.map((p) => {
                const on = form.productIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setForm((f) => ({ ...f, productIds: on ? f.productIds.filter((x) => x !== p.id) : [...f.productIds, p.id] }))}
                    className={"h-[26px] rounded-full border px-2.5 text-[11.5px] font-semibold " + (on ? "border-brand-edge bg-brand-wash text-brand-ink" : "border-field text-muted bg-white")}
                  >
                    {p.name}
                    {p.code ? <span className="font-mono font-normal"> {p.code}</span> : null}
                  </button>
                );
              })}
            </div>
            {products.length === 0 ? <span className="text-faint text-[11.5px]">Add products on the Products page to limit the form to some of them.</span> : null}
          </div>
          <div className="text-faint text-[11.5px]">
            {!canEdit
              ? "Only this space's admins can change case forms."
              : problem && dirty
                ? <span className="text-bad font-semibold">{problem}</span>
                : dirty
                  ? "Unsaved changes — nothing changes for anyone until you save."
                  : (savedNote ?? "Saved.")}{" "}
            The <span className="xl:hidden">panel below</span>
            <span className="hidden xl:inline">right panel</span> previews it live.
          </div>
        </div>

        {/* Sections of the form being edited */}
        {sections.map((section, si) => {
          const removable = !section.fields.some((f) => f.locked);
          return (
            <div key={section.id} data-testid={`case-section-${si + 1}`} className="border-line flex flex-col gap-2.5 rounded-[14px] border bg-white px-[18px] py-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <input
                  aria-label="Section title"
                  value={section.title}
                  onChange={(e) => setSection(section.id, (s) => ({ ...s, title: e.target.value }))}
                  className="text-ink hover:border-line focus:border-field h-[34px] min-w-[160px] flex-1 rounded-[7px] border border-transparent bg-white px-2 text-sm font-bold"
                />
                <span className="text-faint text-xs">
                  {section.fields.length} {section.fields.length === 1 ? "field" : "fields"}
                </span>
                <div className="bg-chip flex gap-0.5 rounded-lg p-[3px]">
                  {([1, 2, 3] as const).map((cols) => (
                    <button
                      key={cols}
                      type="button"
                      aria-pressed={section.cols === cols}
                      onClick={() => setSection(section.id, (s) => ({ ...s, cols }))}
                      className={"h-7 rounded-md border-0 px-2.5 text-xs font-semibold " + (section.cols === cols ? "text-ink bg-white shadow-[0_1px_2px_rgba(16,24,40,.08)]" : "text-muted bg-transparent")}
                    >
                      {cols} col
                    </button>
                  ))}
                </div>
                <SquareButton label="Move section up" disabled={si === 0} onClick={() => setSections((l) => move(l, si, -1))}>
                  ↑
                </SquareButton>
                <SquareButton label="Move section down" disabled={si === sections.length - 1} onClick={() => setSections((l) => move(l, si, 1))}>
                  ↓
                </SquareButton>
                {removable ? (
                  <button
                    type="button"
                    aria-label="Delete section"
                    disabled={sections.length === 1}
                    onClick={() => setSections((l) => l.filter((s) => s.id !== section.id))}
                    className="h-[30px] w-[30px] rounded-[7px] border border-[#FECDCA] bg-white text-[#D92D20] disabled:opacity-35"
                  >
                    ×
                  </button>
                ) : null}
              </div>

              <div className="text-faint hidden grid-cols-[minmax(0,1fr)_56px_56px_64px_72px] gap-2 px-3 text-[10.5px] font-semibold tracking-[0.6px] sm:grid">
                <div>FIELD</div>
                <div className="text-center">SHOW</div>
                <div className="text-center">REQ.</div>
                <div className="text-center" title="Asked when the case is opened — off: filled in later, on the case's edit page">CREATE</div>
                <div />
              </div>

              {section.fields.map((field, fi) => {
                const token = caseFieldVar(field);
                const custom = !field.key;
                const clash = (varCounts.get(token) ?? 0) > 1;
                const fixedReq = field.locked || field.type === "caseid";
                return (
                  <div key={field.id} data-testid={`case-field-${field.label}`} className="border-line-2 flex flex-col gap-2 rounded-[10px] border px-3 py-2">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_56px_56px_64px_72px]">
                      <div className="col-span-4 flex min-w-0 items-center gap-2 sm:col-span-1">
                        <input
                          aria-label="Field name"
                          title="Rename field"
                          value={field.label}
                          onChange={(e) => setField(section.id, field.id, (f) => ({ ...f, label: e.target.value }))}
                          className="border-line h-[30px] min-w-0 flex-1 rounded-md border px-2 text-[13px] font-semibold"
                        />
                        <span className="text-faint font-mono text-[11px]">{TYPE_TAG[field.type]}</span>
                        <span className="bg-chip text-muted rounded px-1.5 py-px text-[9.5px] font-bold tracking-[0.4px]">
                          {field.locked ? "LOCKED" : custom ? "CUSTOM" : "BUILT-IN"}
                        </span>
                      </div>
                      <div className="flex items-center justify-start gap-1.5 sm:justify-center">
                        <span className="text-faint text-[10.5px] font-semibold sm:hidden">SHOW</span>
                        <Switch
                          label={`Show ${field.label}`}
                          on={field.show}
                          locked={field.locked}
                          onToggle={() => setField(section.id, field.id, (f) => ({ ...f, show: !f.show, req: f.show ? false : f.req }))}
                        />
                      </div>
                      <div className="flex items-center justify-start gap-1.5 sm:justify-center">
                        <span className="text-faint text-[10.5px] font-semibold sm:hidden">REQ.</span>
                        <Switch
                          label={`Require ${field.label}`}
                          on={field.req}
                          locked={fixedReq}
                          onToggle={() => setField(section.id, field.id, (f) => ({ ...f, req: !f.req, show: !f.req ? true : f.show }))}
                        />
                      </div>
                      <div className="flex items-center justify-start gap-1.5 sm:justify-center">
                        <span className="text-faint text-[10.5px] font-semibold sm:hidden">CREATE</span>
                        <Switch
                          label={`Ask ${field.label} when creating`}
                          on={field.locked || field.onCreate !== false}
                          locked={field.locked || !field.show}
                          onToggle={() => setField(section.id, field.id, (f) => ({ ...f, onCreate: f.onCreate === false }))}
                        />
                      </div>
                      <div className="flex justify-end gap-1">
                        <TinyButton label="Move field up" disabled={fi === 0} onClick={() => setSection(section.id, (s) => ({ ...s, fields: move(s.fields, fi, -1) }))}>
                          ↑
                        </TinyButton>
                        <TinyButton
                          label="Move field down"
                          disabled={fi === section.fields.length - 1}
                          onClick={() => setSection(section.id, (s) => ({ ...s, fields: move(s.fields, fi, 1) }))}
                        >
                          ↓
                        </TinyButton>
                        {custom ? (
                          <button
                            type="button"
                            aria-label={`Remove field ${field.label}`}
                            onClick={() => setSection(section.id, (s) => ({ ...s, fields: s.fields.filter((f) => f.id !== field.id) }))}
                            className="h-[26px] w-[22px] rounded-md border border-[#FECDCA] bg-white p-0 text-xs text-[#D92D20]"
                          >
                            ×
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {/* Variable */}
                    <div className="border-line-2 flex flex-wrap items-center gap-2 border-t border-dashed pt-1.5">
                      <span className="text-muted text-[11px] font-bold tracking-[0.4px]">VARIABLE</span>
                      {custom ? (
                        <span className="border-field inline-flex h-[26px] items-center overflow-hidden rounded-md border font-mono text-xs">
                          <span className="text-faint pr-1 pl-2">{"{case."}</span>
                          <input
                            aria-label="Variable name"
                            value={field.var}
                            onChange={(e) => setField(section.id, field.id, (f) => ({ ...f, var: e.target.value.replace(/[^A-Za-z0-9_]/g, "").slice(0, 60) }))}
                            className="text-brand-ink h-6 w-[140px] border-0 p-0 font-mono text-xs outline-none"
                          />
                          <span className="text-faint pr-2">{"}"}</span>
                        </span>
                      ) : (
                        <span title="System variable — fixed" className="border-line-2 bg-subtle text-brand-ink inline-flex h-[26px] items-center rounded-md border px-2 font-mono text-xs">
                          {`{${token}}`}
                        </span>
                      )}
                      <button
                        type="button"
                        aria-label={`Copy variable ${token}`}
                        onClick={() => copy(`{${token}}`)}
                        className="border-line text-ink-2 h-[26px] rounded-md border bg-white px-2.5 text-[11.5px] font-semibold"
                      >
                        Copy
                      </button>
                      {clash ? <span className="text-[11.5px] font-semibold text-[#D92D20]">Another field already uses this variable</span> : null}
                    </div>

                    {custom && (field.type === "text" || field.type === "textarea") ? (
                      <label className="text-muted flex items-center gap-2 text-[11.5px] font-semibold">
                        Default value
                        <input
                          value={field.def}
                          onChange={(e) => setField(section.id, field.id, (f) => ({ ...f, def: e.target.value }))}
                          placeholder="Pre-filled in every new case (optional)"
                          className="border-line text-ink h-[30px] min-w-0 flex-1 rounded-md border px-2 text-[12.5px] font-normal"
                        />
                      </label>
                    ) : null}

                    {field.type === "select" ? (
                      <label className="text-muted flex items-center gap-2 text-[11.5px] font-semibold">
                        Options
                        <OptionsInput options={field.options} onChange={(options) => setField(section.id, field.id, (f) => ({ ...f, options }))} />
                      </label>
                    ) : null}

                    {field.type === "person" || field.type === "people" ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-muted text-[11.5px] font-semibold">List people with role</span>
                        <div role="group" aria-label={`${field.label} roles`} className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            aria-pressed={!field.roles?.length}
                            onClick={() => setField(section.id, field.id, (f) => ({ ...f, roles: [] }))}
                            className={"h-[26px] rounded-full border px-2.5 text-[11.5px] font-semibold " + (!field.roles?.length ? "border-brand-edge bg-brand-wash text-brand-ink" : "border-field text-muted bg-white")}
                          >
                            Anyone
                          </button>
                          {roles.map((r) => {
                            const on = (field.roles ?? []).includes(r);
                            return (
                              <button
                                key={r}
                                type="button"
                                aria-pressed={on}
                                onClick={() => setField(section.id, field.id, (f) => ({ ...f, roles: on ? (f.roles ?? []).filter((x) => x !== r) : [...(f.roles ?? []), r] }))}
                                className={"h-[26px] rounded-full border px-2.5 text-[11.5px] font-semibold " + (on ? "border-brand-edge bg-brand-wash text-brand-ink" : "border-field text-muted bg-white")}
                              >
                                {r}
                              </button>
                            );
                          })}
                        </div>
                        <span className="text-faint text-[11.5px]">{field.type === "people" ? "Several can be chosen." : "One is chosen."} People are added on Users & Roles.</span>
                      </div>
                    ) : null}

                    {field.type === "department" ? (
                      <span className="text-faint text-[11.5px]">The chosen hospital&apos;s departments (set on each hospital) — the surgeon&apos;s own when they are linked to some.</span>
                    ) : null}

                    {field.type === "hospital" ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-muted text-[11.5px] font-semibold">Offer</span>
                        <div role="radiogroup" aria-label="Hospitals offered" className="bg-chip flex gap-0.5 rounded-lg p-[3px]">
                          {(
                            [
                              ["all", "All hospitals"],
                              ["surgeon", "The surgeon's hospitals only"],
                            ] as const
                          ).map(([value, label]) => {
                            const on = (field.hospitalSource ?? "all") === value;
                            return (
                              <button
                                key={value}
                                type="button"
                                role="radio"
                                aria-checked={on}
                                onClick={() => setField(section.id, field.id, (f) => ({ ...f, hospitalSource: value }))}
                                className={"h-7 rounded-md border-0 px-2.5 text-xs font-semibold " + (on ? "text-ink bg-white shadow-[0_1px_2px_rgba(16,24,40,.08)]" : "text-muted bg-transparent")}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                        <span className="text-faint text-[11.5px]">From the Hospitals list; a surgeon&apos;s hospitals are set on Users &amp; Roles.</span>
                      </div>
                    ) : null}

                    {field.type === "subscope" ? (
                      <span className="text-faint text-[11.5px]">Asked only when the product chosen has sub-scopes — then it is required and lists that product&apos;s sub-scopes.</span>
                    ) : null}

                    {field.type === "product" || field.type === "subscope" ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-muted text-[11.5px] font-semibold">Show as</span>
                        <div role="radiogroup" aria-label={field.type === "product" ? "Show products as" : "Show sub-scopes as"} className="bg-chip flex gap-0.5 rounded-lg p-[3px]">
                          {(
                            [
                              ["list", "List"],
                              ["cards", "Cards"],
                            ] as const
                          ).map(([value, label]) => {
                            const on = (field.display ?? "list") === value;
                            return (
                              <button
                                key={value}
                                type="button"
                                role="radio"
                                aria-checked={on}
                                onClick={() => setField(section.id, field.id, (f) => ({ ...f, display: value }))}
                                className={"h-7 rounded-md border-0 px-2.5 text-xs font-semibold " + (on ? "text-ink bg-white shadow-[0_1px_2px_rgba(16,24,40,.08)]" : "text-muted bg-transparent")}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                        <span className="text-faint text-[11.5px]">
                          {(field.display ?? "list") === "cards"
                            ? `Each ${field.type === "product" ? "product" : "sub-scope"} a card to click, with its image, code and description.`
                            : `A dropdown of the ${field.type === "product" ? "products" : "sub-scopes"}.`}
                        </span>
                      </div>
                    ) : null}

                    {field.type === "file" ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-muted text-[11.5px] font-semibold">Allowed file types</span>
                        {FILE_TYPE_NAMES.map((type) => {
                          const on = field.fileTypes.includes(type);
                          return (
                            <button
                              key={type}
                              type="button"
                              aria-pressed={on}
                              onClick={() =>
                                setField(section.id, field.id, (f) => ({ ...f, fileTypes: on ? f.fileTypes.filter((t) => t !== type) : [...f.fileTypes, type] }))
                              }
                              className={
                                "h-[26px] rounded-full border px-[9px] text-[11.5px] font-semibold " +
                                (on ? "border-[#5FE9D0] bg-[#F0FDF9] text-[#107569]" : "border-field text-muted bg-white")
                              }
                            >
                              {type}
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          aria-pressed={field.allowLinks}
                          onClick={() => setField(section.id, field.id, (f) => ({ ...f, allowLinks: !f.allowLinks }))}
                          className={
                            "h-[26px] rounded-full border px-2.5 text-[11.5px] font-bold sm:ml-2 " +
                            (field.allowLinks ? "border-[#D1E0FF] bg-[#F5F8FF] text-[#155EEF]" : "border-field text-muted bg-white")
                          }
                        >
                          🔗 Allow download links
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}

              {panel === section.id ? (
                <div className="border-brand-edge bg-brand-wash flex flex-col gap-2 rounded-[10px] border p-3">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                    <input
                      aria-label="New field label"
                      autoFocus
                      value={draft.label}
                      onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addField(section.id);
                        }
                      }}
                      placeholder="Field label, e.g. Laterality"
                      className="border-field h-9 rounded-lg border bg-white px-2.5 text-[13px]"
                    />
                    <select
                      aria-label="New field type"
                      value={draft.type}
                      onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value as CaseFieldType }))}
                      className="border-field h-9 rounded-lg border bg-white px-2 text-[13px]"
                    >
                      {CASE_CUSTOM_TYPES.map((t) => (
                        <option key={t.type} value={t.type}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {draft.type === "select" ? (
                    <input
                      aria-label="New field options"
                      value={draft.options}
                      onChange={(e) => setDraft((d) => ({ ...d, options: e.target.value }))}
                      placeholder="Options, comma separated"
                      className="border-field h-9 rounded-lg border bg-white px-2.5 text-[13px]"
                    />
                  ) : null}
                  {others.length > 0 ? (
                    <label className="text-ink-2 flex flex-col gap-1 text-[12px] font-semibold">
                      Or reuse a field from another form — same variable, so QA forms read both
                      <select
                        aria-label="Reuse a field from another form"
                        value=""
                        onChange={(e) => {
                          const pick = sharedCaseFields(allForms, form.id).find((x) => x.field.id === e.target.value);
                          if (pick) reuseField(section.id, pick.field);
                        }}
                        className="border-field h-9 rounded-lg border bg-white px-2 text-[13px] font-normal"
                      >
                        <option value="">— choose a field —</option>
                        {sharedCaseFields(allForms, form.id).map(({ field: f, forms: on }) => (
                          <option key={f.id} value={f.id}>
                            {f.label} · {TYPE_TAG[f.type]} · {`{${caseFieldVar(f)}}`} · on {on.join(", ")}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setPanel(null)} className="border-field h-[34px] rounded-lg border bg-white px-3 text-[12.5px] font-semibold">
                      Cancel
                    </button>
                    <button type="button" onClick={() => addField(section.id)} className="bg-brand h-[34px] rounded-lg border-0 px-3 text-[12.5px] font-semibold text-white">
                      Add field
                    </button>
                  </div>
                </div>
              ) : canEdit ? (
                <button
                  type="button"
                  onClick={() => {
                    setPanel(section.id);
                    setDraft({ label: "", type: "text", options: "" });
                  }}
                  className="border-field text-ink-2 h-8 self-start rounded-lg border border-dashed bg-white px-3 text-[12.5px] font-semibold"
                >
                  + Add field
                </button>
              ) : null}
            </div>
          );
        })}

        {canEdit ? (
          <button
            type="button"
            disabled={sections.length >= 30}
            onClick={() => setSections((l) => [...l, { id: newId("cs"), title: "New section", cols: 2, fields: [] }])}
            className="border-field text-ink-2 h-11 rounded-xl border border-dashed bg-white text-[13px] font-semibold"
          >
            + Add section
          </button>
        ) : null}
      </fieldset>

      {/* Live preview — its own scroll beside the builder, so it stays in view however long either side is. */}
      <aside
        aria-label="Live preview"
        data-testid="live-preview"
        className="flex min-w-0 flex-col gap-2.5 xl:sticky xl:top-0 xl:max-h-[calc(100dvh-140px)] xl:overflow-y-auto xl:overscroll-contain xl:pr-1 [&>*]:shrink-0"
      >
        <div className="bg-canvas flex flex-wrap items-center gap-2.5 xl:sticky xl:top-0 xl:z-10 xl:pb-1">
          <span className="bg-brand-tint text-brand-ink rounded-full px-[9px] py-[3px] text-[11px] font-bold tracking-[0.4px]">● LIVE PREVIEW</span>
          <span className="text-muted text-xs">How “{form.name || "this form"}” will appear</span>
        </div>
        <div className="border-line overflow-hidden rounded-[14px] border bg-white">
          <div className="bg-navy flex flex-col gap-1 px-5 py-4">
            <span className="text-navy-muted text-[10.5px] font-semibold tracking-[1px]">GENERATED CASE ID</span>
            <span data-testid="id-preview" className="text-brand-glow font-mono text-xl font-semibold break-all">
              {previewId || "—"}
            </span>
          </div>
          <div className="flex flex-col gap-4 px-5 py-4">
            {sections.map((section) => {
              const shown = section.fields.filter((f) => askedOnCreate(f) && f.type !== "caseid");
              return (
                <div key={section.id} className="flex flex-col gap-2.5">
                  <div className="border-line-3 text-ink border-b pb-1.5 text-[11px] font-bold tracking-[0.8px] uppercase">{section.title}</div>
                  {shown.length === 0 ? (
                    <div className="text-faint text-xs">No visible fields in this section.</div>
                  ) : (
                    <div className={`grid gap-3 ${GRID[section.cols]}`}>
                      {shown.map((field) => (
                        <div key={field.id} className={"flex min-w-0 flex-col gap-[5px] " + (isWide(field) ? "col-span-full" : "")}>
                          <span className="text-ink-2 text-xs font-semibold">
                            {field.label}
                            {field.req ? <span className="text-brand"> *</span> : null}
                          </span>
                          <PreviewControl field={field} products={products} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <div className="bg-brand flex h-[42px] items-center justify-center rounded-[9px] text-[13.5px] font-semibold text-white">Create case</div>
          </div>
        </div>
      </aside>

      {toastNode}
    </div>
  );
}

function splitOptions(text: string): string[] {
  return [...new Set(text.split(",").map((o) => o.trim()).filter(Boolean))];
}

function PreviewControl({ field, products }: { field: CaseField; products: Array<{ id: string; name: string; code: string }> }) {
  if (field.type === "product" && field.display === "cards") {
    const shown = products.length ? products.slice(0, 4) : [{ id: "a", name: "Product", code: "" }, { id: "b", name: "Product", code: "" }];
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {shown.map((p) => (
          <div key={p.id} className="border-line bg-subtle flex flex-col gap-0.5 rounded-lg border px-3 py-2.5">
            <span className="text-ink-2 text-[12.5px] font-semibold">{p.name}</span>
            {p.code ? <span className="text-faint font-mono text-[11px]">{p.code}</span> : null}
          </div>
        ))}
      </div>
    );
  }
  if (field.type === "textarea") return <div className="border-line bg-subtle h-[60px] rounded-lg border" />;
  if (field.type === "checkbox") {
    return (
      <div className="text-ink-3 flex items-center gap-2 text-[12.5px]">
        <span className="border-field h-4 w-4 rounded border" />
        Yes
      </div>
    );
  }
  if (field.type === "file") {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="border-field text-muted rounded-lg border border-dashed p-3.5 text-center text-xs">Drag &amp; drop {field.fileTypes.join(", ") || "—"} files</div>
        {field.allowLinks ? <div className="border-line bg-subtle text-faint flex h-8 items-center rounded-lg border px-2.5 text-xs">Or paste a download link…</div> : null}
      </div>
    );
  }
  if (field.type === "people") {
    return (
      <div className="border-line bg-subtle text-faint flex h-9 items-center justify-between rounded-lg border px-2.5 text-[12.5px]">
        Add people…<span>+</span>
      </div>
    );
  }
  if (SELECT_LIKE.includes(field.type)) {
    return (
      <div className="border-line bg-subtle text-faint flex h-9 items-center justify-between rounded-lg border px-2.5 text-[12.5px]">
        {field.def || "Select…"}
        <span>▾</span>
      </div>
    );
  }
  return <div className="border-line bg-subtle h-9 rounded-lg border" />;
}
