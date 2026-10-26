"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useToast } from "@/components/ui/toast";
import {
  addPartFiles,
  addPartLink,
  assignPart,
  movePart,
  removePartFile,
  removePartLink,
  setPartImageSize,
  updatePartField,
  updatePartStage,
  type PartActionResult,
} from "@/lib/parts/actions";
import type { RequestOptions } from "@/lib/parts/queries";
import { IMAGE_SIZE_LABELS, IMAGE_SIZES, linkLabel, PRIORITIES, SOURCING, type ImageSize } from "@/lib/parts/request-form";

/** How large a request image is shown here, on the part's QA forms and their print. */
export function ImageSizePicker({ fileId, label, value }: { fileId: string; label: string; value: ImageSize }) {
  const { run, pending, node } = useRun();
  return (
    <label className="text-muted flex items-center gap-1.5 text-[12px]">
      Display size
      <select
        aria-label={`${label} display size`}
        value={value}
        disabled={pending}
        onChange={(e) => run(() => setPartImageSize(fileId, e.target.value))}
        className="border-field text-ink h-7 rounded-md border bg-white px-1.5 text-[12px] disabled:opacity-60"
      >
        {IMAGE_SIZES.map((size) => (
          <option key={size} value={size}>
            {IMAGE_SIZE_LABELS[size]}
          </option>
        ))}
      </select>
      {node}
    </label>
  );
}

/** Run an action, say what happened, and show the part as it now is. */
function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { toast, node } = useToast();

  function run(action: () => Promise<PartActionResult>, done?: string) {
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          toast(result.message ?? "That did not work. Try again.", true);
          return;
        }
        const message = result.message ?? done;
        if (message) toast(message);
        router.refresh();
      } catch {
        toast("The request did not reach the server. Check the connection and try again.", true);
      }
    });
  }

  return { run, pending, node, toast };
}

// --- Owner and stage movement ------------------------------------------------------------

export function MoveBar({
  partId,
  assigneeName,
  mine,
  prevName,
  nextName,
  noWorkflow = false,
}: {
  partId: string;
  /** Without a workflow there are no stages to move between. */
  noWorkflow?: boolean;
  assigneeName: string | null;
  mine: boolean;
  prevName: string | null;
  nextName: string | null;
}) {
  const { run, pending, node } = useRun();
  return (
    <>
      <div className="border-line-3 flex flex-wrap items-center gap-x-3 gap-y-2.5 border-t pt-3.5">
        <span className="text-muted text-[11px] font-semibold tracking-[0.7px]">ASSIGNED TO</span>
        <span className={"text-[13.5px] font-semibold " + (assigneeName ? "text-ink" : "text-faint")}>
          {assigneeName ?? "Unassigned"}
        </span>
        {mine ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => assignPart(partId, null))}
            className="border-line text-ink-3 h-[34px] rounded-lg border bg-white px-3 text-[12.5px] font-semibold disabled:opacity-60"
          >
            Unassign
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => assignPart(partId, "me"))}
            className="border-brand-edge bg-brand-wash text-brand-ink h-[34px] rounded-lg border px-3 text-[12.5px] font-semibold disabled:opacity-60"
          >
            Assign to me
          </button>
        )}
        <div className="hidden flex-1 sm:block" />
        {noWorkflow ? null : (
          <div className="flex w-full gap-2.5 sm:w-auto">
            <button
              type="button"
              disabled={!mine || !prevName || pending}
              onClick={() => run(() => movePart(partId, -1))}
              className="border-field text-ink-2 h-[38px] min-w-0 flex-1 truncate rounded-[9px] border bg-white px-3.5 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
            >
              ← {prevName ? `Back: ${prevName}` : "Back"}
            </button>
            <button
              type="button"
              disabled={!mine || !nextName || pending}
              onClick={() => run(() => movePart(partId, 1))}
              className="bg-brand disabled:bg-field h-[38px] min-w-0 flex-1 truncate rounded-[9px] border-0 px-3.5 text-[13px] font-semibold text-white disabled:cursor-not-allowed sm:flex-none"
            >
              {nextName ? `Next: ${nextName}` : "Completed"} →
            </button>
          </div>
        )}
      </div>
      {!mine && !noWorkflow ? <div className="text-muted -mt-1.5 text-xs">Assign this part to yourself to move its stage.</div> : null}
      {node}
    </>
  );
}

// --- Choosing a workflow for a part that has none ------------------------------------------

/**
 * A part requested without a workflow: choosing one gives it its stages (the
 * status map) and the quality forms those stages call for.
 */
export function ChooseWorkflow({ partId, options }: { partId: string; options: RequestOptions["workflows"] }) {
  const { run, pending, node } = useRun();
  const [choice, setChoice] = useState("");
  const picked = options.find((w) => w.id === choice);
  return (
    <div className="border-brand-edge bg-brand-wash flex flex-col gap-2.5 rounded-[10px] border border-dashed px-3.5 py-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-ink text-[13.5px] font-bold">No production workflow yet</span>
        <span className="text-ink-3 text-[12.5px]">
          Choose how this part is made. Its stages and their quality forms are created from the workflow, and it starts at the first stage.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Production workflow"
          value={choice}
          disabled={pending}
          onChange={(e) => setChoice(e.target.value)}
          className="border-field text-ink h-[38px] min-w-0 flex-1 rounded-[9px] border bg-white px-2.5 text-[13.5px] sm:max-w-[420px]"
        >
          <option value="">Choose a workflow…</option>
          {options.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} · {w.sourcing} · {w.stages} stages
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!picked || pending}
          onClick={() => picked && run(() => updatePartField(partId, "workflow", picked.id))}
          className="bg-brand disabled:bg-field h-[38px] rounded-[9px] border-0 px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed"
        >
          Set workflow
        </button>
      </div>
      {options.length === 0 ? (
        <span className="text-warn text-[11.5px]">No workflows with stages yet — add one in Manufacturing Workflow Setup.</span>
      ) : null}
      {node}
    </div>
  );
}

// --- Production details (edit mode) ---------------------------------------------------------

const FIELD_LABEL = "text-muted flex flex-col gap-1.5 text-[10.5px] font-semibold tracking-[0.6px]";
const FIELD_CONTROL =
  "border-field text-ink h-10 w-full min-w-0 rounded-[9px] border bg-white px-2.5 text-[13.5px] font-normal tracking-normal disabled:opacity-60";

export interface EditablePart {
  id: string;
  workflowId: string | null;
  workflowName: string;
  partType: string | null;
  technology: string | null;
  sourcing: string;
  vendor: string | null;
  assigneeId: string | null;
  due: string | null;
  printer: string | null;
  material: string | null;
  priority: string | null;
  notes: string | null;
  links: string[];
  files: Array<{ id: string; name: string; size: number }>;
}

/** Offer the saved value even when it has since left the master data. */
function withCurrent(options: string[], current: string | null): string[] {
  return current && !options.includes(current) ? [current, ...options] : options;
}

export function PartEdit({
  part,
  options,
  people,
}: {
  part: EditablePart;
  options: RequestOptions;
  people: Array<{ id: string; name: string }>;
}) {
  const { run, pending, node, toast } = useRun();
  const [notes, setNotes] = useState(part.notes ?? "");
  const [link, setLink] = useState("");
  const set = (field: Parameters<typeof updatePartField>[1], value: string) =>
    run(() => updatePartField(part.id, field, value));

  const workflowKnown = options.workflows.some((w) => w.id === part.workflowId);

  return (
    <fieldset disabled={pending} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
      <label className={FIELD_LABEL}>
        PRODUCTION WORKFLOW
        <select
          value={part.workflowId ?? ""}
          onChange={(e) => {
            const next = options.workflows.find((w) => w.id === e.target.value);
            if (!next) return;
            // A first workflow just gives the part its stages.
            if (!part.workflowId) {
              set("workflow", next.id);
              return;
            }
            // Changing the route sends the part back to its first stage.
            if (window.confirm(`Change the workflow to "${next.name}"? The part goes back to the first stage of the new workflow.`)) {
              set("workflow", next.id);
            }
          }}
          className={FIELD_CONTROL}
        >
          {!part.workflowId ? <option value="">— Not chosen yet —</option> : null}
          {part.workflowId && !workflowKnown ? <option value={part.workflowId}>{part.workflowName}</option> : null}
          {options.workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
        <label className={FIELD_LABEL}>
          PART TYPE
          <select value={part.partType ?? ""} onChange={(e) => set("partType", e.target.value)} className={FIELD_CONTROL}>
            <option value="">— Select —</option>
            {withCurrent(options.partTypes.map((t) => t.name), part.partType).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-muted text-[10.5px] font-semibold tracking-[0.6px]">MANUFACTURING TECH</span>
          <span className="pt-2.5 text-sm font-semibold">{part.technology ?? "—"}</span>
        </div>

        <label className={FIELD_LABEL}>
          SOURCING
          <select value={part.sourcing} onChange={(e) => set("sourcing", e.target.value)} className={FIELD_CONTROL}>
            {SOURCING.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        {part.sourcing === "Outsourced" ? (
          <label className={FIELD_LABEL}>
            OUTSOURCE VENDOR
            <select value={part.vendor ?? ""} onChange={(e) => set("vendor", e.target.value)} className={FIELD_CONTROL}>
              <option value="">— choose vendor —</option>
              {withCurrent(options.vendors, part.vendor).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="hidden sm:block" />
        )}

        <label className={FIELD_LABEL}>
          ASSIGNED TO
          <select
            value={part.assigneeId ?? ""}
            onChange={(e) => run(() => assignPart(part.id, e.target.value || null))}
            className={FIELD_CONTROL}
          >
            <option value="">Unassigned</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className={FIELD_LABEL}>
          DUE DATE
          <input
            type="date"
            defaultValue={part.due ?? ""}
            onBlur={(e) => {
              if (e.target.value !== (part.due ?? "")) set("due", e.target.value);
            }}
            className={FIELD_CONTROL}
          />
        </label>

        <label className={FIELD_LABEL}>
          PRINTER / RESOURCE
          <select value={part.printer ?? ""} onChange={(e) => set("printer", e.target.value)} className={FIELD_CONTROL}>
            <option value="">— Select —</option>
            {withCurrent(options.printers, part.printer).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className={FIELD_LABEL}>
          MATERIAL
          <select value={part.material ?? ""} onChange={(e) => set("material", e.target.value)} className={FIELD_CONTROL}>
            <option value="">— Select —</option>
            {withCurrent(options.materials, part.material).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label className={FIELD_LABEL}>
          PRIORITY
          <select value={part.priority ?? ""} onChange={(e) => set("priority", e.target.value)} className={FIELD_CONTROL}>
            <option value="">— Select —</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className={FIELD_LABEL}>
        NOTES
        <textarea
          rows={3}
          value={notes}
          maxLength={4000}
          placeholder="Production notes for this part"
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes.trim() !== (part.notes ?? "")) set("notes", notes);
          }}
          className="border-field text-ink resize-y rounded-[9px] border px-2.5 py-2 text-[13.5px] font-normal tracking-normal"
        />
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-muted text-[10.5px] font-semibold tracking-[0.6px]">FILES FOR PRINTING</span>
        <div className="flex flex-wrap gap-2">
          {part.files.map((file) => (
            <span
              key={file.id}
              className="inline-flex min-h-[30px] max-w-full items-center gap-1.5 rounded-full border border-[#5FE9D0] bg-[#F0FDF9] py-0.5 pr-1 pl-2.5 text-[12.5px] font-semibold text-[#107569]"
            >
              <a href={`/api/part-files/${file.id}`} className="truncate text-[#107569] no-underline">
                ↓ {file.name}
              </a>
              <button
                type="button"
                aria-label={`Remove file ${file.name}`}
                onClick={() => {
                  if (window.confirm(`Remove "${file.name}" from this part?`)) run(() => removePartFile(part.id, file.id), "File removed");
                }}
                className="h-5 w-5 flex-none rounded-full border-0 bg-transparent text-[#107569]"
              >
                ×
              </button>
            </span>
          ))}
          {part.links.map((url) => (
            <span
              key={url}
              className="inline-flex min-h-[30px] max-w-full items-center gap-1.5 rounded-full border border-[#D1E0FF] bg-[#F5F8FF] py-0.5 pr-1 pl-2.5 text-[12.5px] font-semibold"
            >
              <a href={url} target="_blank" rel="noopener noreferrer" className="truncate text-[#155EEF] no-underline">
                🔗 {linkLabel(url)} ↗
              </a>
              <button
                type="button"
                aria-label="Remove link"
                onClick={() => run(() => removePartLink(part.id, url), "Link removed")}
                className="h-5 w-5 flex-none rounded-full border-0 bg-transparent text-[#155EEF]"
              >
                ×
              </button>
            </span>
          ))}
          {part.files.length === 0 && part.links.length === 0 ? (
            <span className="text-faint text-[12.5px]">No files or links attached.</span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="bg-ink relative inline-flex h-9 cursor-pointer items-center overflow-hidden rounded-lg px-3.5 text-[12.5px] font-semibold text-white">
            + Add files
            <input
              type="file"
              multiple
              aria-label="Add files for printing"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (picked.length === 0) return;
                if (picked.some((f) => f.size > 25 * 1024 * 1024)) {
                  toast("Files are limited to 25 MB each — add larger ones as a download link.", true);
                  return;
                }
                const formData = new FormData();
                for (const file of picked) formData.append("files", file);
                run(() => addPartFiles(part.id, formData), picked.length === 1 ? "File added" : `${picked.length} files added`);
              }}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          <input
            type="url"
            aria-label="File download link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Or paste a download link…"
            className="border-field h-9 min-w-[180px] flex-1 rounded-lg border px-2.5 text-[13px]"
          />
          <button
            type="button"
            disabled={!link.trim()}
            onClick={() => {
              const typed = link;
              setLink("");
              run(() => addPartLink(part.id, typed), "Link added");
            }}
            className="border-field text-ink-2 h-9 rounded-lg border bg-white px-3 text-[12.5px] font-semibold disabled:opacity-50"
          >
            + Add link
          </button>
        </div>
      </div>
      {node}
    </fieldset>
  );
}

// --- Stage owner and due date ----------------------------------------------------------------

export function StageOwner({
  partId,
  stageIndex,
  stageName,
  assigneeId,
  assignee,
  people,
}: {
  partId: string;
  stageIndex: number;
  stageName: string;
  assigneeId: string | null;
  /** The name as it was recorded, in case the person has since left. */
  assignee: string | null;
  people: Array<{ id: string; name: string }>;
}) {
  const { run, pending, node } = useRun();
  const gone = assigneeId && !people.some((p) => p.id === assigneeId);
  return (
    <>
      <select
        aria-label={`Owner of ${stageName}`}
        value={assigneeId ?? ""}
        disabled={pending}
        onChange={(e) => run(() => updatePartStage(partId, stageIndex, { assigneeId: e.target.value || null }))}
        className="border-field text-ink h-[34px] w-full min-w-[130px] rounded-lg border bg-white px-2 text-[12.5px] disabled:opacity-60"
      >
        <option value="">Unassigned</option>
        {gone ? <option value={assigneeId}>{assignee ?? "Former member"}</option> : null}
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {node}
    </>
  );
}

export function StageDue({
  partId,
  stageIndex,
  stageName,
  due,
}: {
  partId: string;
  stageIndex: number;
  stageName: string;
  due: string | null;
}) {
  const { run, pending, node } = useRun();
  return (
    <>
      <input
        type="date"
        aria-label={`Due date of ${stageName}`}
        defaultValue={due ?? ""}
        disabled={pending}
        onBlur={(e) => {
          if (e.target.value !== (due ?? "")) run(() => updatePartStage(partId, stageIndex, { due: e.target.value || null }));
        }}
        className="border-field text-ink h-[34px] w-full min-w-[130px] rounded-lg border bg-white px-2 font-mono text-xs disabled:opacity-60"
      />
      {node}
    </>
  );
}
