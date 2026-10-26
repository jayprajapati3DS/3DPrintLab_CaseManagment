"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";

import { BalloonDrawing } from "@/components/parts/balloons";
import { DocLayoutPart } from "@/components/qa/doc-layout";
import { useToast } from "@/components/ui/toast";
import { attachFormFile, attachGridImage, passOnForm, removeFormFile, saveForm } from "@/lib/qa/actions";
import { computeRow, formatDuration, parseDuration, readRows, type Computed, type GridRow } from "@/lib/qa/calc";
import {
  balloonRows,
  enteredText,
  formModel,
  readFiles,
  evaluate,
  judge,
  judgeKind,
  judgeValue,
  pickedOption,
  specText,
  type FormState,
  type Libraries,
  type LibOption,
  savedUse,
  type Result,
  withOwnUse,
} from "@/lib/qa/evaluate";
import type { Inspection } from "@/lib/parts/request-form";
import { SignaturePad } from "@/components/account/signature-pad";
import { rejectForm, revertForm } from "@/lib/qa/actions";
import { chainField, peopleKey, readPeople, readStamps, stampsKey } from "@/lib/qa/signoff";
import { autoSigner, COLUMN_KIND_LABELS, customOptions, REQUIREMENTS, roleAllowed, type GridColumn, type QaItem, type QaSection } from "@/lib/qa/template";
import { FILE_PREFIX, resolve, type Context } from "@/lib/qa/variables";
import { IMAGE_SIZE_CLASS, imageSize, sizeKey } from "@/lib/parts/request-form";
import { BUILT_IN_LAYOUTS, formTokens, layoutFor, type DocLayoutDef } from "@/lib/qa/layouts";

/**
 * A quality form, filled in. The same component draws it on a part's
 * Current stage tab, in the form dialog, read-only for an approved record,
 * and as the live preview in QA Form Setup.
 */

export interface FormMeta {
  id: string | null;
  name: string;
  code: string;
  clause: string;
  issue: string;
  effective: string;
  rev: string;
  docLayout: boolean;
  /** Valid until, and the header style — a banner shows effective · validity · form · ver. */
  validity?: string;
  docStyle?: string;
  /** Its header & footer design (QA Form Setup); the space's chosen one for docStyle — a built-in one when not given. */
  layout?: DocLayoutDef;
  stageName: string;
  status: string;
  submittedByName?: string | null;
  submittedAt?: string | null;
  approvedByName?: string | null;
  approvedAt?: string | null;
  savedByName?: string | null;
  savedAt?: string | null;
}

/** Where a form's record stands: its version, who may send it back, and the versions kept. */
export interface Lifecycle {
  version: number;
  /** Waiting for approval, and this person sent it (or is an admin). */
  canRevert: boolean;
  /** Approved, and this person may open a new version. */
  canRevise: boolean;
  /** Waiting for this person: they may reject it. */
  canReject: boolean;
  /** The current version was rejected and sent back. */
  rejection: { byName: string; at: string; reason: string } | null;
  versions: Array<{ id: string; version: number; event: string; byName: string; at: string; reason: string | null }>;
  /** `?…&version=` — add a version's id to open it. */
  versionHref: string;
  /** Looking at a kept version, not the current record. */
  viewing?: { title: string; currentHref: string; changes: Array<{ label: string; before: string; after: string }> };
}

/** Sending a form for approval: to whom it can go, who it is waiting for, and passing it on. */
export interface Approval {
  /** The stage's approver roles; "" when anyone may approve. */
  approverRoles: string;
  sendChoices: Array<{ id: string; name: string; roles: string }>;
  sentToName: string | null;
  sentToId: string | null;
  /** The form has Reviewed by / Approved by fields: chosen people sign in turn. */
  chained: boolean;
  /** Whose turn it is: a reviewer's or an approver's. */
  stepKind: "reviewer" | "approver" | null;
  /** That turn is signed with a signature image. */
  stepNeedsImage: boolean;
  /** Who each Reviewed by / Approved by field can be given to. */
  pickChoices: Record<string, Array<{ id: string; name: string; roles: string }>>;
  /** Waiting for the person it was sent to. */
  waiting: boolean;
  canPassOn: boolean;
  passOnChoices: Array<{ id: string; name: string; roles: string }>;
}

export const FORM_STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  Upcoming: { bg: "#F2F4F7", fg: "#475467" },
  "In progress": { bg: "#FFFAEB", fg: "#B54708" },
  "Pending approval": { bg: "#F4F3FF", fg: "#5925DC" },
  Approved: { bg: "#ECFDF3", fg: "#067647" },
  Rejected: { bg: "#FEF3F2", fg: "#B42318" },
};

export function FormStatusPill({ status }: { status: string }) {
  const tone = FORM_STATUS_TONE[status] ?? FORM_STATUS_TONE.Upcoming;
  return (
    <span className="rounded-full px-[9px] py-[3px] text-[11.5px] font-bold whitespace-nowrap" style={{ background: tone.bg, color: tone.fg }}>
      {status}
    </span>
  );
}

/** Section columns, by the form's own width rather than the screen's. */
const COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 @xl:grid-cols-2",
  3: "grid-cols-1 @xl:grid-cols-2 @3xl:grid-cols-3",
  4: "grid-cols-1 @xl:grid-cols-2 @3xl:grid-cols-4",
};

const RESULT_TONE: Record<Exclude<Result, "">, string> = {
  Pass: "bg-ok-tint text-ok",
  Fail: "bg-bad-tint text-bad",
};

/** When a signature was given, in the space's time zone: "2026-10-01 17:05". The same on server and browser. */
function stampTime(at: string, timeZone: string | undefined): string {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
        .formatToParts(new Date(at))
        .map((p) => [p.type, p.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}${timeZone ? "" : " UTC"}`;
  } catch {
    return at.slice(0, 16).replace("T", " ");
  }
}

function ResultChip({ result }: { result: Result }) {
  if (!result) return <span className="text-faint text-[11.5px]">—</span>;
  return <span className={`justify-self-start rounded-md px-2 py-0.5 text-[11.5px] font-bold ${RESULT_TONE[result]}`}>{result}</span>;
}

export function QaFormView({
  meta,
  sections,
  context,
  libraries: stock,
  inspection,
  initial,
  snap = {},
  partLine,
  partId,
  editable,
  canApprove,
  approveHint,
  approval,
  lifecycle,
  preview = false,
  onClose,
  printHref,
  headerActions,
}: {
  /** Version, sending back, versions kept; absent in the editor's preview. */
  lifecycle?: Lifecycle;
  meta: FormMeta;
  sections: QaSection[];
  context: Context;
  libraries: Libraries;
  inspection: Inspection | null;
  initial: FormState;
  snap?: Record<string, { label: string; line: string; warn: string | null }>;
  /** "JM-CRANIO-0430-01 · Cranial plate" */
  partLine: string;
  partId: string | null;
  editable: boolean;
  canApprove: boolean;
  approveHint: string | null;
  /** Who it can be sent to for approval; absent in the editor's preview. */
  approval?: Approval;
  /** Read-only, no footer: the editor's preview. */
  preview?: boolean;
  /** Present in the dialog: draws the dark header with a close button. */
  onClose?: () => void;
  /** Where Print / PDF opens; a part's form's print page when absent. */
  printHref?: string;
  /** In the dialog's header: switch to editing it, and download it as PDF. */
  headerActions?: { editHref?: string | null; pdfHref?: string | null };
}) {
  const router = useRouter();
  const { toast, node: toastNode } = useToast();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<FormState>(initial);
  const locked = !editable;
  // What this form took from stock when it was saved is back on the shelf while it is edited (as the
  // server counts it): a saved quantity can be changed — even one that used a lot up.
  const libraries = useMemo(() => (editable ? withOwnUse(stock, savedUse(sections, initial)) : stock), [editable, stock, sections, initial]);
  // "Submit for approval" first asks who to send it to.
  const [sending, setSending] = useState(false);
  const [sendTo, setSendTo] = useState("");
  const [passTo, setPassTo] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  /** Reject, revert to draft or revise: the server says what happened. */
  function act(call: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) {
    startTransition(async () => {
      try {
        const done = await call();
        if (!done.ok) {
          toast(done.message ?? "That did not work.", true);
          return;
        }
        toast(done.message ?? "Done");
        after?.();
        // The number beside My Approvals may have changed.
        window.dispatchEvent(new Event("approvals-changed"));
        router.refresh();
      } catch {
        toast("The server could not be reached. Try again.", true);
      }
    });
  }
  function revert() {
    if (!meta.id) return;
    const approvedNow = meta.status === "Approved";
    const sure = approvedNow
      ? `Revise this approved record? Version ${lifecycle?.version ?? 1} is kept as it is, and version ${(lifecycle?.version ?? 1) + 1} opens as a draft to be filled, submitted and approved again.`
      : "Revert to draft? The signatures given so far are cleared, and it has to be submitted again.";
    if (!window.confirm(sure)) return;
    act(() => revertForm(meta.id!));
  }
  function reject() {
    if (!meta.id) return;
    if (reason.trim().length < 3) return toast("Say why it is rejected", true);
    act(() => rejectForm(meta.id!, reason), () => {
      setRejecting(false);
      setReason("");
    });
  }
  const viewing = lifecycle?.viewing;
  const waiting = meta.status === "Pending approval";
  // A controlled document's header & footer: its design, with the form's own words.
  const layout = meta.docLayout ? (meta.layout ?? layoutFor(BUILT_IN_LAYOUTS, meta.docStyle)) : null;
  const layoutValues = useMemo(() => ({ ...context, ...formTokens(meta) }), [context, meta]);

  const result = useMemo(() => evaluate(sections, state, context, libraries, inspection), [sections, state, context, libraries, inspection]);
  const computed = useMemo(() => formModel(sections, state, context, libraries).calc, [sections, state, context, libraries]);

  const setValue = (id: string, value: string) => setState((s) => ({ ...s, values: { ...s.values, [id]: value } }));
  const setMeasured = (key: string, value: string) => setState((s) => ({ ...s, measured: { ...s.measured, [key]: value } }));
  const setQty = (id: string, value: string) => setState((s) => ({ ...s, quantities: { ...s.quantities, [id]: value } }));

  function passOn() {
    if (!meta.id || !passTo) return;
    startTransition(async () => {
      try {
        const result = await passOnForm(meta.id!, passTo);
        if (!result.ok) {
          toast(result.message ?? "The form could not be passed on.", true);
          return;
        }
        toast(result.message ?? "Passed on");
        setPassTo("");
        // The number beside My Approvals may have changed.
        window.dispatchEvent(new Event("approvals-changed"));
        router.refresh();
      } catch {
        toast("The server could not be reached. Try again.", true);
      }
    });
  }

  function run(mode: "draft" | "submit" | "approve", to?: string) {
    if (!meta.id) return;
    // The same checks the server makes, so the reason shows at once.
    if (mode !== "draft") {
      if (result.missing.length) {
        toast(`Fill all required items before ${mode === "submit" ? "submitting" : "approving"}`, true);
        return;
      }
      if (result.blocked.length) {
        toast(`${result.blocked[0]} — ${mode === "approve" ? "cannot approve" : "pick another item or fix it first"}`, true);
        return;
      }
    }
    if (mode === "approve" && result.fails.length) {
      toast(`${result.fails.length} item(s) out of specification — raise an NCR / rework before approving`, true);
      return;
    }
    const payload = JSON.stringify(state);
    startTransition(async () => {
      try {
        const saved = await saveForm(meta.id!, mode, payload, to);
        if (!saved.ok) {
          toast(saved.message ?? "The form could not be saved.", true);
          return;
        }
        toast(saved.message ?? "Saved");
        if (mode === "submit") setSending(false);
        // The number beside My Approvals may have changed.
        window.dispatchEvent(new Event("approvals-changed"));
        router.refresh();
      } catch {
        toast("The form did not reach the server. Check the connection and try again.", true);
      }
    });
  }

  const docMeta = [lifecycle && (lifecycle.version > 1 || lifecycle.versions.length) ? `Version ${lifecycle.version}` : "", meta.code, meta.issue && `Issue ${meta.issue}`, meta.rev && `Rev ${meta.rev}`, meta.effective && `Effective ${meta.effective}`, meta.clause, meta.stageName && `Stage: ${meta.stageName}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="@container flex min-w-0 flex-col">
      {onClose ? (
        <div className="bg-navy flex items-start gap-3 px-4 py-4 sm:px-[22px]">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id="qa-form-title" className="m-0 text-base font-bold text-white">
              {meta.name}
            </h2>
            <span className="text-brand-glow font-mono text-[11.5px] break-words">{docMeta}</span>
            <span className="text-navy-muted text-xs">{partLine}</span>
          </div>
          <FormStatusPill status={meta.status} />
          {headerActions?.editHref ? (
            <Link
              href={headerActions.editHref}
              scroll={false}
              className="bg-brand flex h-[34px] flex-none items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold text-white no-underline"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
              </svg>
              Edit
            </Link>
          ) : null}
          {headerActions?.pdfHref ? (
            <a
              href={headerActions.pdfHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-[34px] flex-none items-center gap-1.5 rounded-lg border border-white/30 px-3 text-[12.5px] font-semibold text-white no-underline"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              Download PDF
            </a>
          ) : null}
          <button type="button" onClick={onClose} aria-label="Close" className="h-[34px] w-[34px] flex-none rounded-lg border-0 bg-white/10 text-white">
            ×
          </button>
        </div>
      ) : null}

      {viewing ? (
        <div data-testid="version-view" className="flex flex-col gap-2 border-b border-[#D9D6FE] bg-[#F4F3FF] px-4 py-3 sm:px-[22px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ink flex-1 text-[13px] font-bold">{viewing.title}</span>
            <Link href={viewing.currentHref} scroll={false} className="text-brand-ink text-[12.5px] font-semibold">
              Back to the current version →
            </Link>
          </div>
          <details className="text-[12.5px]">
            <summary className="text-ink-2 cursor-pointer font-semibold">
              {viewing.changes.length ? `${viewing.changes.length} field${viewing.changes.length === 1 ? "" : "s"} differ in the current version` : "The current version reads the same"}
            </summary>
            {viewing.changes.length ? (
              <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-1">
                <span className="text-muted text-[11px] font-bold uppercase">Field</span>
                <span className="text-muted text-[11px] font-bold uppercase">This version</span>
                <span className="text-muted text-[11px] font-bold uppercase">Current</span>
                {viewing.changes.map((c, i) => (
                  <div key={i} className="contents">
                    <span className="text-ink-2 font-semibold break-words">{c.label}</span>
                    <span className="text-ink-3 break-words">{c.before}</span>
                    <span className="text-ink break-words">{c.after}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </details>
        </div>
      ) : null}
      {!viewing && lifecycle?.rejection && meta.status !== "Approved" && !waiting ? (
        <div data-testid="rejection" className="flex flex-col gap-0.5 border-b border-[#FECDCA] bg-[#FEF3F2] px-4 py-3 sm:px-[22px]">
          <span className="text-bad text-[13px] font-bold">
            Rejected by {lifecycle.rejection.byName} · {lifecycle.rejection.at}
          </span>
          <span className="text-ink-2 text-[12.5px]">{lifecycle.rejection.reason}</span>
          <span className="text-muted text-[11.5px]">Correct it and submit it for approval again. The rejected version is kept below.</span>
        </div>
      ) : null}

      {layout ? (
        <div className="mx-4 mt-4 sm:mx-[22px]">
          <DocLayoutPart part={layout.header} values={layoutValues} testId="doc-header" />
        </div>
      ) : null}

      <div className="border-line-2 bg-subtle mt-0 flex flex-wrap items-center gap-2 border-b px-4 py-2.5 text-xs font-semibold sm:px-[22px]">
        <span className="text-ok">● Identification values are fetched automatically from the part, case and request</span>
        <div className="hidden flex-1 sm:block" />
        {result.fails.length ? <span className="bg-bad-tint text-bad rounded-md px-2 py-0.5">{result.fails.length} out of specification</span> : null}
        {result.blocked.length ? (
          <span className="bg-bad-tint text-bad rounded-md px-2 py-0.5">⚠ {result.blocked.length} item{result.blocked.length === 1 ? "" : "s"} not fit for use</span>
        ) : null}
        {result.missing.length ? (
          <span className="bg-warn-tint text-warn rounded-md px-2 py-0.5">{result.missing.length} required item{result.missing.length === 1 ? "" : "s"} empty</span>
        ) : null}
        {!result.fails.length && !result.blocked.length && !result.missing.length ? (
          <span className="bg-ok-tint text-ok rounded-md px-2 py-0.5">All items complete and in specification</span>
        ) : null}
      </div>

      <fieldset disabled={locked || pending} className="m-0 flex min-w-0 flex-col gap-[18px] border-0 px-4 py-[18px] sm:px-[22px]">
        {sections.map((section) => {
          const shown = section.items.filter((i) => !result.hidden.has(i.id));
          if (section.items.length > 0 && shown.length === 0) return null;
          return (
            <div key={section.id} className="flex flex-col gap-2.5">
              {!meta.docLayout && section.title ? (
                <div className="border-line-3 text-brand border-b pb-1.5 text-[11px] font-bold tracking-[0.8px] uppercase">{section.title}</div>
              ) : meta.docLayout && section.title ? (
                <div className="text-ink-3 pt-1 text-[11px] font-bold tracking-[0.8px] uppercase">{section.title}</div>
              ) : null}
              <div className={`grid gap-3 ${COLS[section.cols] ?? COLS[1]}`}>
                {shown.map((item) => (
                  <div
                    key={item.id}
                    className={
                      "flex min-w-0 flex-col gap-1.5 " +
                      (item.type === "table" || item.type === "criteria" || item.type === "grid" || wideImage(item, context) ? "col-span-full" : "")
                    }
                  >
                    <ItemView
                      item={item}
                      state={state}
                      context={context}
                      libraries={libraries}
                      inspection={inspection}
                      snap={snap[item.id]}
                      computed={computed[item.id]}
                      locked={locked}
                      docLayout={meta.docLayout}
                      partMaterial={context["part.material"] ?? ""}
                      setValue={setValue}
                      setMeasured={setMeasured}
                      setQty={setQty}
                      formId={meta.id}
                      approval={approval}
                      status={meta.status}
                      onFiles={(id, files) => setValue(id, files.length ? JSON.stringify(files) : "")}
                    />
                    {item.allowImages ? (
                      <FileItem
                        item={{ ...item, id: `img:${item.id}`, anyFile: false }}
                        label={item.label}
                        required={null}
                        files={readFiles(state.values[`img:${item.id}`])}
                        formId={meta.id}
                        locked={locked}
                        onFiles={(id, files) => setValue(id, files.length ? JSON.stringify(files) : "")}
                        pictures
                      />
                    ) : null}
                  </div>
                ))}
                {section.items.length === 0 ? <span className="text-faint text-xs">No fields in this section.</span> : null}
              </div>
            </div>
          );
        })}
      </fieldset>
      {layout && layout.footer.cells.length ? (
        <div className="border-line-2 mx-4 border-t py-2.5 sm:mx-[22px]">
          <DocLayoutPart part={layout.footer} values={layoutValues} testId="doc-footer" />
        </div>
      ) : null}

      {meta.docLayout && (context["company.name"] || context["company.address"] || context["company.licence"]) ? (
        <div className="text-ink-3 mx-4 mb-3 border-t border-[#101828] pt-2 text-center text-[11.5px] leading-[1.5] sm:mx-[22px]">
          {[context["company.name"], context["company.address"]].filter(Boolean).join(" · ")}
          {context["company.licence"] ? <span className="block">Mfg. Lic. / Reg. No.: {context["company.licence"]}</span> : null}
          {[context["company.phone"], context["company.email"], context["company.website"]].filter(Boolean).length ? (
            <span className="block">{[context["company.phone"], context["company.email"], context["company.website"]].filter(Boolean).join(" · ")}</span>
          ) : null}
        </div>
      ) : null}

      {!preview && editable && canApprove && approval?.stepNeedsImage && !context["user.signature"] ? (
        <div data-testid="sign-here" className="border-line-2 flex flex-col gap-1 border-t bg-[#F9F5FF] px-4 py-3.5 sm:px-[22px]">
          <span className="text-ink text-[13px] font-bold">Your signature is needed to {approval.stepKind === "reviewer" ? "review" : "approve"} this form</span>
          <SaveSignatureHere />
        </div>
      ) : null}
      {!preview ? (
        <div className="border-line-2 flex flex-wrap items-center gap-2.5 border-t px-4 py-3.5 sm:px-[22px]">
          {meta.id && (printHref || partId) ? (
            <a
              href={printHref ?? `/parts/${partId}/forms/${meta.id}/print`}
              target="_blank"
              rel="noopener"
              className="border-field text-ink flex h-[38px] items-center rounded-lg border bg-white px-3.5 text-[13px] font-semibold no-underline"
            >
              ↓ Print / PDF
            </a>
          ) : null}
          <span className="text-muted min-w-[160px] flex-1 text-xs">
            {meta.status === "Approved"
              ? `Approved by ${meta.approvedByName ?? "—"}${meta.approvedAt ? ` · ${meta.approvedAt}` : ""}${meta.submittedByName ? ` · submitted by ${meta.submittedByName}` : ""}`
              : meta.status === "Pending approval"
                ? `Submitted by ${meta.submittedByName ?? "—"}${meta.submittedAt ? ` · ${meta.submittedAt}` : ""}${
                    approval?.waiting && approval.sentToName ? ` · waiting for ${approval.sentToName}` : approveHint ? ` · ${approveHint}` : ""
                  }`
                : meta.savedByName
                  ? `Last saved by ${meta.savedByName}${meta.savedAt ? ` · ${meta.savedAt}` : ""}`
                  : approveHint ?? ""}
          </span>
          {viewing ? (
            onClose ? (
              <button type="button" onClick={onClose} className="bg-ink h-[38px] rounded-lg border-0 px-3.5 text-[13px] font-semibold text-white">
                Close
              </button>
            ) : null
          ) : waiting ? (
            <>
              {lifecycle?.canRevert ? (
                <button type="button" disabled={pending} onClick={revert} className="border-field h-[38px] rounded-lg border bg-white px-3.5 text-[13px] font-semibold disabled:opacity-60">
                  Revert to draft
                </button>
              ) : null}
              {canApprove ? (
                <>
                  {lifecycle?.canReject ? (
                    <button
                      type="button"
                      disabled={pending}
                      aria-expanded={rejecting}
                      onClick={() => setRejecting((o) => !o)}
                      className="border-bad text-bad h-[38px] rounded-lg border bg-white px-3.5 text-[13px] font-semibold disabled:opacity-60"
                    >
                      Reject
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run("approve")}
                    className="bg-ok h-[38px] rounded-lg border-0 px-3.5 text-[13px] font-semibold text-white disabled:opacity-45"
                  >
                    {approval?.stepKind === "reviewer" ? "Sign as reviewer" : "Approve"}
                  </button>
                </>
              ) : onClose ? (
                <button type="button" onClick={onClose} className="bg-ink h-[38px] rounded-lg border-0 px-3.5 text-[13px] font-semibold text-white">
                  Close
                </button>
              ) : null}
            </>
          ) : editable ? (
            <>
              <button type="button" disabled={pending} onClick={() => run("draft")} className="border-field h-[38px] rounded-lg border bg-white px-3.5 text-[13px] font-semibold disabled:opacity-60">
                Save draft
              </button>
              <button
                type="button"
                disabled={pending}
                aria-expanded={sending}
                onClick={() => {
                  // The same checks the server makes, before asking who to send it to.
                  if (result.missing.length) return toast("Fill all required items before submitting", true);
                  if (result.blocked.length) return toast(`${result.blocked[0]} — pick another item or fix it first`, true);
                  if (approval?.chained) {
                    const unpicked = sections
                      .flatMap((sec) => sec.items)
                      .find((i) => chainField(i) && i.req && !readPeople(state.values[peopleKey(i.id)]).length);
                    if (unpicked) return toast(`Choose who signs "${unpicked.label}"`, true);
                    return run("submit");
                  }
                  setSending((o) => !o);
                }}
                className="h-[38px] rounded-lg border-0 bg-[#6941C6] px-3.5 text-[13px] font-semibold text-white disabled:opacity-60"
              >
                Submit for approval
              </button>
              <button
                type="button"
                disabled={pending || !canApprove}
                title={!canApprove && approveHint ? approveHint : undefined}
                onClick={() => run("approve")}
                className="bg-ok h-[38px] rounded-lg border-0 px-3.5 text-[13px] font-semibold text-white disabled:opacity-45"
              >
                {approval?.stepKind === "reviewer" ? "Sign as reviewer" : "Approve"}
              </button>
            </>
          ) : (
            <>
              {lifecycle?.canRevise ? (
                <button type="button" disabled={pending} onClick={revert} className="border-field h-[38px] rounded-lg border bg-white px-3.5 text-[13px] font-semibold disabled:opacity-60">
                  Revise — new version
                </button>
              ) : null}
              {onClose ? (
                <button type="button" onClick={onClose} className="bg-ink h-[38px] rounded-lg border-0 px-3.5 text-[13px] font-semibold text-white">
                  Close
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      {!preview && !viewing && waiting && rejecting ? (
        <div className="border-line-2 flex flex-col gap-2 border-t bg-[#FEF3F2] px-4 py-3.5 sm:px-[22px]">
          <label className="text-ink flex flex-col gap-1.5 text-[13px] font-bold">
            Reason for rejection
            <textarea
              aria-label="Reason for rejection"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="What needs correcting — it goes back to the sender as a draft"
              className="border-field rounded-lg border bg-white px-2.5 py-2 text-[13px] font-normal"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending} onClick={reject} className="bg-bad h-[38px] rounded-lg border-0 px-3.5 text-[13px] font-semibold text-white disabled:opacity-60">
              {pending ? "Sending back…" : "Reject and send back"}
            </button>
            <button type="button" onClick={() => setRejecting(false)} className="border-field h-[38px] rounded-lg border bg-white px-3 text-[13px] font-semibold">
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {!preview && editable && sending ? (
        <div className="border-line-2 flex flex-col gap-2 border-t bg-[#F9F5FF] px-4 py-3.5 sm:px-[22px]">
          <span className="text-ink text-[13px] font-bold">Send for approval to</span>
          <span className="text-muted text-[12px]">
            {approval?.approverRoles ? `Only people who hold ${approval.approverRoles} approve this stage's forms.` : "Anyone in the space can approve this stage's forms."} Only the person
            you choose can approve it.
          </span>
          {approval && approval.sendChoices.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Send for approval to"
                value={sendTo}
                onChange={(e) => setSendTo(e.target.value)}
                className="border-field h-[38px] min-w-0 flex-1 rounded-lg border bg-white px-2.5 text-[13px] sm:max-w-[420px]"
              >
                <option value="">— Choose a person —</option>
                {approval.sendChoices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.roles ? ` · ${p.roles}` : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={pending || !sendTo}
                onClick={() => run("submit", sendTo)}
                className="h-[38px] rounded-lg border-0 bg-[#6941C6] px-3.5 text-[13px] font-semibold text-white disabled:opacity-50"
              >
                {pending ? "Sending…" : "Send"}
              </button>
              <button type="button" onClick={() => setSending(false)} className="border-field h-[38px] rounded-lg border bg-white px-3 text-[13px] font-semibold">
                Cancel
              </button>
            </div>
          ) : (
            <span className="text-bad text-[12.5px]">
              Nobody in this space can approve it{approval?.approverRoles ? ` — no one else holds ${approval.approverRoles}` : ""}. Ask an admin to give
              someone that role, or change the stage&apos;s approvers in the workflow.
            </span>
          )}
        </div>
      ) : null}
      {!preview && approval?.canPassOn ? (
        <div className="border-line-2 flex flex-wrap items-center gap-2 border-t px-4 py-3 sm:px-[22px]">
          <span className="text-ink-2 text-[12.5px] font-semibold">Away? Pass it on to</span>
          {approval.passOnChoices.length ? (
            <>
              <select
                aria-label="Pass on to"
                value={passTo}
                onChange={(e) => setPassTo(e.target.value)}
                className="border-field h-[34px] min-w-0 flex-1 rounded-lg border bg-white px-2 text-[12.5px] sm:max-w-[360px]"
              >
                <option value="">— Choose a person —</option>
                {approval.passOnChoices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.roles ? ` · ${p.roles}` : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={pending || !passTo}
                onClick={passOn}
                className="border-field h-[34px] rounded-lg border bg-white px-3 text-[12.5px] font-semibold disabled:opacity-50"
              >
                Pass on
              </button>
            </>
          ) : (
            <span className="text-muted text-[12.5px]">No one else can approve it.</span>
          )}
        </div>
      ) : null}
      {!preview && lifecycle && lifecycle.versions.length ? (
        <div data-testid="versions" className="border-line-2 flex flex-col gap-1.5 border-t px-4 py-3.5 sm:px-[22px]">
          <span className="text-ink text-[13px] font-bold">Versions kept</span>
          {lifecycle.versions.map((v) => (
            <div key={v.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12.5px]">
              <span className="text-ink font-semibold">Version {v.version}</span>
              <FormStatusPill status={v.event === "approved" ? "Approved" : "Rejected"} />
              <span className="text-ink-3">
                {v.event === "approved" ? "Approved" : "Rejected"} by {v.byName} · {v.at}
              </span>
              {v.reason ? <span className="text-ink-2 min-w-0 basis-full break-words sm:basis-auto">— {v.reason}</span> : null}
              <Link href={`${lifecycle.versionHref}${v.id}`} scroll={false} className="text-brand-ink font-semibold">
                View
              </Link>
            </div>
          ))}
        </div>
      ) : null}
      {toastNode}
    </div>
  );
}

// --- One item ------------------------------------------------------------------------------

/** No signature image yet: draw or upload one here; it is kept on the profile, and the form keeps what was entered. */
function SaveSignatureHere() {
  const router = useRouter();
  return (
    <div className="border-line rounded-lg border border-dashed bg-white px-3 py-2.5">
      <SignaturePad compact title="Add your signature — it is saved to your profile for next time" onSaved={() => router.refresh()} />
    </div>
  );
}

/**
 * Text from the part or request with its links clickable: web addresses in
 * full, opening in a new tab, and request files by name, opening the file.
 */
function LinkedText({ text, context }: { text: string; context: Context }) {
  const pieces = text.split(/(https?:\/\/[^\s,]+|, )/);
  if (pieces.length === 1 && !context[`${FILE_PREFIX}${text}`]) return <>{text}</>;
  return (
    <>
      {pieces.map((piece, i) => {
        if (/^https?:\/\//.test(piece)) {
          return (
            <a key={i} href={piece} target="_blank" rel="noopener noreferrer" className="text-brand-ink underline [overflow-wrap:anywhere]">
              {piece}
            </a>
          );
        }
        const file = piece && context[`${FILE_PREFIX}${piece}`];
        if (file) {
          return (
            <a key={i} href={file} target="_blank" rel="noopener" className="text-brand-ink underline">
              {piece}
            </a>
          );
        }
        return <span key={i}>{piece}</span>;
      })}
    </>
  );
}

/** The display size chosen for an image item's picture: {request.productImage} → its @size. */
function itemImageSize(item: QaItem, context: Context) {
  const token = /^\{([^{}\s]+)\}$/.exec(item.value.trim())?.[1];
  return imageSize(token ? context[sizeKey(token)] : undefined);
}

/** A large or full-width picture takes the whole row of its section. */
const wideImage = (item: QaItem, context: Context) => item.type === "image" && ["L", "XL"].includes(itemImageSize(item, context));

/** A signature as signed: the image (for that style), the name, the role, the time. */
function SignedLine({ style, name, roles, at, fileId, timeZone }: { style: QaItem["style"]; name: string; roles: string; at: string; fileId?: string; timeZone: string | undefined }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3">
      {style === "image" && fileId ? (
        // eslint-disable-next-line @next/next/no-img-element -- the copy kept with this record
        <img src={`/api/part-files/${fileId}`} alt={`Signature of ${name}`} className="h-[48px] max-w-[170px] object-contain" />
      ) : null}
      <div className="flex min-w-0 flex-col gap-0.5 text-[12.5px]">
        <span className="text-ink font-semibold" style={style === "image" ? undefined : { fontFamily: "'Brush Script MT', cursive", fontSize: 18 }}>
          {name}
        </span>
        {(style === "role" || style === "image") && roles ? <span className="text-ink-3">{roles}</span> : null}
        <span className="text-muted font-mono text-[11.5px]">{stampTime(at, timeZone)}</span>
      </div>
    </div>
  );
}

/** "Prepared by": the person filling the form — shown at once, signed as they submit it. */
function PreparedSign({
  item,
  label,
  required,
  stamp,
  signedName,
  context,
  locked,
}: {
  item: QaItem;
  label: string;
  required: React.ReactNode;
  stamp: { name: string; roles: string; at: string; fileId?: string } | null;
  signedName: string;
  context: Context;
  locked: boolean;
}) {
  const me = context["user.name"] ?? "";
  const role = context["user.role"] ?? "";
  return (
    <div data-testid="auto-sign-submitter" className="flex flex-col gap-1.5">
      <span className="text-ink-2 text-[12.5px] font-semibold">
        {label}
        {required}
      </span>
      <div className="border-line flex min-h-[56px] flex-wrap items-center gap-3 rounded-lg border bg-white px-3 py-2">
        {signedName && stamp ? (
          <SignedLine style={item.style} name={signedName} roles={stamp.roles} at={stamp.at} fileId={stamp.fileId} timeZone={context["space.timeZone"]} />
        ) : locked || !me ? (
          <span className="text-faint text-[12px]">Not signed</span>
        ) : (
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            {item.style === "image" && context["user.signature"] ? (
              // eslint-disable-next-line @next/next/no-img-element -- the signer's own image, until the form is submitted
              <img src={`/api/signatures/me?v=${encodeURIComponent(context["user.signature"] ?? "")}`} alt="Your signature" className="h-[48px] max-w-[170px] object-contain opacity-80" />
            ) : null}
            <div className="flex min-w-0 flex-col gap-0.5 text-[12.5px]">
              <span className="text-ink font-semibold" style={item.style === "image" ? undefined : { fontFamily: "'Brush Script MT', cursive", fontSize: 18 }}>
                {me}
              </span>
              {(item.style === "role" || item.style === "image") && role ? <span className="text-ink-3">{role}</span> : null}
              {item.style === "image" && !context["user.signature"] ? (
                <span className="text-warn text-[11.5px]">No signature on your profile yet — add it below.</span>
              ) : (
                <span className="text-muted text-[11.5px]">Signed with the time as you submit it</span>
              )}
            </div>
          </div>
        )}
      </div>
      {!locked && !(signedName && stamp) && item.style === "image" && !context["user.signature"] ? <SaveSignatureHere /> : null}
      {item.roles ? <span className="text-muted text-[11.5px]">Only {item.roles} may sign</span> : null}
    </div>
  );
}

/** "Reviewed by" / "Approved by": the people chosen while filling the form; each signs in turn. */
function ChainSign({
  item,
  label,
  required,
  people,
  stamps,
  choices,
  canPick,
  pending,
  turnId,
  timeZone,
  onPeople,
}: {
  item: QaItem;
  label: string;
  required: React.ReactNode;
  people: Array<{ id: string; name: string }>;
  stamps: Array<{ id: string; name: string; roles: string; at: string; fileId?: string }>;
  choices: Array<{ id: string; name: string; roles: string }>;
  canPick: boolean;
  pending: boolean;
  turnId: string | null;
  timeZone: string | undefined;
  onPeople: (list: Array<{ id: string; name: string }>) => void;
}) {
  const kind = item.signer === "reviewer" ? "reviewer" : "approver";
  const left = choices.filter((c) => !people.some((p) => p.id === c.id));
  return (
    <div data-testid={`auto-sign-${kind}`} className="flex flex-col gap-1.5">
      <span className="text-ink-2 text-[12.5px] font-semibold">
        {label}
        {required}
      </span>
      <div className="border-line flex min-h-[56px] flex-col gap-2 rounded-lg border bg-white px-3 py-2">
        {people.map((person) => {
          const stamp = stamps.find((x) => x.id === person.id);
          return (
            <div key={person.id} className="flex flex-wrap items-center gap-2">
              {stamp ? (
                <SignedLine style={item.style} name={stamp.name} roles={stamp.roles} at={stamp.at} fileId={stamp.fileId} timeZone={timeZone} />
              ) : (
                <>
                  <span className="text-ink text-[13px] font-semibold">{person.name}</span>
                  {pending ? (
                    <span
                      className={
                        "rounded-full px-2 py-0.5 text-[11px] font-semibold " + (turnId === person.id ? "bg-[#F4F3FF] text-[#5925DC]" : "bg-subtle text-ink-3")
                      }
                    >
                      {turnId === person.id ? (kind === "reviewer" ? "To review now" : "To approve now") : "Waiting"}
                    </span>
                  ) : null}
                  {canPick ? (
                    <button
                      type="button"
                      aria-label={`Remove ${person.name}`}
                      onClick={() => onPeople(people.filter((p) => p.id !== person.id))}
                      className="bg-chip text-ink-3 h-[22px] w-[22px] rounded-[5px] border-0 text-xs"
                    >
                      ×
                    </button>
                  ) : null}
                </>
              )}
            </div>
          );
        })}
        {canPick ? (
          left.length ? (
            <select
              aria-label={`${label} — choose a person`}
              value=""
              onChange={(e) => {
                const chosen = choices.find((c) => c.id === e.target.value);
                if (chosen) onPeople([...people, { id: chosen.id, name: chosen.name }]);
              }}
              className="border-field text-ink h-9 w-full min-w-0 rounded-lg border bg-white px-2.5 text-[13px] sm:max-w-[360px]"
            >
              <option value="">{people.length ? `+ Add another ${kind}` : `Choose the ${kind}…`}</option>
              {left.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.roles ? ` · ${c.roles}` : ""}
                </option>
              ))}
            </select>
          ) : people.length ? null : (
            <span className="text-bad text-[12px]">No one can sign this{item.roles ? ` — no one else holds ${item.roles}` : ""}.</span>
          )
        ) : people.length ? null : (
          <span className="text-faint text-[12px]">No one chosen</span>
        )}
      </div>
      <span className="text-muted text-[11.5px]">
        {kind === "reviewer" ? "Reviewers sign first, in this order; then the approvers." : "Approvers sign after the reviewers; the last one approves the form."}
        {item.roles ? ` Only ${item.roles}.` : ""}
      </span>
    </div>
  );
}

function ItemView({
  item,
  state,
  context,
  libraries,
  inspection,
  snap,
  computed,
  locked,
  docLayout,
  partMaterial,
  setValue,
  setMeasured,
  setQty,
  formId,
  approval,
  status,
  onFiles,
}: {
  item: QaItem;
  /** Who reviews and approves it — for Reviewed by / Approved by signatures. */
  approval?: Approval;
  status: string;
  state: FormState;
  context: Context;
  libraries: Libraries;
  inspection: Inspection | null;
  snap?: { label: string; line: string; warn: string | null };
  /** A calculated field's result. */
  computed?: Computed;
  /** The record, when there is one — attachments need it. */
  formId: string | null;
  onFiles: (itemId: string, files: Array<{ id: string; name: string; type: string }>) => void;
  locked: boolean;
  docLayout: boolean;
  partMaterial: string;
  setValue: (id: string, value: string) => void;
  setMeasured: (key: string, value: string) => void;
  setQty: (id: string, value: string) => void;
}) {
  const label = resolve(item.label, context);
  const required = item.req ? <span className="text-bad"> *</span> : null;
  const INPUT = "border-field text-ink h-9 w-full min-w-0 rounded-lg border bg-white px-2.5 text-[13px] disabled:bg-subtle disabled:text-ink-2";

  switch (item.type) {
    case "info": {
      const shown = resolve(item.value, context) || "—";
      if (docLayout) {
        return (
          <div className="-mt-px flex flex-wrap gap-x-1.5 gap-y-1 border border-[#101828] px-3 py-2 text-[13px] leading-[1.5] text-[#101828]">
            <span className="font-bold">{label}:</span>
            <span className="[overflow-wrap:anywhere] whitespace-pre-line">
              <LinkedText text={shown} context={context} />
            </span>
          </div>
        );
      }
      return (
        <div className="grid grid-cols-1 items-baseline gap-x-2.5 gap-y-0.5 text-[13px] @md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
          <span className="text-muted">{label}</span>
          <span className={"font-semibold [overflow-wrap:anywhere] whitespace-pre-wrap " + (shown === "—" ? "text-faint" : "text-ink")}>
            <LinkedText text={shown} context={context} />
          </span>
        </div>
      );
    }
    case "image": {
      const src = resolve(item.value, context);
      const usable = src.startsWith("/api/") || /^https?:\/\//.test(src);
      // The size the requester chose for this image.
      const size = itemImageSize(item, context);
      return (
        <div
          className={
            "grid grid-cols-1 items-start gap-x-2.5 gap-y-1 text-[13px] " + (size === "L" || size === "XL" ? "" : "@md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]")
          }
        >
          <span className="text-muted">{label}</span>
          {usable ? (
            // eslint-disable-next-line @next/next/no-img-element -- a stored request image
            <img src={src} alt={label} data-size={size} className={`border-line-2 h-auto rounded-lg border object-contain ${IMAGE_SIZE_CLASS[size]}`} />
          ) : (
            <span className="text-faint font-semibold">—</span>
          )}
        </div>
      );
    }
    case "text":
      return (
        <label className="text-ink-2 flex flex-col gap-[5px] text-[12.5px] font-semibold">
          <span>
            {label}
            {required}
          </span>
          <input value={enteredText(item, state, context)} onChange={(e) => setValue(item.id, e.target.value)} className={`${INPUT} font-normal`} />
        </label>
      );
    case "date":
    case "datetime":
    case "time": {
      const text = enteredText(item, state, context);
      return (
        <label className="text-ink-2 flex flex-col gap-[5px] text-[12.5px] font-semibold">
          <span>
            {label}
            {required}
          </span>
          <input
            type={item.type === "datetime" ? "datetime-local" : item.type}
            aria-label={label}
            // A pre-fill like {now} reads "2026-10-01T14:05"; the inputs want that shape.
            value={item.type === "datetime" ? text.replace(" ", "T").slice(0, 16) : text}
            onChange={(e) => setValue(item.id, e.target.value)}
            className={`${INPUT} font-mono font-normal`}
          />
        </label>
      );
    }
    case "duration": {
      const text = enteredText(item, state, context);
      const lsl = resolve(item.lsl, context);
      const usl = resolve(item.usl, context);
      const lo = lsl === "—" ? "" : lsl;
      const hi = usl === "—" ? "" : usl;
      const unreadable = text.trim() !== "" && parseDuration(text) === null;
      return (
        <div className="flex flex-col gap-1">
          <div className={"grid items-center gap-x-2.5 gap-y-1.5 " + (lo || hi ? "grid-cols-[minmax(0,1fr)_110px] @lg:grid-cols-[minmax(0,1.2fr)_120px_minmax(0,0.9fr)_auto]" : "grid-cols-[minmax(0,1fr)_110px] @lg:grid-cols-[minmax(0,1.2fr)_120px]")}>
            <span className={"text-ink-2 text-[12.5px] font-semibold " + (lo || hi ? "col-span-2 @lg:col-span-1" : "")}>
              {label}
              {required}
            </span>
            <input
              aria-label={label}
              value={text}
              placeholder="h:mm"
              onChange={(e) => setValue(item.id, e.target.value)}
              // "90", "1h 30m" and "1:30" all mean the same; show it as h:mm.
              onBlur={(e) => {
                const minutes = parseDuration(e.target.value);
                if (minutes !== null) setValue(item.id, formatDuration(minutes));
              }}
              className={`${INPUT} h-[34px] font-mono`}
            />
            {lo || hi ? (
              <>
                <span className="text-muted font-mono text-[11.5px]">Spec {specText(lo, hi)}</span>
                <ResultChip result={judgeKind("duration", text, lsl, usl)} />
              </>
            ) : null}
          </div>
          {unreadable ? <span className="text-bad text-[11.5px]">Enter h:mm (1:30), minutes (90) or 1h 30m.</span> : null}
        </div>
      );
    }
    case "calc": {
      // An approved record shows the result it was saved with.
      const stored = locked ? state.values[item.id] : undefined;
      const shown = stored ?? computed?.text ?? "";
      const lsl = resolve(item.lsl, context);
      const usl = resolve(item.usl, context);
      const lo = lsl === "—" ? "" : lsl;
      const hi = usl === "—" ? "" : usl;
      return (
        <div className="flex flex-col gap-1">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 @lg:grid-cols-[minmax(0,1.2fr)_minmax(120px,auto)_auto]">
            <span className="text-ink-2 text-[12.5px] font-semibold">
              {label}
              {required}
            </span>
            <output
              aria-label={label}
              data-calc={item.id}
              className={
                "bg-subtle border-line-2 flex h-[34px] min-w-[120px] items-center rounded-lg border px-2.5 font-mono text-[13px] font-semibold " +
                (shown ? "text-ink" : "text-faint")
              }
            >
              {shown || "—"}
            </output>
            {lo || hi ? (
              <span className="flex items-center gap-2">
                <span className="text-muted font-mono text-[11.5px]">Spec {specText(lo, hi)}</span>
                <ResultChip result={computed?.value ? judgeValue(computed.value, lsl, usl) : ""} />
              </span>
            ) : null}
          </div>
          <span className="text-muted text-[11px] [overflow-wrap:anywhere]">
            {computed?.error ? <span className="text-bad">{computed.error}</span> : <>= {item.formula || "—"}{!shown ? " · fills in once its fields are entered" : ""}</>}
          </span>
        </div>
      );
    }
    case "grid":
      return <GridItem item={item} label={label} required={required} value={state.values[item.id] ?? ""} context={context} locked={locked} setValue={setValue} formId={formId} />;
    case "yesno": {
      const value = state.values[item.id] ?? "";
      return (
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-ink min-w-[160px] flex-1 text-[13px]">
            {label}
            {required}
            {item.expect ? <span className="text-muted text-[11.5px]"> · expected {item.expect}</span> : null}
          </span>
          {(["Yes", "No"] as const).map((option) => {
            const on = value === option;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={on}
                aria-label={`${label}: ${option}`}
                onClick={() => setValue(item.id, on ? "" : option)}
                className={"h-[30px] min-w-[52px] rounded-[7px] border px-3 text-xs font-bold " + (on ? "border-ink bg-ink text-white" : "border-field text-ink-3 bg-white")}
              >
                {option}
              </button>
            );
          })}
          {item.expect ? <ResultChip result={value ? (value === item.expect ? "Pass" : "Fail") : ""} /> : null}
        </div>
      );
    }
    case "file":
      return <FileItem item={item} label={label} required={required} files={readFiles(state.values[item.id])} formId={formId} locked={locked} onFiles={onFiles} />;
    case "sign": {
      const stamp = (() => {
        try {
          return state.values[`sig:${item.id}`] ? (JSON.parse(state.values[`sig:${item.id}`]) as { name: string; roles: string; at: string; fileId?: string }) : null;
        } catch {
          return null;
        }
      })();
      const mayNot = item.roles && !roleAllowed(item.roles, context["user.role"] ?? "");
      const signer = autoSigner(item);
      if (signer === "submitter") return <PreparedSign item={item} label={label} required={required} stamp={stamp} signedName={state.values[item.id] ?? ""} context={context} locked={locked} />;
      if (signer)
        return (
          <ChainSign
            item={item}
            label={label}
            required={required}
            people={readPeople(state.values[peopleKey(item.id)])}
            stamps={readStamps(state.values[stampsKey(item.id)])}
            choices={approval?.pickChoices[item.id] ?? []}
            canPick={!locked && status !== "Pending approval" && status !== "Approved"}
            pending={status === "Pending approval"}
            turnId={approval?.sentToId ?? null}
            timeZone={context["space.timeZone"]}
            onPeople={(list) => setValue(peopleKey(item.id), list.length ? JSON.stringify(list) : "")}
          />
        );
      const signedText = enteredText(item, state, context);
      // The role shown: the signer's, once signed; until then, the role of whoever is signing.
      const role = stamp && signedText === (state.values[item.id] ?? "") ? stamp.roles : signedText ? (context["user.role"] ?? "") : "";
      if (item.style === "image") {
        const saved = stamp?.fileId && signedText ? stamp.fileId : null;
        return (
          <div className="flex flex-col gap-1.5">
            <span className="text-ink-2 text-[12.5px] font-semibold">
              {label}
              {required}
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <div className="border-line flex h-[72px] w-[200px] flex-none items-center justify-center overflow-hidden rounded-lg border bg-white">
                {saved ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the copy kept with this record
                  <img src={`/api/part-files/${saved}`} alt={`Signature of ${stamp?.name}`} className="max-h-full max-w-full object-contain" />
                ) : signedText ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the signer's own image, until the form is saved
                  <img src={`/api/signatures/me?v=${encodeURIComponent(context["user.signature"] ?? "")}`} alt="Your signature" className="max-h-full max-w-full object-contain" />
                ) : (
                  <span className="text-faint text-[12px]">Not signed</span>
                )}
              </div>
              <div className="flex min-w-[160px] flex-1 flex-col gap-0.5 text-[12.5px]">
                {signedText ? (
                  <>
                    <span className="text-ink font-semibold">{signedText}</span>
                    {role ? <span className="text-ink-3">{role}</span> : null}
                    <span className="text-muted font-mono text-[11.5px]">
                      {stamp && saved ? stampTime(stamp.at, context["space.timeZone"]) : "Signed — kept when the form is saved"}
                    </span>
                  </>
                ) : locked ? null : mayNot ? (
                  <span className="text-warn">Only {item.roles} may sign — not you</span>
                ) : context["user.signature"] ? (
                  <button
                    type="button"
                    onClick={() => setValue(item.id, context["user.name"] ?? "")}
                    className="bg-ink h-8 self-start rounded-lg border-0 px-3 text-[12.5px] font-semibold text-white"
                  >
                    Sign with my signature
                  </button>
                ) : (
                  <span className="text-warn">No signature on your profile yet — add it below to sign here.</span>
                )}
                {signedText && !locked && !mayNot ? (
                  <button type="button" onClick={() => setValue(item.id, "")} className="text-brand-ink self-start border-0 bg-transparent p-0 text-xs font-semibold">
                    Remove signature
                  </button>
                ) : null}
              </div>
            </div>
            {!locked && !mayNot && !signedText && !context["user.signature"] ? <SaveSignatureHere /> : null}
            {item.roles ? <span className="text-muted text-[11.5px]">Only {item.roles} may sign</span> : null}
          </div>
        );
      }
      return (
        <div className="flex flex-col gap-1">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2.5">
            <label className="text-ink-2 flex min-w-0 flex-col gap-[5px] text-[12.5px] font-semibold">
              <span>
                {label}
                {required}
              </span>
              <input
                value={enteredText(item, state, context)}
                onChange={(e) => setValue(item.id, e.target.value)}
                disabled={Boolean(mayNot)}
                aria-label={label}
                className={`${INPUT} font-normal`}
                style={{ fontFamily: "'Brush Script MT', cursive", fontSize: 18 }}
              />
            </label>
            <span className="text-ink-3 flex h-9 items-center font-mono text-[12.5px] whitespace-nowrap">Date: {context.today ?? ""}</span>
          </div>
          {item.style === "role" && role ? <span className="text-ink-2 text-[12.5px] font-semibold">Role: {role}</span> : null}
          {item.roles ? (
            <span className={"text-[11.5px] " + (mayNot && !locked ? "text-warn" : "text-muted")}>
              Only {item.roles} may sign{mayNot && !locked ? " — not you" : ""}
            </span>
          ) : null}
          {stamp ? (
            <span className="text-muted text-[11.5px]">
              Signed in as {stamp.name}
              {stamp.roles ? ` (${stamp.roles})` : ""} · {stampTime(stamp.at, context["space.timeZone"])}
            </span>
          ) : null}
        </div>
      );
    }
    case "number": {
      const value = state.values[item.id] ?? "";
      const lsl = resolve(item.lsl, context);
      const usl = resolve(item.usl, context);
      const lo = lsl === "—" ? "" : lsl;
      const hi = usl === "—" ? "" : usl;
      // A count or reading with no limits is just a value: no spec, no result.
      if (!lo && !hi) {
        return (
          <label className="grid grid-cols-[minmax(0,1fr)_110px] items-center gap-x-2.5 @lg:grid-cols-[minmax(0,1.2fr)_120px]">
            <span className="text-ink-2 text-[12.5px] font-semibold">
              {label}
              {required}
            </span>
            <input
              aria-label={label}
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(item.id, e.target.value)}
              className={`${INPUT} h-[34px] font-mono`}
            />
          </label>
        );
      }
      return (
        <div className="grid grid-cols-[minmax(0,1fr)_110px] items-center gap-x-2.5 gap-y-1.5 @lg:grid-cols-[minmax(0,1.2fr)_120px_minmax(0,0.9fr)_auto]">
          <span className="text-ink-2 col-span-2 text-[12.5px] font-semibold @lg:col-span-1">
            {label}
            {required}
          </span>
          <input
            aria-label={label}
            inputMode="decimal"
            value={value}
            placeholder="Measured"
            onChange={(e) => setValue(item.id, e.target.value)}
            className={`${INPUT} h-[34px] font-mono`}
          />
          <span className="text-muted font-mono text-[11.5px]">Spec {specText(lo, hi)}</span>
          <ResultChip result={judge(value, lsl, usl)} />
        </div>
      );
    }
    case "check": {
      const value = state.values[item.id] ?? "";
      return (
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-ink min-w-[160px] flex-1 text-[13px]">
            {label}
            {required}
          </span>
          {(["Pass", "Fail", "N/A"] as const).map((option) => {
            const on = value === option;
            const tone = option === "Pass" ? "border-[#75E0A7] bg-ok-tint text-ok" : option === "Fail" ? "border-[#FDA29B] bg-bad-tint text-bad" : "border-ink bg-ink text-white";
            return (
              <button
                key={option}
                type="button"
                aria-pressed={on}
                aria-label={`${label}: ${option}`}
                onClick={() => setValue(item.id, on ? "" : option)}
                className={"h-[30px] rounded-[7px] border px-3 text-xs font-bold " + (on ? tone : "border-field text-ink-3 bg-white")}
              >
                {option}
              </button>
            );
          })}
        </div>
      );
    }
    case "select":
      return (
        <SelectItem
          item={item}
          label={label}
          state={state}
          context={context}
          libraries={libraries}
          snap={snap}
          locked={locked}
          partMaterial={partMaterial}
          setValue={setValue}
          setQty={setQty}
        />
      );
    case "table":
      return <TableItem item={item} label={label} state={state} inspection={inspection} setMeasured={setMeasured} />;
    case "criteria":
      return (
        <div className="overflow-x-auto">
          <div className="min-w-[560px] border border-[#101828] text-[12.5px] text-[#101828]">
            <div className="grid grid-cols-[1.05fr_1fr_1.25fr_1.25fr] text-center font-bold">
              {["Requirement Type", "Feature", "Specification", "Testing / Acceptance Method"].map((h, i) => (
                <div key={h} className={"p-2 " + (i < 3 ? "border-r border-[#101828]" : "")}>
                  {h}
                </div>
              ))}
            </div>
            {REQUIREMENTS.map(([title, prefix]) => (
              <div key={prefix} className="grid grid-cols-[1.05fr_1fr_1.25fr_1.25fr] border-t border-[#101828] leading-[1.45]">
                <div className="border-r border-[#101828] px-2 py-1.5">{title}</div>
                <div className="border-r border-[#101828] px-2 py-1.5">{context[`request.${prefix}Feature`] || "—"}</div>
                <div className="border-r border-[#101828] px-2 py-1.5">{context[`request.${prefix}Specification`] || "—"}</div>
                <div className="px-2 py-1.5">{context[`request.${prefix}TestMethod`] || "—"}</div>
              </div>
            ))}
          </div>
        </div>
      );
  }
}

// --- Data table ----------------------------------------------------------------------------------

const newRowId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function GridItem({
  item,
  label,
  required,
  value,
  context,
  locked,
  setValue,
  formId = null,
}: {
  item: QaItem;
  label: string;
  required: React.ReactNode;
  value: string;
  context: Context;
  locked: boolean;
  setValue: (id: string, value: string) => void;
  /** The saved form, for a row's picture (an image column). */
  formId?: string | null;
}) {
  const columns = item.columns ?? [];
  const rows = readRows(value);
  // Being filled, an empty table starts with one row to type into; it is kept once something is typed in it.
  const [blankId] = useState(() => newRowId());
  const shown = rows.length || locked ? rows : [{ id: blankId, c: {} }];
  const write = (next: GridRow[]) => setValue(item.id, next.length ? JSON.stringify(next) : "");
  const setCell = (rowId: string, colId: string, text: string) =>
    write(
      rows.some((r) => r.id === rowId)
        ? rows.map((r) => (r.id === rowId ? { ...r, c: { ...r.c, [colId]: text } } : r))
        : [...rows, { id: rowId, c: { [colId]: text } }],
    );
  const CELL = "border-field text-ink h-8 w-full min-w-0 rounded-md border bg-white px-2 text-[12.5px] disabled:bg-subtle disabled:text-ink-2";

  function cell(col: GridColumn, row: GridRow, n: number, calc: Record<string, Computed>) {
    const text = row.c[col.id] ?? "";
    const aria = `${col.label} row ${n + 1}`;
    if (col.kind === "calc") {
      const result = calc[col.id];
      return (
        <output aria-label={aria} title={result?.error ?? `= ${col.formula}`} className={"bg-subtle flex h-8 items-center rounded-md px-2 font-mono text-[12.5px] font-semibold " + (result?.error ? "text-bad" : "text-ink")}>
          {result?.error ? "!" : result?.text || "—"}
        </output>
      );
    }
    if (col.kind === "check") {
      return (
        <input
          type="checkbox"
          aria-label={aria}
          checked={text === "Yes"}
          disabled={locked}
          onChange={(e) => setCell(row.id, col.id, e.target.checked ? "Yes" : "")}
          className="accent-brand h-4 w-4"
        />
      );
    }
    if (col.kind === "image") {
      return <GridImageCell aria={aria} fileId={text} formId={formId} itemId={item.id} rowId={row.id} locked={locked} onChange={(id) => setCell(row.id, col.id, id)} />;
    }
    if (col.kind === "yesno" || col.kind === "select") {
      const options = col.kind === "yesno" ? ["Yes", "No"] : customOptions(col.opts);
      return (
        <select aria-label={aria} value={text} onChange={(e) => setCell(row.id, col.id, e.target.value)} className={CELL}>
          <option value="">—</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    const type = col.kind === "date" ? "date" : col.kind === "datetime" ? "datetime-local" : col.kind === "time" ? "time" : "text";
    return (
      <input
        aria-label={aria}
        type={type}
        value={col.kind === "datetime" ? text.replace(" ", "T").slice(0, 16) : text}
        inputMode={col.kind === "number" ? "decimal" : undefined}
        placeholder={col.kind === "duration" ? "h:mm" : undefined}
        onChange={(e) => setCell(row.id, col.id, e.target.value)}
        onBlur={(e) => {
          if (col.kind !== "duration") return;
          const minutes = parseDuration(e.target.value);
          if (minutes !== null) setCell(row.id, col.id, formatDuration(minutes));
        }}
        className={CELL + (col.kind === "text" ? "" : " font-mono")}
      />
    );
  }

  // Wide tables (many columns) take narrower columns, so the whole table fits the page when it can.
  const colMin = columns.length > 8 ? 78 : columns.length > 6 ? 88 : 130;
  const template = `36px repeat(${columns.length}, minmax(${colMin}px, 1fr))${locked ? "" : " 34px"}`;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-ink-2 text-[12.5px] font-semibold">
        {label}
        {required}
      </span>
      <div className="border-line-2 overflow-x-auto rounded-lg border">
        <div style={{ minWidth: 36 + columns.length * colMin + (locked ? 0 : 34) }}>
          <div className="bg-subtle text-ink-3 grid gap-1.5 px-2 py-1.5 text-[10.5px] font-bold tracking-[0.3px] uppercase" style={{ gridTemplateColumns: template }}>
            <span>#</span>
            {columns.map((c) => (
              <span key={c.id} title={c.kind === "calc" ? `= ${c.formula}` : COLUMN_KIND_LABELS[c.kind]}>
                {c.label}
                {c.req ? <span className="text-bad"> *</span> : null}
              </span>
            ))}
            {locked ? null : <span />}
          </div>
          {shown.map((row, n) => {
            const calc = computeRow(columns, row, context);
            return (
              <div key={row.id} className="border-line-3 grid items-center gap-1.5 border-t px-2 py-1.5" style={{ gridTemplateColumns: template }}>
                <span className="text-ink-3 font-mono text-[12px]">{n + 1}</span>
                {columns.map((c) => (
                  <div key={c.id} className="min-w-0">
                    {cell(c, row, n, calc)}
                  </div>
                ))}
                {locked ? null : !rows.some((r) => r.id === row.id) ? (
                  <span />
                ) : (
                  <button type="button" aria-label={`Remove row ${n + 1}`} onClick={() => write(rows.filter((r) => r.id !== row.id))} className="text-faint h-7 w-7 rounded-md border-0 bg-transparent text-base">
                    ×
                  </button>
                )}
              </div>
            );
          })}
          {shown.length === 0 ? <div className="text-faint border-line-3 border-t px-3 py-2.5 text-[12.5px]">No rows yet.</div> : null}
        </div>
      </div>
      {locked ? null : (
        <button
          type="button"
          onClick={() => write([...(rows.length ? rows : [{ id: blankId, c: {} }]), { id: newRowId(), c: {} }])}
          className="border-field text-ink-2 h-[30px] self-start rounded-md border border-dashed bg-white px-2.5 text-xs font-semibold"
        >
          + Add row
        </button>
      )}
    </div>
  );
}

/** One row's picture in a data table: upload, show, replace or clear it. */
function GridImageCell({
  aria,
  fileId,
  formId,
  itemId,
  rowId,
  locked,
  onChange,
}: {
  aria: string;
  fileId: string;
  formId: string | null;
  itemId: string;
  rowId: string;
  locked: boolean;
  onChange: (fileId: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  function upload(file: File | undefined) {
    if (!file || !formId) return;
    const data = new FormData();
    data.set("file", file);
    setError(null);
    startTransition(async () => {
      try {
        const result = await attachGridImage(formId, itemId, rowId, data);
        if (!result.ok || !result.fileId) setError(result.message ?? "Not uploaded.");
        else onChange(result.fileId);
      } catch {
        setError("The server could not be reached.");
      }
      if (input.current) input.current.value = "";
    });
  }
  return (
    <span className="flex items-center gap-1.5">
      {fileId ? (
        // eslint-disable-next-line @next/next/no-img-element -- a stored upload, served by the files route
        <img src={`/api/part-files/${fileId}`} alt={aria} className="border-line h-12 w-16 flex-none rounded-md border bg-white object-contain" />
      ) : locked ? (
        <span className="text-faint text-[12px]">—</span>
      ) : null}
      {locked ? null : formId ? (
        <label className="border-field text-ink-2 relative inline-flex h-8 cursor-pointer items-center overflow-hidden rounded-md border border-dashed bg-white px-2 text-[11.5px] font-semibold whitespace-nowrap">
          {pending ? "Uploading…" : fileId ? "Replace" : "+ Image"}
          <input
            ref={input}
            type="file"
            aria-label={aria}
            accept="image/png,image/jpeg,image/webp,image/gif"
            disabled={pending}
            onChange={(e) => upload(e.target.files?.[0])}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
      ) : (
        <span className="text-faint text-[11px]">Save the form first</span>
      )}
      {fileId && !locked ? (
        <button type="button" aria-label={`Clear ${aria}`} onClick={() => onChange("")} className="text-faint h-6 w-6 rounded border-0 bg-transparent">
          ×
        </button>
      ) : null}
      {error ? <span className="text-bad text-[11px]">{error}</span> : null}
    </span>
  );
}

// --- Photo / attachment ------------------------------------------------------------------------------

function FileItem({
  item,
  label,
  required,
  files,
  formId,
  locked,
  onFiles,
  pictures = false,
}: {
  item: QaItem;
  label: string;
  required: React.ReactNode;
  files: Array<{ id: string; name: string; type: string }>;
  formId: string | null;
  locked: boolean;
  onFiles: (itemId: string, files: Array<{ id: string; name: string; type: string }>) => void;
  /** The pictures beside another field's value: no label of its own, pictures only. */
  pictures?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function upload(file: File | undefined) {
    if (!file || !formId) return;
    setError(null);
    startTransition(async () => {
      try {
        const data = new FormData();
        data.set("file", file);
        const result = await attachFormFile(formId, item.id, data);
        if (!result.ok || !result.files) setError(result.message ?? "The file could not be attached.");
        else onFiles(item.id, result.files);
      } catch {
        setError("The file did not reach the server — it may be over 25 MB.");
      }
      if (input.current) input.current.value = "";
    });
  }

  function remove(fileId: string) {
    if (!formId) return;
    startTransition(async () => {
      try {
        const result = await removeFormFile(formId, item.id, fileId);
        if (!result.ok || !result.files) setError(result.message ?? "The file could not be removed.");
        else onFiles(item.id, result.files);
      } catch {
        setError("The server could not be reached. Try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid={pictures ? "field-images" : undefined}>
      {pictures ? null : (
        <span className="text-ink-2 text-[12.5px] font-semibold">
          {label}
          {required}
        </span>
      )}
      {pictures && files.length === 0 && locked ? null : (
      <div className="flex flex-wrap gap-2">
        {files.map((f) => (
          <span key={f.id} className="border-line flex max-w-full items-center gap-2 rounded-lg border bg-white p-1.5 pr-2">
            {f.type.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element -- a stored attachment
              <img src={`/api/part-files/${f.id}`} alt={f.name} className="h-12 w-16 rounded object-cover" />
            ) : (
              <span className="bg-subtle text-ink-3 flex h-12 w-12 items-center justify-center rounded text-[10px] font-bold uppercase">{(f.name.split(".").pop() ?? "file").slice(0, 4)}</span>
            )}
            <a href={`/api/part-files/${f.id}`} target="_blank" rel="noopener" className="text-brand-ink max-w-[200px] truncate text-[12.5px] font-semibold no-underline">
              {f.name}
            </a>
            {locked ? null : (
              <button type="button" disabled={pending} aria-label={`Remove ${f.name}`} onClick={() => remove(f.id)} className="text-faint h-6 w-6 rounded border-0 bg-transparent">
                ×
              </button>
            )}
          </span>
        ))}
        {files.length === 0 && locked && !pictures ? <span className="text-faint text-[12.5px]">No attachment</span> : null}
      </div>
      )}
      {locked ? null : formId ? (
        <label
          className={
            pictures
              ? "border-field text-ink-2 relative inline-flex h-[28px] cursor-pointer items-center self-start overflow-hidden rounded-md border border-dashed bg-white px-2.5 text-[12px] font-semibold"
              : "bg-ink relative inline-flex h-[32px] cursor-pointer items-center self-start overflow-hidden rounded-lg px-3 text-[12.5px] font-semibold text-white"
          }
        >
          {pending ? "Uploading…" : pictures ? "+ Add image" : item.anyFile ? "+ Choose file" : "+ Attach photo / PDF"}
          <input
            ref={input}
            type="file"
            aria-label={pictures ? `Add image to ${label}` : `Attach to ${label}`}
            accept={pictures ? "image/png,image/jpeg,image/webp,image/gif" : item.anyFile ? undefined : "image/png,image/jpeg,image/webp,image/gif,application/pdf"}
            disabled={pending}
            onChange={(e) => upload(e.target.files?.[0])}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
      ) : (
        pictures ? null : <span className="text-muted text-[11.5px]">Attachments are added on the part&apos;s form.</span>
      )}
      {error ? (
        <span role="alert" className="text-bad text-[12px]">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function SelectItem({
  item,
  label,
  state,
  context,
  libraries,
  snap,
  locked,
  partMaterial,
  setValue,
  setQty,
}: {
  item: QaItem;
  label: string;
  state: FormState;
  context: Context;
  libraries: Libraries;
  snap?: { label: string; line: string; warn: string | null };
  locked: boolean;
  partMaterial: string;
  setValue: (id: string, value: string) => void;
  setQty: (id: string, value: string) => void;
}) {
  const INPUT = "border-field text-ink h-9 w-full min-w-0 rounded-lg border bg-white px-2 text-[13px] disabled:bg-subtle disabled:text-ink-2";
  const head = (
    <span className="text-ink-2 text-[12.5px] font-semibold">
      {label}
      {item.req ? <span className="text-bad"> *</span> : null}
    </span>
  );

  if (item.src === "custom" && item.multi) {
    // Several can be ticked.
    const picked = enteredText(item, state, context).split(",").map((v) => v.trim()).filter(Boolean);
    const options = customOptions(item.opts);
    return (
      <div className="grid grid-cols-1 items-start gap-x-2.5 gap-y-1 @md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
        {head}
        <div role="group" aria-label={label} className="flex flex-col gap-1.5 py-1">
          {options.map((o) => (
            <label key={o} className="text-ink flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={picked.includes(o)}
                onChange={(e) => {
                  const next = e.target.checked ? [...picked, o] : picked.filter((x) => x !== o);
                  // Kept in the order the choices are listed.
                  setValue(item.id, options.filter((x) => next.includes(x)).join(", "));
                }}
                className="accent-brand h-4 w-4"
              />
              {o}
            </label>
          ))}
        </div>
      </div>
    );
  }

  if (item.src === "custom") {
    const value = enteredText(item, state, context);
    return (
      <div className="grid grid-cols-1 items-center gap-x-2.5 gap-y-1 @md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
        {head}
        <select aria-label={label} value={value} onChange={(e) => setValue(item.id, e.target.value)} className={INPUT}>
          <option value="">Select…</option>
          {customOptions(item.opts).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    );
  }

  const source = item.src || "printers";
  const all = libraries[source] ?? [];
  const picked = pickedOption(item, state, context, libraries);
  // Usable first; for lots, the part's own material before others; unusable
  // last and not selectable — unless it is the one already chosen.
  const rank = (o: LibOption) => (o.warn ? 2 : source === "lots" && o.material && partMaterial && o.material !== partMaterial ? 1 : 0);
  const options = [...all].sort((a, b) => rank(a) - rank(b));
  const qty = state.quantities[item.id] ?? "";
  const qtyNumber = Number(qty.replace(",", "."));

  let qtyNote = "Pick an item first";
  let qtyTone = "text-muted";
  if (picked && picked.avail !== null) {
    if (!qty.trim()) qtyNote = `Available ${picked.avail} ${picked.unit ?? ""}`;
    else if (Number.isFinite(qtyNumber) && qtyNumber <= picked.avail) {
      qtyNote = `Available ${picked.avail} ${picked.unit ?? ""}  →  ${Math.round((picked.avail - qtyNumber) * 1000) / 1000} ${picked.unit ?? ""} left after this`;
      qtyTone = "text-ok";
    } else {
      qtyNote = `Only ${picked.avail} ${picked.unit ?? ""} available`;
      qtyTone = "text-bad";
    }
  }

  // A locked record shows what the item was when the form was submitted.
  const shownLine = locked && snap ? snap.line : picked ? picked.info.map(([k, v]) => `${k}: ${v}`).join("  ·  ") : "";
  const shownWarn = locked && snap ? snap.warn : picked?.warn ?? null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-1 items-center gap-x-2.5 gap-y-1 @md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
        {head}
        <select aria-label={label} value={picked?.id ?? ""} onChange={(e) => setValue(item.id, e.target.value)} className={INPUT}>
          <option value="">Select…</option>
          {locked && snap && !picked ? <option value="">{snap.label}</option> : null}
          {options.map((o) => (
            <option key={o.id} value={o.id} disabled={Boolean(o.warn) && o.id !== picked?.id}>
              {o.label}
              {o.avail !== null ? ` · ${o.avail} ${o.unit ?? ""} left` : ""}
              {o.warn ? `  —  ⚠ ${o.warn}` : ""}
            </option>
          ))}
        </select>
      </div>
      {item.qty ? (
        <div className="grid grid-cols-1 items-center gap-x-2.5 gap-y-1 @md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
          <span className="text-ink-3 text-xs font-semibold">Quantity used</span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label={`${label} — quantity used`}
              inputMode="decimal"
              value={qty}
              placeholder="0"
              onChange={(e) => setQty(item.id, e.target.value)}
              className="border-field h-[34px] w-[110px] rounded-lg border px-2.5 font-mono text-[13px] disabled:bg-subtle"
            />
            <span className="text-muted text-xs">{picked?.unit ?? ""}</span>
            {!locked ? <span className={`text-[11.5px] font-semibold ${qtyTone}`}>{qtyNote}</span> : <span className="text-muted text-[11.5px]">Used {qty || "—"} {picked?.unit ?? ""}</span>}
          </div>
        </div>
      ) : null}
      {shownLine || shownWarn ? (
        <div
          className={
            "flex flex-col gap-[3px] rounded-lg border px-2.5 py-[7px] " +
            (shownWarn ? "border-[#FECDCA] bg-[#FFFBFA]" : "border-line-2 bg-subtle")
          }
        >
          {shownLine ? <span className="text-ink-3 text-[11.5px] leading-[1.5]">{shownLine}</span> : null}
          {shownWarn ? <span className="text-bad text-xs font-bold">⚠ {shownWarn}</span> : null}
          <span className="text-faint text-[10.5px]">{locked && snap ? "Recorded when the form was submitted" : "Live from the setup pages"}</span>
        </div>
      ) : null}
    </div>
  );
}

function TableItem({
  item,
  label,
  state,
  inspection,
  setMeasured,
}: {
  item: QaItem;
  label: string;
  state: FormState;
  inspection: Inspection | null;
  setMeasured: (key: string, value: string) => void;
}) {
  if (!item.value.includes("{balloon.table}")) {
    return (
      <div className="rounded-lg border border-dashed border-[#FDB022] bg-[#FFFAEB] p-3 text-[12.5px] text-[#B54708]">
        No balloon source selected — pick the part request balloon variable {"{balloon.table}"} for this table in QA Form Setup.
      </div>
    );
  }
  const rows = balloonRows(item, state, inspection);
  const measure = !item.noMeasure;
  const columns = inspection?.columns ?? [];
  const template = `64px repeat(${Math.max(columns.length, 1)}, minmax(80px, 1fr))${measure ? " 110px 64px" : ""}`;
  const images = (inspection?.images ?? []).filter((i) => i.fileId);
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-ink-2 text-[12.5px] font-semibold">
        {label}
        {item.req && measure ? <span className="text-bad"> *</span> : null}
      </span>
      {images.length ? (
        <div className="grid grid-cols-1 gap-2.5 @2xl:grid-cols-2">
          {images.map((image, i) => (
            <BalloonDrawing
              key={image.id}
              image={image}
              url={`/api/part-files/${image.fileId}`}
              points={inspection!.points.filter((p) => p.imgId === image.id)}
              label={`Drawing ${i + 1}`}
            />
          ))}
        </div>
      ) : null}
      <div className="border-line-2 overflow-x-auto rounded-lg border">
        <div style={{ minWidth: 64 + Math.max(columns.length, 1) * 90 + (measure ? 180 : 0) }}>
          <div className="border-line-2 bg-subtle text-ink-3 grid gap-1.5 border-b px-2.5 py-2 text-[10.5px] font-bold tracking-[0.4px]" style={{ gridTemplateColumns: template }}>
            <div>Balloon</div>
            {columns.map((c) => (
              <div key={c.id} className="truncate">
                {c.label}
              </div>
            ))}
            {measure ? (
              <>
                <div>Measured</div>
                <div>Result</div>
              </>
            ) : null}
          </div>
          {rows.map((row) => (
            <div key={row.rowId} className="border-line-3 grid items-center gap-1.5 border-b px-2.5 py-1.5 text-[12.5px] last:border-b-0" style={{ gridTemplateColumns: template }}>
              <div className="text-brand-ink font-mono font-bold">{row.balloon}</div>
              {row.cells.map((cell, i) => (
                <div key={i} className="min-w-0 break-words">
                  {cell || <span className="text-faint">—</span>}
                </div>
              ))}
              {measure ? (
                <>
                  <input
                    aria-label={`Measured value for balloon ${row.balloon}`}
                    inputMode="decimal"
                    value={row.measured}
                    onChange={(e) => setMeasured(`${item.id}:${row.rowId}`, e.target.value)}
                    className="border-field h-[30px] min-w-0 rounded-md border px-2 font-mono text-[12.5px] disabled:bg-subtle"
                  />
                  <ResultChip result={row.result} />
                </>
              ) : null}
            </div>
          ))}
          {rows.length === 0 ? (
            <div className="text-faint p-3 text-center text-xs">
              This part&apos;s request has no balloon characteristics — rows appear here automatically when the requester adds them.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

