"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

import { QaFormView, type Approval, type FormMeta, type Lifecycle } from "@/components/qa/form-view";
import { useToast } from "@/components/ui/toast";
import { assignForm } from "@/lib/qa/actions";
import type { FormState, Libraries } from "@/lib/qa/evaluate";
import type { Inspection } from "@/lib/parts/request-form";
import type { QaSection } from "@/lib/qa/template";
import type { Context } from "@/lib/qa/variables";

/** Everything one form needs on screen, as plain data. */
export interface FormProps {
  meta: FormMeta;
  sections: QaSection[];
  initial: FormState;
  snap: Record<string, { label: string; line: string; warn: string | null }>;
  editable: boolean;
  canApprove: boolean;
  approveHint: string | null;
  approval: Approval;
  lifecycle?: Lifecycle;
}

export function InlineForm({
  form,
  context,
  libraries,
  inspection,
  partLine,
  partId,
}: {
  form: FormProps;
  context: Context;
  libraries: Libraries;
  inspection: Inspection | null;
  partLine: string;
  partId: string;
}) {
  return (
    <QaFormView
      // One instance per form: it keeps what was typed, and its message, across a save.
      key={form.meta.id ?? "form"}
      meta={form.meta}
      sections={form.sections}
      context={context}
      libraries={libraries}
      inspection={inspection}
      initial={form.initial}
      snap={form.snap}
      partLine={partLine}
      partId={partId}
      editable={form.editable}
      canApprove={form.canApprove}
      approveHint={form.approveHint}
      approval={form.approval}
      lifecycle={form.lifecycle}
    />
  );
}

/** The form dialog, opened by `?form=<id>` and closed back to the page under it. */
export function FormDialog({
  form,
  context,
  libraries,
  inspection,
  partLine,
  partId,
  closeHref,
  printHref,
  headerActions,
}: {
  form: FormProps;
  context: Context;
  libraries: Libraries;
  inspection: Inspection | null;
  partLine: string;
  /** null for a case's form. */
  partId: string | null;
  closeHref: string;
  printHref?: string;
  headerActions?: { editHref?: string | null; pdfHref?: string | null };
}) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push(closeHref, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [router, closeHref]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(12,21,36,.55)] px-2 py-3 sm:px-4 sm:py-8">
      <div role="dialog" aria-modal="true" aria-labelledby="qa-form-title" className="shadow-modal w-[860px] max-w-full overflow-hidden rounded-[14px] bg-white">
        <QaFormView
          key={form.meta.id ?? "form"}
          meta={form.meta}
          sections={form.sections}
          context={context}
          libraries={libraries}
          inspection={inspection}
          initial={form.initial}
          snap={form.snap}
          partLine={partLine}
          partId={partId}
          editable={form.editable}
          canApprove={form.canApprove}
          approveHint={form.approveHint}
          approval={form.approval}
      lifecycle={form.lifecycle}
          printHref={printHref}
          headerActions={headerActions}
          onClose={() => router.push(closeHref, { scroll: false })}
        />
      </div>
    </div>
  );
}

/** "Assign to…" on the Quality Forms tab. */
export function FormAssignee({
  formId,
  assigneeId,
  assigneeName,
  people,
  meId,
  locked,
}: {
  formId: string;
  assigneeId: string | null;
  assigneeName: string | null;
  people: Array<{ id: string; name: string }>;
  meId: string;
  locked: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { toast, node } = useToast();
  const set = (to: string | null) =>
    startTransition(async () => {
      const result = await assignForm(formId, to);
      if (!result.ok) toast(result.message ?? "That did not work.", true);
      else router.refresh();
    });
  if (locked) return <span className="text-ink-2 text-[12.5px] font-semibold">{assigneeName ?? "—"}</span>;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Form assignee"
        value={assigneeId ?? ""}
        disabled={pending}
        onChange={(e) => set(e.target.value || null)}
        className="border-field h-8 min-w-[140px] rounded-lg border bg-white px-2 text-[12.5px] disabled:opacity-60"
      >
        <option value="">Assign to…</option>
        {assigneeId && !people.some((p) => p.id === assigneeId) ? <option value={assigneeId}>{assigneeName}</option> : null}
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {assigneeId !== meId ? (
        <button type="button" disabled={pending} onClick={() => set("me")} className="border-brand-edge bg-brand-wash text-brand-ink h-8 rounded-lg border px-2.5 text-xs font-semibold">
          Assign to me
        </button>
      ) : null}
      {node}
    </span>
  );
}
