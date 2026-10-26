import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { StagePill } from "@/components/parts/ui";
import { Pill, S_TD, S_TH, SectionCard } from "@/components/setup/ui";
import { requireSpaceUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { lotRegister } from "@/lib/grn/queries";
import { stageLabel } from "@/lib/parts/queries";
import { spaceTimeZone } from "@/lib/queries/cases";
import { spaceToday } from "@/lib/resources/queries";

export const metadata: Metadata = { title: "Lot trace" };

const round = (n: number) => Math.round(n * 1000) / 1000;

interface Event {
  at: Date;
  event: string;
  detail: string;
  ref: string;
  qty: number | null;
  by: string;
}

/** One lot's whole story: received, inspected, released, used — and the parts made from it. */
export default async function LotTracePage({ params }: PageProps<"/grnlots/[key]">) {
  const user = await requireSpaceUser();
  const { key } = await params;
  const [today, timeZone] = await Promise.all([spaceToday(user.space.id), spaceTimeZone(user.space.id)]);
  const row = (await lotRegister(user.space.id, today)).find((r) => r.key === key);
  if (!row) notFound();

  const events: Event[] = [];
  let unit = "";
  let received = 0;
  let rejected = 0;
  let remaining: number | null = null;
  let usesWhere: { source: string; itemId: string } | null = null;

  if (key.startsWith("m-")) {
    const lot = await db.materialLot.findFirst({
      where: { id: key.slice(2), resource: { spaceId: user.space.id } },
      include: { resource: true, adjustments: { orderBy: { createdAt: "asc" } } },
    });
    if (!lot) notFound();
    unit = lot.resource.kind === "materials" ? String(((lot.resource.data ?? {}) as Record<string, unknown>).unit ?? "unit") : "pcs";
    remaining = Number(lot.remaining);
    rejected = Number(lot.rejected ?? 0);
    const line = lot.grnId ? await db.grnLine.findFirst({ where: { grnId: lot.grnId, resultId: lot.id }, include: { grn: true } }) : null;
    const topUps = lot.adjustments.filter((a) => a.reason.startsWith("Top-up")).reduce((s, a) => s + Number(a.quantity), 0);
    const initial = Number(lot.received) - topUps;
    received = Number(lot.received) + rejected;
    if (line) {
      events.push({ at: line.createdAt, event: "Draft receipt", detail: `Line ${line.position} on ${line.grn.number}`, ref: line.grn.number, qty: null, by: line.grn.createdByName ?? "" });
      if (line.grn.receivedAt) events.push({ at: line.grn.receivedAt, event: "Received", detail: `${Number(line.quantity ?? 0)} ${unit} from ${line.grn.supplierName ?? "—"}`, ref: line.grn.number, qty: null, by: line.grn.confirmedByName ?? "" });
      if (line.inspectedAt) {
        events.push({ at: line.inspectedAt, event: "Incoming inspection", detail: line.testSummary ?? "", ref: line.grn.number, qty: null, by: line.inspectedByName ?? "" });
        events.push({
          at: line.inspectedAt,
          event: rejected ? "Released — part rejected" : "Released to stock",
          detail: rejected ? `${rejected} ${unit} rejected${line.reason ? ` — ${line.reason}` : ""}` : "Accepted in full",
          ref: line.grn.number,
          qty: initial,
          by: line.inspectedByName ?? "",
        });
      }
    } else {
      events.push({ at: lot.createdAt, event: "Recorded (before GRN)", detail: "Opening stock entered on the material", ref: "", qty: initial, by: "" });
    }
    for (const a of lot.adjustments) {
      const qty = Number(a.quantity);
      const used = a.reason.startsWith("Used on") || a.reason.startsWith("Returned from");
      events.push({
        at: a.createdAt,
        event: a.reason.startsWith("Top-up") ? "Received (top-up)" : used ? (qty < 0 ? "Used in production" : "Returned to stock") : "Stock adjusted",
        detail: a.reason,
        ref: used ? (a.reason.match(/(?:on|from) (\S+)/)?.[1] ?? "") : "",
        qty,
        by: a.byName,
      });
    }
    if (lot.expiresOn) {
      const expired = lot.expiresOn.toISOString().slice(0, 10) < today;
      events.push({ at: lot.expiresOn, event: expired ? "Expired" : "Expiry date", detail: lot.expiresOn.toISOString().slice(0, 10), ref: "", qty: null, by: "" });
    }
    usesWhere = { source: lot.resource.kind === "materials" ? "lots" : lot.resource.kind, itemId: lot.id };
  } else if (key.startsWith("g-")) {
    const line = await db.grnLine.findFirst({ where: { id: key.slice(2), spaceId: user.space.id }, include: { grn: true } });
    if (!line) notFound();
    unit = line.unit ?? "";
    received = Number(line.quantity ?? 0);
    rejected = Number(line.rejectedQty ?? 0);
    events.push({ at: line.createdAt, event: "Draft receipt", detail: `Line ${line.position} on ${line.grn.number}`, ref: line.grn.number, qty: null, by: line.grn.createdByName ?? "" });
    if (line.grn.receivedAt) events.push({ at: line.grn.receivedAt, event: "Received", detail: `${received} ${unit} from ${line.grn.supplierName ?? "—"}`, ref: line.grn.number, qty: null, by: line.grn.confirmedByName ?? "" });
    if (line.inspectedAt) {
      events.push({ at: line.inspectedAt, event: "Incoming inspection", detail: line.testSummary ?? "", ref: line.grn.number, qty: null, by: line.inspectedByName ?? "" });
      events.push({
        at: line.inspectedAt,
        event: line.decision === "Accepted" ? "Released to stock" : line.decision === "Rejected" ? "Rejected" : "On hold (quarantine)",
        detail: line.reason ?? "",
        ref: line.grn.number,
        qty: line.decision === "Accepted" ? round(received - rejected) : null,
        by: line.inspectedByName ?? "",
      });
    }

  } else {
    notFound();
  }

  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  let balance = 0;
  const withBalance = events.map((e) => {
    if (e.qty !== null) balance = round(balance + e.qty);
    return { ...e, balance: e.qty !== null ? balance : null };
  });

  const uses = usesWhere
    ? await db.formUse.findMany({
        where: { spaceId: user.space.id, source: usesWhere.source, itemId: usesWhere.itemId },
        orderBy: { createdAt: "desc" },
        include: {
          form: {
            select: {
              name: true,
              code: true,
              savedByName: true,
              savedAt: true,
              part: { select: { id: true, partNumber: true, name: true, stageIndex: true, stageCount: true, stages: true, case: { select: { id: true, caseNumber: true, platformCaseId: true } } } },
            },
          },
        },
      }).then((rows) => rows.flatMap((u) => (u.form.part ? [{ ...u, form: { ...u.form, part: u.form.part } }] : [])))
    : [];
  const usedQty = round(uses.reduce((s, u) => s + Number(u.quantity ?? 0), 0));

  return (
    <div className="flex flex-col gap-4">
      <Link href="/grnlots" className="text-ink-3 self-start text-[13px] font-semibold no-underline">
        ‹ All lots
      </Link>

      <section className="border-line flex flex-col gap-4 rounded-[14px] border bg-white px-4 py-[18px] sm:px-[22px]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-brand-ink text-[11px] font-bold tracking-[0.8px]">LOT TRACE</span>
            <span className="font-mono text-xl font-semibold">{row.lot}</span>
            <span className="text-muted text-[13px]">
              {row.item} · {row.kind}
            </span>
          </div>
          <Pill tone={row.tone}>{row.status}</Pill>
        </div>
        <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
          {[
            ["Supplier", row.supplier || "—"],
            ["Supplier batch", row.batch || "—"],
            ["GRN", row.grn || "—"],
            ["Expiry", row.expiry ?? "—"],
            ["Item", row.item],
          ].map(([k, v]) => (
            <div key={k} className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-muted text-[10.5px] font-semibold tracking-[0.5px] uppercase">{k}</dt>
              <dd className="m-0 text-[13px] font-semibold break-words">
                {k === "GRN" && row.grnId ? (
                  <Link href={`/grn/${row.grnId}`} className="text-brand-ink font-mono no-underline">
                    {v}
                  </Link>
                ) : (
                  v
                )}
              </dd>
            </div>
          ))}
        </dl>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Received", `${round(received)} ${unit}`],
            ["Rejected", `${round(rejected)} ${unit}`],
            ["Used in parts", `${usedQty} ${unit}`],
            ["Remaining", remaining !== null ? `${round(remaining)} ${unit}` : row.remaining],
          ].map(([k, v]) => (
            <div key={k} className="border-line flex flex-col gap-0.5 rounded-xl border px-3.5 py-3">
              <span className="text-muted text-[10.5px] font-semibold tracking-[0.5px] uppercase">{k}</span>
              <span className="font-mono text-[15px] font-bold">{v}</span>
            </div>
          ))}
        </div>
      </section>

      <SectionCard title="Lot log" hint="Everything that happened to this lot, in order, with the running balance.">
        <div className="border-line overflow-x-auto rounded-[10px] border">
          <table className="w-full min-w-[860px] border-collapse">
            <thead className="bg-subtle">
              <tr>
                {["#", "Date", "Event", "Details", "Reference", "Qty", "Balance", "By"].map((h) => (
                  <th key={h} className={S_TH}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {withBalance.map((e, i) => (
                <tr key={i}>
                  <td className={`${S_TD} font-mono text-xs`}>{i + 1}</td>
                  <td className={`${S_TD} font-mono text-xs whitespace-nowrap`}>{fmtDateTime(e.at, timeZone)}</td>
                  <td className={`${S_TD} font-semibold`}>{e.event}</td>
                  <td className={`${S_TD} max-w-[320px] text-[12.5px] break-words`}>{e.detail || "—"}</td>
                  <td className={`${S_TD} font-mono text-xs`}>{e.ref || "—"}</td>
                  <td className={`${S_TD} font-mono text-xs ${e.qty !== null && e.qty < 0 ? "text-bad" : ""}`}>{e.qty !== null ? `${e.qty > 0 ? "+" : ""}${round(e.qty)}` : ""}</td>
                  <td className={`${S_TD} font-mono text-xs`}>{e.balance ?? ""}</td>
                  <td className={`${S_TD} text-[12.5px]`}>{e.by || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Parts made from this lot" hint={`${uses.length} part record${uses.length === 1 ? "" : "s"} · Total used: ${usedQty} ${unit}`}>
        {uses.length === 0 ? (
          <p className="text-muted m-0 text-[13px]">Not used in any part yet.</p>
        ) : (
          <div className="border-line overflow-x-auto rounded-[10px] border">
            <table className="w-full min-w-[820px] border-collapse">
              <thead className="bg-subtle">
                <tr>
                  {["Part ID", "Part name", "Case", "Recorded in", "Used on", "Qty used", "By", "Current stage"].map((h) => (
                    <th key={h} className={S_TH}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {uses.map((u) => {
                  const p = u.form.part;
                  return (
                    <tr key={u.id}>
                      <td className={`${S_TD} font-mono text-[12.5px]`}>
                        <Link href={`/parts/${p.id}?tab=info`} className="text-brand-ink no-underline">
                          {p.partNumber}
                        </Link>
                      </td>
                      <td className={`${S_TD} font-semibold`}>{p.name}</td>
                      <td className={`${S_TD} font-mono text-[12.5px]`}>{p.case ? (p.case.caseNumber ?? `#${p.case.platformCaseId}`) : "—"}</td>
                      <td className={S_TD}>
                        {u.form.code} · {u.form.name}
                        <span className="text-muted block text-[11.5px]">{u.field}</span>
                      </td>
                      <td className={`${S_TD} font-mono text-xs`}>{u.form.savedAt ? fmtDateTime(u.form.savedAt, timeZone) : "—"}</td>
                      <td className={`${S_TD} font-mono text-[12.5px]`}>{u.quantity ? `${Number(u.quantity)} ${u.unit ?? ""}` : "—"}</td>
                      <td className={S_TD}>{u.form.savedByName ?? "—"}</td>
                      <td className={S_TD}>
                        <StagePill name={stageLabel(p)} stageIndex={p.stageIndex} stageCount={p.stageCount} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
