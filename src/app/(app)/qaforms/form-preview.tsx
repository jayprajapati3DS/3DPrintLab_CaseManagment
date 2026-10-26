"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { QaFormView } from "@/components/qa/form-view";
import type { Libraries } from "@/lib/qa/evaluate";
import type { Inspection } from "@/lib/parts/request-form";
import type { QaTemplateData } from "@/lib/qa/template";
import type { DocLayoutDef } from "@/lib/qa/layouts";
import type { Context } from "@/lib/qa/variables";

/**
 * A QA form as it will appear on a part, opened from the QA forms list
 * (\`?preview=<id>\`): read-only, filled from a part chosen in the dropdown.
 */
export function FormPreview({
  id,
  form,
  context,
  libraries,
  inspection,
  parts,
  partId,
  canEdit,
  layout,
}: {
  id: string;
  form: QaTemplateData;
  context: Context;
  libraries: Libraries;
  inspection: Inspection | null;
  parts: Array<{ id: string; label: string }>;
  partId: string | null;
  canEdit: boolean;
  /** Its header & footer design. */
  layout?: DocLayoutDef;
}) {
  const router = useRouter();
  const close = () => router.push("/qaforms", { scroll: false });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push("/qaforms", { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [router]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(12,21,36,.55)] px-2 py-3 sm:px-4 sm:py-8">
      <div role="dialog" aria-modal="true" aria-labelledby="qa-preview-title" className="shadow-modal w-[860px] max-w-full overflow-hidden rounded-[14px] bg-white">
        <div className="bg-navy flex items-start gap-3 px-4 py-4 sm:px-[22px]">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-brand-glow text-[10.5px] font-bold tracking-[0.8px]">PREVIEW</span>
            <h2 id="qa-preview-title" className="m-0 text-base font-bold text-white">
              {form.name}
            </h2>
            <span className="text-brand-glow font-mono text-[11.5px] break-words">
              {[form.code, form.issue && `Issue ${form.issue}`, form.rev && `Rev ${form.rev}`, form.clause].filter(Boolean).join(" · ")}
            </span>
            <span className="text-navy-muted text-xs">
              {form.attach.length ? `Added to parts at: ${form.attach.join(", ")}` : "Not added to any workflow stage yet"}
            </span>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="h-[34px] w-[34px] flex-none rounded-lg border-0 bg-white/10 text-white">
            ×
          </button>
        </div>
        <div className="border-line-2 flex flex-wrap items-center gap-2 border-b bg-[#F9FAFB] px-4 py-2.5 sm:px-[22px]">
          <label className="text-muted flex min-w-0 flex-1 items-center gap-2 text-[12.5px]">
            Filled from part
            <select
              aria-label="Preview with part"
              value={partId ?? ""}
              onChange={(e) => router.replace(`/qaforms?preview=${id}&part=${e.target.value}`, { scroll: false })}
              className="border-field h-8 min-w-0 flex-1 rounded-lg border bg-white px-2 text-[12.5px] sm:max-w-[420px]"
            >
              {parts.length === 0 ? <option value="">No parts yet — variables show blank</option> : null}
              {parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <Link href={`/qaforms/${id}`} className="border-field text-ink-2 flex h-8 items-center rounded-lg border bg-white px-2.5 text-[12.5px] font-semibold no-underline">
            {canEdit ? "Edit form" : "Open form"}
          </Link>
        </div>
        <QaFormView
          key={partId ?? "none"}
          meta={{
            id: null,
            name: form.name,
            code: form.code,
            clause: form.clause,
            issue: form.issue,
            effective: form.effective,
            rev: form.rev,
            docLayout: form.docLayout,
            validity: form.validity,
            docStyle: form.docStyle,
            layout,
            stageName: form.attach[0] ?? "",
            status: "In progress",
          }}
          sections={form.sections}
          context={context}
          libraries={libraries}
          inspection={inspection}
          initial={{ values: {}, measured: {}, quantities: {} }}
          partLine=""
          partId={null}
          editable={false}
          canApprove={false}
          approveHint={null}
          preview
        />
        <div className="border-line-2 flex justify-end border-t px-4 py-3 sm:px-[22px]">
          <button type="button" onClick={close} className="bg-ink h-[38px] rounded-lg border-0 px-3.5 text-[13px] font-semibold text-white">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
