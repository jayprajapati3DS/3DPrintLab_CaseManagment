"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useToast } from "@/components/ui/toast";
import { saveRequestRule } from "@/lib/parts/actions";
import {
  buildPartNumber,
  cleanPrefix,
  countingLabel,
  labelOnlyTokens,
  numberingExamples,
  scopeMissing,
  SEPARATORS,
  SEQ_SCOPE_LABELS,
  SEQ_SCOPES,
  TOKEN_CODES,
  TOKENS,
  type IdRule,
  type TokenCode,
} from "@/lib/parts/request-form";

/**
 * The part-ID rule — one for the space, whichever request form a part was
 * asked for with — edited on the Part Request Setup list.
 */

/** The parts the numbering examples are for, in the order numberingExamples gives them. */
const EXAMPLE_PARTS = ["Case E123 · Implant", "Case E123 · Implant", "Case E123 · Model", "Case E124 · Implant"];

function move<T>(list: T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

export function RuleCard({ initial, canEdit, spaceName }: { initial: IdRule; canEdit: boolean; spaceName: string }) {
  const router = useRouter();
  const { toast, node } = useToast();
  const [pending, startTransition] = useTransition();
  const [rule, setRuleState] = useState<IdRule>(initial);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initial));
  const dirty = JSON.stringify(rule) !== baseline;
  // The preview's clock is fixed when the page opens, so the year and month tokens do not flicker.
  const [now] = useState(() => new Date());
  const context = { spaceName, now };
  const setRule = (change: Partial<IdRule>) => setRuleState((r) => ({ ...r, ...change }));
  // Tokens after PART_SEQ name the part without starting a new count.
  const scope = rule.scope ?? "case";
  const labelsOnly = scope === "auto" ? labelOnlyTokens(rule) : [];
  const missing = scopeMissing(rule);

  function save() {
    const payload = JSON.stringify(rule);
    startTransition(async () => {
      try {
        const result = await saveRequestRule(payload);
        if (!result.ok) {
          toast(result.message ?? "The rule could not be saved.", true);
          return;
        }
        setBaseline(payload);
        toast("Part ID rule saved — new parts are numbered this way");
        router.refresh();
      } catch {
        toast("The server could not be reached. Try again.", true);
      }
    });
  }

  return (
    <fieldset disabled={!canEdit || pending} className="m-0 min-w-0 border-0 p-0">
      <div className="border-line flex flex-col gap-3.5 rounded-[14px] border bg-white px-5 py-[18px]">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="bg-brand-tint text-brand flex h-6 w-6 items-center justify-center rounded-md font-mono text-[13px] font-bold">
            #
          </span>
          <div className="flex flex-col gap-0.5">
            <h3 className="m-0 text-sm font-bold">Part ID Rule</h3>
            <div className="text-muted text-xs">The identifier generated for every new part — the same whichever request form is used.</div>
          </div>
          <span className="text-brand-glow bg-navy ml-auto rounded-md px-2.5 py-1 font-mono text-[13px] font-semibold" data-testid="id-preview">
            {buildPartNumber(rule, context, true) || "—"}
          </span>
          {canEdit ? (
            <button
              type="button"
              onClick={save}
              disabled={!dirty || pending}
              className="bg-brand h-9 rounded-lg border-0 px-3.5 text-[12.5px] font-semibold text-white disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save rule"}
            </button>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-[150px_minmax(0,1fr)]">
          <label className="flex flex-col gap-1.5 text-xs font-bold">
            Prefix
            <input
              value={rule.prefix}
              onChange={(e) => setRule({ prefix: cleanPrefix(e.target.value) })}
              className="border-field bg-subtle h-10 rounded-[9px] border px-3 font-mono text-sm font-semibold"
            />
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-bold">Separator</span>
            <div className="grid grid-cols-4 gap-2">
              {SEPARATORS.map((sep) => {
                const on = rule.sep === sep;
                return (
                  <button
                    key={sep || "none"}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setRule({ sep })}
                    className={
                      "text-ink h-10 rounded-[9px] border font-mono text-sm font-semibold " +
                      (on ? "border-brand-edge bg-brand-wash" : "border-field bg-white")
                    }
                  >
                    {sep || "none"}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold">Token sequence</span>
          <div className="border-field flex flex-wrap items-center gap-2 rounded-[10px] border border-dashed bg-[#FCFCFD] p-3">
            <span className="border-field inline-flex h-[38px] items-center rounded-lg border bg-white px-3 font-mono text-[13px] font-semibold">
              {rule.prefix || "—"}
            </span>
            {rule.tokens.map((token, i) => (
              <span key={token} className="inline-flex items-center gap-2">
                <span className="text-faint font-mono">{rule.sep || "·"}</span>
                <span className="border-brand-edge bg-brand-wash inline-flex h-[38px] items-center gap-1.5 rounded-lg border pr-1.5 pl-2.5">
                  <span className="flex flex-col leading-[1.15]">
                    <span className="text-brand-ink font-mono text-xs font-semibold">{token}</span>
                    <span className="text-brand font-mono text-[10px]">
                      {buildPartNumber({ prefix: "", sep: "", tokens: [token] }, context, true)}
                    </span>
                  </span>
                  <TokenButton label="Move token left" onClick={() => setRule({ tokens: move(rule.tokens, i, -1) })}>
                    ‹
                  </TokenButton>
                  <TokenButton label="Move token right" onClick={() => setRule({ tokens: move(rule.tokens, i, 1) })}>
                    ›
                  </TokenButton>
                  <button
                    type="button"
                    aria-label={`Remove token ${token}`}
                    onClick={() => setRule({ tokens: rule.tokens.filter((t) => t !== token) })}
                    className="text-brand h-[22px] w-[22px] rounded-[5px] border-0 bg-transparent"
                  >
                    ×
                  </button>
                </span>
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {TOKEN_CODES.map((token: TokenCode) => {
              const on = rule.tokens.includes(token);
              const sample = buildPartNumber({ prefix: "", sep: "", tokens: [token] }, context, true);
              return (
                <button
                  key={token}
                  type="button"
                  title={`${TOKENS[token].description} · e.g. ${sample}`}
                  onClick={() => (on ? undefined : setRule({ tokens: [...rule.tokens, token] }))}
                  aria-pressed={on}
                  className={
                    "text-ink-2 h-8 rounded-full border px-3 font-mono text-xs font-semibold " +
                    (on ? "border-brand-edge bg-brand-wash" : "border-field bg-white")
                  }
                >
                  {token} {on ? "✓" : "+"}
                </button>
              );
            })}
          </div>
          {!rule.tokens.includes("PART_SEQ") ? (
            <div className="text-warn text-[11.5px]">
              Without PART_SEQ, two parts of one case would get the same ID — the part sequence is then added at the
              end automatically.
            </div>
          ) : null}
        </div>

        {/* How the part sequence counts */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold">Numbering — what PART_SEQ counts</span>
          <div role="radiogroup" aria-label="Numbering" className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {SEQ_SCOPES.map((option) => {
              const on = scope === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setRule({ scope: option })}
                  className={
                    "flex min-w-0 flex-col gap-1 rounded-[10px] border px-3 py-2.5 text-left " +
                    (on ? "border-brand bg-brand-wash" : "border-field hover:bg-subtle bg-white")
                  }
                >
                  <span className="text-ink text-[13px] font-bold">{SEQ_SCOPE_LABELS[option].title}</span>
                  <span className="text-muted text-[12px] leading-[1.4]">{SEQ_SCOPE_LABELS[option].detail}</span>
                </button>
              );
            })}
          </div>
          {scope === "auto" ? (
            <p data-testid="numbering" className="text-ink-2 m-0 text-[12.5px] leading-[1.5]">
              {countingLabel(rule)}
            </p>
          ) : null}
          {labelsOnly.length ? (
            <p data-testid="numbering-hint" className="text-muted m-0 text-[11.5px] leading-[1.5]">
              {labelsOnly.join(", ")} {labelsOnly.length === 1 ? "comes" : "come"} after PART_SEQ, so{" "}
              {labelsOnly.length === 1 ? "it labels" : "they label"} the part without starting a new count. Move{" "}
              {labelsOnly.length === 1 ? "it" : "them"} before PART_SEQ for a separate count of each.
            </p>
          ) : null}
          {missing.length ? (
            <div data-testid="numbering-warning" className="text-warn text-[11.5px]">
              {SEQ_SCOPE_LABELS[scope].title} needs {missing.join(" and ")} in the ID — without it two parts would get the
              same ID, and the sequence is then added at the end.
            </div>
          ) : null}
          {rule.tokens.includes("PART_SEQ") ? (
            <div data-testid="numbering-examples" className="border-line grid max-w-[520px] grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-[10px] border bg-white px-3 py-2.5">
              {numberingExamples(rule, spaceName, now).map((id, i) => (
                <div key={i} className="contents">
                  <span className="text-muted text-[12px]">{EXAMPLE_PARTS[i]}</span>
                  <span className="text-ink font-mono text-[12px] break-all">{id}</span>
                </div>
              ))}
            </div>
          ) : null}
          <label className="text-ink-2 flex items-center gap-2 text-xs font-bold">
            Digits
            <select
              aria-label="Sequence digits"
              value={rule.width ?? 2}
              onChange={(e) => setRule({ width: Number(e.target.value) })}
              className="border-field h-8 rounded-md border bg-white px-2 font-mono text-[12.5px] font-normal"
            >
              {[1, 2, 3, 4].map((w) => (
                <option key={w} value={w}>
                  {"1".padStart(w, "0")}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {node}
    </fieldset>
  );
}

function TokenButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="bg-chip h-[22px] w-[22px] rounded-[5px] border-0">
      {children}
    </button>
  );
}
