import type { Metadata } from "next";
import Link from "next/link";

import type { Prisma } from "@prisma/client";

import { requireSpaceUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { spaceTimeZone } from "@/lib/queries/cases";
import { formScope } from "@/lib/sites/scope";

export const metadata: Metadata = { title: "Quality Forms" };

/**
 * Every quality form now on a case or a part, in one list: which form, on
 * which case or part, at which stage, how far it is — filled, with whom for
 * approval, approved. Filtered by status, case or part, form, product,
 * stage, person, out of specification and when it was last updated; each row
 * opens the form where it lives.
 */

const STATUSES = ["Upcoming", "In progress", "Pending approval", "Approved"] as const;
const TILES: Array<{ key: string; label: string; bg: string; fg: string; icon: string }> = [
  { key: "", label: "All forms", bg: "#FFF1EB", fg: "#E24E1B", icon: "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" },
  { key: "Upcoming", label: "Upcoming", bg: "#F2F4F7", fg: "#475467", icon: "M12 8v4l3 3M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0z" },
  { key: "In progress", label: "In progress", bg: "#FFFAEB", fg: "#B54708", icon: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" },
  { key: "Pending approval", label: "Pending approval", bg: "#EFF8FF", fg: "#175CD3", icon: "M22 2 11 13M22 2l-7 20-4-9-9-4z" },
  { key: "Approved", label: "Approved", bg: "#ECFDF3", fg: "#067647", icon: "M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14l-3-3" },
];
const STATUS_TONE: Record<string, string> = {
  Upcoming: "bg-[#F2F4F7] text-[#475467]",
  "In progress": "bg-[#FFFAEB] text-[#B54708]",
  "Pending approval": "bg-[#EFF8FF] text-[#175CD3]",
  Approved: "bg-[#ECFDF3] text-[#067647]",
};
const LIMIT = 300;

export default async function QualityFormsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireSpaceUser();
  const raw = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const status = STATUSES.find((s) => s === one(raw.status)) ?? "";
  const on = one(raw.on) === "case" || one(raw.on) === "part" ? one(raw.on) : "";
  const q = one(raw.q).trim().slice(0, 100);
  // The filter panel: which form, product, stage, person; out of specification; updated between two dates.
  const form = one(raw.form).trim().slice(0, 200);
  const product = one(raw.product).trim().slice(0, 200);
  const stage = one(raw.stage).trim().slice(0, 200);
  const person = one(raw.person).trim().slice(0, 200);
  const oos = one(raw.oos) === "1";
  const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const from = isDate(one(raw.from)) ? one(raw.from) : "";
  const to = isDate(one(raw.to)) ? one(raw.to) : "";
  const timeZone = await spaceTimeZone(user.space.id);

  const filters: Prisma.PartFormWhereInput[] = [
    ...(form ? [{ name: form }] : []),
    ...(product ? [{ OR: [{ case: { productName: product } }, { part: { case: { productName: product } } }] }] : []),
    ...(stage ? [{ stageName: stage }] : []),
    ...(person
      ? [{ OR: [{ sentToName: person }, { assigneeName: person }, { approvedByName: person }, { savedByName: person }, { submittedByName: person }] }]
      : []),
    ...(oos ? [{ outOfSpec: { gt: 0 } }] : []),
    ...(from || to ? [{ updatedAt: { ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59Z`) } : {}) } }] : []),
  ];
  const base: Prisma.PartFormWhereInput = {
    spaceId: user.space.id,
    ...formScope(user),
    ...(filters.length ? { AND: filters } : {}),
    ...(on === "case" ? { partId: null, caseId: { not: null } } : on === "part" ? { partId: { not: null } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { code: { contains: q, mode: "insensitive" } },
            { stageName: { contains: q, mode: "insensitive" } },
            { part: { partNumber: { contains: q, mode: "insensitive" } } },
            { part: { name: { contains: q, mode: "insensitive" } } },
            { case: { caseNumber: { contains: q, mode: "insensitive" } } },
            { part: { case: { caseNumber: { contains: q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
  // What the filters offer: every value there is in this space.
  const everything = { spaceId: user.space.id, ...formScope(user) };
  const [formNames, stageNames, people, products] = await Promise.all([
    db.partForm.groupBy({ by: ["name"], where: everything, orderBy: { name: "asc" } }),
    db.partForm.groupBy({ by: ["stageName"], where: everything, orderBy: { stageName: "asc" } }),
    db.partForm.findMany({
      where: everything,
      distinct: ["sentToName", "assigneeName", "approvedByName", "savedByName", "submittedByName"],
      select: { sentToName: true, assigneeName: true, approvedByName: true, savedByName: true, submittedByName: true },
    }),
    db.caseRecord.groupBy({ by: ["productName"], where: { spaceId: user.space.id, productName: { not: null } }, orderBy: { productName: "asc" } }),
  ]);
  const personNames = [...new Set(people.flatMap((x) => [x.sentToName, x.assigneeName, x.approvedByName, x.savedByName, x.submittedByName]).filter((x): x is string => Boolean(x)))].sort();
  const filterCount = filters.length;

  const [counts, rows] = await Promise.all([
    db.partForm.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
    db.partForm.findMany({
      where: { ...base, ...(status ? { status } : {}) },
      orderBy: [{ updatedAt: "desc" }],
      take: LIMIT + 1,
      select: {
        id: true,
        name: true,
        code: true,
        rev: true,
        version: true,
        status: true,
        stageIndex: true,
        stageName: true,
        sentToName: true,
        assigneeName: true,
        savedByName: true,
        approvedByName: true,
        approvedAt: true,
        updatedAt: true,
        outOfSpec: true,
        partId: true,
        caseId: true,
        part: { select: { partNumber: true, name: true, case: { select: { id: true, caseNumber: true } } } },
        case: { select: { caseNumber: true, productName: true } },
      },
    }),
  ]);
  const count = (s: string) => (s ? (counts.find((c) => c.status === s)?._count._all ?? 0) : counts.reduce((n, c) => n + c._count._all, 0));
  const more = rows.length > LIMIT;
  const shown = rows.slice(0, LIMIT);

  const href = (patch: Record<string, string>) => {
    const kept = { status, on, q, form, product, stage, person, oos: oos ? "1" : "", from, to };
    const next = new URLSearchParams({ ...kept, ...patch });
    for (const [k, v] of [...next.entries()]) if (!v) next.delete(k);
    return next.size ? `/qualityforms?${next}` : "/qualityforms";
  };
  // Each form opens where it lives: on its case's or its part's Status tab.
  const openHref = (f: (typeof shown)[number]) =>
    f.partId ? `/parts/${f.partId}?tab=stages&form=${f.id}` : `/cases/${f.caseId}?tab=stages&stage=${f.stageIndex + 1}&form=${f.id}&mode=view`;

  return (
    <div className="flex flex-col gap-4">
      {/* Tiles: by status */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 lg:gap-3.5">
        {TILES.map((t) => {
          const selected = status === t.key;
          return (
            <Link
              key={t.label}
              href={href({ status: t.key })}
              aria-current={selected ? "true" : undefined}
              className={
                "flex items-center gap-3 rounded-[14px] border px-4 py-3.5 no-underline " + (selected ? "border-[#F9A57F] bg-[#FFF6F2]" : "border-line hover:border-field bg-white")
              }
            >
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px]" style={{ background: t.bg, color: t.fg }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={t.icon} />
                </svg>
              </span>
              <span className="flex flex-col">
                <span className="text-ink text-[22px] leading-none font-bold">{count(t.key)}</span>
                <span className="text-muted mt-1 text-[12.5px]">{t.label}</span>
              </span>
            </Link>
          );
        })}
      </div>

      {/* Search and case / part */}
      <div className="flex flex-wrap items-center gap-2.5">
        <form action="/qualityforms" className="flex min-w-[240px] flex-1 items-center gap-2 sm:max-w-[360px]">
          {Object.entries({ status, on, form, product, stage, person, oos: oos ? "1" : "", from, to })
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
          <input
            name="q"
            defaultValue={q}
            aria-label="Search quality forms"
            placeholder="Search form, code, case, part, stage…"
            className="border-field text-ink h-10 w-full rounded-[10px] border bg-white px-3 text-[13px]"
          />
        </form>
        <div className="flex gap-1 rounded-[11px] bg-[#EEF0F3] p-1" role="group" aria-label="On cases or parts">
          {(
            [
              ["", "All"],
              ["case", "Case forms"],
              ["part", "Part forms"],
            ] as const
          ).map(([value, label]) => (
            <Link
              key={label}
              href={href({ on: value })}
              aria-current={on === value ? "true" : undefined}
              className={
                "flex h-8 items-center rounded-lg px-3 text-[12.5px] font-semibold whitespace-nowrap no-underline " +
                (on === value ? "text-brand-ink bg-white shadow-[0_1px_2px_rgba(16,24,40,.1)]" : "text-ink-3")
              }
            >
              {label}
            </Link>
          ))}
        </div>
        <span className="text-muted text-[12.5px]">
          {shown.length}
          {more ? "+" : ""} shown
        </span>
      </div>

      {/* Every filter */}
      <details open={filterCount > 0} className="border-line rounded-[14px] border bg-white">
        <summary className="text-ink flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[13px] font-semibold">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
          </svg>
          Filters
          {filterCount ? <span className="bg-brand rounded-full px-2 py-[1px] text-[11px] font-bold text-white">{filterCount}</span> : null}
          {filterCount ? (
            <Link href={href({ form: "", product: "", stage: "", person: "", oos: "", from: "", to: "" })} className="text-brand-ink ml-auto text-[12.5px] font-semibold no-underline">
              Clear filters
            </Link>
          ) : null}
        </summary>
        <form action="/qualityforms" aria-label="Filter quality forms" className="border-line-3 grid grid-cols-1 gap-3 border-t px-4 py-3.5 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries({ status, on, q })
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
          <FilterSelect name="form" label="Form" value={form} options={formNames.map((x) => x.name)} />
          <FilterSelect name="product" label="Product" value={product} options={products.map((x) => x.productName ?? "").filter(Boolean)} />
          <FilterSelect name="stage" label="Stage / status" value={stage} options={stageNames.map((x) => x.stageName)} />
          <FilterSelect name="person" label="Person (filled, sent to, approved)" value={person} options={personNames} />
          <label className="flex flex-col gap-1">
            <span className="text-muted text-[11px] font-semibold tracking-[0.5px] uppercase">Updated from</span>
            <input type="date" name="from" defaultValue={from} className="border-field text-ink h-9 rounded-[9px] border bg-white px-2.5 text-[13px]" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted text-[11px] font-semibold tracking-[0.5px] uppercase">Updated to</span>
            <input type="date" name="to" defaultValue={to} className="border-field text-ink h-9 rounded-[9px] border bg-white px-2.5 text-[13px]" />
          </label>
          <label className="text-ink-2 flex items-center gap-2 self-end pb-2 text-[13px]">
            <input type="checkbox" name="oos" value="1" defaultChecked={oos} className="h-4 w-4" />
            Out of specification only
          </label>
          <div className="flex items-end justify-end gap-2">
            <button type="submit" className="bg-brand h-9 rounded-[9px] px-4 text-[13px] font-semibold text-white">
              Apply filters
            </button>
          </div>
        </form>
      </details>

      {/* The list */}
      {shown.length === 0 ? (
        <div className="border-field text-muted rounded-[14px] border border-dashed bg-white p-8 text-center text-[13px]">No quality forms match.</div>
      ) : (
        <div className="border-line overflow-x-auto rounded-[14px] border bg-white">
          <table className="w-full min-w-[980px] border-collapse text-left text-[13px]" aria-label="Quality forms">
            <thead>
              <tr className="text-muted border-line-3 bg-subtle border-b text-[11px] font-semibold tracking-[0.6px] uppercase">
                <th className="py-2.5 pr-3 pl-[18px] font-semibold">Form</th>
                <th className="px-3 py-2.5 font-semibold">On</th>
                <th className="px-3 py-2.5 font-semibold">Case</th>
                <th className="px-3 py-2.5 font-semibold">Stage</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-3 py-2.5 font-semibold">With</th>
                <th className="py-2.5 pr-[18px] pl-3 font-semibold">Updated</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((f) => {
                const caseNumber = f.part ? f.part.case?.caseNumber : f.case?.caseNumber;
                const caseId = f.part ? f.part.case?.id : f.caseId;
                const withWhom =
                  f.status === "Approved"
                    ? `Approved by ${f.approvedByName ?? "—"}`
                    : f.status === "Pending approval"
                      ? `Sent to ${f.sentToName ?? "approver"}`
                      : (f.assigneeName ?? f.savedByName ?? "—");
                return (
                  <tr key={f.id} className="border-line-3 hover:bg-subtle border-b last:border-b-0">
                    <td className="py-2.5 pr-3 pl-[18px] align-top">
                      <Link href={openHref(f)} className="text-ink font-semibold no-underline hover:underline">
                        {f.name}
                      </Link>
                      <div className="text-muted font-mono text-[11.5px]">
                        {[f.code, f.rev ? `Rev ${f.rev}` : null, f.version > 1 ? `v${f.version}` : null].filter(Boolean).join(" · ")}
                        {f.outOfSpec ? <span className="text-bad ml-1.5 font-sans font-semibold">· {f.outOfSpec} out of spec</span> : null}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      {f.part ? (
                        <Link href={`/parts/${f.partId}?tab=stages`} className="flex flex-col no-underline">
                          <span className="text-brand-ink font-mono text-[12px] font-semibold [overflow-wrap:anywhere]">{f.part.partNumber}</span>
                          <span className="text-muted max-w-[220px] truncate text-[11.5px]">Part · {f.part.name}</span>
                        </Link>
                      ) : (
                        <span className="text-muted text-[12px]">Case · {f.case?.productName ?? "—"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      {caseId && caseNumber ? (
                        <Link href={`/cases/${caseId}?tab=stages`} className="text-brand-ink font-mono text-[12px] font-semibold no-underline [overflow-wrap:anywhere]">
                          {caseNumber}
                        </Link>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="text-ink-2 px-3 py-2.5 align-top">
                      <span className="text-faint font-mono text-[11.5px]">{f.stageIndex + 1}.</span> {f.stageName}
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <span className={"rounded-md px-2 py-[3px] text-[11.5px] font-semibold whitespace-nowrap " + (STATUS_TONE[f.status] ?? STATUS_TONE.Upcoming)}>{f.status}</span>
                    </td>
                    <td className="text-ink-3 px-3 py-2.5 align-top text-[12.5px]">{withWhom}</td>
                    <td className="text-ink-3 py-2.5 pr-[18px] pl-3 align-top text-[12.5px] whitespace-nowrap">{fmtDate(f.approvedAt ?? f.updatedAt, timeZone)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {more ? <div className="text-muted border-line-3 border-t px-[18px] py-2.5 text-[12px]">Showing the {LIMIT} most recently updated — search or filter to narrow it.</div> : null}
        </div>
      )}
    </div>
  );
}

function FilterSelect({ name, label, value, options }: { name: string; label: string; value: string; options: string[] }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-muted text-[11px] font-semibold tracking-[0.5px] uppercase">{label}</span>
      <select name={name} defaultValue={value} className="border-field text-ink h-9 min-w-0 rounded-[9px] border bg-white px-2.5 text-[13px]">
        <option value="">Any</option>
        {value && !options.includes(value) ? <option value={value}>{value}</option> : null}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
