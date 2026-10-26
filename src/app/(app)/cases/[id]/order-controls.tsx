"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { addOrderForm, removeOrderForm, type OrderResult } from "@/lib/cases/order-actions";

/** Add a form to the case's Order tab, from those its product offers. */
export function AddOrderForm({ caseId, choices }: { caseId: string; choices: Array<{ id: string; label: string }> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState("");
  const [result, setResult] = useState<OrderResult | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Order form to add"
        value={picked}
        onChange={(e) => setPicked(e.target.value)}
        className="border-field text-ink h-9 max-w-[360px] min-w-[220px] rounded-[9px] border bg-white px-2 text-[13px]"
      >
        <option value="">{choices.length ? "Add an order form…" : "Nothing more to add"}</option>
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!picked || pending}
        onClick={() =>
          start(async () => {
            const r = await addOrderForm(caseId, picked);
            setResult(r);
            if (r.ok) {
              setPicked("");
              router.refresh();
            }
          })
        }
        className="bg-brand h-9 rounded-[9px] px-3.5 text-[13px] font-semibold text-white disabled:opacity-50"
      >
        + Add form
      </button>
      {result ? <span className={"text-[12.5px] " + (result.ok ? "text-[#067647]" : "text-bad")}>{result.message}</span> : null}
    </div>
  );
}

/** Take a form off: one not filled goes; a filled one is withdrawn, with why. */
export function RemoveOrderForm({ formId, name, filled }: { formId: string; name: string; filled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`${filled ? "Withdraw" : "Remove"} ${name}`}
      title={filled ? "Withdraw — it has been filled; it is kept in the case's history" : "Remove from the Order tab"}
      onClick={() => {
        let reason = "";
        if (filled) {
          reason = window.prompt(`Withdraw "${name}"? It has been filled — say why (kept in the case's history):`) ?? "";
          if (!reason.trim()) return;
        } else if (!window.confirm(`Remove "${name}" from the Order tab?`)) return;
        start(async () => {
          const r = await removeOrderForm(formId, reason);
          if (!r.ok) window.alert(r.message);
          router.refresh();
        });
      }}
      className="text-ink-3 hover:text-bad flex h-[26px] w-[26px] flex-none items-center justify-center rounded-md border-0 bg-transparent hover:bg-[#FEF3F2]"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
      </svg>
    </button>
  );
}
