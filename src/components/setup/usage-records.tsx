import Link from "next/link";

import { FormStatusPill } from "@/components/qa/form-view";
import { StagePill } from "@/components/parts/ui";
import { SectionCard, S_TD, S_TH } from "@/components/setup/ui";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { partStages, stageLabel } from "@/lib/parts/queries";
import { usageRecords } from "@/lib/qa/queries";

/**
 * Where a library item was used: every quality-form entry that picked it,
 * with the part, its case and who recorded it. For a material, its lots count
 * too. For a machine, the parts assigned to it come first: its build history.
 */
export async function UsageRecords({
  spaceId,
  itemIds,
  noun,
  timeZone,
}: {
  spaceId: string;
  itemIds: string[];
  noun: string;
  timeZone: string;
}) {
  const uses = await usageRecords(spaceId, itemIds);
  const parts = new Set(uses.map((u) => u.form.part.id));
  const cases = new Set(uses.map((u) => u.form.part.case?.id).filter(Boolean));
  const last = uses[0]?.form.savedAt ?? uses[0]?.createdAt ?? null;

  return (
    <SectionCard title="Usage records" hint="Every quality-form entry where this item was selected — generated automatically from the QA forms filled on parts.">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Records", String(uses.length)],
          ["Parts", String(parts.size)],
          ["Cases", String(cases.size)],
          ["Last recorded", last ? fmtDateTime(last, timeZone) : "—"],
        ].map(([label, value]) => (
          <div key={label} className="border-line flex flex-col gap-0.5 rounded-xl border px-3.5 py-3">
            <span className="text-muted text-[10.5px] font-semibold tracking-[0.5px] uppercase">{label}</span>
            <span className="text-[15px] font-bold">{value}</span>
          </div>
        ))}
      </div>
      {uses.length === 0 ? (
        <p className="text-muted m-0 text-[13px] leading-[1.5]">
          Not recorded in any quality form yet. Add a “Dropdown” field with this {noun}&apos;s library as its source in QA Form Setup, then fill the form on a part.
        </p>
      ) : (
        <div className="border-line overflow-x-auto rounded-[10px] border">
          <table className="w-full min-w-[820px] border-collapse">
            <thead className="bg-subtle">
              <tr>
                {["Part ID", "Part", "Case", "Recorded in", "Stage", "Form status", "By · when"].map((h) => (
                  <th key={h} className={S_TH}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {uses.map((use) => {
                const part = use.form.part;
                return (
                  <tr key={use.id}>
                    <td className={`${S_TD} font-mono text-[12.5px]`}>
                      <Link href={`/parts/${part.id}?tab=info`} className="text-brand-ink no-underline">
                        {part.partNumber}
                      </Link>
                    </td>
                    <td className={S_TD}>
                      <span className="font-semibold">{part.name}</span>
                      {part.partType ? <span className="text-muted block text-[11.5px]">{part.partType}</span> : null}
                    </td>
                    <td className={S_TD}>
                      {part.case ? (
                        <Link href={`/cases/${part.case.id}`} className="text-brand-ink font-mono text-[12.5px] no-underline">
                          {part.case.caseNumber ?? `#${part.case.platformCaseId}`}
                        </Link>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className={S_TD}>
                      <span className="font-mono text-[12px]">{use.form.code}</span> · {use.form.name}
                      <span className="text-muted block text-[11.5px]">
                        {use.field} → {use.label}
                        {use.quantity ? ` · ${Number(use.quantity)} ${use.unit ?? ""}` : ""}
                      </span>
                    </td>
                    <td className={S_TD}>{use.form.stageName}</td>
                    <td className={S_TD}>
                      <FormStatusPill status={use.form.status} />
                    </td>
                    <td className={S_TD}>
                      {use.form.savedByName ?? "—"}
                      <span className="text-muted block font-mono text-[11.5px]">{use.form.savedAt ? fmtDateTime(use.form.savedAt, timeZone) : ""}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

/** A stage that is the build itself: printing, machining. */
const BUILD = /print|machin|build(?! queued)/i;

/**
 * What a machine is doing now, read from the parts assigned to it: the ones
 * on a build stage are building; those not there yet are its queue.
 */
export async function LiveStatus({ spaceId, machine }: { spaceId: string; machine: string }) {
  const active = await db.part.findMany({
    where: { spaceId, printer: machine, OR: [{ caseId: null }, { case: { bucket: { not: "ARCHIVED" } } }] },
    orderBy: { dueOn: { sort: "asc", nulls: "last" } },
    select: { id: true, partNumber: true, name: true, stageIndex: true, stageCount: true, stages: true, dueOn: true },
  });
  const building: typeof active = [];
  const queued: typeof active = [];
  for (const p of active) {
    const stages = partStages(p);
    const buildAt = stages.findIndex((s) => BUILD.test(s.name));
    if (buildAt < 0 || p.stageIndex >= stages.length - 1) continue;
    if (p.stageIndex === buildAt) building.push(p);
    else if (p.stageIndex < buildAt) queued.push(p);
  }
  const chip = (p: (typeof active)[number]) => (
    <Link key={p.id} href={`/parts/${p.id}`} className="border-line text-ink inline-flex flex-col rounded-lg border bg-white px-2.5 py-1.5 no-underline">
      <span className="font-mono text-xs font-semibold">{p.partNumber}</span>
      <span className="text-muted text-[11.5px]">
        {p.name}
        {p.dueOn ? ` · due ${p.dueOn.toISOString().slice(0, 10)}` : ""}
      </span>
    </Link>
  );
  return (
    <SectionCard title="Live status" hint="What this machine is building and what is waiting for it, read from the parts assigned to it.">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <span className="text-muted text-[11px] font-bold tracking-[0.5px] uppercase">Building now · {building.length}</span>
          <div className="flex flex-wrap gap-2">{building.length ? building.map(chip) : <span className="text-faint text-[12.5px]">Not building</span>}</div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-muted text-[11px] font-bold tracking-[0.5px] uppercase">Queued · {queued.length}</span>
          <div className="flex flex-wrap gap-2">{queued.length ? queued.slice(0, 12).map(chip) : <span className="text-faint text-[12.5px]">Queue empty</span>}</div>
        </div>
      </div>
    </SectionCard>
  );
}

/** The parts a machine is assigned to, newest first, then its usage records. */
export async function BuildHistory({
  spaceId,
  machine,
  timeZone,
}: {
  spaceId: string;
  machine: { id: string; name: string };
  timeZone: string;
}) {
  const parts = await db.part.findMany({
    where: { spaceId, printer: machine.name },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { case: { select: { id: true, caseNumber: true, platformCaseId: true } } },
  });
  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="Build history" hint="Parts assigned to this machine — for traceability, non-conformances and recalls.">
        {parts.length === 0 ? (
          <p className="text-muted m-0 text-[13px]">No parts have been assigned to this machine yet.</p>
        ) : (
          <div className="border-line overflow-x-auto rounded-[10px] border">
            <table className="w-full min-w-[720px] border-collapse">
              <thead className="bg-subtle">
                <tr>
                  {["Part ID", "Part", "Case", "Stage", "Due", "Requested"].map((h) => (
                    <th key={h} className={S_TH}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parts.map((p) => {
                  const stages = partStages(p);
                  return (
                    <tr key={p.id}>
                      <td className={`${S_TD} font-mono text-[12.5px]`}>
                        <Link href={`/parts/${p.id}`} className="text-brand-ink no-underline">
                          {p.partNumber}
                        </Link>
                      </td>
                      <td className={`${S_TD} font-semibold`}>{p.name}</td>
                      <td className={`${S_TD} font-mono text-[12.5px]`}>{p.case ? (p.case.caseNumber ?? `#${p.case.platformCaseId}`) : "—"}</td>
                      <td className={S_TD}>
                        <StagePill name={stageLabel(p)} stageIndex={p.stageIndex} stageCount={stages.length} />
                      </td>
                      <td className={`${S_TD} font-mono text-[12.5px]`}>{p.dueOn ? p.dueOn.toISOString().slice(0, 10) : "—"}</td>
                      <td className={`${S_TD} text-[12.5px]`}>{fmtDateTime(p.createdAt, timeZone)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
      <UsageRecords spaceId={spaceId} itemIds={[machine.id]} noun="machine" timeZone={timeZone} />
    </div>
  );
}
