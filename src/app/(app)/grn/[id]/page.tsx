import type { Metadata } from "next";
import Link from "next/link";

import { ConfirmReceipt, DeleteDraft, DocsPanel, HeaderForm, LinesPanel, type LineView } from "@/app/(app)/grn/[id]/grn-detail";
import { Pill } from "@/components/setup/ui";
import { assertVisible, requireSpaceUser } from "@/lib/auth/rbac";
import { grnStatus, list, LOT_TYPES, nextLotId, type LineType, type TestEntry } from "@/lib/grn/config";
import { getGrn, getGrnConfig, knownLotIds, lineOptions } from "@/lib/grn/queries";
import { fmtDateTime } from "@/lib/format";
import { spaceTimeZone } from "@/lib/queries/cases";
import { spaceToday } from "@/lib/resources/queries";

export const metadata: Metadata = { title: "Goods receipt" };

const TABS = [
  ["overview", "Overview"],
  ["lines", "Lines & inspection"],
  ["docs", "Documents"],
  ["history", "History"],
] as const;
type Tab = (typeof TABS)[number][0];

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export default async function GrnDetailPage({ params, searchParams }: PageProps<"/grn/[id]">) {
  const user = await requireSpaceUser();
  const { id } = await params;
  if (id === "new") return <NewGrn spaceId={user.space.id} userName={user.name} />;
  const grn = assertVisible(await getGrn(user.space.id, id));
  const query = await searchParams;
  const tab: Tab = TABS.some(([k]) => k === query.tab) ? (query.tab as Tab) : grn.received ? "lines" : "overview";

  const [today, timeZone, { config }, lotIds] = await Promise.all([
    spaceToday(user.space.id),
    spaceTimeZone(user.space.id),
    getGrnConfig(user.space.id),
    knownLotIds(user.space.id),
  ]);
  const options = await lineOptions(user.space.id, today);
  const supplier = options.suppliers.find((s) => s.id === grn.supplierId);
  const status = grnStatus(grn);
  const header = (grn.header ?? {}) as Record<string, string>;
  const closed = status.label.startsWith("Closed");

  // What still stands between a draft and its receipt, most pressing first.
  let hint = "Everything is ready — confirm to send the lines to incoming inspection.";
  let ready = true;
  const missing = config.header.filter((h) => h.show && h.req && !(header[h.k] ?? "").trim()).map((h) => h.label);
  if (!grn.supplierId) [hint, ready] = ["Select a supplier first.", false];
  else if (supplier && !supplier.approved && config.rules.supplier === "block") [hint, ready] = ["Supplier is not approved — receipt is blocked by GRN setup.", false];
  else if (missing.length) [hint, ready] = [`Fill required fields on Overview: ${missing.join(", ")}.`, false];
  else if (grn.lines.length === 0) [hint, ready] = ["Add at least one line.", false];

  const now = new Date(`${today}T00:00:00Z`);
  const nextLotIds = Object.fromEntries(LOT_TYPES.map((t) => [t, nextLotId(config, t, lotIds, now)]));

  const lines: LineView[] = grn.lines.map((l) => ({
    id: l.id,
    position: l.position,
    type: l.type as LineType,
    itemId: l.itemId ?? "",
    itemName: l.itemName,
    lotMode: l.lotMode === "existing" ? "existing" : "new",
    lotNumber: l.lotNumber ?? "",
    existingLotId: l.existingLotId ?? "",
    supplierBatch: l.supplierBatch ?? "",
    quantity: l.quantity !== null ? String(Number(l.quantity)) : "",
    unit: l.unit ?? "",
    expiry: iso(l.expiresOn),
    coa: l.coa ?? "",
    partIds: l.partIds,
    ref: l.ref ?? "",
    calItemId: l.calItemId ?? "",
    cert: l.cert ?? "",
    calDate: iso(l.calDate),
    category: l.category ?? "tooling",
    equipmentMode: l.equipmentMode === "new" ? "new" : "existing",
    newName: l.newName ?? "",
    newAsset: l.newAsset ?? "",
    description: l.description ?? "",
    extra: (l.extra ?? {}) as Record<string, string>,
    tests: (l.tests ?? {}) as unknown as Record<string, TestEntry>,
    rejectedQty: l.rejectedQty !== null ? String(Number(l.rejectedQty)) : "",
    decision: l.decision,
    reason: l.reason,
    inspectedByName: l.inspectedByName,
    inspectedAt: l.inspectedAt ? fmtDateTime(l.inspectedAt, timeZone) : null,
    testSummary: l.testSummary,
  }));

  const inspectBy = new Date(grn.receivedOn.getTime() + config.rules.inspDays * 86_400_000).toISOString().slice(0, 10);
  const counts: Record<Tab, number | null> = { overview: null, lines: grn.lines.length, docs: grn.documents.length, history: grn.log.length };

  return (
    <div className="flex flex-col gap-4">
      <Link href="/grn" className="text-ink-3 self-start text-[13px] font-semibold no-underline">
        ‹ All receipts
      </Link>

      <section className="border-line min-w-0 overflow-hidden rounded-[14px] border bg-white">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 px-4 pt-[18px] pb-3.5 sm:px-[22px]">
          <div className="flex min-w-[200px] flex-1 flex-col gap-1">
            <span className="text-brand-ink text-[11px] font-bold tracking-[0.8px]">GOODS RECEIPT NOTE</span>
            <h2 className="m-0 font-mono text-lg font-bold">{grn.number}</h2>
            <span className="text-muted text-[12.5px]">
              {[grn.supplierName ?? "No supplier yet", iso(grn.receivedOn), header.po ? `PO ${header.po}` : null, `${grn.lines.length} line${grn.lines.length === 1 ? "" : "s"}`]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
          <Pill tone={status.tone}>{status.label}</Pill>
          {!grn.received ? <DeleteDraft grnId={grn.id} number={grn.number} /> : null}
        </div>
        <div role="tablist" className="border-line-2 flex gap-1 overflow-x-auto border-t px-2 sm:px-4">
          {TABS.map(([key, label]) => (
            <Link
              key={key}
              href={`/grn/${grn.id}?tab=${key}`}
              role="tab"
              aria-selected={tab === key}
              scroll={false}
              className={
                "flex h-[42px] flex-none items-center gap-1.5 border-b-2 px-3 text-[13px] font-semibold whitespace-nowrap no-underline " +
                (tab === key ? "border-brand text-brand-ink" : "text-ink-3 border-transparent")
              }
            >
              {label}
              {counts[key] !== null ? <span className="bg-chip text-ink-3 rounded-full px-1.5 py-px text-[10.5px]">{counts[key]}</span> : null}
            </Link>
          ))}
        </div>
      </section>

      {!grn.received ? <ConfirmReceipt grnId={grn.id} hint={hint} ready={ready} /> : null}
      {supplier?.warn ? <div className="bg-warn-tint text-warn rounded-[12px] border border-[#FEDF89] px-4 py-3 text-[13px]">⚠ {supplier.warn}</div> : null}
      {!grn.supplierId ? <div className="bg-warn-tint text-warn rounded-[12px] border border-[#FEDF89] px-4 py-3 text-[13px]">⚠ Select the supplier this delivery came from.</div> : null}
      {grn.received && !closed ? (
        <div className="text-muted text-[12.5px]">
          Inspect within {config.rules.inspDays} day{config.rules.inspDays === 1 ? "" : "s"} of receipt — by {inspectBy}. Lines stay in quarantine, out of stock, until accepted.
        </div>
      ) : null}

      <section className="border-line min-w-0 overflow-hidden rounded-[14px] border bg-white">
        {tab === "overview" ? (
          <HeaderForm
            grnId={grn.id}
            config={config}
            suppliers={options.suppliers}
            initial={{ supplierId: grn.supplierId ?? "", receivedOn: iso(grn.receivedOn), header }}
            editable={!closed}
          />
        ) : null}
        {tab === "lines" ? (
          <LinesPanel grnId={grn.id} received={grn.received} closed={closed} lines={lines} config={config} options={options} nextLotIds={nextLotIds} />
        ) : null}
        {tab === "docs" ? (
          <DocsPanel
            grnId={grn.id}
            kinds={list(config.docKinds)}
            documents={grn.documents.map((d) => ({ id: d.id, name: d.name, kind: d.kind, by: d.uploadedByName ?? "", at: fmtDateTime(d.createdAt, timeZone) }))}
          />
        ) : null}
        {tab === "history" ? (
          <ol className="m-0 flex list-none flex-col p-4 sm:p-[22px]">
            {grn.log.length === 0 ? <li className="text-muted py-6 text-center text-[13px]">Nothing recorded yet.</li> : null}
            {grn.log.map((entry) => (
              <li key={entry.id} className="border-line-3 flex flex-wrap gap-x-3 gap-y-0.5 border-b py-2.5 text-[13px] last:border-b-0">
                <span className="text-muted w-[150px] flex-none font-mono text-xs">{fmtDateTime(entry.createdAt, timeZone)}</span>
                <span className="text-ink-3 w-[140px] flex-none text-xs">{entry.byName}</span>
                <span className="min-w-[200px] flex-1 break-words">{entry.text}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </section>
    </div>
  );
}

/**
 * "New GRN", before anything is stored: the receipt details. "Create receipt"
 * makes the draft — numbered then — and opens its lines.
 */
async function NewGrn({ spaceId, userName }: { spaceId: string; userName: string }) {
  const [today, { config }] = await Promise.all([spaceToday(spaceId), getGrnConfig(spaceId)]);
  const options = await lineOptions(spaceId, today);
  return (
    <div className="flex max-w-[1180px] flex-col gap-4">
      <Link href="/grn" className="text-ink-3 self-start text-[13px] font-semibold no-underline">
        ‹ Back to goods receipts
      </Link>
      <div data-testid="not-saved" className="border-brand-edge bg-brand-wash text-ink-2 rounded-[12px] border px-4 py-3 text-[13px] leading-[1.5]">
        <strong>Not created yet.</strong> Fill in the receipt details and press <strong>Create receipt</strong> — the GRN number is given then, and its
        lines are added next. Leave this page to cancel; nothing is kept.
      </div>
      <section className="border-line min-w-0 rounded-[14px] border bg-white">
        <div className="flex flex-col gap-1 px-4 pt-[18px] pb-3.5 sm:px-[22px]">
          <span className="text-brand-ink text-[11px] font-bold tracking-[0.8px]">GOODS RECEIPT</span>
          <h2 className="m-0 text-base font-bold">New goods receipt</h2>
        </div>
        <div className="border-line-2 border-t">
          <HeaderForm
            grnId="new"
            config={config}
            suppliers={options.suppliers}
            initial={{ supplierId: "", receivedOn: today, header: { receivedBy: userName, condition: list(config.conditions)[0] ?? "" } }}
            editable
          />
        </div>
      </section>
    </div>
  );
}
