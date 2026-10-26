"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Pill, S_BTN_OUTLINE, S_BTN_SMALL, S_INPUT, S_LABEL } from "@/components/setup/ui";
import {
  approveDeletionAction,
  cancelDeletionAction,
  requestDeletionAction,
  restoreResourceAction,
  type ActionResult,
} from "@/lib/resources/actions";

export interface ArchivedRow {
  id: string;
  name: string;
  summary: string;
  archivedOn: string;
  archivedBy: string;
  reason: string;
  /** What permanent deletion would erase, for the approval dialog. */
  contents: string;
  deletion: null | { by: string; on: string; reason: string; mine: boolean };
}

const IDLE: ActionResult = { ok: true };

export function ArchivedList({
  route,
  title,
  rows,
  canEdit,
}: {
  route: string;
  title: string;
  rows: ArchivedRow[];
  canEdit: boolean;
}) {
  return (
    <section className="border-line flex flex-col overflow-hidden rounded-[14px] border bg-white">
      <div className="border-line-3 flex flex-col gap-1 border-b px-[22px] py-[18px]">
        <h2 className="m-0 text-[15px] font-bold">Archived {title.toLowerCase()}</h2>
        <p className="text-muted m-0 max-w-[820px] text-[12.5px] leading-[1.5]">
          Archived records keep all their data, history and documents and are hidden from active
          lists and selections. Restore them at any time, or delete permanently through an approved
          request.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="text-muted px-5 py-10 text-center text-[13px]">
          Nothing archived here yet. Use &ldquo;Archive&rdquo; on a record to move it here.
        </div>
      ) : (
        rows.map((row) => <Row key={row.id} row={row} route={route} canEdit={canEdit} />)
      )}

      <div className="border-line-3 text-muted border-t px-[22px] py-3 text-xs">
        Every archive, restore and deletion action is recorded in the Audit Log (Quality › Audit Log).
      </div>
    </section>
  );
}

function Row({ row, route, canEdit }: { row: ArchivedRow; route: string; canEdit: boolean }) {
  const [requesting, setRequesting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [request, submitRequest, requestPending] = useActionState(
    async (previous: ActionResult, formData: FormData) => {
      const result = await requestDeletionAction(previous, formData);
      if (result.ok) setRequesting(false);
      return result;
    },
    IDLE,
  );

  return (
    <div className="border-line-3 flex flex-col gap-3 border-b px-4 py-4 last:border-b-0 sm:px-[22px]">
      <div className="grid grid-cols-1 items-start gap-x-4 gap-y-2.5 text-[13px] sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_170px_minmax(0,1.2fr)_190px]">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold">{row.name}</span>
          <span className="text-muted truncate text-[12.5px]">{row.summary}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[12.5px]">{row.archivedOn}</span>
          <span className="text-muted text-[12.5px]">{row.archivedBy}</span>
        </div>
        <div className="text-ink-2">{row.reason}</div>
        <div>
          <Pill tone={row.deletion ? "amber" : "grey"}>
            {row.deletion ? "Deletion pending approval" : "Archived"}
          </Pill>
        </div>
      </div>

      {row.deletion ? (
        <div className="bg-warn-tint text-warn rounded-[10px] border border-[#FEDF89] px-3.5 py-2.5 text-[12.5px] leading-[1.5]">
          <strong>Deletion requested</strong> by {row.deletion.by} on {row.deletion.on} — {row.deletion.reason}.
          Needs approval from a different person before anything is deleted.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Link href={`${route}/${row.id}`} className={`${S_BTN_SMALL} flex items-center no-underline`}>
          View record
        </Link>
        {canEdit ? (
          <>
            <form action={restoreResourceAction}>
              <input type="hidden" name="id" value={row.id} />
              <button type="submit" className={S_BTN_SMALL}>
                Restore
              </button>
            </form>
            {row.deletion ? (
              <>
                <form action={cancelDeletionAction}>
                  <input type="hidden" name="id" value={row.id} />
                  <button type="submit" className={S_BTN_SMALL}>
                    Cancel request
                  </button>
                </form>
                <button
                  type="button"
                  onClick={() => setApproving(true)}
                  className="text-bad h-8 rounded-lg border border-[#FDA29B] bg-white px-2.5 text-[12.5px] font-semibold"
                >
                  Approve deletion
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setRequesting((v) => !v)} className={S_BTN_SMALL}>
                Request permanent deletion
              </button>
            )}
          </>
        ) : null}
      </div>

      {requesting && !row.deletion ? (
        <form action={submitRequest} className="border-line bg-subtle flex flex-col gap-3 rounded-[10px] border px-3.5 py-3">
          <input type="hidden" name="id" value={row.id} />
          <label className="flex flex-col gap-1.5">
            <span className={S_LABEL}>Reason for permanent deletion</span>
            <input
              name="reason"
              required
              placeholder="e.g. retention period ended — records no longer required"
              className={S_INPUT}
            />
          </label>
          <p className="text-muted m-0 text-xs">
            The request is made in your name. Someone else has to approve it before anything is deleted.
          </p>
          {!request.ok && request.message ? (
            <p role="alert" className="text-bad m-0 text-[12.5px]">
              {request.message}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button type="button" onClick={() => setRequesting(false)} className={S_BTN_SMALL}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={requestPending}
              className="bg-ink h-8 rounded-lg border-0 px-3 text-[12.5px] font-semibold text-white disabled:opacity-45"
            >
              Submit for approval
            </button>
          </div>
        </form>
      ) : null}

      {approving && row.deletion ? <ApproveDialog row={row} onClose={() => setApproving(false)} /> : null}
    </div>
  );
}

function ApproveDialog({ row, onClose }: { row: ArchivedRow; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const [ack, setAck] = useState(false);
  const [state, submit, pending] = useActionState(
    async (previous: ActionResult, formData: FormData) => {
      const result = await approveDeletionAction(previous, formData);
      if (result.ok) onClose();
      return result;
    },
    IDLE,
  );

  const deletion = row.deletion!;
  const nameOk = typed.trim() === row.name;
  const hint = deletion.mine
    ? "You made this request, so you cannot approve it. It needs a different person."
    : nameOk && ack
      ? "All checks passed — the data will be erased."
      : "Type the exact record name and tick the confirmation.";

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-[rgba(16,24,40,0.45)] p-3 sm:items-center sm:p-6">
      <form
        action={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="del-title"
        className="flex w-[520px] max-w-full flex-col gap-4 rounded-[14px] bg-white p-[22px] shadow-[0_20px_40px_rgba(16,24,40,.2)]"
      >
        <input type="hidden" name="id" value={row.id} />
        <h2 id="del-title" className="m-0 text-base font-bold">
          Approve permanent deletion — &ldquo;{row.name}&rdquo;
        </h2>
        <p className="text-ink-2 m-0 text-[13px] leading-[1.55]">
          This erases the record and all its data ({row.contents}). It cannot be undone. Only a log
          entry — name, dates, requester, approver and reason — is kept as the audit trail.
        </p>
        <dl className="bg-subtle border-line m-0 grid grid-cols-[110px_minmax(0,1fr)] gap-y-1.5 rounded-[10px] border px-3.5 py-3 text-[12.5px]">
          <dt className="text-muted">Requested by</dt>
          <dd className="m-0">
            {deletion.by} on {deletion.on}
          </dd>
          <dt className="text-muted">Reason</dt>
          <dd className="m-0">{deletion.reason}</dd>
        </dl>

        <label className="flex flex-col gap-1.5">
          <span className={S_LABEL}>Type the record name to confirm</span>
          <input
            name="confirmName"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={row.name}
            autoComplete="off"
            className={S_INPUT}
          />
        </label>
        <label className="text-ink-2 flex cursor-pointer items-start gap-2.5 text-[13px] leading-[1.45]">
          <input
            type="checkbox"
            name="acknowledge"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          I approve that all data of this record — including its history, qualification and
          validation records, and documents — can be permanently deleted.
        </label>

        <p className={"m-0 text-[12.5px] " + (deletion.mine ? "text-bad" : "text-muted")}>{hint}</p>
        {!state.ok && state.message ? (
          <p role="alert" className="text-bad m-0 text-[12.5px]">
            {state.message}
          </p>
        ) : null}

        <div className="flex justify-end gap-2.5">
          <button type="button" onClick={onClose} className={S_BTN_OUTLINE}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || deletion.mine || !nameOk || !ack}
            className="h-9 rounded-[9px] border-0 bg-[#B42318] px-3.5 text-[13px] font-semibold text-white disabled:opacity-45"
          >
            {pending ? "Deleting…" : "Delete permanently"}
          </button>
        </div>
      </form>
    </div>
  );
}
