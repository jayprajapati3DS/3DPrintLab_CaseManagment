import Link from "next/link";

import { AddOrderForm, RemoveOrderForm } from "@/app/(app)/cases/[id]/order-controls";
import { FormStatusPill } from "@/components/qa/form-view";
import { fmtDateTime } from "@/lib/format";

export interface OrderRow {
  id: string;
  name: string;
  code: string;
  rev: string;
  status: string;
  version: number;
  savedByName: string | null;
  savedAt: Date | null;
  submittedByName: string | null;
  sentToName: string | null;
  approvedByName: string | null;
  approvedAt: Date | null;
  withdrawnAt: Date | null;
  withdrawnByName: string | null;
  withdrawnReason: string | null;
}

/**
 * A case's Order tab: the forms between the surgeon and the internal team.
 * The team fills its part and saves; sends it to the surgeon, who fills theirs
 * and approves it (or sends it back). Not tied to the case's status.
 */
export function OrderTab({
  caseId,
  surgeonName,
  forms,
  addable,
  canManage,
  timeZone,
}: {
  caseId: string;
  surgeonName: string | null;
  forms: OrderRow[];
  /** Forms that can still be added (not on the tab now). */
  addable: Array<{ id: string; label: string }>;
  /** The case team adds and removes forms; a surgeon fills and signs. */
  canManage: boolean;
  timeZone: string;
}) {
  const open = forms.filter((f) => !f.withdrawnAt);
  const withdrawn = forms.filter((f) => f.withdrawnAt);
  const signed = open.filter((f) => f.status === "Approved").length;
  const icon = "text-ink-3 hover:text-brand flex h-[26px] w-[26px] flex-none items-center justify-center rounded-md hover:bg-[#FFF4ED]";
  const href = (id: string, mode: "view" | "edit") => `/cases/${caseId}?tab=order&form=${id}&mode=${mode}`;

  return (
    <div className="flex flex-col gap-4" data-testid="case-order">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="m-0 text-[15px] font-bold">Order</h3>
          <p className="text-muted m-0 text-[12.5px]">
            Forms between {surgeonName ?? "the surgeon"} and the team — the team fills its part and saves, then sends it to the surgeon to complete and approve. {signed} of {open.length} signed.
          </p>
        </div>
        {canManage ? <AddOrderForm caseId={caseId} choices={addable} /> : null}
      </div>

      {open.length === 0 ? (
        <div className="border-field text-muted rounded-[12px] border border-dashed p-6 text-center text-[13px]">
          No order forms yet{canManage ? " — add one above, or set the forms every case gets on the product (Products → Order forms)." : "."}
        </div>
      ) : (
        <div className="border-line overflow-x-auto rounded-[12px] border">
          <table className="w-full min-w-[820px] border-collapse text-left text-[13px]" aria-label="Order forms">
            <thead>
              <tr className="text-muted bg-subtle border-line-3 border-b text-[11px] font-semibold tracking-[0.6px] uppercase">
                <th className="px-3.5 py-2.5 font-semibold">Form</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-3 py-2.5 font-semibold">Team</th>
                <th className="px-3 py-2.5 font-semibold">Surgeon</th>
                <th className="px-3.5 py-2.5 text-right font-semibold">Open</th>
              </tr>
            </thead>
            <tbody>
              {open.map((f) => {
                const filled = Boolean(f.savedAt) || f.status === "Pending approval" || f.status === "Approved";
                return (
                  <tr key={f.id} className="border-line-3 border-b last:border-b-0">
                    <td className="px-3.5 py-2.5 align-top">
                      <Link href={href(f.id, f.status === "Approved" ? "view" : "edit")} scroll={false} className="text-ink font-semibold no-underline hover:underline">
                        {f.name}
                      </Link>
                      <div className="text-muted font-mono text-[11.5px]">{[f.code, f.rev ? `Rev ${f.rev}` : null, f.version > 1 ? `v${f.version}` : null].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <FormStatusPill status={f.status === "Pending approval" ? "Pending approval" : f.status} />
                      {f.status === "Pending approval" && f.sentToName ? <div className="text-muted mt-1 text-[11.5px]">With {f.sentToName}</div> : null}
                    </td>
                    <td className="text-ink-3 px-3 py-2.5 align-top text-[12.5px]">
                      {f.savedByName ? `${f.savedByName}${f.savedAt ? ` · ${fmtDateTime(f.savedAt, timeZone)}` : ""}` : "Not filled yet"}
                    </td>
                    <td className="text-ink-3 px-3 py-2.5 align-top text-[12.5px]">
                      {f.approvedByName ? `Signed by ${f.approvedByName}${f.approvedAt ? ` · ${fmtDateTime(f.approvedAt, timeZone)}` : ""}` : f.status === "Pending approval" ? "To check and sign" : "—"}
                    </td>
                    <td className="px-3.5 py-2.5 align-top">
                      <span className="flex items-center justify-end">
                        <Link href={href(f.id, "view")} scroll={false} aria-label={`View ${f.name}`} title="View" className={icon}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        </Link>
                        {f.status !== "Approved" ? (
                          <Link href={href(f.id, "edit")} scroll={false} aria-label={`Fill ${f.name}`} title="Fill / sign" className="bg-brand flex h-[26px] w-[26px] flex-none items-center justify-center rounded-md text-white">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                            </svg>
                          </Link>
                        ) : null}
                        <a href={`/cases/${caseId}/forms/${f.id}/print`} target="_blank" rel="noopener noreferrer" aria-label={`Download PDF of ${f.name}`} title="Download PDF" className={icon}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                          </svg>
                        </a>
                        {canManage ? <RemoveOrderForm formId={f.id} name={f.name} filled={filled} /> : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {withdrawn.length && canManage ? (
        <details className="text-[12.5px]">
          <summary className="text-ink-3 cursor-pointer font-semibold">Withdrawn ({withdrawn.length})</summary>
          <ul className="text-ink-3 m-0 mt-2 flex list-none flex-col gap-1 p-0">
            {withdrawn.map((f) => (
              <li key={f.id}>
                <Link href={href(f.id, "view")} scroll={false} className="text-ink-2 font-semibold">
                  {f.name}
                </Link>{" "}
                — withdrawn by {f.withdrawnByName ?? "someone"}
                {f.withdrawnAt ? ` · ${fmtDateTime(f.withdrawnAt, timeZone)}` : ""}
                {f.withdrawnReason ? ` · “${f.withdrawnReason}”` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
