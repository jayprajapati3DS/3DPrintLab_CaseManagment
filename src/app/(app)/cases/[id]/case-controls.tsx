"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { useToast } from "@/components/ui/toast";
import { addCaseFiles, assignCase, changeCaseState, clearCaseImage, moveCase, setCaseImage, setCaseTask, setStagePlan, type CaseActionResult, type CaseStateChange } from "@/lib/cases/actions";

/** Run a case action: its message as a toast, the page refreshed after. */
function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { toast, node } = useToast();

  function run(action: () => Promise<CaseActionResult>, done?: string) {
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

  return { run, pending, node };
}

/** Who has the case, and moving it through its stages — as a part's owner moves a part. */
export function CaseMoveBar({
  caseId,
  assigneeName,
  mine,
  prevName,
  nextName,
  noStages = false,
}: {
  caseId: string;
  assigneeName: string | null;
  mine: boolean;
  prevName: string | null;
  nextName: string | null;
  noStages?: boolean;
}) {
  const { run, pending, node } = useRun();
  return (
    <>
      <div className="border-line-3 flex flex-wrap items-center gap-x-3 gap-y-2.5 border-t pt-3.5" data-testid="case-move-bar">
        <span className="text-muted text-[11px] font-semibold tracking-[0.7px]">ASSIGNED TO</span>
        <span className={"text-[13.5px] font-semibold " + (assigneeName ? "text-ink" : "text-faint")}>{assigneeName ?? "Unassigned"}</span>
        {mine ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => assignCase(caseId, null))}
            className="border-line text-ink-3 h-[34px] rounded-lg border bg-white px-3 text-[12.5px] font-semibold disabled:opacity-60"
          >
            Unassign
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => assignCase(caseId, "me"))}
            className="border-brand-edge bg-brand-wash text-brand-ink h-[34px] rounded-lg border px-3 text-[12.5px] font-semibold disabled:opacity-60"
          >
            Assign to me
          </button>
        )}
        <div className="hidden flex-1 sm:block" />
        {noStages ? null : (
          <div className="flex w-full gap-2.5 sm:w-auto">
            <button
              type="button"
              disabled={!mine || !prevName || pending}
              onClick={() => run(() => moveCase(caseId, -1))}
              className="border-field text-ink-2 h-[38px] min-w-0 flex-1 truncate rounded-[9px] border bg-white px-3.5 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
            >
              ← {prevName ? `Back: ${prevName}` : "Back"}
            </button>
            <button
              type="button"
              disabled={!mine || !nextName || pending}
              onClick={() => run(() => moveCase(caseId, 1))}
              className="bg-brand disabled:bg-field h-[38px] min-w-0 flex-1 truncate rounded-[9px] border-0 px-3.5 text-[13px] font-semibold text-white disabled:cursor-not-allowed sm:flex-none"
            >
              {nextName ? `Next: ${nextName}` : "Completed"} →
            </button>
          </div>
        )}
      </div>
      {!mine && !noStages ? <div className="text-muted -mt-1.5 text-xs">Assign this case to yourself to move its stage.</div> : null}
      {noStages ? <div className="text-muted -mt-1.5 text-xs">This case&apos;s product has no case stages yet — set them on the Products page.</div> : null}
      {node}
    </>
  );
}

/** Upload a picture as the case's own image. */
function useImageUpload(caseId: string, label = "Case image") {
  const { run, pending, node } = useRun();
  const input = useRef<HTMLInputElement>(null);
  const field = (
    <input
      ref={input}
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif"
      aria-label={label}
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        const data = new FormData();
        data.set("image", file);
        run(() => setCaseImage(caseId, data));
      }}
    />
  );
  return { pick: () => input.current?.click(), field, pending, node, run };
}

/**
 * The case's picture with a camera badge: click it to add or change the case's
 * own image. Without one, its product's image is shown.
 */
export function CaseImageBadge({ caseId, hasOwn, children }: { caseId: string; hasOwn: boolean; children: React.ReactNode }) {
  const { pick, field, pending, node } = useImageUpload(caseId);
  return (
    <span className="relative inline-flex flex-none">
      {children}
      <button
        type="button"
        disabled={pending}
        onClick={pick}
        aria-label={hasOwn ? "Change case image" : "Add case image"}
        title={hasOwn ? "Change case image" : "Add case image"}
        className="bg-brand absolute -right-1.5 -bottom-1.5 flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 border-white text-white shadow-[0_2px_6px_rgba(16,24,40,.25)] disabled:opacity-60"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      </button>
      {field}
      {node}
    </span>
  );
}

/** The case's ⋮ menu: edit it, its image — and hold, cancel, archive or delete it, each confirmed with a comment. */
export function CaseMenu({
  caseId,
  editHref,
  hasOwnImage,
  onHold = false,
  cancelled = false,
  archived = false,
  canHold = false,
  isAdmin = false,
}: {
  caseId: string;
  /** Null while the case information is locked at its status. */
  editHref: string | null;
  hasOwnImage: boolean;
  onHold?: boolean;
  cancelled?: boolean;
  archived?: boolean;
  /** The case's owner or an admin. */
  canHold?: boolean;
  isAdmin?: boolean;
}) {
  const { pick, field, pending, node, run } = useImageUpload(caseId, "Case image from menu");
  const [asking, setAsking] = useState<CaseStateChange | null>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const item = "text-ink flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] font-medium no-underline hover:bg-subtle disabled:opacity-60";
  const ask = (change: CaseStateChange) => {
    menu.current?.removeAttribute("open");
    setAsking(change);
  };
  const changes: Array<{ change: CaseStateChange; label: string; danger?: boolean; show: boolean }> = [
    { change: "hold", label: "Hold case", show: canHold && !onHold && !cancelled && !archived },
    { change: "resume", label: "Resume case", show: canHold && onHold },
    { change: "cancel", label: "Cancel case", danger: true, show: isAdmin && !cancelled },
    { change: "archive", label: "Archive case", show: isAdmin && !archived },
    { change: "restore", label: "Restore from archive", show: isAdmin && archived },
    { change: "delete", label: "Delete case", danger: true, show: isAdmin },
  ];
  const shown = changes.filter((c) => c.show);
  return (
    <>
      <details ref={menu} className="relative">
        <summary
          aria-label="More actions"
          className="border-line text-ink-2 flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-[9px] border bg-white"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="12" cy="5" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="12" cy="19" r="1.8" />
          </svg>
        </summary>
        <div role="menu" className="border-line absolute right-0 z-30 mt-1.5 flex w-[220px] flex-col rounded-[10px] border bg-white p-1 shadow-[0_12px_32px_rgba(16,24,40,.18)]">
          {editHref ? (
            <a role="menuitem" href={editHref} className={item}>
              Edit case
            </a>
          ) : (
            <span role="menuitem" aria-disabled="true" title="The case information is locked at this status" className={item + " cursor-not-allowed opacity-50"}>
              Edit case — locked
            </span>
          )}
          <button role="menuitem" type="button" disabled={pending} onClick={pick} className={item}>
            {hasOwnImage ? "Change case image" : "Add case image"}
          </button>
          {hasOwnImage ? (
            <button role="menuitem" type="button" disabled={pending} onClick={() => run(() => clearCaseImage(caseId))} className={item}>
              Remove case image
            </button>
          ) : null}
          {shown.length ? <span className="border-line-2 my-1 border-t" aria-hidden="true" /> : null}
          {shown.map((c) => (
            <button key={c.change} role="menuitem" type="button" disabled={pending} onClick={() => ask(c.change)} className={item + (c.danger ? " text-bad!" : "")}>
              {c.label}
            </button>
          ))}
        </div>
        {field}
        {node}
      </details>
      {asking ? <ConfirmStateChange caseId={caseId} change={asking} onClose={() => setAsking(null)} /> : null}
    </>
  );
}

const CONFIRM: Record<CaseStateChange, { title: string; text: string; button: string; required: boolean; danger?: boolean }> = {
  hold: { title: "Hold this case?", text: "Its stages stay where they are until it is resumed.", button: "Hold case", required: true },
  resume: { title: "Resume this case?", text: "Its stages can move again.", button: "Resume case", required: false },
  cancel: { title: "Cancel this case?", text: "It moves to Archived, and its stages no longer move.", button: "Cancel case", required: true, danger: true },
  archive: { title: "Archive this case?", text: "It moves to Archived; it can be restored later.", button: "Archive case", required: false },
  restore: { title: "Restore this case?", text: "It comes back from the archive.", button: "Restore case", required: false },
  delete: {
    title: "Delete this case?",
    text: "The case, its form records and files are deleted for good. A case with parts cannot be deleted — cancel or archive it instead.",
    button: "Delete case",
    required: true,
    danger: true,
  },
};

/** The confirmation, with the comment kept on the case's trail. */
function ConfirmStateChange({ caseId, change, onClose }: { caseId: string; change: CaseStateChange; onClose: () => void }) {
  const { run, pending, node } = useRun();
  const [comment, setComment] = useState("");
  const c = CONFIRM[change];
  const short = c.required && comment.trim().length < 3;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(12,21,36,.55)] px-3" onClick={(e) => e.target === e.currentTarget && !pending && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={c.title} className="shadow-modal flex w-[460px] max-w-full flex-col gap-3.5 rounded-[14px] bg-white p-5">
        <div className="flex flex-col gap-1">
          <h3 className="m-0 text-[16px] font-bold">{c.title}</h3>
          <p className="text-ink-3 m-0 text-[13px]">{c.text}</p>
        </div>
        <label className="flex flex-col gap-1.5 text-[12.5px] font-semibold">
          <span>
            Comment {c.required ? <span className="text-bad">*</span> : <span className="text-muted font-normal">(optional)</span>}
          </span>
          <textarea
            rows={3}
            value={comment}
            autoFocus
            onChange={(e) => setComment(e.target.value)}
            placeholder={c.required ? "Say why — it is kept on the case's activity log." : "Anything to note — kept on the case's activity log."}
            className="border-field rounded-lg border px-2.5 py-2 text-[13px] font-normal"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" disabled={pending} onClick={onClose} className="border-line text-ink-2 h-[38px] rounded-[9px] border bg-white px-3.5 text-[13px] font-semibold">
            Back
          </button>
          <button
            type="button"
            disabled={pending || short}
            onClick={() => run(async () => {
              const result = await changeCaseState(caseId, change, comment);
              if (result.ok) onClose();
              return result;
            })}
            className={"h-[38px] rounded-[9px] border-0 px-3.5 text-[13px] font-semibold text-white disabled:opacity-50 " + (c.danger ? "bg-[#D92D20]" : "bg-brand")}
          >
            {pending ? "Saving…" : c.button}
          </button>
        </div>
        {node}
      </div>
    </div>
  );
}

/** Add files to a case: reports, photos, documents. */
export function AddCaseFiles({ caseId }: { caseId: string }) {
  const { run, pending, node } = useRun();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        aria-label="Add files to this case"
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length === 0) return;
          const data = new FormData();
          for (const f of files) data.append("files", f);
          run(() => addCaseFiles(caseId, data));
        }}
      />
      <button
        type="button"
        disabled={pending}
        onClick={() => input.current?.click()}
        className="bg-brand flex h-[38px] items-center rounded-[9px] px-[15px] text-[13px] font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Uploading…" : "+ Add files"}
      </button>
      {node}
    </>
  );
}

/** Who a status is planned for — chosen on the Status tab. */
export function StageOwnerSelect({
  caseId,
  index,
  stageName,
  value,
  people,
  disabled,
}: {
  caseId: string;
  index: number;
  stageName: string;
  value: string;
  people: Array<{ id: string; name: string; detail: string }>;
  disabled: boolean;
}) {
  const { run, pending, node } = useRun();
  return (
    <>
      <select
        aria-label={`${stageName} assigned to`}
        value={value}
        disabled={disabled || pending}
        onChange={(e) => run(() => setStagePlan(caseId, index, { ownerId: e.target.value || null }))}
        className="border-field text-ink h-[38px] w-full min-w-[150px] rounded-lg border bg-white px-2.5 text-[13px] disabled:cursor-not-allowed disabled:bg-[#F9FAFB] disabled:text-[#98A2B3]"
      >
        <option value="">Unassigned</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.detail ? `${p.name} — ${p.detail}` : p.name}
          </option>
        ))}
      </select>
      {node}
    </>
  );
}

/** When a status is due — set on the Status tab; empty goes back to the stage's working days. */
export function StageDueInput({ caseId, index, stageName, value, disabled }: { caseId: string; index: number; stageName: string; value: string; disabled: boolean }) {
  const { run, pending, node } = useRun();
  return (
    <>
      <input
        type="date"
        aria-label={`${stageName} due date`}
        defaultValue={value}
        key={value}
        disabled={disabled || pending}
        onChange={(e) => {
          const v = e.target.value;
          if (v === value || (v && !/^\d{4}-\d{2}-\d{2}$/.test(v))) return;
          run(() => setStagePlan(caseId, index, { due: v || null }));
        }}
        className="border-field text-ink h-[38px] w-[150px] rounded-lg border bg-white px-2.5 text-[13px] disabled:cursor-not-allowed disabled:bg-[#F9FAFB]"
      />
      {node}
    </>
  );
}

/** Tick a stage task off — or open it again. */
export function TaskCheck({ taskId, name, done, label = false }: { taskId: string; name: string; done: boolean; label?: boolean }) {
  const { run, pending, node } = useRun();
  // Shown ticked at once; the page catches up when the server has it.
  const [on, setOn] = useState(done);
  const [seen, setSeen] = useState(done);
  if (seen !== done) {
    setSeen(done);
    setOn(done);
  }
  return (
    <>
      <label className={"flex items-center gap-2 " + (label ? "border-line rounded-[10px] border px-3.5 py-3 text-[13px] font-semibold" : "")}>
        <input
          type="checkbox"
          checked={on}
          disabled={pending}
          aria-label={`${name} done`}
          onChange={(e) => {
            const next = e.target.checked;
            setOn(next);
            run(() => setCaseTask(taskId, { done: next }));
          }}
          className="accent-brand h-4 w-4 flex-none cursor-pointer"
        />
        {label ? (on ? "Done — untick to open it again" : "Mark this task done") : null}
      </label>
      {node}
    </>
  );
}

/** Who a stage task is for, and when it is due. */
export function TaskPlan({
  taskId,
  name,
  assigneeId,
  due,
  people,
}: {
  taskId: string;
  name: string;
  assigneeId: string;
  due: string;
  people: Array<{ id: string; name: string; detail: string }>;
}) {
  const { run, pending, node } = useRun();
  return (
    <>
      <label className="flex flex-col gap-1.5 text-[12.5px] font-semibold">
        Assigned to
        <select
          aria-label={`${name} assigned to`}
          value={assigneeId}
          disabled={pending}
          onChange={(e) => run(() => setCaseTask(taskId, { assigneeId: e.target.value || null }))}
          className="border-field text-ink h-[38px] rounded-lg border bg-white px-2.5 text-[13px] font-normal"
        >
          <option value="">Unassigned</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.detail ? `${p.name} — ${p.detail}` : p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-[12.5px] font-semibold">
        Due date
        <input
          type="date"
          aria-label={`${name} due date`}
          defaultValue={due}
          key={due}
          disabled={pending}
          onChange={(e) => {
            const v = e.target.value;
            if (v === due || (v && !/^\d{4}-\d{2}-\d{2}$/.test(v))) return;
            run(() => setCaseTask(taskId, { due: v || null }));
          }}
          className="border-field text-ink h-[38px] w-[180px] rounded-lg border bg-white px-2.5 text-[13px] font-normal"
        />
      </label>
      {node}
    </>
  );
}
