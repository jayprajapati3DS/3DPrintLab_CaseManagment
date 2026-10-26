"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { useToast } from "@/components/ui/toast";
import { saveRequestForm } from "@/lib/parts/actions";
import {
  askedOnRequest,
  buildPartNumber,
  CUSTOM_TYPES,
  customVarName,
  DEFAULT_BALLOON_COLUMNS,
  defaultSections,
  fieldVar,
  formsProblem,
  FILE_TYPE_NAMES,
  sharedFields,
  slugVar,
  tableMinWidth,
  tableTemplate,
  typeTag,
  uniqueVar,
  type FieldType,
  type IdRule,
  type RequestField,
  type RequestFormDef,
  type RequestSection,
} from "@/lib/parts/request-form";

/**
 * One request form of Part Request Setup, built on the left and previewed on
 * the right. Nothing changes for anyone until "Save form". The list of forms,
 * and the part-ID rule they share, are on the page above this one.
 */

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

function move<T>(list: T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

const SELECT_LIKE: FieldType[] = ["select", "case", "workflow", "parttype", "priority", "material", "printer", "sourcing", "vendor", "site"];

/** Fields that take the whole row, whatever the section's column count. */
const isWide = (type: FieldType) => type === "textarea" || type === "file" || type === "balloon";

const GRID: Record<1 | 2 | 3, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
};

export function SetupBuilder({
  initial,
  others,
  rule,
  canEdit,
  spaceName,
  savedNote,
}: {
  /** The form being edited. */
  initial: RequestFormDef;
  /** The space's other forms: for reusing their fields, and checking variables against them. */
  others: RequestFormDef[];
  /** The part-ID rule, for the preview. */
  rule: IdRule;
  canEdit: boolean;
  spaceName: string;
  savedNote: string | null;
}) {
  const router = useRouter();
  const { toast, node: toastNode } = useToast();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<RequestFormDef>(initial);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initial));
  const [adding, setAdding] = useState<string | null>(null);
  const [draft, setDraft] = useState({ label: "", type: "text" as FieldType, options: "" });

  const dirty = JSON.stringify(form) !== baseline;
  // Checked with the other forms, so a shared variable keeps one type.
  const problem = useMemo(() => formsProblem({ rule, forms: [...others, form] }), [rule, others, form]);
  const sections = form.sections;
  const allForms = [...others, form];

  // The preview's clock is fixed when the page opens, so typing does not make
  // the year and month tokens flicker.
  const [now] = useState(() => new Date());
  const context = { spaceName, now };

  const setSections = (fn: (sections: RequestSection[]) => RequestSection[]) => setForm((f) => ({ ...f, sections: fn(f.sections) }));
  const setSection = (id: string, fn: (section: RequestSection) => RequestSection) =>
    setSections((list) => list.map((s) => (s.id === id ? fn(s) : s)));
  const setField = (sectionId: string, fieldId: string, fn: (field: RequestField) => RequestField) =>
    setSection(sectionId, (s) => ({ ...s, fields: s.fields.map((f) => (f.id === fieldId ? fn(f) : f)) }));

  const allFields = sections.flatMap((s) => s.fields);
  const varCounts = new Map<string, number>();
  for (const f of allFields) {
    const name = fieldVar(f);
    if (name?.startsWith("request.")) varCounts.set(name, (varCounts.get(name) ?? 0) + 1);
  }

  function addField(sectionId: string) {
    const label = draft.label.trim();
    if (!label) {
      toast("Enter a field label", true);
      return;
    }
    const taken = allFields.filter((f) => !f.key).map(customVarName);
    const field: RequestField = {
      id: newId("f"),
      key: "",
      var: uniqueVar(slugVar(label), taken),
      def: "",
      label,
      type: draft.type,
      show: true,
      req: false,
      locked: false,
      options: draft.type === "select" ? splitOptions(draft.options) : [],
      fileTypes: draft.type === "file" ? ["STL", "PDF"] : [],
      columns: draft.type === "balloon" ? DEFAULT_BALLOON_COLUMNS.map((c) => ({ ...c })) : [],
      allowLinks: true,
    };
    setSection(sectionId, (s) => ({ ...s, fields: [...s.fields, field] }));
    setAdding(null);
    setDraft({ label: "", type: "text", options: "" });
  }

  /** Add a field another form already has — same label, type and variable, so QA forms read both as one. */
  function reuseField(sectionId: string, source: RequestField) {
    if (allFields.some((f) => !f.key && fieldVar(f) === fieldVar(source) && fieldVar(source))) {
      toast("This form already has that field", true);
      return;
    }
    setSection(sectionId, (s) => ({ ...s, fields: [...s.fields, { ...source, id: newId("f"), options: [...source.options], fileTypes: [...source.fileTypes], columns: source.columns.map((c) => ({ ...c })) }] }));
    setAdding(null);
  }

  function save() {
    if (problem) {
      toast(problem, true);
      return;
    }
    const payload = JSON.stringify(form);
    startTransition(async () => {
      const result = await saveRequestForm(payload);
      if (!result.ok) {
        toast(result.message ?? "The form could not be saved.", true);
        return;
      }
      setBaseline(payload);
      toast(result.message ?? "Form saved");
      router.refresh();
    });
  }

  function reset() {
    setSections(() => defaultSections());
    setAdding(null);
    toast(`"${form.name}" set back to the default fields — Save form to apply`);
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
            <Link href="/partsetup" className="text-ink-2 text-[13px] font-semibold no-underline">
              ← All request forms
            </Link>
            {form.isDefault ? <span className="bg-chip text-muted rounded px-1.5 py-px text-[10px] font-bold tracking-[0.4px]">DEFAULT FORM</span> : null}
            <span className="flex-1" />
            {canEdit ? (
              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={reset}
                  className="border-field text-ink-2 h-9 rounded-lg border bg-white px-3 text-[12.5px] font-semibold disabled:opacity-50"
                >
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
                placeholder="e.g. 3D printed anatomical model, made in-house"
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="border-field h-9 rounded-lg border px-2.5 text-[13px] font-normal"
              />
            </label>
          </div>
          <div className="text-faint text-[11.5px]">
            {!canEdit
              ? "Only this space's admins can change request forms."
              : dirty
                ? "Unsaved changes — nothing changes for anyone until you save."
                : (savedNote ?? "Saved.")}
            {" "}The <span className="xl:hidden">panel below</span>
            <span className="hidden xl:inline">right panel</span> previews it live.
          </div>
        </div>

        {/* Sections of the form being edited */}
        {sections.map((section, si) => {
          const removable = !section.fields.some((f) => f.locked);
          return (
            <div key={section.id} className="border-line flex flex-col gap-2.5 rounded-[14px] border bg-white px-[18px] py-4">
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
                      className={
                        "h-7 rounded-md border-0 px-2.5 text-xs font-semibold " +
                        (section.cols === cols ? "text-ink bg-white shadow-[0_1px_2px_rgba(16,24,40,.08)]" : "text-muted bg-transparent")
                      }
                    >
                      {cols} col
                    </button>
                  ))}
                </div>
                <SquareButton label="Move section up" disabled={si === 0} onClick={() => setSections((l) => move(l, si, -1))}>
                  ↑
                </SquareButton>
                <SquareButton
                  label="Move section down"
                  disabled={si === sections.length - 1}
                  onClick={() => setSections((l) => move(l, si, 1))}
                >
                  ↓
                </SquareButton>
                {removable ? (
                  <button
                    type="button"
                    aria-label="Delete section"
                    onClick={() => setSections((l) => l.filter((s) => s.id !== section.id))}
                    className="h-[30px] w-[30px] rounded-[7px] border border-[#FECDCA] bg-white text-[#D92D20]"
                  >
                    ×
                  </button>
                ) : null}
              </div>

              <div className="text-faint hidden grid-cols-[minmax(0,1fr)_56px_56px_64px_72px] gap-2 px-3 text-[10.5px] font-semibold tracking-[0.6px] sm:grid">
                <div>FIELD</div>
                <div className="text-center">SHOW</div>
                <div className="text-center">REQ.</div>
                <div className="text-center" title="Asked when the part is requested — off: answered later, on the part's page">CREATE</div>
                <div />
              </div>

              {section.fields.map((field, fi) => {
                const token = fieldVar(field);
                const custom = !field.key;
                const clash = Boolean(token && (varCounts.get(token) ?? 0) > 1);
                return (
                  <div key={field.id} className="border-line-2 flex flex-col gap-2 rounded-[10px] border px-3 py-2">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_56px_56px_64px_72px]">
                      <div className="col-span-4 flex min-w-0 items-center gap-2 sm:col-span-1">
                        <input
                          aria-label="Field name"
                          title="Rename field"
                          value={field.label}
                          onChange={(e) => setField(section.id, field.id, (f) => ({ ...f, label: e.target.value }))}
                          className="border-line h-[30px] min-w-0 flex-1 rounded-md border px-2 text-[13px] font-semibold"
                        />
                        <span className="text-faint font-mono text-[11px]">{typeTag(field.type)}</span>
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
                          onToggle={() =>
                            setField(section.id, field.id, (f) => ({ ...f, show: !f.show, req: f.show ? false : f.req }))
                          }
                        />
                      </div>
                      <div className="flex items-center justify-start gap-1.5 sm:justify-center">
                        <span className="text-faint text-[10.5px] font-semibold sm:hidden">REQ.</span>
                        <Switch
                          label={`Require ${field.label}`}
                          on={field.req}
                          locked={field.locked}
                          onToggle={() =>
                            setField(section.id, field.id, (f) => ({ ...f, req: !f.req, show: !f.req ? true : f.show }))
                          }
                        />
                      </div>
                      <div className="flex items-center justify-start gap-1.5 sm:justify-center">
                        <span className="text-faint text-[10.5px] font-semibold sm:hidden">CREATE</span>
                        <Switch
                          label={`Ask ${field.label} when requesting`}
                          on={field.locked || field.onCreate !== false}
                          locked={field.locked || !field.show}
                          onToggle={() => setField(section.id, field.id, (f) => ({ ...f, onCreate: f.onCreate === false }))}
                        />
                      </div>
                      <div className="flex justify-end gap-1">
                        <TinyButton
                          label="Move field up"
                          disabled={fi === 0}
                          onClick={() => setSection(section.id, (s) => ({ ...s, fields: move(s.fields, fi, -1) }))}
                        >
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
                            onClick={() =>
                              setSection(section.id, (s) => ({ ...s, fields: s.fields.filter((f) => f.id !== field.id) }))
                            }
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
                      {!token ? (
                        <span className="text-faint text-[11.5px]">Files are not available as a QA variable</span>
                      ) : custom && field.type !== "balloon" ? (
                        <span className="border-field inline-flex h-[26px] items-center overflow-hidden rounded-md border font-mono text-xs">
                          <span className="text-faint pr-1 pl-2">{"{request."}</span>
                          <input
                            aria-label="Variable name"
                            value={customVarName(field)}
                            onChange={(e) =>
                              setField(section.id, field.id, (f) => ({
                                ...f,
                                var: e.target.value.replace(/[^A-Za-z0-9_]/g, "").slice(0, 60),
                              }))
                            }
                            className="text-brand-ink h-6 w-[140px] border-0 p-0 font-mono text-xs outline-none"
                          />
                          <span className="text-faint pr-2">{"}"}</span>
                        </span>
                      ) : (
                        <span
                          title="System variable — fixed"
                          className="border-line-2 bg-subtle text-brand-ink inline-flex h-[26px] items-center rounded-md border px-2 font-mono text-xs"
                        >
                          {`{${token}}`}
                        </span>
                      )}
                      {token ? (
                        <button
                          type="button"
                          aria-label={`Copy variable ${token}`}
                          onClick={() => copy(`{${token}}`)}
                          className="border-line text-ink-2 h-[26px] rounded-md border bg-white px-2.5 text-[11.5px] font-semibold"
                        >
                          Copy
                        </button>
                      ) : null}
                      {clash ? (
                        <span className="text-[11.5px] font-semibold text-[#D92D20]">Another field already uses this variable</span>
                      ) : null}
                    </div>

                    {custom && (field.type === "text" || field.type === "textarea") ? (
                      <label className="text-muted flex items-center gap-2 text-[11.5px] font-semibold">
                        Default value
                        <input
                          value={field.def}
                          onChange={(e) => setField(section.id, field.id, (f) => ({ ...f, def: e.target.value }))}
                          placeholder="Pre-filled in every new request (optional)"
                          className="border-line text-ink h-[30px] min-w-0 flex-1 rounded-md border px-2 text-[12.5px] font-normal"
                        />
                      </label>
                    ) : null}

                    {field.type === "select" ? (
                      <label className="text-muted flex items-center gap-2 text-[11.5px] font-semibold">
                        Options
                        <OptionsInput
                          options={field.options}
                          onChange={(options) => setField(section.id, field.id, (f) => ({ ...f, options }))}
                        />
                      </label>
                    ) : null}

                    {field.type === "balloon" ? (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-muted text-[11.5px] font-semibold">
                          Table columns <span className="font-normal">· Sl. No. and Balloon ID are always first</span>
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {["Sl. No.", "Balloon ID"].map((fixed) => (
                            <span
                              key={fixed}
                              className="border-line-2 bg-subtle text-faint inline-flex h-[30px] items-center rounded-md border px-2.5 text-xs"
                            >
                              {fixed}
                            </span>
                          ))}
                          {field.columns.map((column, ci) => (
                            <span
                              key={column.id}
                              className="border-brand-edge bg-brand-wash inline-flex h-[30px] items-center gap-0.5 rounded-md border px-[3px]"
                            >
                              <button
                                type="button"
                                aria-label="Move column left"
                                disabled={ci === 0}
                                onClick={() => setField(section.id, field.id, (f) => ({ ...f, columns: move(f.columns, ci, -1) }))}
                                className="h-[22px] w-[18px] border-0 bg-transparent p-0 disabled:opacity-30"
                              >
                                ‹
                              </button>
                              <input
                                aria-label="Column name"
                                value={column.label}
                                onChange={(e) =>
                                  setField(section.id, field.id, (f) => ({
                                    ...f,
                                    columns: f.columns.map((c) => (c.id === column.id ? { ...c, label: e.target.value } : c)),
                                  }))
                                }
                                className="h-6 w-[110px] rounded border border-[#F4C7B7] bg-white px-1.5 text-xs"
                              />
                              <button
                                type="button"
                                aria-label="Move column right"
                                disabled={ci === field.columns.length - 1}
                                onClick={() => setField(section.id, field.id, (f) => ({ ...f, columns: move(f.columns, ci, 1) }))}
                                className="h-[22px] w-[18px] border-0 bg-transparent p-0 disabled:opacity-30"
                              >
                                ›
                              </button>
                              <button
                                type="button"
                                aria-label={`Remove column ${column.label}`}
                                onClick={() =>
                                  setField(section.id, field.id, (f) => ({ ...f, columns: f.columns.filter((c) => c.id !== column.id) }))
                                }
                                className="h-[22px] w-5 border-0 bg-transparent p-0 text-[#D92D20]"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                          <button
                            type="button"
                            disabled={field.columns.length >= 12}
                            onClick={() =>
                              setField(section.id, field.id, (f) => ({
                                ...f,
                                columns: [...f.columns, { id: newId("c"), label: "New column" }],
                              }))
                            }
                            className="border-field text-ink-2 h-[30px] rounded-md border border-dashed bg-white px-2.5 text-xs font-semibold"
                          >
                            + Add column
                          </button>
                        </div>
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
                                setField(section.id, field.id, (f) => ({
                                  ...f,
                                  fileTypes: on ? f.fileTypes.filter((t) => t !== type) : [...f.fileTypes, type],
                                }))
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

              {adding === section.id ? (
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
                      onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value as FieldType }))}
                      className="border-field h-9 rounded-lg border bg-white px-2 text-[13px]"
                    >
                      {CUSTOM_TYPES.map((t) => (
                        <option key={t.type} value={t.type}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {draft.type === "select" ? (
                    <input
                      aria-label="Dropdown options"
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
                          const pick = sharedFields(allForms, form.id).find((x) => x.field.id === e.target.value);
                          if (pick) reuseField(section.id, pick.field);
                        }}
                        className="border-field h-9 rounded-lg border bg-white px-2 text-[13px] font-normal"
                      >
                        <option value="">— choose a field —</option>
                        {sharedFields(allForms, form.id).map(({ field: f, forms: on }) => (
                          <option key={f.id} value={f.id}>
                            {f.label} · {typeTag(f.type)}
                            {fieldVar(f) ? ` · {${fieldVar(f)}}` : ""} · on {on.join(", ")}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setAdding(null)}
                      className="border-field h-[34px] rounded-lg border bg-white px-3 text-[12.5px] font-semibold"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => addField(section.id)}
                      className="bg-brand h-[34px] rounded-lg border-0 px-3 text-[12.5px] font-semibold text-white"
                    >
                      Add field
                    </button>
                  </div>
                </div>
              ) : canEdit ? (
                <button
                  type="button"
                  onClick={() => {
                    setAdding(section.id);
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
            disabled={sections.length >= 40}
            onClick={() => setSections((l) => [...l, { id: newId("s"), title: "New section", cols: 2, fields: [] }])}
            className="border-field text-ink-2 h-11 rounded-xl border border-dashed bg-white text-[13px] font-semibold"
          >
            + Add section
          </button>
        ) : null}
      </fieldset>

      {/* Live preview */}
      {/* Its own scroll beside the builder: the preview stays in view however long either side is. */}
      <aside
        aria-label="Live preview"
        data-testid="live-preview"
        className="flex min-w-0 flex-col gap-2.5 xl:sticky xl:top-0 xl:max-h-[calc(100dvh-140px)] xl:overflow-y-auto xl:overscroll-contain xl:pr-1 [&>*]:shrink-0"
      >
        <div className="bg-canvas flex flex-wrap items-center gap-2.5 xl:sticky xl:top-0 xl:z-10 xl:pb-1">

          <span className="bg-brand-tint text-brand-ink rounded-full px-[9px] py-[3px] text-[11px] font-bold tracking-[0.4px]">
            ● LIVE PREVIEW
          </span>
          <span className="text-muted text-xs">How “{form.name || "this form"}” will appear</span>
        </div>
        <div className="border-line overflow-hidden rounded-[14px] border bg-white">
          <div className="bg-navy flex flex-col gap-1 px-5 py-4">
            <span className="text-navy-muted text-[10.5px] font-semibold tracking-[1px]">GENERATED PART ID</span>
            <span data-testid="id-preview" className="text-brand-glow font-mono text-xl font-semibold break-all">
              {buildPartNumber(rule, context, true) || "—"}
            </span>
          </div>
          <div className="flex flex-col gap-4 px-5 py-4">
            {sections.map((section) => {
              const shown = section.fields.filter(askedOnRequest);
              return (
                <div key={section.id} className="flex flex-col gap-2.5">
                  <div className="border-line-3 text-ink border-b pb-1.5 text-[11px] font-bold tracking-[0.8px] uppercase">
                    {section.title}
                  </div>
                  {shown.length === 0 ? (
                    <div className="text-faint text-xs">No visible fields in this section.</div>
                  ) : (
                    <div className={`grid gap-3 ${GRID[section.cols]}`}>
                      {shown.map((field) => (
                        <div key={field.id} className={"flex min-w-0 flex-col gap-[5px] " + (isWide(field.type) ? "col-span-full" : "")}>
                          <span className="text-ink-2 text-xs font-semibold">
                            {field.label}
                            {field.req ? <span className="text-brand"> *</span> : null}
                          </span>
                          <PreviewControl field={field} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <div className="bg-brand flex h-[42px] items-center justify-center rounded-[9px] text-[13.5px] font-semibold text-white">
              Request part
            </div>
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

/**
 * Comma-separated options, typed freely. The text is kept as typed — splitting
 * on every keystroke would swallow the comma the moment it is pressed.
 */
export function OptionsInput({ options, onChange }: { options: string[]; onChange: (options: string[]) => void }) {
  const [text, setText] = useState(options.join(", "));
  return (
    <input
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(splitOptions(e.target.value));
      }}
      placeholder="Comma separated, e.g. Left, Right"
      className="border-line text-ink h-[30px] min-w-0 flex-1 rounded-md border px-2 text-[12.5px] font-normal"
    />
  );
}

function PreviewControl({ field }: { field: RequestField }) {
  if (field.type === "textarea") return <div className="border-line bg-subtle h-[60px] rounded-lg border" />;
  if (field.type === "checkbox") {
    return (
      <div className="text-ink-3 flex items-center gap-2 text-[12.5px]">
        <span className="border-field h-4 w-4 rounded border" />
        Yes
      </div>
    );
  }
  if (field.type === "image") {
    return (
      <div className="border-field text-muted flex h-[90px] items-center justify-center rounded-lg border border-dashed bg-[#FCFCFD] text-xs">
        Upload {field.label.toLowerCase()}
      </div>
    );
  }
  if (field.type === "file") {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="border-field text-muted rounded-lg border border-dashed p-3.5 text-center text-xs">
          Drag &amp; drop {field.fileTypes.join(", ") || "—"} files
        </div>
        {field.allowLinks ? (
          <div className="border-line bg-subtle text-faint flex h-8 items-center rounded-lg border px-2.5 text-xs">
            Or paste a download link…
          </div>
        ) : null}
      </div>
    );
  }
  if (field.type === "balloon") {
    const template = tableTemplate(field.columns.length, false);
    return (
      <div className="flex flex-col gap-2">
        <div className="border-field text-muted relative rounded-lg border border-dashed p-[18px] text-center text-xs">
          Add one or more drawing images · click to place balloons
          {[
            ["30%", "20%", 1],
            ["62%", "45%", 2],
          ].map(([left, top, n]) => (
            <span
              key={n}
              style={{ left, top }}
              className="bg-brand absolute flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
            >
              {n}
            </span>
          ))}
        </div>
        <div className="border-line-2 overflow-x-auto rounded-lg border">
          <div
            className="border-line-2 bg-subtle text-ink-3 grid gap-1.5 border-b px-2.5 py-2 text-[10.5px] font-bold tracking-[0.4px]"
            style={{ gridTemplateColumns: template, minWidth: tableMinWidth(field.columns.length) }}
          >
            <div>Sl. No.</div>
            <div>Balloon ID</div>
            {field.columns.map((c) => (
              <div key={c.id} className="truncate" title={c.label}>
                {c.label}
              </div>
            ))}
          </div>
          <div className="text-faint p-2.5 text-center text-[11.5px]">Rows are added for each balloon</div>
        </div>
      </div>
    );
  }
  if (SELECT_LIKE.includes(field.type)) {
    return (
      <div className="border-line bg-subtle text-faint flex h-9 items-center justify-between rounded-lg border px-2.5 text-[12.5px]">
        Select…<span>▾</span>
      </div>
    );
  }
  return <div className="border-line bg-subtle h-9 rounded-lg border" />;
}

export function Switch({ label, on, locked, onToggle }: { label: string; on: boolean; locked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={locked}
      title={locked ? "Required by the system" : undefined}
      onClick={onToggle}
      className={
        "relative h-[22px] w-[38px] flex-none rounded-full border-0 p-0 disabled:cursor-not-allowed " +
        (on ? (locked ? "bg-[#FDA283]" : "bg-brand") : "bg-field")
      }
    >
      <span
        className="absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.2)] transition-[left]"
        style={{ left: on ? 18 : 2 }}
      />
    </button>
  );
}

export function SquareButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="border-line h-[30px] w-[30px] rounded-[7px] border bg-white disabled:opacity-35"
    >
      {children}
    </button>
  );
}

export function TinyButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="border-line h-[26px] w-[22px] rounded-md border bg-white p-0 text-[11px] disabled:opacity-35"
    >
      {children}
    </button>
  );
}
