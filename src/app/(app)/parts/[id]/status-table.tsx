import Link from "next/link";

import { StageDue, StageOwner } from "@/app/(app)/parts/[id]/part-controls";
import type { PartQa } from "@/app/(app)/parts/[id]/qa-section";
import { FormStatusPill } from "@/components/qa/form-view";
import { fmtDateTime } from "@/lib/format";
import { partLockStages, partStageMeta, type PartRecord } from "@/lib/parts/queries";
import { inStageOrder, isOptionalForm, orderWaiting } from "@/lib/resources/config";

// --- Status ------------------------------------------------------------------------------------

/** One row per stage: its forms, who has it, when it is due, and who finished it when — as a case's Status tab. */
export async function PartStatusTable({
  part,
  qa,
  people,
  timeZone,
}: {
  part: PartRecord;
  qa: PartQa;
  people: Array<{ id: string; name: string }>;
  timeZone: string;
}) {
  // The workflow's live settings (lock, form order) on the part's own stages.
  const stages = await partLockStages(part);
  const meta = partStageMeta(part);
  const icon = "text-ink-3 hover:text-brand flex h-[26px] w-[26px] flex-none items-center justify-center rounded-md hover:bg-[#FFF4ED]";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1180px] border-collapse text-[13px]" data-testid="part-status-table">
        <thead>
          <tr className="border-line-2 bg-subtle text-muted border-y text-left text-[11px] tracking-[0.6px] whitespace-nowrap uppercase">
            <th className="w-[56px] py-3 pr-2 pl-4 font-semibold sm:pl-[22px]">#</th>
            <th className="min-w-[170px] px-3 py-3 font-semibold">Status</th>
            <th className="min-w-[400px] px-3 py-3 font-semibold">Quality forms</th>
            <th className="px-3 py-3 font-semibold">Tasks</th>
            <th className="px-3 py-3 font-semibold">Assigned to</th>
            <th className="px-3 py-3 font-semibold">Due date</th>
            <th className="px-3 py-3 font-semibold">Completed by</th>
            <th className="py-3 pr-4 pl-3 font-semibold sm:pr-[22px]">Completed time</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((stage, i) => {
            const done = i < part.stageIndex;
            const now = i === part.stageIndex;
            const forms = inStageOrder(stage, qa.forms.filter((f) => f.stageIndex === i));
            const approval = forms.length > 0 && stage.formsRequired !== false;
            return (
              <tr key={stage.id ?? i} id={`stage-${i + 1}`} aria-current={now ? "step" : undefined} className={"border-line-2 border-b align-top " + (now ? "bg-[#FFFCF5]" : "")}>
                <td className="py-3.5 pr-2 pl-4 sm:pl-[22px]">
                  <span
                    className={
                      "flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 text-[12px] font-bold " +
                      (done ? "border-brand bg-brand text-white" : now ? "border-brand text-brand bg-white" : "border-[#D0D5DD] bg-white text-[#98A2B3]")
                    }
                  >
                    {done ? (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    ) : (
                      i + 1
                    )}
                  </span>
                </td>
                <td className="px-3 py-3.5">
                  <div className="flex flex-col gap-1">
                    <span className={"text-[13.5px] font-bold " + (done || now ? "text-ink" : "text-ink-2")}>{stage.name}</span>
                    {approval ? <span className="self-start rounded bg-[#FFFAEB] px-1.5 py-[1px] text-[10px] font-bold tracking-[0.5px] text-[#DC6803]">APPROVAL</span> : null}
                    {stage.role ? <span className="text-muted text-[11.5px]">{stage.role}</span> : null}
                  </div>
                </td>
                <td className="px-3 py-3.5">
                  {forms.length === 0 ? (
                    <span className="text-faint">—</span>
                  ) : (
                    <ul className="border-line m-0 flex w-[380px] list-none flex-col overflow-hidden rounded-[10px] border bg-white p-0" aria-label={`${stage.name} quality forms`}>
                      {forms.map((f, k) => {
                        const open = `/parts/${part.id}?tab=stages&form=${f.id}`;
                        return (
                          <li key={f.id} data-testid="status-form" className={"flex min-h-[38px] items-center gap-2 px-2.5 py-1.5 " + (k ? "border-line-2 border-t " : "") + (now ? "bg-[#FFFCF5]" : "")}>
                            <span className="flex min-w-0 flex-1 flex-col">
                              <Link href={open} scroll={false} className="text-ink text-[12.5px] leading-[1.3] font-semibold no-underline hover:underline">
                                {f.name}
                                {f.code ? <span className="text-muted ml-1.5 font-mono text-[10.5px] font-normal">{f.code}</span> : null}
                                {isOptionalForm(stage, f) ? <span className="text-muted ml-1.5 text-[10.5px] font-normal">· optional</span> : null}
                              </Link>
                              {f.status !== "Pending approval" && f.status !== "Approved" && orderWaiting(stage, f, forms) ? (
                                <span className="text-muted text-[11px]" data-testid="form-waits">
                                  after {orderWaiting(stage, f, forms)}
                                </span>
                              ) : null}
                            </span>
                            <FormStatusPill status={f.status} />
                            <span className="flex flex-none items-center">
                              <Link href={open} scroll={false} aria-label={`Open ${f.name}`} title={f.status === "Approved" ? "View" : "Fill / edit"} className={now && f.status !== "Approved" ? "bg-brand flex h-[26px] w-[26px] flex-none items-center justify-center rounded-md text-white" : icon}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  {f.status === "Approved" ? (
                                    <>
                                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                      <circle cx="12" cy="12" r="3" />
                                    </>
                                  ) : (
                                    <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                                  )}
                                </svg>
                              </Link>
                              <a href={`/parts/${part.id}/forms/${f.id}/print`} target="_blank" rel="noopener noreferrer" aria-label={`Download PDF of ${f.name}`} title="Download PDF" className={icon}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                                </svg>
                              </a>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </td>
                <td className="text-faint px-3 py-3.5">—</td>
                <td className="px-3 py-3">
                  <StageOwner partId={part.id} stageIndex={i} stageName={stage.name} assigneeId={meta[i].assigneeId} assignee={meta[i].assignee} people={people} />
                </td>
                <td className="px-3 py-3">
                  <StageDue partId={part.id} stageIndex={i} stageName={stage.name} due={meta[i].due} />
                </td>
                <td className="text-ink-2 px-3 py-3.5">{meta[i].by ?? <span className="text-faint">—</span>}</td>
                <td className="text-ink-3 py-3.5 pr-4 pl-3 whitespace-nowrap sm:pr-[22px]">{meta[i].at ? fmtDateTime(new Date(meta[i].at!), timeZone) : <span className="text-faint">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
