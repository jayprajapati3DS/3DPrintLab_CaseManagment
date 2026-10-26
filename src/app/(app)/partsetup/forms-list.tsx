"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useToast } from "@/components/ui/toast";
import { createRequestForm, deleteRequestForm, setDefaultRequestForm, type PartActionResult } from "@/lib/parts/actions";

/**
 * Part Request Setup's list of request forms: open one to edit it, add one —
 * from the default fields or as a copy of another — duplicate, make default,
 * delete.
 */

export interface FormRow {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  sections: number;
  fields: number;
  parts: number;
  saved: string | null;
}

export function FormsList({ rows, canEdit }: { rows: FormRow[]; canEdit: boolean }) {
  const router = useRouter();
  const { toast, node } = useToast();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", description: "", from: "" });

  function run(action: () => Promise<PartActionResult & { formId?: string }>, open = false) {
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          toast(result.message ?? "That did not work. Try again.", true);
          return;
        }
        if (result.message) toast(result.message);
        // A new form opens straight away, to be filled in.
        if (open && result.formId) router.push(`/partsetup?form=${result.formId}`);
        else router.refresh();
      } catch {
        toast("The server could not be reached. Try again.", true);
      }
    });
  }

  function create() {
    run(() => createRequestForm(draft.name, draft.description, draft.from || null), true);
  }

  return (
    <section className="border-line flex flex-col gap-3.5 rounded-[14px] border bg-white px-5 py-[18px]">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="bg-brand-tint text-brand flex h-6 w-6 items-center justify-center rounded-md text-[13px] font-bold">≡</span>
        <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
          <h3 className="m-0 text-sm font-bold">Request forms</h3>
          <div className="text-muted text-xs">
            One form per kind of part, if you like. Whoever requests a part picks the form; with one form, it opens straight away.
          </div>
        </div>
        {canEdit ? (
          <button
            type="button"
            disabled={pending || rows.length >= 30}
            onClick={() => {
              setAdding((a) => !a);
              setDraft({ name: "", description: "", from: "" });
            }}
            aria-expanded={adding}
            className="bg-brand-ink h-9 rounded-lg border-0 px-3.5 text-[12.5px] font-semibold text-white disabled:opacity-50"
          >
            + New form
          </button>
        ) : null}
      </div>

      {adding ? (
        <div className="border-brand-edge bg-brand-wash flex flex-col gap-3 rounded-[12px] border p-4">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <label className="flex flex-col gap-1 text-xs font-bold">
              Form name
              <input
                autoFocus
                aria-label="New form name"
                value={draft.name}
                maxLength={80}
                placeholder="e.g. Anatomical model"
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                className="border-field h-9 rounded-lg border bg-white px-2.5 text-[13px] font-semibold"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold">
              Shown when choosing (optional)
              <input
                aria-label="New form description"
                value={draft.description}
                maxLength={200}
                placeholder="e.g. 3D printed anatomical model, made in-house"
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                className="border-field h-9 rounded-lg border bg-white px-2.5 text-[13px] font-normal"
              />
            </label>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-bold">Start from</span>
            <div role="radiogroup" aria-label="Start from" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[{ id: "", name: "The default fields", description: "Part name, quantity, workflow, the QAC requirements, files and drawing" }, ...rows].map((r) => {
                const on = draft.from === r.id;
                return (
                  <button
                    key={r.id || "default"}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setDraft((d) => ({ ...d, from: r.id }))}
                    className={
                      "flex min-w-0 items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-left " +
                      (on ? "border-brand bg-white" : "border-field bg-white/70 hover:bg-white")
                    }
                  >
                    <span
                      className={"mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full border-2 " + (on ? "border-brand" : "border-field")}
                      aria-hidden="true"
                    >
                      {on ? <span className="bg-brand h-2 w-2 rounded-full" /> : null}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="text-ink text-[13px] font-semibold">{r.id ? `Copy of “${r.name}”` : r.name}</span>
                      <span className="text-muted text-[12px] leading-[1.4]">
                        {r.id ? `All ${"fields" in r ? r.fields : ""} fields and their variables — QA forms read both forms the same way` : r.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <span className="text-muted text-[11.5px]">
              Fields from any other form can also be added one by one while editing — &quot;Reuse a field from another form&quot;.
            </span>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="border-field h-9 rounded-lg border bg-white px-3 text-[12.5px] font-semibold"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={create}
              className="bg-brand h-9 rounded-lg border-0 px-3.5 text-[12.5px] font-semibold text-white disabled:opacity-50"
            >
              {pending ? "Creating…" : "Create and edit"}
            </button>
          </div>
        </div>
      ) : null}

      <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-2" aria-label="Request forms list">
        {rows.map((r) => (
          <li key={r.id} className="border-line hover:border-brand-edge relative flex flex-col gap-3 rounded-[12px] border bg-white p-4">
            <div className="flex items-start gap-3">
              <span className="bg-brand-wash text-brand flex h-10 w-10 flex-none items-center justify-center rounded-[10px]" aria-hidden="true">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1zM8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2M8 11h8M8 15h5" />
                </svg>
              </span>
              <Link href={`/partsetup?form=${r.id}`} className="text-ink flex min-w-0 flex-1 flex-col gap-0.5 no-underline after:absolute after:inset-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-bold [overflow-wrap:anywhere]">{r.name}</span>
                  {r.isDefault ? <span className="bg-chip text-muted rounded px-1.5 py-px text-[9.5px] font-bold tracking-[0.4px]">DEFAULT</span> : null}
                </span>
                {r.description ? <span className="text-ink-3 text-[12.5px]">{r.description}</span> : null}
                <span className="text-muted text-[12px]">
                  {r.sections} section{r.sections === 1 ? "" : "s"} · {r.fields} field{r.fields === 1 ? "" : "s"} shown · {r.parts} part{r.parts === 1 ? "" : "s"} requested
                </span>
                {r.saved ? <span className="text-faint text-[11.5px]">{r.saved}</span> : null}
              </Link>
            </div>
            <div className="border-line-3 relative z-[1] flex flex-wrap items-center gap-1.5 border-t pt-3">
              <Link
                href={`/partsetup?form=${r.id}`}
                className="bg-ink flex h-8 items-center rounded-lg px-3 text-[12.5px] font-semibold text-white no-underline"
              >
                {canEdit ? "Edit" : "View"}
              </Link>
              {canEdit ? (
                <>
                  <button
                    type="button"
                    disabled={pending || rows.length >= 30}
                    onClick={() => run(() => createRequestForm("", "", r.id), true)}
                    className="border-field text-ink-2 h-8 rounded-lg border bg-white px-3 text-[12.5px] font-semibold disabled:opacity-50"
                  >
                    Duplicate
                  </button>
                  {!r.isDefault ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => setDefaultRequestForm(r.id))}
                      className="border-field text-ink-2 h-8 rounded-lg border bg-white px-3 text-[12.5px] font-semibold disabled:opacity-50"
                    >
                      Make default
                    </button>
                  ) : null}
                  <span className="flex-1" />
                  <button
                    type="button"
                    disabled={pending || rows.length === 1}
                    aria-label={`Delete ${r.name}`}
                    onClick={() => {
                      const note = r.parts
                        ? `${r.parts} part${r.parts === 1 ? " was" : "s were"} requested with it — it is archived, and they keep showing what was asked.`
                        : "No parts were requested with it — it is deleted.";
                      if (window.confirm(`Remove the request form "${r.name}"? ${note}`)) run(() => deleteRequestForm(r.id));
                    }}
                    className="h-8 rounded-lg border border-[#FECDCA] bg-white px-3 text-[12.5px] font-semibold text-[#D92D20] disabled:opacity-40"
                  >
                    Delete
                  </button>
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {node}
    </section>
  );
}
