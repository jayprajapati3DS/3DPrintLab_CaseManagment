"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ArchiveButton } from "@/components/setup/archive-button";
import { Row, SectionHead, StageBoard } from "@/components/setup/stage-board";
import { S_BTN_PRIMARY, S_INPUT } from "@/components/setup/ui";
import { saveWorkflowAction, type ActionResult } from "@/lib/resources/actions";
import { KINDS, NEW_ID, type WorkflowStage } from "@/lib/resources/config";


export function WorkflowEditor({
  id,
  initialName,
  initialMethod,
  initialStages,
  technologies,
  forms,
  roles,
  canEdit,
  sites = [],
  initialSourcing = "In-house",
  initialSiteIds = [],
  initialSiteId = "",
}: {
  id: string;
  initialName: string;
  initialMethod: string;
  /** Manufacturing Sites — where it can run. */
  sites?: Array<{ id: string; name: string; type: string }>;
  initialSourcing?: "In-house" | "Outsourced";
  initialSiteIds?: string[];
  initialSiteId?: string;
  initialStages: WorkflowStage[];
  technologies: string[];
  /** The space's QA forms, as stages list them: "Final Inspection (QMS-FI-03)". */
  forms: string[];
  /** The roles people hold: Space Admin, Member and the platform roles. */
  roles: string[];
  canEdit: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [method, setMethod] = useState(initialMethod);
  const [sourcing, setSourcing] = useState(initialSourcing);
  const [siteIds, setSiteIds] = useState(initialSiteIds);
  const [siteId, setSiteId] = useState(initialSiteId);
  // The sites that fit how it is made: vendors' sites for outsourced, the rest for in-house.
  const fitting = sites.filter((x) => (x.type === "External vendor") === (sourcing === "Outsourced"));
  // The default is one of those chosen — or, with none chosen, any that fits.
  const defaultChoices = siteIds.length ? fitting.filter((x) => siteIds.includes(x.id)) : fitting;
  const [stages, setStages] = useState(initialStages);
  // Not saved yet when opened from "Add": there is something to save from the start.
  const [dirty, setDirty] = useState(id === NEW_ID);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [saving, startTransition] = useTransition();
  const router = useRouter();

  const touch = () => {
    setDirty(true);
    setResult(null);
  };

  function save() {
    startTransition(async () => {
      const saved = await saveWorkflowAction(id, { name, method, stages, sourcing, siteIds, siteId });
      setResult(saved);
      if (saved.ok) setDirty(false);
      // A new workflow exists from its first save: carry on editing it there.
      if (saved.ok && saved.createdId) router.replace(`${KINDS.workflows.route}/${saved.createdId}`);
    });
  }

  return (
    <div className="flex flex-col gap-4 pb-20">
      <section className="border-line overflow-hidden rounded-[14px] border bg-white" aria-label="Workflow">
        <div className="border-line-2 flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-[22px]">
          <h2 className="m-0 min-w-[160px] flex-1 truncate text-[15px] font-bold">{name || "New workflow"}</h2>
          {canEdit && id !== NEW_ID ? <ArchiveButton resourceId={id} name={initialName || "New workflow"} label="Archive workflow" /> : null}
        </div>
        <SectionHead title="Details" />
        <Row label="Workflow name">
          <input
            aria-label="Workflow name"
            value={name}
            disabled={!canEdit}
            onChange={(e) => {
              setName(e.target.value);
              touch();
            }}
            className={`${S_INPUT} h-9 w-full max-w-[520px] font-semibold`}
          />
        </Row>
        <Row label="Manufacturing method" hint="The technology its parts are made with.">
          <select
            aria-label="Manufacturing method"
            value={method}
            disabled={!canEdit}
            onChange={(e) => {
              setMethod(e.target.value);
              touch();
            }}
            className={`${S_INPUT} h-9 w-[280px]! max-w-full`}
          >
            {!technologies.includes(method) ? <option value={method}>{method || "— select —"}</option> : null}
            {technologies.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Row>
        <Row label="Made" hint="In-house, or outsourced to a vendor — a part request asks this first, then the site, and offers the workflows that fit.">
          <span className="flex flex-wrap gap-2" role="radiogroup" aria-label="Made">
            {(
              [
                ["In-house", "In-house", "Made in this site's own facility."],
                ["Outsourced", "Outsourced", "Made by a vendor from Suppliers & Vendors; received back through goods receipt."],
              ] as const
            ).map(([value, title, detail]) => {
              const on = sourcing === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!canEdit}
                  onClick={() => {
                    // The sites chosen were for the other way of making it.
                    if (value !== sourcing) {
                      setSiteIds([]);
                      setSiteId("");
                    }
                    setSourcing(value);
                    touch();
                  }}
                  className={"flex max-w-[300px] items-start gap-2 rounded-lg border px-2.5 py-2 text-left " + (on ? "border-brand-edge bg-brand-wash" : "border-line bg-white")}
                >
                  <span className={"mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full border-2 " + (on ? "border-brand" : "border-field")} aria-hidden="true">
                    {on ? <span className="bg-brand h-1.5 w-1.5 rounded-full" /> : null}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-ink text-[12.5px] font-semibold">{title}</span>
                    <span className="text-muted text-[12px]">{detail}</span>
                  </span>
                </button>
              );
            })}
          </span>
        </Row>
        <Row label="Manufacturing sites" hint={sourcing === "Outsourced" ? "The vendors' sites its parts may be made at. None chosen: any vendor's site." : "The sites its parts may be made at. None chosen: any in-house or partner site."}>
          <span className="flex flex-wrap gap-1.5" role="group" aria-label="Manufacturing sites">
            {fitting.length === 0 ? (
              <span className="text-warn text-[12.5px]">{sourcing === "Outsourced" ? "No vendor sites yet" : "No in-house or partner sites yet"} — add them under Manufacturing Sites.</span>
            ) : null}
            {fitting.map((x) => {
              const on = siteIds.includes(x.id);
              return (
                <button
                  key={x.id}
                  type="button"
                  aria-pressed={on}
                  disabled={!canEdit}
                  onClick={() => {
                    setSiteIds(on ? siteIds.filter((v) => v !== x.id) : [...siteIds, x.id]);
                    if (on && siteId === x.id) setSiteId("");
                    touch();
                  }}
                  className={"h-8 rounded-full border px-3 text-[12.5px] font-semibold " + (on ? "border-brand bg-brand-wash text-brand-ink" : "border-field text-ink-2 bg-white")}
                >
                  {on ? "✓ " : ""}
                  {x.name}
                  <span className="text-muted ml-1 font-normal">· {x.type}</span>
                </button>
              );
            })}
          </span>
        </Row>
        <Row label="Default site" hint="Chosen first on a part request — it can be changed there. An outsourced part's vendor is the site's.">
          <select
            aria-label="Default site"
            value={siteId}
            disabled={!canEdit}
            onChange={(e) => {
              setSiteId(e.target.value);
              touch();
            }}
            className={`${S_INPUT} h-9 w-[320px]! max-w-full`}
          >
            <option value="">No default</option>
            {defaultChoices.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </Row>
      </section>

      <StageBoard
        stages={stages}
        onChange={(next) => {
          setStages(next);
          touch();
        }}
        canEdit={canEdit}
        forms={forms}
        roles={roles}
        noun="part"
        title="Status stages"
        hint="The stages a part goes through, in order. Choose a stage on the left — drag to reorder — and set its forms, tasks, emails, time and owner on the right."
      />

      {canEdit ? (
        <div className="border-line shadow-popover fixed right-3 bottom-4 z-10 flex max-w-[calc(100vw-24px)] items-center gap-3 rounded-full border bg-white py-2 pr-2 pl-4 sm:right-10 sm:bottom-6">
          <span
            role="status"
            className={
              "text-[12.5px] " +
              (result && !result.ok ? "text-bad" : dirty ? "text-warn font-semibold" : "text-muted")
            }
          >
            {result && !result.ok
              ? result.message
              : dirty
                ? "Unsaved changes"
                : result?.ok
                  ? "Workflow saved."
                  : "No changes to save."}
          </span>
          <button type="button" onClick={save} disabled={!dirty || saving} className={`${S_BTN_PRIMARY} rounded-full`}>
            {saving ? "Saving…" : "Save workflow"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Roles as chips to switch on and off, kept as a comma-separated list. A
 * name no longer among the space's roles (an older fixed label) still shows,
 * so it can be removed.
 */
export function RoleChips({ label, value, roles, onChange }: { label: string; value: string; roles: string[]; onChange: (value: string) => void }) {
  const chosen = value.split(",").map((r) => r.trim()).filter(Boolean);
  const all = [...roles, ...chosen.filter((c) => !roles.some((r) => r.toLowerCase() === c.toLowerCase()))];
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {all.map((role) => {
        const on = chosen.some((c) => c.toLowerCase() === role.toLowerCase());
        const known = roles.includes(role);
        return (
          <button
            key={role}
            type="button"
            aria-pressed={on}
            title={known ? undefined : "No longer one of this space's roles"}
            onClick={() => onChange((on ? chosen.filter((c) => c.toLowerCase() !== role.toLowerCase()) : [...chosen, role]).join(", "))}
            className={
              "rounded-full border px-2.5 py-1 text-xs font-semibold " +
              (on ? "border-brand-edge bg-brand-wash text-brand-ink" : "border-field text-ink-2 bg-white") +
              (known ? "" : " line-through decoration-1")
            }
          >
            {role}
          </button>
        );
      })}
    </div>
  );
}

export function Picker({
  title,
  hint,
  values,
  options,
  addLabel,
  onChange,
  small = false,
}: {
  title: string;
  hint?: string;
  values: string[];
  options: readonly string[];
  addLabel: string;
  onChange: (values: string[]) => void;
  small?: boolean;
}) {
  const remaining = options.filter((o) => !values.includes(o));
  return (
    <div className="flex flex-col gap-2">
      {small ? <span className="text-ink-2 text-[12.5px] font-semibold">{title}</span> : <Heading title={title} hint={hint} />}
      <div className="flex flex-wrap items-center gap-1.5">
        {values.map((v) => (
          <span key={v} className="bg-chip text-ink-2 flex items-center gap-1.5 rounded-full py-1 pr-1.5 pl-2.5 text-xs font-semibold">
            {v}
            <button
              type="button"
              aria-label={`Remove ${v}`}
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="text-muted hover:text-bad h-4 w-4 rounded-full border-0 bg-transparent p-0 leading-none"
            >
              ×
            </button>
          </span>
        ))}
        {remaining.length > 0 ? (
          <select
            value=""
            aria-label={addLabel}
            onChange={(e) => e.target.value && onChange([...values, e.target.value])}
            className="border-field text-ink-2 h-8 rounded-lg border bg-white px-2 text-[12.5px] font-semibold"
          >
            <option value="">{addLabel}</option>
            {remaining.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        ) : null}
      </div>
    </div>
  );
}

export function Heading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[13px] font-bold">{title}</span>
      {hint ? <span className="text-muted text-[12.5px]">{hint}</span> : null}
    </div>
  );
}




export function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
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
      className="border-field text-ink-3 flex h-8 w-8 items-center justify-center rounded-lg border bg-white text-[11px] disabled:opacity-40"
    >
      {children}
    </button>
  );
}
