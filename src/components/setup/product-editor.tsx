"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ArchiveButton } from "@/components/setup/archive-button";
import { ProductExtrasPanel, ProductImage, type ViewerOption } from "@/components/setup/product-extras";
import { S_BTN_PRIMARY, S_INPUT, S_LABEL } from "@/components/setup/ui";
import { ChipSelect, Row, SectionHead, StageBoard } from "@/components/setup/stage-board";
import { copyStages, defaultCaseStages, newScope, type CatalogData, type ProductExtras, type ProductMode, type ProductScope } from "@/lib/cases/catalog";
import { saveProductAction, type ActionResult } from "@/lib/resources/actions";
import { KINDS, NEW_ID, type WorkflowStage } from "@/lib/resources/config";

/**
 * A product, edited like a manufacturing workflow. Made as one of two kinds:
 * one workflow — its case stages below its details — or sub-scopes, kept
 * inside the product, each with its own details and case stages. Nothing
 * changes until "Save product".
 */

const MODES: Array<{ value: ProductMode; title: string; detail: string }> = [
  { value: "single", title: "Product with one workflow", detail: "Every case of it goes through the same stages — e.g. 3D PDF, anatomical model." },
  { value: "scopes", title: "Product with sub-scopes", detail: "Variants kept inside the product, each with its own workflow — e.g. PSI: orthognathic, mandible reconstruction." },
];

export function ProductEditor({
  id,
  initialName,
  initialStatus,
  initial,
  workflows,
  viewers,
  forms,
  orderForms = [],
  roles,
  canEdit,
  allTags = [],
  history = null,
}: {
  id: string;
  initialName: string;
  initialStatus: string;
  initial: CatalogData;
  /** Manufacturing workflows, for the parts a case makes. */
  workflows: Array<{ id: string; name: string }>;
  /** The Viewer list, to associate. */
  viewers: ViewerOption[];
  /** QA forms, as stages list them. */
  forms: string[];
  /** QA forms for the Order tab (order and generic ones), by label. */
  orderForms?: string[];
  roles: string[];
  canEdit: boolean;
  /** Tags other products have, offered as you type. */
  allTags?: string[];
  /** Who created it and when, who last updated it and when — ready to show. */
  history?: { created: string | null; updated: string | null } | null;
}) {
  const creating = id === NEW_ID;
  const [name, setName] = useState(initialName);
  const [status, setStatus] = useState(initialStatus === "Inactive" ? "Inactive" : "Active");
  // A new product asks what kind it is first.
  const [chosen, setChosen] = useState(!creating);
  const [data, setData] = useState<CatalogData>(() => ({
    ...initial,
    // Saved before it had case stages: starts from the default path.
    stages: initial.mode === "single" && initial.stages.length === 0 ? defaultCaseStages() : initial.stages,
  }));
  const [scopeId, setScopeId] = useState<string | null>(initial.scopes[0]?.id ?? null);
  // The page in two tabs: the product itself, and the stages its cases go through.
  const [view, setView] = useState<"product" | "stages">("product");
  const [dirty, setDirty] = useState(creating || (initial.mode === "single" && initial.stages.length === 0));
  const order = data.orderForms ?? { auto: [], offered: [] };
  const [result, setResult] = useState<ActionResult | null>(null);
  const [saving, startTransition] = useTransition();
  const router = useRouter();

  const touch = () => {
    setDirty(true);
    setResult(null);
  };
  const set = (patch: Partial<CatalogData>) => {
    setData((d) => ({ ...d, ...patch }));
    touch();
  };
  const scope = data.scopes.find((s) => s.id === scopeId) ?? data.scopes[0] ?? null;
  const setScope = (sid: string, patch: Partial<ProductScope>) => set({ scopes: data.scopes.map((s) => (s.id === sid ? { ...s, ...patch } : s)) });

  // Viewers: a sub-scope without its own uses the product's.
  const named = (ids: string[]) => ids.map((vid) => viewers.find((v) => v.id === vid)).filter((v): v is ViewerOption => Boolean(v));
  const effective = (sc: ProductScope) => (sc.viewerIds.length ? sc.viewerIds : data.viewerIds);

  function changeProductExtras(patch: Partial<ProductExtras>) {
    if (!patch.viewerIds) return set(patch);
    const after = patch.viewerIds;
    if (data.mode === "single") return set({ ...patch, stages: syncViewers(data.stages, data.viewerIds, after) });
    set({ ...patch, scopes: data.scopes.map((sc) => (sc.viewerIds.length ? sc : { ...sc, stages: syncViewers(sc.stages, data.viewerIds, after) })) });
  }

  function changeScopeExtras(sid: string, patch: Partial<ProductExtras>) {
    const sc = data.scopes.find((x) => x.id === sid);
    if (!sc || !patch.viewerIds) return setScope(sid, patch);
    const after = patch.viewerIds.length ? patch.viewerIds : data.viewerIds;
    setScope(sid, { ...patch, stages: syncViewers(sc.stages, effective(sc), after) });
  }

  function choose(mode: ProductMode) {
    if (mode === "scopes") {
      const first = newScope("", defaultCaseStages());
      setData((d) => ({ ...d, mode, scopes: [first], stages: [] }));
      setScopeId(first.id);
    } else {
      setData((d) => ({ ...d, mode, stages: d.stages.length ? d.stages : defaultCaseStages(), scopes: [] }));
    }
    setChosen(true);
    touch();
  }

  /** Change kind after the fact: one workflow becomes the first scope, or the open scope becomes the one workflow. */
  function switchMode() {
    if (data.mode === "single") {
      const first = newScope(name || "Standard", data.stages);
      set({ mode: "scopes", scopes: [first], stages: [] });
      setScopeId(first.id);
    } else {
      const keep = scope;
      if (data.scopes.length > 1 && !window.confirm(`Keep only "${keep?.name || "this sub-scope"}"'s stages as the product's one workflow? The other sub-scopes are removed.`)) return;
      set({ mode: "single", stages: keep?.stages ?? defaultCaseStages(), scopes: [] });
    }
  }

  function addScope() {
    const next = newScope("", copyStages(scope?.stages ?? defaultCaseStages()));
    set({ scopes: [...data.scopes, next] });
    setScopeId(next.id);
  }

  function removeScope(sid: string) {
    const rest = data.scopes.filter((s) => s.id !== sid);
    set({ scopes: rest });
    setScopeId(rest[0]?.id ?? null);
  }

  function save() {
    startTransition(async () => {
      const saved = await saveProductAction(id, { name, status, ...data });
      setResult(saved);
      if (saved.ok) setDirty(false);
      if (saved.ok && saved.createdId) router.replace(`${KINDS.products.route}/${saved.createdId}`);
      else if (saved.ok) router.refresh();
    });
  }

  if (!chosen) {
    return (
      <section className="border-line flex flex-col gap-3 rounded-[14px] border bg-white px-4 py-[18px] sm:px-[22px]">
        <div className="flex flex-col gap-0.5">
          <h2 className="m-0 text-[15px] font-bold">What kind of product?</h2>
          <p className="text-muted m-0 text-[12.5px]">It can be changed later on its page.</p>
        </div>
        <div role="radiogroup" aria-label="Product kind" className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={false}
              onClick={() => choose(m.value)}
              className="border-field hover:border-brand-edge hover:bg-brand-wash flex flex-col gap-1 rounded-[12px] border bg-white px-4 py-3.5 text-left"
            >
              <span className="text-ink text-[14px] font-bold">{m.title}</span>
              <span className="text-muted text-[12.5px] leading-[1.45]">{m.detail}</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <fieldset disabled={!canEdit || saving} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0 pb-20">
      <div role="tablist" aria-label="Product sections" className="bg-chip flex gap-1 self-start rounded-[11px] p-1">
        {(
          [
            ["product", "Product"],
            ["stages", data.mode === "scopes" ? `Sub-scopes & case stages (${data.scopes.length})` : `Case stages (${data.stages.length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            onClick={() => setView(key)}
            className={
              "h-9 rounded-lg border-0 px-4 text-[13px] font-semibold whitespace-nowrap " +
              (view === key ? "text-brand-ink bg-white shadow-[0_1px_2px_rgba(16,24,40,.1)]" : "text-ink-3 bg-transparent")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {view === "product" ? (
      <section className="border-line overflow-hidden rounded-[14px] border bg-white" aria-label="Product">
        {/* What it is, at a glance: name, active or not, and its kind. */}
        <div className="border-line-2 flex flex-wrap items-center gap-4 border-b px-4 py-4 sm:px-[22px]">
          <ProductImage productId={id} imageId={data.imageId} canEdit={canEdit} onChange={(imageId) => set({ imageId })} />
          <div className="flex min-w-[160px] flex-1 flex-col gap-1">
            <h2 className="m-0 truncate text-[17px] font-bold">{name || "New product"}</h2>
            {history ? (
              <span className="text-muted text-[12px]" data-testid="product-history">
                {[history.created, history.updated].filter(Boolean).join(" · ")}
              </span>
            ) : null}
          </div>
          <div role="radiogroup" aria-label="Status" className="bg-chip flex gap-0.5 rounded-lg p-[3px]">
            {(["Active", "Inactive"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={status === value}
                onClick={() => {
                  setStatus(value);
                  touch();
                }}
                className={
                  "h-7 rounded-md border-0 px-2.5 text-xs font-semibold " +
                  (status === value ? (value === "Active" ? "text-ok bg-white shadow-[0_1px_2px_rgba(16,24,40,.08)]" : "text-ink bg-white shadow-[0_1px_2px_rgba(16,24,40,.08)]") : "text-muted bg-transparent")
                }
              >
                {value}
              </button>
            ))}
          </div>
          <span className="flex items-center gap-2" title={MODES.find((m) => m.value === data.mode)?.detail}>
            <span className="bg-brand-wash text-brand-ink rounded-full px-2.5 py-1 text-[12px] font-bold" data-testid="product-kind">
              {MODES.find((m) => m.value === data.mode)?.title}
            </span>
            {canEdit ? (
              <button type="button" onClick={switchMode} className="text-brand-ink border-0 bg-transparent p-0 text-[12px] font-semibold underline">
                {data.mode === "single" ? "Change to sub-scopes" : "Change to one workflow"}
              </button>
            ) : null}
          </span>
          {canEdit && !creating ? <ArchiveButton resourceId={id} name={initialName || "New product"} label="Archive product" /> : null}
        </div>
        <SectionHead title="Details" />
        <Row label="Product name">
          <input
            aria-label="Product name"
            value={name}
            placeholder="e.g. Patient-specific guide"
            onChange={(e) => {
              setName(e.target.value);
              touch();
            }}
            className={`${S_INPUT} h-9 w-full max-w-[520px] font-semibold`}
          />
        </Row>
        <Row label="Product code" hint="The code is {TYPE} in the case ID.">
          <input aria-label="Product code" value={data.code} placeholder="e.g. PSI" onChange={(e) => set({ code: e.target.value })} className={`${S_INPUT} h-9 w-[160px]! font-mono`} />
        </Row>
        <Row label="Tags" hint="One or more — to find and filter products by.">
          <TagInput value={data.tags} suggestions={allTags} onChange={(tags) => set({ tags })} />
        </Row>
        <Row label="Manufacturing workflows" hint="The production workflows the parts of its cases may use.">
          <WorkflowPicker label="Manufacturing workflows" all="All workflows" value={data.workflowIds} workflows={workflows} onChange={(workflowIds) => set({ workflowIds })} />
        </Row>
        <Row label="Order forms" hint="Its cases' Order tab — the forms between the surgeon and the team. Not tied to a case status.">
          <div className="flex flex-col gap-2">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-ink-3 w-[150px] text-[12px] font-semibold">Added to every case</span>
              <ChipSelect
                label="Order forms added to every case"
                values={order.auto}
                options={orderForms}
                addLabel="+ Add form"
                onChange={(auto) => set({ orderForms: { ...order, auto, offered: order.offered.filter((f) => !auto.includes(f)) } })}
              />
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-ink-3 w-[150px] text-[12px] font-semibold">Offered to add</span>
              <ChipSelect
                label="Order forms offered to add"
                values={order.offered}
                options={orderForms.filter((f) => !order.auto.includes(f))}
                addLabel="+ Add form"
                onChange={(offered) => set({ orderForms: { ...order, offered } })}
              />
            </span>
            <span className="text-muted text-[11.5px]">None offered: any order or generic QA form can be added. Forms are made in QA Form Setup with &ldquo;Used for: Order&rdquo;.</span>
          </div>
        </Row>
        <Row label="Description">
          <textarea aria-label="Description" rows={2} value={data.description} onChange={(e) => set({ description: e.target.value })} className={`${S_INPUT} h-auto w-full max-w-[720px] py-2`} />
        </Row>
        <ProductExtrasPanel
          embedded
          withImage={false}
          title="Viewers and scan protocol"
          hint={data.mode === "scopes" ? "The product's own — a sub-scope without its own uses these." : "Shown with every case of this product."}
          productId={id}
          value={data}
          onChange={changeProductExtras}
          viewers={viewers}
          canEdit={canEdit}
        />
      </section>
      ) : null}

      {view !== "stages" ? null : data.mode === "single" ? (
        <StageBoard
          stages={data.stages}
          viewers={named(data.viewerIds)}
          onChange={(stages) => set({ stages })}
          canEdit={canEdit}
          forms={forms}
          roles={roles}
          title="Case stages"
          hint="The statuses a case goes through, in order — each with the quality forms, emails, tasks, expected time and owner applied to it. Choose a stage on the left — drag to reorder — and set it up on the right."
        />
      ) : (
        <>
          <section className="border-line flex flex-col gap-3 rounded-[14px] border bg-white px-4 py-[18px] sm:px-[22px]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <h3 className="m-0 text-sm font-bold">Sub-scopes</h3>
                <p className="text-muted m-0 text-[12.5px]">Each with its own case stages. A case of this product picks one.</p>
              </div>
              {canEdit ? (
                <button type="button" onClick={addScope} disabled={data.scopes.length >= 40} className="bg-ink h-9 rounded-lg border-0 px-3.5 text-[12.5px] font-semibold text-white">
                  + Add sub-scope
                </button>
              ) : null}
            </div>
            <div role="tablist" aria-label="Sub-scopes" className="flex flex-wrap gap-1.5">
              {data.scopes.map((s, i) => {
                const on = s.id === scope?.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setScopeId(s.id)}
                    className={"flex h-9 items-center gap-2 rounded-lg border px-3 text-[12.5px] font-semibold " + (on ? "border-brand bg-brand-wash text-brand-ink" : "border-field text-ink-2 bg-white")}
                  >
                    {s.name || `Sub-scope ${i + 1}`}
                    <span className="text-muted font-normal">
                      {s.stages.length} stage{s.stages.length === 1 ? "" : "s"}
                    </span>
                  </button>
                );
              })}
            </div>
            {scope ? (
              <div className="border-line-3 flex flex-col gap-4 border-t pt-3.5">
                <div className="flex flex-wrap items-end gap-4">
                  <label className="flex min-w-[200px] flex-[2] flex-col gap-[5px]">
                    <span className={S_LABEL}>Sub-scope name</span>
                    <input aria-label="Sub-scope name" value={scope.name} placeholder="e.g. Orthognathic" onChange={(e) => setScope(scope.id, { name: e.target.value })} className={`${S_INPUT} h-10 font-semibold`} />
                  </label>
                  <label className="flex min-w-[110px] flex-1 flex-col gap-[5px]">
                    <span className={S_LABEL}>Sub-scope code</span>
                    <input aria-label="Sub-scope code" value={scope.code} placeholder="e.g. ORT" onChange={(e) => setScope(scope.id, { code: e.target.value })} className={`${S_INPUT} h-10 font-mono`} />
                  </label>
                  <div className="min-w-[200px] flex-[1.4]">
                    <span className="text-ink-3 mb-1 block text-[11px] font-semibold tracking-[0.5px] uppercase">Manufacturing workflows</span>
                    <WorkflowPicker label="Sub-scope manufacturing workflows" all="Same as the product" value={scope.workflowIds} workflows={workflows} onChange={(workflowIds) => setScope(scope.id, { workflowIds })} />
                  </div>
                  {canEdit ? (
                    <button
                      type="button"
                      disabled={data.scopes.length === 1}
                      title={data.scopes.length === 1 ? "A product with sub-scopes keeps at least one" : undefined}
                      onClick={() => removeScope(scope.id)}
                      className="h-10 rounded-lg border border-[#FECDCA] bg-white px-3 text-[12.5px] font-semibold text-[#D92D20] disabled:opacity-40"
                    >
                      Remove sub-scope
                    </button>
                  ) : null}
                </div>
                <label className="flex flex-col gap-[5px]">
                  <span className={S_LABEL}>Description</span>
                  <input aria-label="Sub-scope description" value={scope.description} onChange={(e) => setScope(scope.id, { description: e.target.value })} className={S_INPUT} />
                </label>
              </div>
            ) : null}
            {scope ? (
              <div className="border-line -mx-4 -mb-[18px] border-t sm:-mx-[22px]">
                <ProductExtrasPanel
                  key={`extras-${scope.id}`}
                  embedded
                  title={`Image, viewers and scan protocol — ${scope.name || "this sub-scope"}`}
                  hint="Left empty, the product's are used for this sub-scope's cases."
                  productId={id}
                  value={scope}
                  onChange={(patch) => changeScopeExtras(scope.id, patch)}
                  viewers={viewers}
                  canEdit={canEdit}
                />
              </div>
            ) : null}
          </section>
          {scope ? (
            <StageBoard
              key={scope.id}
              stages={scope.stages}
              viewers={named(effective(scope))}
              onChange={(stages) => setScope(scope.id, { stages })}
              canEdit={canEdit}
              forms={forms}
              roles={roles}
              title={`Case stages — ${scope.name || "this sub-scope"}`}
              hint="The statuses a case of this sub-scope goes through, in order — each with the quality forms, emails, tasks, expected time and owner applied to it. Choose a stage on the left — drag to reorder — and set it up on the right."
            />
          ) : null}
        </>
      )}

      {canEdit ? (
        <div className="border-line shadow-popover fixed right-3 bottom-4 z-10 flex max-w-[calc(100vw-24px)] items-center gap-3 rounded-full border bg-white py-2 pr-2 pl-4 sm:right-10 sm:bottom-6">
          <span role="status" className={"text-[12.5px] " + (result && !result.ok ? "text-bad" : dirty ? "text-warn font-semibold" : "text-muted")}>
            {result && !result.ok ? result.message : dirty ? (creating ? "Not saved yet" : "Unsaved changes") : result?.ok ? result.message : "No changes to save."}
          </span>
          <button type="button" onClick={save} disabled={!dirty || saving} className={`${S_BTN_PRIMARY} rounded-full`}>
            {saving ? "Saving…" : "Save product"}
          </button>
        </div>
      ) : null}
    </fieldset>
  );
}


/**
 * A viewer newly associated shows its button at every stage, to everyone —
 * to be narrowed stage by stage; one no longer associated leaves every stage.
 */
function syncViewers(stages: WorkflowStage[], before: string[], after: string[]): WorkflowStage[] {
  const added = after.filter((v) => !before.includes(v));
  return stages.map((st) => {
    const kept = (st.viewers ?? []).filter((v) => after.includes(v.viewerId));
    const fresh = added.filter((v) => !kept.some((k) => k.viewerId === v)).map((viewerId) => ({ viewerId, roles: "" }));
    return { ...st, viewers: [...kept, ...fresh] };
  });
}

/** "All" (none chosen) or a selection of workflows, as chips. */
function WorkflowPicker({
  label,
  all,
  value,
  workflows,
  onChange,
}: {
  label: string;
  all: string;
  value: string[];
  workflows: Array<{ id: string; name: string }>;
  onChange: (ids: string[]) => void;
}) {
  const [picking, setPicking] = useState(value.length > 0);
  const selected = picking || value.length > 0;
  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label={label} className="bg-chip flex gap-0.5 self-start rounded-lg p-[3px]">
        {(
          [
            [false, all],
            [true, "Selected"],
          ] as const
        ).map(([choose, text]) => (
          <button
            key={text}
            type="button"
            role="radio"
            aria-checked={selected === choose}
            onClick={() => {
              setPicking(choose);
              if (!choose) onChange([]);
            }}
            className={"h-7 rounded-md border-0 px-2.5 text-xs font-semibold " + (selected === choose ? "text-ink bg-white shadow-[0_1px_2px_rgba(16,24,40,.08)]" : "text-muted bg-transparent")}
          >
            {text}
          </button>
        ))}
      </div>
      {selected ? (
        <div role="group" aria-label={`${label} chosen`} className="flex flex-wrap items-center gap-1.5">
          {value.map((wid) => (
            <span key={wid} className="bg-brand-wash text-brand-ink flex items-center gap-1.5 rounded-full py-1 pr-1.5 pl-2.5 text-xs font-semibold">
              {workflows.find((w) => w.id === wid)?.name ?? "A removed workflow"}
              <button
                type="button"
                aria-label={`Remove ${workflows.find((w) => w.id === wid)?.name ?? "workflow"}`}
                onClick={() => onChange(value.filter((x) => x !== wid))}
                className="text-muted hover:text-bad h-4 w-4 rounded-full border-0 bg-transparent p-0 leading-none"
              >
                ×
              </button>
            </span>
          ))}
          {workflows.some((w) => !value.includes(w.id)) ? (
            <select
              aria-label={`Add to ${label}`}
              value=""
              onChange={(e) => e.target.value && onChange([...value, e.target.value])}
              className="border-field text-ink-2 h-8 max-w-full rounded-lg border bg-white px-2 text-[12.5px] font-semibold"
            >
              <option value="">+ Add workflow</option>
              {workflows
                .filter((w) => !value.includes(w.id))
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
            </select>
          ) : null}
          {value.length === 0 ? <span className="text-faint text-[12px]">Choose one or more.</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Tags as chips, added by typing (Enter or comma) — the ones in use elsewhere offered. */
function TagInput({ value, suggestions, onChange }: { value: string[]; suggestions: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const tag = raw.trim().replace(/,$/, "").trim().slice(0, 40);
    if (tag && !value.some((t) => t.toLowerCase() === tag.toLowerCase())) onChange([...value, tag]);
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Tags">
      {value.map((t) => (
        <span key={t} className="bg-chip text-ink-2 flex items-center gap-1.5 rounded-full py-1 pr-1.5 pl-2.5 text-xs font-semibold">
          {t}
          <button type="button" aria-label={`Remove tag ${t}`} onClick={() => onChange(value.filter((x) => x !== t))} className="text-muted hover:text-bad h-4 w-4 rounded-full border-0 bg-transparent p-0 leading-none">
            ×
          </button>
        </span>
      ))}
      <input
        aria-label="Add a tag"
        value={draft}
        list="product-tags"
        placeholder={value.length ? "Add another…" : "Add a tag, e.g. Maxillofacial"}
        onChange={(e) => (e.target.value.endsWith(",") ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          }
        }}
        onBlur={() => draft.trim() && add(draft)}
        className="border-field h-8 min-w-[180px] rounded-lg border bg-white px-2.5 text-[12.5px]"
      />
      <datalist id="product-tags">
        {suggestions.filter((t) => !value.includes(t)).map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </div>
  );
}
