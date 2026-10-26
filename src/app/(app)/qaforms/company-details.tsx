"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useToast } from "@/components/ui/toast";
import { saveCompanyDetails } from "@/lib/qa/actions";
import { COMPANY_FIELDS } from "@/lib/qa/variables";

/**
 * Company details for quality forms: read by forms as {company.…} and
 * printed at the foot of every controlled-document form.
 */
export function CompanyDetails({ initial, canEdit }: { initial: Record<string, string>; canEdit: boolean }) {
  const router = useRouter();
  const { toast, node } = useToast();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState(initial);
  const dirty = COMPANY_FIELDS.some((f) => (values[f.key] ?? "") !== (initial[f.key] ?? ""));

  function save() {
    startTransition(async () => {
      try {
        const result = await saveCompanyDetails(values);
        if (!result.ok) {
          toast(result.message ?? "Could not save.", true);
          return;
        }
        toast(result.message ?? "Saved");
        router.refresh();
      } catch {
        toast("The server could not be reached. Try again.", true);
      }
    });
  }

  return (
    <section className="border-line flex flex-col gap-3.5 rounded-[14px] border bg-white px-4 py-[18px] sm:px-[22px]">
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 text-[15px] font-bold">Company details</h2>
        <p className="text-muted m-0 text-[12.5px] leading-[1.5]">
          Used by forms as <span className="font-mono">{"{company.name}"}</span>, <span className="font-mono">{"{company.licence}"}</span>,{" "}
          <span className="font-mono">{"{company.address}"}</span>… and printed at the foot of every controlled-document form.
        </p>
      </div>
      <fieldset disabled={!canEdit || pending} className="m-0 grid grid-cols-1 gap-3 border-0 p-0 sm:grid-cols-2">
        {COMPANY_FIELDS.map((f) => (
          <label key={f.key} className={"flex flex-col gap-1 text-xs font-semibold " + (f.key === "address" ? "sm:col-span-2" : "")}>
            {f.label}
            <input
              value={values[f.key] ?? ""}
              placeholder={f.placeholder}
              maxLength={300}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              className="border-field h-9 rounded-lg border px-2.5 text-[13px] font-normal disabled:bg-subtle"
            />
            <span className="text-faint font-mono text-[11px] font-normal">{`{company.${f.key}}`}</span>
          </label>
        ))}
      </fieldset>
      {canEdit ? (
        <button
          type="button"
          disabled={!dirty || pending}
          onClick={save}
          className="bg-ink h-9 self-start rounded-lg border-0 px-3.5 text-[13px] font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save company details"}
        </button>
      ) : null}
      {node}
    </section>
  );
}
