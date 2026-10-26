import type { Metadata } from "next";
import Link from "next/link";

import type { Prisma } from "@prisma/client";

import { requireSpaceUser } from "@/lib/auth/rbac";
import { ensureOrderForms } from "@/lib/cases/orders";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { spaceTimeZone } from "@/lib/queries/cases";

export const metadata: Metadata = { title: "My Orders" };

/**
 * A surgeon's cases and their order forms: what waits for their signature,
 * what is signed — each case opening on its Order tab. For the team, every
 * case with order forms, and what is with a surgeon.
 */
export default async function OrdersPage() {
  const user = await requireSpaceUser();
  const timeZone = await spaceTimeZone(user.space.id);
  // A surgeon's cases nobody has opened yet get their automatic order forms now.
  if (user.surgeonOnly) {
    const fresh = await db.caseRecord.findMany({ where: { spaceId: user.space.id, origin: "local", surgeonName: user.name, ordersReadyAt: null }, select: { id: true, spaceId: true, productId: true, origin: true, ordersReadyAt: true }, take: 100 });
    for (const record of fresh) await ensureOrderForms(record);
  }
  const mineOnly: Prisma.CaseRecordWhereInput = user.surgeonOnly ? { surgeonName: user.name } : { forms: { some: { area: "order" } } };
  const cases = await db.caseRecord.findMany({
    where: { spaceId: user.space.id, origin: "local", ...mineOnly },
    orderBy: [{ surgeryDate: "asc" }, { platformCreatedAt: "desc" }],
    take: 300,
    select: {
      id: true,
      caseNumber: true,
      productName: true,
      surgeonName: true,
      surgeryDate: true,
      caseStatus: true,
      forms: {
        where: { area: "order", withdrawnAt: null },
        select: { id: true, name: true, status: true, sentToId: true, sentToName: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  const waitingTotal = cases.reduce((n, c) => n + c.forms.filter((f) => f.status === "Pending approval" && f.sentToId === user.id).length, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="border-line flex flex-wrap items-center gap-6 rounded-[14px] border bg-white px-5 py-4">
        <div className="flex flex-col">
          <span className="text-ink text-[22px] leading-none font-bold">{cases.length}</span>
          <span className="text-muted mt-1 text-[12.5px]">{user.surgeonOnly ? "Your cases" : "Cases with order forms"}</span>
        </div>
        <div className="flex flex-col">
          <span className={"text-[22px] leading-none font-bold " + (waitingTotal ? "text-[#175CD3]" : "text-ink")}>{waitingTotal}</span>
          <span className="text-muted mt-1 text-[12.5px]">Waiting for your signature</span>
        </div>
      </div>

      {cases.length === 0 ? (
        <div className="border-field text-muted rounded-[14px] border border-dashed bg-white p-8 text-center text-[13px]">
          {user.surgeonOnly ? "No cases of yours yet." : "No case has order forms yet."}
        </div>
      ) : (
        <div className="border-line overflow-x-auto rounded-[14px] border bg-white">
          <table className="w-full min-w-[820px] border-collapse text-left text-[13px]" aria-label="Orders">
            <thead>
              <tr className="text-muted border-line-3 bg-subtle border-b text-[11px] font-semibold tracking-[0.6px] uppercase">
                <th className="py-2.5 pr-3 pl-[18px] font-semibold">Case</th>
                <th className="px-3 py-2.5 font-semibold">Surgery</th>
                {user.surgeonOnly ? null : <th className="px-3 py-2.5 font-semibold">Surgeon</th>}
                <th className="px-3 py-2.5 font-semibold">Order forms</th>
                <th className="py-2.5 pr-[18px] pl-3 font-semibold">For you</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => {
                const signed = c.forms.filter((f) => f.status === "Approved").length;
                const waiting = c.forms.filter((f) => f.status === "Pending approval" && f.sentToId === user.id);
                const withSurgeon = c.forms.filter((f) => f.status === "Pending approval").length;
                return (
                  <tr key={c.id} className="border-line-3 hover:bg-subtle border-b last:border-b-0">
                    <td className="py-2.5 pr-3 pl-[18px] align-top">
                      <Link href={`/cases/${c.id}?tab=order`} className="text-brand-ink font-mono text-[12.5px] font-semibold no-underline [overflow-wrap:anywhere] hover:underline">
                        {c.caseNumber}
                      </Link>
                      <div className="text-muted text-[12px]">{c.productName ?? "—"}</div>
                    </td>
                    <td className="text-ink-3 px-3 py-2.5 align-top text-[12.5px] whitespace-nowrap">{c.surgeryDate ? fmtDate(c.surgeryDate, timeZone) : "—"}</td>
                    {user.surgeonOnly ? null : <td className="text-ink-3 px-3 py-2.5 align-top text-[12.5px]">{c.surgeonName ?? "—"}</td>}
                    <td className="px-3 py-2.5 align-top">
                      <span className="text-ink font-semibold">
                        {signed} / {c.forms.length} signed
                      </span>
                      {withSurgeon ? <div className="text-muted text-[12px]">{withSurgeon} sent for signature</div> : null}
                      <div className="text-muted max-w-[320px] truncate text-[12px]">{c.forms.map((f) => f.name).join(", ") || "None yet"}</div>
                    </td>
                    <td className="py-2.5 pr-[18px] pl-3 align-top">
                      {waiting.length ? (
                        <Link href={`/cases/${c.id}?tab=order&form=${waiting[0].id}&mode=edit`} className="rounded-md bg-[#EFF8FF] px-2 py-[3px] text-[12px] font-semibold text-[#175CD3] no-underline">
                          {waiting.length} to sign →
                        </Link>
                      ) : (
                        <span className="text-muted text-[12.5px]">Nothing waiting</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
