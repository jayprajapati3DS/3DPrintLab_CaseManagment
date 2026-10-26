"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { updatePartDetails } from "@/lib/parts/actions";

/**
 * The part's own request questions, answered on its page: those the request
 * form leaves for later — flagged until they are — and any other text,
 * number, date, choice or tick, to correct.
 */

export interface DetailField {
  id: string;
  label: string;
  type: string;
  options: string[];
  req: boolean;
  /** Left out of the request, to answer here. */
  later: boolean;
}

const INPUT = "border-field text-ink h-9 w-full min-w-0 rounded-lg border bg-white px-2.5 text-[13px]";

export function DetailsEditor({ partId, fields, values }: { partId: string; fields: DetailField[]; values: Record<string, string> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(values);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const waiting = fields.filter((f) => f.later && !values[f.id]);

  function save() {
    startTransition(async () => {
      const result = await updatePartDetails(partId, draft);
      setMessage({ ok: result.ok, text: result.message ?? (result.ok ? "Saved" : "Could not save.") });
      if (result.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  }

  if (fields.length === 0) return null;
  return (
    <div className="border-line flex flex-col gap-3 rounded-xl border bg-white px-4 py-3.5 sm:px-5" data-testid="details-editor">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
          <span className="text-[13px] font-bold">Request details</span>
          <span className={"text-[12px] " + (waiting.length ? "text-warn font-semibold" : "text-muted")}>
            {waiting.length ? `${waiting.length} left to answer: ${waiting.map((f) => f.label).join(", ")}` : "Answer or correct the request's own questions."}
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setDraft(values);
            setOpen((o) => !o);
          }}
          aria-expanded={open}
          className="border-field text-ink-2 h-9 rounded-lg border bg-white px-3.5 text-[12.5px] font-semibold"
        >
          {open ? "Close" : "Edit details"}
        </button>
      </div>
      {open ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {fields.map((f) => {
              const id = `detail-${f.id}`;
              const v = draft[f.id] ?? "";
              const set = (value: string) => setDraft((d) => ({ ...d, [f.id]: value }));
              return (
                <label key={f.id} htmlFor={id} className={"flex min-w-0 flex-col gap-1 " + (f.type === "textarea" ? "sm:col-span-2" : "")}>
                  <span className="text-ink-2 text-[12.5px] font-semibold">
                    {f.label}
                    {f.req ? <span className="text-bad"> *</span> : null}
                    {f.later ? <span className="text-muted ml-1.5 text-[11px] font-normal">· answered here</span> : null}
                  </span>
                  {f.type === "textarea" ? (
                    <textarea id={id} rows={3} value={v} onChange={(e) => set(e.target.value)} className={`${INPUT} h-auto py-2`} />
                  ) : f.type === "select" ? (
                    <select id={id} value={v} onChange={(e) => set(e.target.value)} className={INPUT}>
                      <option value="">Select…</option>
                      {f.options.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  ) : f.type === "checkbox" ? (
                    <span className="flex h-9 items-center gap-2 text-[13px]">
                      <input id={id} type="checkbox" checked={v === "Yes"} onChange={(e) => set(e.target.checked ? "Yes" : "")} className="h-4 w-4" />
                      Yes
                    </span>
                  ) : (
                    <input id={id} type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"} step={f.type === "number" ? "any" : undefined} value={v} onChange={(e) => set(e.target.value)} className={INPUT} />
                  )}
                </label>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            <button type="button" disabled={pending} onClick={save} className="bg-brand h-9 rounded-lg border-0 px-4 text-[12.5px] font-semibold text-white disabled:opacity-60">
              {pending ? "Saving…" : "Save details"}
            </button>
            {message ? <span className={"text-[12.5px] " + (message.ok ? "text-ok" : "text-bad")}>{message.text}</span> : null}
          </div>
        </div>
      ) : message?.ok ? (
        <span className="text-ok text-[12.5px]">{message.text}</span>
      ) : null}
    </div>
  );
}
