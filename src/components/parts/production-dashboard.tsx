import type { Prisma } from "@prisma/client";

import { fmtDate } from "@/lib/format";
import { partStageMeta, partStages } from "@/lib/parts/queries";

/**
 * A case's production at a glance, above its parts: how many and how far, what
 * is late, how long it is taking — stage by stage against what each stage is
 * expected to take — what material has been used and on which machines. Read
 * from the parts, their stages and what their quality forms recorded.
 */

const DAY = 86_400_000;

interface DashPart {
  name: string;
  partNumber: string;
  createdAt: Date;
  dueOn: Date | null;
  stageIndex: number;
  material: string | null;
  printer: string | null;
  stages: Prisma.JsonValue;
  stageMeta: Prisma.JsonValue;
}

interface DashForm {
  status: string;
  outOfSpec: number;
  uses: Array<{ source: string; label: string; quantity: Prisma.Decimal | null; unit: string | null }>;
}

/** "3.5 d", "6 h", "40 min". */
function span(ms: number): string {
  if (ms >= DAY) return `${(ms / DAY).toFixed(ms >= 10 * DAY ? 0 : 1)} d`;
  if (ms >= 3_600_000) return `${Math.round(ms / 3_600_000)} h`;
  return `${Math.max(1, Math.round(ms / 60_000))} min`;
}

const STOCK = new Set(["lots", "components", "packaging"]);

export function ProductionDashboard({ parts, timeZone, now }: { parts: Array<{ part: DashPart; forms: DashForm[] }>; timeZone: string; /** The time now, in ms — given by the page. */ now: number }) {
  if (parts.length === 0) return null;
  const today = new Date(new Date(now).toISOString().slice(0, 10) + "T00:00:00Z").getTime();

  let finished = 0;
  let notStarted = 0;
  const overdue: string[] = [];
  let nextDue: Date | null = null;
  const finishTimes: number[] = [];
  // By stage name, across the parts: the time each completed stage took, and what it is expected to take.
  const stageTime = new Map<string, { total: number; n: number; expected: number | null; order: number }>();
  let first = Infinity;
  let lastEnd = 0;

  for (const { part } of parts) {
    const stages = partStages(part);
    const meta = partStageMeta(part);
    const last = stages.length - 1;
    const done = stages.length > 0 && part.stageIndex >= last && Boolean(meta[last - 1]?.at || last === 0);
    first = Math.min(first, part.createdAt.getTime());
    if (stages.length === 0 || (part.stageIndex === 0 && !meta[0]?.at)) notStarted += 1;
    if (done) {
      finished += 1;
      const end = meta[last - 1]?.at ? new Date(meta[last - 1].at!).getTime() : now;
      finishTimes.push(end - part.createdAt.getTime());
      lastEnd = Math.max(lastEnd, end);
    } else {
      if (part.dueOn && part.dueOn.getTime() < today) overdue.push(part.partNumber);
      if (part.dueOn && (!nextDue || part.dueOn < nextDue)) nextDue = part.dueOn;
    }
    stages.forEach((st, i) => {
      const startIso = i === 0 ? part.createdAt.toISOString() : meta[i - 1]?.at;
      const endIso = meta[i]?.at;
      const entry = stageTime.get(st.name) ?? { total: 0, n: 0, expected: st.days ?? null, order: i };
      if (startIso && endIso) {
        entry.total += new Date(endIso).getTime() - new Date(startIso).getTime();
        entry.n += 1;
      }
      entry.order = Math.min(entry.order, i);
      stageTime.set(st.name, entry);
    });
  }
  const allDone = finished === parts.length;
  const elapsed = (allDone && lastEnd ? lastEnd : now) - first;
  const avgFinish = finishTimes.length ? finishTimes.reduce((a, b) => a + b, 0) / finishTimes.length : null;

  const forms = parts.flatMap((p) => p.forms);
  const approved = forms.filter((f) => f.status === "Approved").length;
  const outOfSpec = forms.reduce((n, f) => n + (f.outOfSpec ?? 0), 0);

  // Material taken from stock through the forms; machines recorded on them.
  const material = new Map<string, { qty: number; unit: string }>();
  const machines = new Set<string>();
  for (const f of forms) {
    for (const u of f.uses) {
      if (STOCK.has(u.source) && u.quantity !== null) {
        const key = `${u.label}|${u.unit ?? ""}`;
        const m = material.get(key) ?? { qty: 0, unit: u.unit ?? "" };
        m.qty += Number(u.quantity);
        material.set(key, m);
      }
      if (u.source === "printers") machines.add(u.label);
    }
  }
  for (const { part } of parts) if (part.printer) machines.add(part.printer);
  const planned = [...new Set(parts.map((p) => p.part.material).filter((m): m is string => Boolean(m)))];

  const stagesShown = [...stageTime.entries()].sort((a, b) => a[1].order - b[1].order);
  const longest = Math.max(1, ...stagesShown.map(([, s]) => Math.max(s.n ? s.total / s.n : 0, (s.expected ?? 0) * DAY)));

  return (
    <section aria-label="Production summary" data-testid="production-dashboard" className="flex flex-col gap-3.5">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Tile label="Parts" value={`${finished} / ${parts.length} done`} note={`${parts.length - finished - notStarted} in progress · ${notStarted} not started`} />
        <Tile
          label="Overdue"
          value={String(overdue.length)}
          tone={overdue.length ? "bad" : undefined}
          note={overdue.length ? overdue.slice(0, 2).join(", ") + (overdue.length > 2 ? "…" : "") : nextDue ? `Next due ${fmtDate(nextDue, timeZone)}` : "Nothing due"}
        />
        <Tile
          label={allDone ? "Production time" : "Production time so far"}
          value={span(Math.max(0, elapsed))}
          note={avgFinish !== null ? `Avg ${span(avgFinish)} per finished part` : "No part finished yet"}
        />
        <Tile label="Quality forms" value={`${approved} / ${forms.length} approved`} tone={outOfSpec ? "bad" : undefined} note={outOfSpec ? `${outOfSpec} result${outOfSpec === 1 ? "" : "s"} out of specification` : "Nothing out of specification"} />
      </div>

      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="border-line flex flex-col gap-2.5 rounded-[12px] border bg-white px-4 py-3.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-ink text-[13px] font-bold">Time by stage</span>
            <span className="text-muted text-[11.5px]">Average actual time (dark bar) · expected time (light bar) · over expected in red</span>
          </div>
          <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Time by stage">
            {stagesShown.map(([name, s]) => {
              const avg = s.n ? s.total / s.n : null;
              const expected = s.expected ? s.expected * DAY : null;
              const slow = avg !== null && expected !== null && avg > expected;
              return (
                <li key={name} className="grid grid-cols-[minmax(110px,150px)_1fr_auto] items-center gap-2.5 text-[12px]" title={`${name}: ${avg !== null ? `${span(avg)} on average over ${s.n} part${s.n === 1 ? "" : "s"}` : "not completed yet"}${expected ? ` · expected ${s.expected} working day${s.expected === 1 ? "" : "s"}` : ""}`}>
                  <span className="text-ink-2 truncate">{name}</span>
                  <span className="relative h-3 rounded-[4px] bg-[#F2F4F7]">
                    {expected ? <span className="absolute inset-y-0 left-0 rounded-[4px] bg-[#E4E7EC]" style={{ width: `${(expected / longest) * 100}%` }} /> : null}
                    {avg !== null ? <span className={"absolute inset-y-[2px] left-0 rounded-[4px] " + (slow ? "bg-[#D92D20]" : "bg-[#475467]")} style={{ width: `${Math.max(2, (avg / longest) * 100)}%` }} /> : null}
                  </span>
                  <span className={"min-w-[96px] text-right font-mono whitespace-nowrap " + (slow ? "text-bad font-semibold" : "text-ink-3")}>
                    {avg !== null ? span(avg) : "—"}
                    {expected ? <span className="text-faint"> / {s.expected} d</span> : null}
                    {slow && avg !== null && expected !== null ? <span className="block font-sans text-[10.5px]">over by {span(avg - expected)}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex flex-col gap-2.5">
          <div className="border-line flex flex-col gap-2 rounded-[12px] border bg-white px-4 py-3.5">
            <span className="text-ink text-[13px] font-bold">Material used</span>
            {material.size ? (
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px]">
                {[...material.entries()].map(([key, m]) => (
                  <li key={key} className="flex items-baseline justify-between gap-3">
                    <span className="text-ink-2 min-w-0 truncate">{key.split("|")[0]}</span>
                    <span className="text-ink font-mono font-semibold whitespace-nowrap">
                      {Number(m.qty.toFixed(3))} {m.unit}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-muted text-[12.5px]">
                None recorded on the forms yet{planned.length ? ` · planned: ${planned.join(", ")}` : ""}.
              </span>
            )}
          </div>
          <div className="border-line flex flex-col gap-2 rounded-[12px] border bg-white px-4 py-3.5">
            <span className="text-ink text-[13px] font-bold">Machines</span>
            <span className="text-ink-2 text-[12.5px]">{machines.size ? [...machines].join(", ") : "None recorded yet."}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Tile({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "bad" }) {
  return (
    <div className={"flex flex-col gap-0.5 rounded-[12px] border px-4 py-3 " + (tone === "bad" ? "border-[#FECDCA] bg-[#FEF3F2]" : "border-line bg-white")}>
      <span className="text-muted text-[11px] font-semibold tracking-[0.5px] uppercase">{label}</span>
      <span className={"text-[18px] font-bold " + (tone === "bad" ? "text-bad" : "text-ink")}>{value}</span>
      <span className="text-muted text-[11.5px]">{note}</span>
    </div>
  );
}
