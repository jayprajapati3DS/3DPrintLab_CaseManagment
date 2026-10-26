"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { useToast } from "@/components/ui/toast";
import { deleteCaseForm, setDefaultCaseForm, type CaseActionResult } from "@/lib/cases/actions";

/**
 * Case Form Setup's list of case forms: open one to edit it, add one — from
 * the default fields or as a copy of another — make default, delete. A new
 * form is only created when it is first saved.
 */

export interface CaseFormRow {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  products: string[];
  sections: number;
  fields: number;
  cases: number;
}

export function CaseFormsList({ rows, canEdit, managed }: { rows: CaseFormRow[]; canEdit: boolean; managed: boolean }) {
  const router = useRouter();
  const { toast, node } = useToast();
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<CaseActionResult>) {
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) return toast(result.message ?? "That did not work. Try again.", true);
        if (result.message) toast(result.message);
        router.refresh();
      } catch {
        toast("The server could not be reached. Try again.", true);
      }
    });
  }

  return (
    <section className="border-line flex flex-col gap-3.5 rounded-[14px] border bg-white px-4 py-[18px] sm:px-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="bg-brand-tint text-brand flex h-6 w-6 items-center justify-center rounded-md text-[13px] font-bold">≡</span>
        <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
          <h3 className="m-0 text-sm font-bold">Case forms</h3>
          <div className="text-muted text-xs">
            One form per kind of case, if you like — a 3D PDF case asks less than a guide. Whoever opens a case picks the form; with one form, it opens straight away.
            {managed ? "" : " Used once cases are managed here."}
          </div>
        </div>
        {canEdit && rows.length < 30 ? (
          <Link href="/casesetup?form=new" className="bg-brand-ink flex h-9 items-center rounded-lg px-3.5 text-[12.5px] font-semibold text-white no-underline">
            + New form
          </Link>
        ) : null}
      </div>

      <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-2" aria-label="Case forms list">
        {rows.map((r) => (
          <li key={r.id} className="border-line hover:border-brand-edge relative flex flex-col gap-3 rounded-[12px] border bg-white p-4">
            <Link href={`/casesetup?form=${r.id}`} className="text-ink flex min-w-0 flex-col gap-0.5 no-underline after:absolute after:inset-0">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-bold [overflow-wrap:anywhere]">{r.name}</span>
                {r.isDefault ? <span className="bg-chip text-muted rounded px-1.5 py-px text-[9.5px] font-bold tracking-[0.4px]">DEFAULT</span> : null}
              </span>
              {r.description ? <span className="text-ink-3 text-[12.5px]">{r.description}</span> : null}
              <span className="text-muted text-[12px]">{r.products.length ? `For ${r.products.join(", ")}` : "For any product"}</span>
              <span className="text-muted text-[12px]">
                {r.sections} section{r.sections === 1 ? "" : "s"} · {r.fields} field{r.fields === 1 ? "" : "s"} shown · {r.cases} case{r.cases === 1 ? "" : "s"} opened
              </span>
            </Link>
            <div className="border-line-3 relative z-[1] flex flex-wrap items-center gap-1.5 border-t pt-3">
              <Link href={`/casesetup?form=${r.id}`} className="bg-ink flex h-8 items-center rounded-lg px-3 text-[12.5px] font-semibold text-white no-underline">
                {canEdit ? "Edit" : "View"}
              </Link>
              {canEdit ? (
                <>
                  {rows.length < 30 ? (
                    <Link
                      href={`/casesetup?form=new&from=${r.id}`}
                      className="border-field text-ink-2 flex h-8 items-center rounded-lg border bg-white px-3 text-[12.5px] font-semibold no-underline"
                    >
                      Duplicate
                    </Link>
                  ) : null}
                  {!r.isDefault ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => setDefaultCaseForm(r.id))}
                      className="border-field text-ink-2 h-8 rounded-lg border bg-white px-3 text-[12.5px] font-semibold disabled:opacity-50"
                    >
                      Make default
                    </button>
                  ) : null}
                  <span className="flex-1" />
                  <button
                    type="button"
                    disabled={pending || r.isDefault || r.cases > 0}
                    title={r.isDefault ? "Make another form the default first" : r.cases ? "Cases were opened with it — it stays so they keep their layout" : undefined}
                    aria-label={`Delete ${r.name}`}
                    onClick={() => {
                      if (window.confirm(`Delete the case form "${r.name}"? No case was opened with it.`)) run(() => deleteCaseForm(r.id));
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
