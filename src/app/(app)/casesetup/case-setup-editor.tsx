"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { S_BTN_PRIMARY, S_INPUT, S_LABEL } from "@/components/setup/ui";
import { useToast } from "@/components/ui/toast";
import { saveCaseRule } from "@/lib/cases/actions";
import type { CaseSetup } from "@/lib/cases/case-form";
import { CASE_FIELD_TOKENS, ID_TOKENS, nextIds, patternProblem } from "@/lib/resources/ids";

/** Sample answers for the preview of an ID made from a case's own fields. */
const SAMPLE_FIELDS = { SURGEON: "HR", PATIENT: "MA", PID: "2606", SURGERY: "041026", DELIVERY: "300926", HOSPITAL: "13" };

/**
 * Case Form Setup's first card: where this space's cases come from, and the
 * case ID pattern every case form shares. Nothing changes until "Save". Each
 * case form is edited on its own page (case-form-builder.tsx).
 */

const SOURCES: Array<{ value: CaseSetup["source"]; title: string; detail: string }> = [
  { value: "local", title: "Managed here", detail: "Cases are opened in this app from the case forms below — no platform sync." },
  { value: "platform", title: "From the 3D Surgical Platform", detail: "Cases arrive by the platform sync; the case forms are not used." },
];

const CARD = "border-line flex flex-col gap-3 rounded-[14px] border bg-white px-4 py-[18px] sm:px-[22px]";

export function CaseRuleCard({
  initial,
  saved,
  canEdit,
  productCodes,
  used,
}: {
  initial: Pick<CaseSetup, "source" | "idPattern" | "idStart">;
  saved: boolean;
  canEdit: boolean;
  /** Products' codes, to preview {TYPE}. */
  productCodes: string[];
  /** Case numbers already given, so the preview starts where the next one will. */
  used: string[];
}) {
  const router = useRouter();
  const { toast, node } = useToast();
  const [pending, startTransition] = useTransition();
  const [rule, setRule] = useState(initial);
  const [baseline, setBaseline] = useState(() => (saved ? JSON.stringify(initial) : ""));
  const [previewType, setPreviewType] = useState(productCodes[0] ?? "PSI");
  const [now] = useState(() => new Date());

  const dirty = JSON.stringify(rule) !== baseline;
  const problem = useMemo(() => {
    const p = patternProblem(rule.idPattern);
    return p ? `Case ID: ${p}` : null;
  }, [rule.idPattern]);
  const preview = useMemo(() => nextIds(rule.idPattern, { type: previewType, now, fields: SAMPLE_FIELDS, start: rule.idStart }, used, 3), [rule.idPattern, rule.idStart, previewType, now, used]);

  function save() {
    if (problem) return toast(problem, true);
    startTransition(async () => {
      try {
        const result = await saveCaseRule(rule.source, rule.idPattern, rule.idStart ?? null);
        if (!result.ok) return toast(result.message ?? "That could not be saved.", true);
        setBaseline(JSON.stringify(rule));
        toast(result.message ?? "Saved");
        router.refresh();
      } catch {
        toast("The server could not be reached. Try again.", true);
      }
    });
  }

  return (
    <fieldset disabled={!canEdit || pending} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
      {/* Where cases come from */}
      <section className={CARD}>
        <div className="flex flex-col gap-0.5">
          <h2 className="m-0 text-[15px] font-bold">Case source</h2>
          <p className="text-muted m-0 text-[12.5px]">Where this space&apos;s cases come from. The Cases page offers &ldquo;+ New case&rdquo; only when they are managed here.</p>
        </div>
        <div role="radiogroup" aria-label="Case source" className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {SOURCES.map((s) => {
            const on = rule.source === s.value;
            return (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setRule((x) => ({ ...x, source: s.value }))}
                className={"flex flex-col gap-1 rounded-[10px] border px-3 py-2.5 text-left " + (on ? "border-brand bg-brand-wash" : "border-field hover:bg-subtle bg-white")}
              >
                <span className="text-ink text-[13px] font-bold">{s.title}</span>
                <span className="text-muted text-[12px] leading-[1.4]">{s.detail}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Case ID */}
      <section className={CARD}>
        <div className="flex flex-col gap-0.5">
          <h2 className="m-0 text-[15px] font-bold">Case ID</h2>
          <p className="text-muted m-0 text-[12.5px]">
            Given automatically when a case is saved, whichever form it is opened with. Exactly one running part, counting up across all cases; {"{TYPE}"} is the product&apos;s code (Products page). The case&apos;s own answers can be part of it too — surgeon and patient initials, patient ID, surgery and delivery dates, and the hospital&apos;s code (set on the Hospitals list). &ldquo;Start numbering from&rdquo; carries the running number on from IDs given elsewhere.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[220px] flex-1 flex-col gap-[5px]">
            <span className={S_LABEL}>Pattern</span>
            <input
              aria-label="Case ID pattern"
              value={rule.idPattern}
              onChange={(e) => setRule((x) => ({ ...x, idPattern: e.target.value }))}
              className={`${S_INPUT} font-mono`}
            />
          </label>
          <label className="flex w-[170px] flex-col gap-[5px]">
            <span className={S_LABEL}>Start numbering from</span>
            <input
              aria-label="Start numbering from"
              type="number"
              min={1}
              step={1}
              placeholder="1"
              value={rule.idStart ?? ""}
              onChange={(e) => {
                const n = Math.floor(Number(e.target.value));
                setRule((x) => ({ ...x, idStart: e.target.value && n > 1 ? n : undefined }));
              }}
              className={`${S_INPUT} font-mono`}
            />
          </label>
          {rule.idPattern.includes("{TYPE}") && productCodes.length ? (
            <label className="flex flex-col gap-[5px]">
              <span className={S_LABEL}>Preview as product</span>
              <select value={previewType} onChange={(e) => setPreviewType(e.target.value)} className={S_INPUT}>
                {productCodes.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[...ID_TOKENS, ...CASE_FIELD_TOKENS].map((t) => (
            <button
              key={t.token}
              type="button"
              title={t.hint}
              onClick={() => setRule((x) => ({ ...x, idPattern: x.idPattern + t.token }))}
              className="border-field text-ink-2 h-7 rounded-full border bg-white px-2.5 font-mono text-[11.5px] font-semibold"
            >
              {t.token} <span className="text-muted font-sans font-normal">{t.label}</span>
            </button>
          ))}
        </div>
        <div data-testid="case-id-preview" className="text-ink-2 text-[12.5px]">
          Next IDs: <span className="text-ink font-mono font-semibold">{preview.length ? preview.join(" · ") : "—"}</span>
        </div>
        {canEdit ? (
          <div className="border-line-3 flex flex-wrap items-center justify-end gap-3 border-t pt-3">
            <span className={"text-[12.5px] " + (problem ? "text-bad" : dirty ? "text-warn font-semibold" : "text-muted")}>
              {problem ?? (dirty ? (baseline ? "Unsaved changes" : "Not saved yet — cases come from the platform") : "Saved")}
            </span>
            <button type="button" onClick={save} disabled={!dirty || Boolean(problem) || pending} className={S_BTN_PRIMARY}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        ) : null}
      </section>
      {node}
    </fieldset>
  );
}
