"use client";

import { useState } from "react";

import { Pill, S_BTN_DARK, S_BTN_SMALL, S_INPUT, S_LABEL, S_TD, S_TH, SectionCard, TONE_TEXT } from "@/components/setup/ui";
import { useFormAction } from "@/components/setup/use-form-action";
import {
  addScheduleItemAction,
  recordScheduleItemAction,
  removeScheduleItemAction,
  reviewChangeControlAction,
  updateScheduleItemAction,
} from "@/lib/resources/actions";
import { QUAL_RESULTS, type Track } from "@/lib/resources/config";
import { addMonths, type Tone } from "@/lib/resources/status";

export interface ScheduleItemRow {
  id: string;
  name: string;
  dueOn: string | null;
  repeatMonths: number | null;
  lastDoneOn: string | null;
  lastResult: string | null;
  status: { label: string; tone: Tone };
  /** "Due in 12 days" / "Overdue by 3 days". */
  relative: string | null;
}

export interface RecordRow {
  id: string;
  doneOn: string;
  itemName: string;
  doneBy: string;
  recordedBy: string | null;
  result: string | null;
  ref: string | null;
  note: string | null;
  /** "pending" while a change-control review is open; the outcome once closed. */
  changeControl: null | { pending: true } | { pending: false; outcome: string; by: string };
  documents: Array<{ id: string; name: string }>;
}

export interface PendingReview {
  recordId: string;
  itemName: string;
  doneOn: string;
  note: string | null;
}

export function ScheduleBlock({
  resourceId,
  track,
  label,
  hint,
  items,
  records,
  reviews,
  canEdit,
  canRecord,
  today,
  userName,
}: {
  resourceId: string;
  track: Track;
  /** The tab's word: "Maintenance", "Calibration", "Supplier evaluation"… */
  label: string;
  hint: string;
  items: ScheduleItemRow[];
  records: RecordRow[];
  /** Change-control reviews waiting, shown above a qualification schedule. */
  reviews: PendingReview[];
  canEdit: boolean;
  canRecord: boolean;
  today: string;
  userName: string;
}) {
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<{ id: string; mode: "edit" | "record" } | null>(null);
  const isQual = track === "qualification";
  const lower = label.toLowerCase();

  return (
    <div className="flex flex-col gap-4">
      {isQual && reviews.length > 0 ? (
        <section className="bg-warn-tint flex flex-col gap-2.5 rounded-[14px] border border-[#FEDF89] px-[18px] py-3.5">
          <h3 className="text-warn m-0 text-[13.5px] font-bold">Change control — review required</h3>
          {reviews.map((review) => (
            <div key={review.recordId} className="flex flex-wrap items-center gap-3 text-[13px]">
              <span className="text-ink-2 min-w-0 flex-1">
                <span className="font-mono text-[12.5px]">{review.doneOn}</span> · {review.itemName}
                {review.note ? ` — ${review.note}` : ""}
              </span>
              {canEdit ? (
                <form action={reviewChangeControlAction} className="flex gap-2">
                  <input type="hidden" name="recordId" value={review.recordId} />
                  <button type="submit" name="outcome" value="No impact on validated state" className={S_BTN_SMALL}>
                    No impact — close
                  </button>
                  <button type="submit" name="outcome" value="Requalification required" className={S_BTN_SMALL}>
                    Requalification required
                  </button>
                </form>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      <SectionCard
        title={`${label} schedule`}
        hint={hint}
        action={
          canEdit && !adding ? (
            <button type="button" onClick={() => setAdding(true)} className={S_BTN_SMALL}>
              + Add item
            </button>
          ) : null
        }
      >
        {adding ? (
          <ItemForm
            mode="add"
            resourceId={resourceId}
            track={track}
            placeholder={isQual ? "e.g. OQ — Operational qualification, PQ — Ti-6Al-4V implants" : "e.g. Preventive maintenance, laser calibration, filter change"}
            onDone={() => setAdding(false)}
          />
        ) : null}

        <div className="border-line overflow-x-auto rounded-[10px] border">
          <table className="w-full min-w-[720px] border-collapse">
            <thead className="bg-subtle">
              <tr>
                {["Item", "Next due", "Repeat", "Last done", "Status", ""].map((h, i) => (
                  <th key={i} className={S_TH}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-muted px-3 py-8 text-center text-[13px]">
                    No {lower} items yet{canEdit ? " — click “+ Add item”." : "."}
                  </td>
                </tr>
              ) : null}
              {items.map((item) => (
                <ItemRows
                  key={item.id}
                  item={item}
                  isQual={isQual}
                  open={open?.id === item.id ? open.mode : null}
                  setOpen={(mode) => setOpen(mode ? { id: item.id, mode } : null)}
                  canEdit={canEdit}
                  canRecord={canRecord}
                  today={today}
                  userName={userName}
                />
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard
        title={`${label} records`}
        hint="Saved records with their uploaded reports (also listed in the Documents tab). Past records stay here."
      >
        <div className="border-line overflow-x-auto rounded-[10px] border">
          <table className="w-full min-w-[720px] border-collapse">
            <thead className="bg-subtle">
              <tr>
                {(isQual
                  ? ["Date", "Item", "Done by", "Result", "Report ref", "Notes", "Documents"]
                  : ["Date", "Item", "Done by", "Notes", "Documents"]
                ).map((h) => (
                  <th key={h} className={S_TH}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={isQual ? 7 : 5} className="text-muted px-3 py-8 text-center text-[13px]">
                    No {lower} recorded yet.
                  </td>
                </tr>
              ) : null}
              {records.map((r) => (
                <tr key={r.id}>
                  <td className={`${S_TD} font-mono text-[12.5px] whitespace-nowrap`}>{r.doneOn}</td>
                  <td className={`${S_TD} font-semibold`}>{r.itemName}</td>
                  <td className={S_TD}>
                    {r.doneBy}
                    {r.recordedBy && r.recordedBy !== r.doneBy ? (
                      <span className="text-muted block text-[11.5px]">recorded by {r.recordedBy}</span>
                    ) : null}
                  </td>
                  {isQual ? (
                    <>
                      <td className={S_TD}>
                        {r.result ? (
                          <Pill tone={r.result === "Fail" ? "red" : r.result === "Pass" ? "green" : "amber"} small>
                            {r.result}
                          </Pill>
                        ) : null}
                      </td>
                      <td className={`${S_TD} font-mono text-[12.5px]`}>{r.ref}</td>
                    </>
                  ) : null}
                  <td className={S_TD}>
                    {r.note}
                    {r.changeControl ? (
                      <span
                        className={
                          "block text-[11.5px] font-semibold " +
                          (r.changeControl.pending ? "text-warn" : "text-ok")
                        }
                      >
                        {r.changeControl.pending
                          ? "Change control — review pending (Qualification tab)"
                          : `Change control closed — ${r.changeControl.outcome} (${r.changeControl.by})`}
                      </span>
                    ) : null}
                  </td>
                  <td className={S_TD}>
                    <span className="flex flex-col gap-1">
                      {r.documents.map((d) => (
                        <a
                          key={d.id}
                          href={`/api/files/${d.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand-ink text-[12.5px] font-semibold break-all no-underline"
                        >
                          {d.name}
                        </a>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

function ItemRows({
  item,
  isQual,
  open,
  setOpen,
  canEdit,
  canRecord,
  today,
  userName,
}: {
  item: ScheduleItemRow;
  isQual: boolean;
  open: "edit" | "record" | null;
  setOpen: (mode: "edit" | "record" | null) => void;
  canEdit: boolean;
  canRecord: boolean;
  today: string;
  userName: string;
}) {
  return (
    <>
      <tr>
        <td className={S_TD}>
          <span className="font-semibold">{item.name}</span>
          {isQual ? (
            <span className="text-muted block text-[11.5px]">
              {item.lastResult ? `Last result: ${item.lastResult}` : "Not yet performed"}
            </span>
          ) : null}
        </td>
        <td className={S_TD}>
          {item.dueOn ? (
            <>
              <span className="font-mono text-[12.5px]">{item.dueOn}</span>
              <span className={`block text-[11.5px] font-semibold ${TONE_TEXT[item.status.tone === "green" ? "grey" : item.status.tone]}`}>
                {item.relative}
              </span>
            </>
          ) : (
            <span className="text-faint">—</span>
          )}
        </td>
        <td className={S_TD}>{item.repeatMonths ? `Every ${item.repeatMonths} mo` : "One-time"}</td>
        <td className={`${S_TD} font-mono text-[12.5px]`}>{item.lastDoneOn ?? <span className="text-faint">—</span>}</td>
        <td className={S_TD}>
          <Pill tone={item.status.tone} small>
            {item.status.label}
          </Pill>
        </td>
        <td className={`${S_TD} whitespace-nowrap`}>
          <span className="flex justify-end gap-1.5">
            {canEdit ? (
              <button type="button" onClick={() => setOpen(open === "edit" ? null : "edit")} className={S_BTN_SMALL}>
                {open === "edit" ? "Done" : "Edit"}
              </button>
            ) : null}
            {canRecord ? (
              <button
                type="button"
                onClick={() => setOpen(open === "record" ? null : "record")}
                className="bg-ink h-8 rounded-lg border-0 px-2.5 text-[12.5px] font-semibold text-white"
              >
                Record
              </button>
            ) : null}
          </span>
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={6} className="border-line-3 bg-subtle border-t px-3 py-3.5">
            {open === "edit" ? (
              <ItemForm mode="edit" item={item} onDone={() => setOpen(null)} />
            ) : (
              <RecordForm item={item} isQual={isQual} today={today} userName={userName} onDone={() => setOpen(null)} />
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ItemForm(
  props:
    | { mode: "add"; resourceId: string; track: Track; placeholder: string; onDone: () => void }
    | { mode: "edit"; item: ScheduleItemRow; onDone: () => void },
) {
  const { state, pending, onSubmit } = useFormAction(
    props.mode === "add" ? addScheduleItemAction : updateScheduleItemAction,
    props.onDone,
  );
  const item = props.mode === "edit" ? props.item : null;

  return (
    <div className="flex flex-col gap-2.5">
      <form onSubmit={onSubmit} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_170px_170px_auto]">
        {props.mode === "add" ? (
          <>
            <input type="hidden" name="resourceId" value={props.resourceId} />
            <input type="hidden" name="track" value={props.track} />
          </>
        ) : (
          <input type="hidden" name="itemId" value={props.item.id} />
        )}
        <label className="flex flex-col gap-[5px]">
          <span className={S_LABEL}>Item</span>
          <input
            name="name"
            required
            autoFocus
            defaultValue={item?.name}
            placeholder={props.mode === "add" ? props.placeholder : undefined}
            className={S_INPUT}
          />
        </label>
        <label className="flex flex-col gap-[5px]">
          <span className={S_LABEL}>Next due date</span>
          <input name="dueOn" type="date" defaultValue={item?.dueOn ?? ""} className={`${S_INPUT} font-mono`} />
        </label>
        <label className="flex flex-col gap-[5px]">
          <span className={S_LABEL}>Repeat every (months)</span>
          <input
            name="repeatMonths"
            type="number"
            min={1}
            max={240}
            defaultValue={item?.repeatMonths ?? ""}
            placeholder="Optional"
            className={`${S_INPUT} font-mono`}
          />
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={props.onDone} className={S_BTN_SMALL + " h-[38px]"}>
            Cancel
          </button>
          <button type="submit" disabled={pending} className={S_BTN_DARK + " h-[38px]"}>
            {props.mode === "add" ? "Add" : "Save"}
          </button>
        </div>
      </form>
      {!state.ok && state.message ? (
        <p role="alert" className="text-bad m-0 text-[12.5px]">
          {state.message}
        </p>
      ) : null}
      {props.mode === "edit" ? (
        <form action={removeScheduleItemAction}>
          <input type="hidden" name="itemId" value={props.item.id} />
          <button type="submit" className="text-bad border-0 bg-transparent p-0 text-[12.5px] font-semibold">
            Remove item (its records are kept)
          </button>
        </form>
      ) : null}
    </div>
  );
}

function RecordForm({
  item,
  isQual,
  today,
  userName,
  onDone,
}: {
  item: ScheduleItemRow;
  isQual: boolean;
  today: string;
  userName: string;
  onDone: () => void;
}) {
  const [doneOn, setDoneOn] = useState(today);
  const { state, pending, onSubmit } = useFormAction(recordScheduleItemAction, onDone);

  const next =
    item.repeatMonths && /^\d{4}-\d{2}-\d{2}$/.test(doneOn) ? addMonths(doneOn, item.repeatMonths) : null;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="itemId" value={item.id} />
      <div className="text-[13px] font-bold">Record — {item.name}</div>
      <div className={"grid grid-cols-1 gap-3 sm:grid-cols-2 " + (isQual ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
        <label className="flex flex-col gap-[5px]">
          <span className={S_LABEL}>Done on</span>
          <input
            name="doneOn"
            type="date"
            required
            max={today}
            value={doneOn}
            onChange={(e) => setDoneOn(e.target.value)}
            className={`${S_INPUT} font-mono`}
          />
        </label>
        <label className="flex flex-col gap-[5px]">
          <span className={S_LABEL}>{isQual ? "Done / approved by" : "Done by"}</span>
          <input
            name="doneBy"
            required
            defaultValue={userName}
            placeholder={isQual ? "Name, role" : "Name / service provider"}
            className={S_INPUT}
          />
        </label>
        {isQual ? (
          <>
            <label className="flex flex-col gap-[5px]">
              <span className={S_LABEL}>Result</span>
              <select name="result" defaultValue="Pass" className={S_INPUT}>
                {QUAL_RESULTS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-[5px]">
              <span className={S_LABEL}>Report ref no.</span>
              <input name="ref" placeholder="e.g. PQ-DMLS-2026-01" className={`${S_INPUT} font-mono`} />
            </label>
          </>
        ) : (
          <label className="flex flex-col gap-[5px]">
            <span className={S_LABEL}>Affects validation?</span>
            <select name="affectsValidation" defaultValue="no" className={S_INPUT}>
              <option value="no">No</option>
              <option value="yes">Yes — review</option>
            </select>
          </label>
        )}
      </div>
      <label className="flex flex-col gap-[5px]">
        <span className={S_LABEL}>Notes</span>
        <input name="note" placeholder={isQual ? undefined : "What was done (optional)"} className={S_INPUT} />
      </label>
      <label className="flex flex-col gap-[5px]">
        <span className={S_LABEL}>PDF / report</span>
        <input
          name="files"
          type="file"
          multiple
          accept=".pdf,image/*"
          className="text-ink-2 text-[12.5px] file:border-field file:text-ink file:mr-3 file:h-8 file:rounded-lg file:border file:bg-white file:px-2.5 file:text-[12.5px] file:font-semibold"
        />
      </label>
      <p className="text-muted m-0 text-[12.5px]">
        {next
          ? `Next due will be set to ${next}.`
          : isQual
            ? "One-time item."
            : "One-time item — set a new due date afterwards if needed."}
      </p>
      {!state.ok && state.message ? (
        <p role="alert" className="text-bad m-0 text-[12.5px]">
          {state.message}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button type="button" onClick={onDone} className={S_BTN_SMALL + " h-9"}>
          Cancel
        </button>
        <button type="submit" disabled={pending} className={S_BTN_DARK}>
          {pending ? "Saving…" : "Save record"}
        </button>
      </div>
    </form>
  );
}
