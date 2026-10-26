"use client";

import { useState } from "react";

import { S_INPUT } from "@/components/setup/ui";
import { IconButton, RoleChips } from "@/components/setup/workflow-editor";
import { STAGE_EMAILS, type StageViewer, type WorkflowStage } from "@/lib/resources/config";

/**
 * Stages — of a case or of a part's workflow — configured one at a time: the
 * stages down the left (click one, drag to reorder) and the chosen stage on
 * the right as one compact settings sheet in sections (Viewer buttons first,
 * then General, Forms, Tasks, Emails) — a row per setting, its name on the left and its
 * control on the right.
 */

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function StageBoard({
  stages,
  onChange,
  canEdit,
  forms,
  roles,
  title,
  hint,
  viewers = [],
  noun = "case",
}: {
  stages: WorkflowStage[];
  onChange: (stages: WorkflowStage[]) => void;
  canEdit: boolean;
  /** QA forms, as stages list them. */
  forms: string[];
  roles: string[];
  title: string;
  hint: string;
  /** The viewers associated, whose buttons each stage shows or not. */
  viewers?: Array<{ id: string; name: string }>;
  /** What moves through the stages: "case" or "part". */
  noun?: "case" | "part";
}) {
  const [selectedId, setSelectedId] = useState<string | null>(stages[0]?.id ?? null);
  const [dragging, setDragging] = useState<number | null>(null);
  const index = Math.max(0, stages.findIndex((s) => s.id === selectedId));
  const stage = stages[index] ?? null;

  const update = (patch: Partial<WorkflowStage>) => stage && onChange(stages.map((s) => (s.id === stage.id ? { ...s, ...patch } : s)));
  const moveTo = (from: number, to: number) => {
    if (to < 0 || to >= stages.length || from === to) return;
    const next = [...stages];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };
  function addStage() {
    const fresh: WorkflowStage = {
      id: uid(),
      name: "New stage",
      role: noun === "part" ? "Manufacturing" : "",
      days: 1,
      forms: [],
      // A part's stage holds it until its forms are approved, as before; a case's does not.
      ...(noun === "part" ? {} : { formsRequired: false }),
      emailsNext: [],
      emailsBack: [],
      tasks: [],
      // A new stage shows the associated viewers to everyone, as the others start.
      viewers: viewers.map((v) => ({ viewerId: v.id, roles: "" })),
    };
    // Before the last stage ("Case completed", dispatch…) when there is one.
    const at = stages.length > 1 ? stages.length - 1 : stages.length;
    onChange([...stages.slice(0, at), fresh, ...stages.slice(at)]);
    setSelectedId(fresh.id);
  }
  function removeStage() {
    if (!stage || stages.length <= 1) return;
    const rest = stages.filter((s) => s.id !== stage.id);
    onChange(rest);
    setSelectedId(rest[Math.min(index, rest.length - 1)]?.id ?? null);
  }

  const shownViewers = (s: WorkflowStage) => (s.viewers ?? []).filter((v) => viewers.some((x) => x.id === v.viewerId));
  return (
    <section className="border-line flex flex-col gap-3.5 rounded-[14px] border bg-white px-4 py-[18px] sm:px-[22px]" aria-label={title}>
      <div className="flex flex-col gap-0.5">
        <h3 className="m-0 text-sm font-bold">{title}</h3>
        <p className="text-muted m-0 text-[12.5px] leading-[1.5]">{hint}</p>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[290px_minmax(0,1fr)]">
        {/* The stages */}
        <div className="flex flex-col gap-2">
          <ol className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="Stages">
            {stages.map((s, i) => {
              const on = s.id === stage?.id;
              const facts = [
                s.forms.length ? plural(s.forms.length, "form") : null,
                shownViewers(s).length ? plural(shownViewers(s).length, "viewer") : null,
                s.days !== null ? `${s.days}d` : null,
                s.lockInfo ? (s.lockInfo === "onward" ? "locked from here" : "locked") : null,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <li
                  key={s.id}
                  draggable={canEdit}
                  onDragStart={() => setDragging(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragging !== null) moveTo(dragging, i);
                    setDragging(null);
                  }}
                  onDragEnd={() => setDragging(null)}
                  className={dragging === i ? "opacity-40" : ""}
                >
                  <button
                    type="button"
                    aria-current={on ? "step" : undefined}
                    onClick={() => setSelectedId(s.id)}
                    className={
                      "flex w-full items-center gap-2.5 rounded-[10px] border px-2.5 py-2 text-left " +
                      (on ? "border-brand bg-brand-wash" : "border-line hover:border-field bg-white")
                    }
                  >
                    {canEdit ? (
                      <span className="text-faint cursor-grab text-[13px] leading-none select-none" aria-hidden="true" title="Drag to reorder">
                        ⋮⋮
                      </span>
                    ) : null}
                    <span
                      className={
                        "flex h-6 w-6 flex-none items-center justify-center rounded-full text-[11.5px] font-bold " + (on ? "bg-brand text-white" : "bg-brand-tint text-brand-ink")
                      }
                    >
                      {i + 1}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-ink truncate text-[13px] font-semibold">{s.name || "Untitled stage"}</span>
                      <span className="text-muted truncate text-[11.5px]">{facts || "Nothing set yet"}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          {canEdit ? (
            <button type="button" onClick={addStage} disabled={stages.length >= 40} className="border-field text-ink-2 h-9 rounded-[10px] border border-dashed bg-white text-[12.5px] font-semibold">
              + Add stage
            </button>
          ) : null}
        </div>

        {/* The chosen stage */}
        {stage ? (
          <div className="border-line flex min-w-0 flex-col rounded-[12px] border" data-testid="stage-panel">
            <div className="border-line-2 flex flex-wrap items-center gap-2 border-b px-3.5 py-3">
              <span className="bg-brand flex h-7 w-7 flex-none items-center justify-center rounded-full text-[12px] font-bold text-white">{index + 1}</span>
              <input
                aria-label="Stage name"
                value={stage.name}
                disabled={!canEdit}
                onChange={(e) => update({ name: e.target.value })}
                className={`${S_INPUT} h-9 min-w-[160px] flex-1 font-semibold`}
              />
              {canEdit ? (
                <span className="flex flex-none gap-1.5">
                  <IconButton label="Move up" disabled={index === 0} onClick={() => moveTo(index, index - 1)}>
                    ▲
                  </IconButton>
                  <IconButton label="Move down" disabled={index === stages.length - 1} onClick={() => moveTo(index, index + 1)}>
                    ▼
                  </IconButton>
                  <IconButton label="Remove stage" disabled={stages.length <= 1} onClick={removeStage}>
                    ×
                  </IconButton>
                </span>
              ) : null}
            </div>

            <fieldset disabled={!canEdit} className="m-0 flex min-w-0 flex-col border-0 p-0">
              {viewers.length ? (
                <>
                <SectionHead title="Viewer buttons" />
                <Row label="Buttons" hint="Shown at this stage, and to whom.">
                  <ViewerTable
                    stage={stage}
                    viewers={viewers}
                    roles={roles}
                    onChange={(next) => update({ viewers: next })}
                    onApplyToAll={(viewerId) => {
                      const entry = (stage.viewers ?? []).find((v) => v.viewerId === viewerId) ?? null;
                      onChange(
                        stages.map((st) => {
                          const others = (st.viewers ?? []).filter((v) => v.viewerId !== viewerId);
                          return { ...st, viewers: entry ? [...others, { ...entry }] : others };
                        }),
                      );
                    }}
                  />
                </Row>
                </>
              ) : null}
              <SectionHead title="General" />
              <Row label="Expected time" hint={`Drives the ${noun} due date.`}>
                <span className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={stage.days ?? ""}
                    aria-label="Expected working days"
                    onChange={(e) => update({ days: e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0) })}
                    className={`${S_INPUT} h-8 w-[80px]! font-mono`}
                  />
                  <span className="text-muted text-[12.5px]">working days</span>
                </span>
              </Row>
              <Row label="Stage owner" hint="None: assign a person later.">
                <RoleChips label="Stage owner roles" value={stage.role} roles={roles} onChange={(role) => update({ role })} />
              </Row>
              <Row label="Lock information" hint={`Stop the ${noun} information being changed.`}>
                <div className="flex flex-col gap-2">
                  <span className="flex flex-col gap-1.5" role="radiogroup" aria-label="Lock information">
                    {(
                      [
                        [undefined, "Not locked", `The ${noun} information can be changed at this status.`],
                        ["stage", "Locked at this status", `Not changeable while the ${noun} is at this status; changeable again after it.`],
                        ["onward", "Locked from this status on", `Not changeable from this status to the last.`],
                      ] as const
                    ).map(([value, title, detail]) => {
                      const on = stage.lockInfo === value;
                      return (
                        <button
                          key={title}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => update({ lockInfo: value, ...(value ? {} : { lockRoles: "" }) })}
                          className={"flex items-start gap-2 rounded-lg border px-2.5 py-2 text-left " + (on ? "border-brand-edge bg-brand-wash" : "border-line bg-white")}
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
                  {stage.lockInfo ? (
                    <span className="flex flex-col gap-1">
                      <span className="text-ink-3 text-[12px] font-semibold">Locked for</span>
                      <RoleChips label="Locked for roles" value={stage.lockRoles ?? ""} roles={roles} onChange={(lockRoles) => update({ lockRoles })} />
                      <span className="text-muted text-[12px]">{(stage.lockRoles ?? "").trim() ? `Only these roles are locked out; others can still change it.` : `No role chosen — locked for everyone.`}</span>
                    </span>
                  ) : null}
                </div>
              </Row>
              <SectionHead title="Forms" />
              <Row label="Quality forms" hint="Completed at this stage.">
                <ChipSelect label="Quality forms" values={stage.forms} options={forms} addLabel="+ Add form" onChange={(f) => update({ forms: f })} />
              </Row>
              <Row label="Moving on" hint={`When the ${noun} may go to the next stage.`}>
                <span className="flex items-center gap-2.5">
                  <Switch on={stage.formsRequired !== false} label="Forms must be approved to move on" onToggle={() => update({ formsRequired: stage.formsRequired === false })} />
                  <span className="text-ink-2 text-[12.5px]">
                    {stage.formsRequired !== false
                      ? `On — a ${noun} cannot move to the next stage until every quality form of this stage is approved.`
                      : `Off — a ${noun} can move on before this stage's forms are approved; they stay on the ${noun} to complete and approve later.`}
                  </span>
                </span>
              </Row>
              {noun === "case" ? (
                <Row label="Filling" hint="When this status's forms can be filled.">
                  <span className="flex flex-col gap-1.5" role="radiogroup" aria-label="When its forms can be filled">
                    {(
                      [
                        ["stage", "Only while the case is at this status", "Before and after it the forms can be viewed and printed, not filled."],
                        ["anytime", "Any time", "From the moment the case is opened, whatever its status."],
                      ] as const
                    ).map(([value, title, detail]) => {
                      const on = (stage.formsFill ?? "stage") === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => update({ formsFill: value })}
                          className={"flex items-start gap-2 rounded-lg border px-2.5 py-2 text-left " + (on ? "border-brand-edge bg-brand-wash" : "border-line bg-white")}
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
              ) : null}
              {stage.forms.length > 1 ? (
                <Row label="Filling order" hint="With more than one form: whether they are filled in any order.">
                  <span className="flex flex-col gap-1.5" role="radiogroup" aria-label="Filling order">
                    {(
                      [
                        ["any", "Any order", "Every form of this stage can be filled at once."],
                        ["sequence", "In sequence", "Each form opens once the one before it (in the order listed above) is submitted."],
                      ] as const
                    ).map(([value, title, detail]) => {
                      const on = (stage.formsOrder ?? "any") === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => update({ formsOrder: value })}
                          className={"flex items-start gap-2 rounded-lg border px-2.5 py-2 text-left " + (on ? "border-brand-edge bg-brand-wash" : "border-line bg-white")}
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
                    {stage.formsOrder === "sequence" ? (
                      <ol className="text-ink-2 m-0 mt-1 flex flex-col gap-0.5 pl-5 text-[12px]" aria-label="Form sequence">
                        {stage.forms.map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ol>
                    ) : null}
                  </span>
                </Row>
              ) : null}
              {stage.formsRequired !== false && stage.forms.length > 1 ? (
                <Row label="Optional forms" hint="Of this stage's forms, the ones that need not be approved to move on.">
                  <ChipSelect
                    label="Optional forms"
                    values={(stage.optionalForms ?? []).filter((f) => stage.forms.includes(f))}
                    options={stage.forms}
                    addLabel="+ Mark optional"
                    onChange={(f) => update({ optionalForms: f })}
                  />
                </Row>
              ) : null}
              <Row label="Approves forms" hint="None: anyone in the space.">
                <RoleChips label="Approver roles" value={stage.approvers ?? ""} roles={roles} onChange={(approvers) => update({ approvers })} />
              </Row>
              <SectionHead title="Tasks" />
              <Row label="Task list" hint={`Created when a ${noun} reaches this stage; days from stage start.`}>
                <div className="flex flex-col gap-1.5">
                  {stage.tasks.map((task, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-muted w-4 text-right text-[12px]">{i + 1}.</span>
                      <input
                        value={task.name}
                        aria-label={`Task ${i + 1} name`}
                        placeholder="Task name"
                        onChange={(e) => update({ tasks: stage.tasks.map((t, j) => (j === i ? { ...t, name: e.target.value } : t)) })}
                        className={`${S_INPUT} h-8 min-w-0 flex-1`}
                      />
                      <input
                        type="number"
                        min={0}
                        max={365}
                        value={task.days}
                        aria-label={`Task ${i + 1} due offset in days`}
                        onChange={(e) => update({ tasks: stage.tasks.map((t, j) => (j === i ? { ...t, days: Math.max(0, Number(e.target.value) || 0) } : t)) })}
                        className={`${S_INPUT} h-8 w-[64px]! font-mono`}
                      />
                      <span className="text-muted text-[12px]">d</span>
                      <IconButton label={`Remove task ${i + 1}`} onClick={() => update({ tasks: stage.tasks.filter((_, j) => j !== i) })}>
                        ×
                      </IconButton>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => update({ tasks: [...stage.tasks, { name: "", days: 1 }] })}
                    className="text-brand-ink self-start border-0 bg-transparent p-0 text-[12.5px] font-semibold"
                  >
                    + Add task
                  </button>
                </div>
              </Row>
              <SectionHead title="Emails" />
              <Row label="Send emails" hint={`Sent when the ${noun} moves on or back.`}>
                <div className="flex flex-col gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-ink-3 w-[92px] text-[12px] font-semibold">→ Moving on</span>
                    <ChipSelect label="Emails on moving on" values={stage.emailsNext} options={STAGE_EMAILS} addLabel="+ Add email" onChange={(emailsNext) => update({ emailsNext })} />
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-ink-3 w-[92px] text-[12px] font-semibold">← Moving back</span>
                    <ChipSelect label="Emails on moving back" values={stage.emailsBack} options={STAGE_EMAILS} addLabel="+ Add email" onChange={(emailsBack) => update({ emailsBack })} />
                  </span>
                </div>
              </Row>
            </fieldset>
          </div>
        ) : (
          <div className="border-field text-muted rounded-[12px] border border-dashed p-6 text-center text-[13px]">Add a stage to configure it.</div>
        )}
      </div>
    </section>
  );
}

/** Each associated viewer: shown at this stage or not, and to whom. */
function ViewerTable({
  stage,
  viewers,
  roles,
  onChange,
  onApplyToAll,
}: {
  stage: WorkflowStage;
  viewers: Array<{ id: string; name: string }>;
  roles: string[];
  onChange: (viewers: StageViewer[]) => void;
  onApplyToAll: (viewerId: string) => void;
}) {
  const list = stage.viewers ?? [];
  const set = (viewerId: string, entry: { roles: string } | null) =>
    onChange(entry ? [...list.filter((v) => v.viewerId !== viewerId), { viewerId, roles: entry.roles }] : list.filter((v) => v.viewerId !== viewerId));
  return (
    <div className="flex flex-col gap-2">
      <div className="border-line overflow-hidden rounded-[10px] border">
        {viewers.map((v, i) => {
          const entry = list.find((x) => x.viewerId === v.id);
          return (
            <div key={v.id} className={"flex flex-col gap-2 px-3 py-2.5 " + (i ? "border-line-2 border-t" : "")}>
              <div className="flex flex-wrap items-center gap-2.5">
                <Switch on={Boolean(entry)} label={`Show ${v.name} at this stage`} onToggle={() => set(v.id, entry ? null : { roles: "" })} />
                <span className="text-ink min-w-[120px] flex-1 text-[13px] font-semibold">{v.name}</span>
                <button
                  type="button"
                  onClick={() => onApplyToAll(v.id)}
                  title="Use this setting at every stage"
                  className="text-brand-ink border-0 bg-transparent p-0 text-[12px] font-semibold underline"
                >
                  Apply to all stages
                </button>
              </div>
              {entry ? (
                <div className="flex flex-wrap items-center gap-1.5 pl-[48px]">
                  <span className="text-muted mr-1 text-[12px]">Shown to</span>
                  <button
                    type="button"
                    aria-pressed={!entry.roles}
                    onClick={() => set(v.id, { roles: "" })}
                    className={"rounded-full border px-2.5 py-1 text-xs font-semibold " + (!entry.roles ? "border-brand-edge bg-brand-wash text-brand-ink" : "border-field text-ink-2 bg-white")}
                  >
                    Everyone
                  </button>
                  <RoleChips label={`${v.name} roles`} value={entry.roles} roles={roles} onChange={(r) => set(v.id, { roles: r })} />
                </div>
              ) : (
                <span className="text-faint pl-[48px] text-[12px]">Not shown at this stage.</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={"relative h-[22px] w-[38px] flex-none rounded-full border-0 p-0 " + (on ? "bg-brand" : "bg-field")}
    >
      <span className="absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.2)] transition-[left]" style={{ left: on ? 18 : 2 }} />
    </button>
  );
}

/** A group of the sheet's settings: Viewer buttons, General, Forms, Tasks, Emails. */
export function SectionHead({ title }: { title: string }) {
  return (
    <div className="bg-subtle border-line-2 text-brand-ink border-b px-3.5 py-1.5 text-[11px] font-bold tracking-[0.8px] uppercase" role="heading" aria-level={4}>
      {title}
    </div>
  );
}

/** One setting of the sheet: its name (and a short hint) on the left, its control on the right. */
export function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="border-line-2 grid grid-cols-1 gap-1.5 border-b px-3.5 py-3 last:border-b-0 md:grid-cols-[170px_minmax(0,1fr)] md:gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-ink text-[12.5px] font-bold">{label}</span>
        {hint ? <span className="text-muted text-[11.5px] leading-[1.4]">{hint}</span> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Chosen values as chips, and a dropdown to add one more. */
export function ChipSelect({
  label,
  values,
  options,
  addLabel,
  onChange,
}: {
  label: string;
  values: string[];
  options: readonly string[];
  addLabel: string;
  onChange: (values: string[]) => void;
}) {
  const remaining = options.filter((o) => !values.includes(o));
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      {values.map((v) => (
        <span key={v} className="bg-chip text-ink-2 flex items-center gap-1.5 rounded-full py-1 pr-1.5 pl-2.5 text-xs font-semibold">
          {v}
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="text-muted hover:text-bad h-4 w-4 rounded-full border-0 bg-transparent p-0 leading-none">
            ×
          </button>
        </span>
      ))}
      {remaining.length ? (
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
      ) : values.length === 0 ? (
        <span className="text-faint text-[12px]">None available</span>
      ) : null}
    </div>
  );
}
