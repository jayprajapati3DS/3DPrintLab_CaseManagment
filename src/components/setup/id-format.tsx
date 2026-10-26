"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { S_BTN_PRIMARY, S_BTN_SMALL, S_INPUT, S_LABEL } from "@/components/setup/ui";
import { saveIdRuleAction } from "@/lib/resources/actions";
import type { ResourceKind } from "@/lib/resources/config";
import { ID_TOKENS, nextIds, patternProblem, type IdRule } from "@/lib/resources/ids";

/**
 * "ID format" on a list page: how this kind of record is given its ID — a
 * prefix and a running number, letters or both, optionally with the type and
 * date — and whether it is assigned on its own. IDs can always be typed.
 */
export function IdFormat({
  kind,
  title,
  fieldLabel,
  typeLabel,
  rule,
  suggested,
  used,
  types,
}: {
  kind: ResourceKind;
  title: string;
  fieldLabel: string;
  typeLabel: string;
  rule: IdRule;
  suggested: string;
  /** IDs already given, so the preview starts where the next one will. */
  used: string[];
  /** Types to preview {TYPE} with. */
  types: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [auto, setAuto] = useState(rule.auto);
  const [pattern, setPattern] = useState(rule.pattern);
  const [type, setType] = useState(types[0] ?? "");
  const [status, setStatus] = useState<{ text: string; bad: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Escape closes; the page behind does not scroll.
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  const problem = patternProblem(pattern);
  const preview = problem ? [] : nextIds(pattern, { type, now: new Date() }, used, 3);
  const usesType = pattern.includes("{TYPE}");
  // The pattern's own prefix, for the presets: "PR-{TYPE}-{##}" → "PR".
  const prefix = (/^[^{]*/.exec(pattern)?.[0] ?? "").replace(/[-_./ ]+$/, "") || "ID";
  const presets: Array<[string, string]> = [
    ["Suggested", suggested],
    ["Numbers", `${prefix}-{###}`],
    ["Letters", `${prefix}-{AA}`],
    ["Letters + numbers", `${prefix}-{XXXX}`],
    ["Type + number", `${prefix}-{TYPE}-{##}`],
    ["Year + number", `${prefix}-{YY}-{###}`],
  ];

  function insert(token: string) {
    const el = input.current;
    const at = el?.selectionStart ?? pattern.length;
    const end = el?.selectionEnd ?? at;
    const next = pattern.slice(0, at) + token + pattern.slice(end);
    setPattern(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  }

  function save() {
    setStatus(null);
    startTransition(async () => {
      try {
        const result = await saveIdRuleAction(kind, { auto, pattern: pattern.trim() });
        if (!result.ok) {
          setStatus({ text: result.message ?? "Could not save.", bad: true });
          return;
        }
        setOpen(false);
        router.refresh();
      } catch {
        setStatus({ text: "The server could not be reached. Try again.", bad: true });
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setAuto(rule.auto);
          setPattern(rule.pattern);
          setStatus(null);
          setOpen(true);
        }}
        className={S_BTN_SMALL + " h-[38px]"}
      >
        ID format{rule.auto ? " · auto" : ""}
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(12,21,36,.55)] px-2 py-3 sm:px-4 sm:py-10"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="idf-title"
            tabIndex={-1}
            className="shadow-modal flex w-[620px] max-w-full flex-col overflow-hidden rounded-[14px] bg-white outline-none"
          >
            <div className="border-line-2 flex items-center gap-3 border-b px-4 py-4 sm:px-[22px]">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <h2 id="idf-title" className="m-0 text-base font-bold">
                  ID format
                </h2>
                <span className="text-muted text-[12.5px]">
                  {title} · {fieldLabel}
                </span>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="bg-chip text-ink-3 h-[34px] w-[34px] rounded-lg border-0">
                ×
              </button>
            </div>

            <div className="flex flex-col gap-4 px-4 py-[18px] sm:px-[22px]">
              <label className="border-line-2 flex cursor-pointer items-start gap-2.5 rounded-[10px] border px-3 py-2.5">
                <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="mt-0.5 h-4 w-4 flex-none" />
                <span className="flex flex-col gap-0.5">
                  <span className="text-[13.5px] font-semibold">Assign automatically</span>
                  <span className="text-muted text-[12.5px]">
                    When the {fieldLabel} is left blank, the next ID in this format is given on save. A {fieldLabel.toLowerCase()} typed by
                    hand is always kept; with this off, use Generate on the record to fill one in.
                  </span>
                </span>
              </label>

              <label className="flex flex-col gap-[5px]">
                <span className={S_LABEL}>Pattern</span>
                <input
                  ref={input}
                  aria-label="Pattern"
                  value={pattern}
                  maxLength={40}
                  onChange={(e) => setPattern(e.target.value)}
                  className={S_INPUT + " font-mono"}
                />
              </label>

              <div className="flex flex-col gap-1.5">
                <span className={S_LABEL}>Insert</span>
                <div className="flex flex-wrap gap-1.5">
                  {ID_TOKENS.map((t) => (
                    <button
                      key={t.token}
                      type="button"
                      onClick={() => insert(t.token)}
                      title={t.hint}
                      className="border-field text-ink-2 inline-flex h-[30px] items-center gap-1.5 rounded-md border bg-white px-2 text-[12px] font-semibold"
                    >
                      <span className="font-mono text-[11.5px]">{t.token}</span>
                      <span className="text-muted font-normal">{t.label}</span>
                    </button>
                  ))}
                </div>
                <span className="text-muted text-[11.5px]">
                  One running part: <span className="font-mono">{"{###}"}</span> numbers, <span className="font-mono">{"{AA}"}</span> letters
                  or <span className="font-mono">{"{XXX}"}</span> letters and numbers — its width sets the padding.
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className={S_LABEL}>Presets</span>
                <div className="flex flex-wrap gap-1.5">
                  {presets.map(([label, value]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setPattern(value)}
                      aria-pressed={pattern === value}
                      className={
                        "inline-flex h-[30px] items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-semibold " +
                        (pattern === value ? "border-brand bg-brand-wash text-brand-ink" : "border-field text-ink-2 bg-white")
                      }
                    >
                      {label} <span className="font-mono font-normal">{value}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-line-2 bg-subtle flex flex-col gap-2 rounded-[10px] border px-3.5 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className={S_LABEL}>Next IDs</span>
                  {usesType && types.length > 0 ? (
                    <label className="text-muted flex items-center gap-1.5 text-[12px]">
                      for {typeLabel.toLowerCase()}
                      <select value={type} onChange={(e) => setType(e.target.value)} aria-label={`Preview for ${typeLabel}`} className="border-field h-[30px] rounded-md border bg-white px-1.5 text-[12px]">
                        {types.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
                {problem ? (
                  <span role="alert" className="text-bad text-[12.5px]">
                    {problem}
                  </span>
                ) : (
                  <div className="flex flex-wrap gap-2" data-testid="id-preview">
                    {preview.map((id) => (
                      <span key={id} className="border-line rounded-md border bg-white px-2 py-1 font-mono text-[13px] font-semibold">
                        {id}
                      </span>
                    ))}
                  </div>
                )}
                <span className="text-muted text-[11.5px]">
                  Counted from the IDs already given{used.length ? ` (${used.length} in use)` : ""} — one past the highest in the same format.
                </span>
              </div>

              {status ? (
                <span role="status" className={"text-[12.5px] " + (status.bad ? "text-bad" : "text-ok")}>
                  {status.text}
                </span>
              ) : null}
            </div>

            <div className="border-line-2 flex justify-end gap-2 border-t px-4 py-3.5 sm:px-[22px]">
              <button type="button" onClick={() => setOpen(false)} className={S_BTN_SMALL}>
                Cancel
              </button>
              <button type="button" disabled={pending || Boolean(problem)} onClick={save} className={S_BTN_PRIMARY}>
                {pending ? "Saving…" : "Save ID format"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
