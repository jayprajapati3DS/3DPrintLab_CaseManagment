import type { Metadata } from "next";
import Link from "next/link";

import { FormStatusPill } from "@/components/qa/form-view";
import { requireSpaceUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { spaceTimeZone } from "@/lib/queries/cases";

export const metadata: Metadata = { title: "My Approvals" };

/**
 * The quality forms waiting for the signed-in person, oldest first — and the
 * ones they sent that are still waiting for someone — each on its own tab.
 */
export default async function ApprovalsPage({ searchParams }: PageProps<"/approvals">) {
  const user = await requireSpaceUser();
  const query = await searchParams;
  const [timeZone, mine, sent] = await Promise.all([
    spaceTimeZone(user.space.id),
    db.partForm.findMany({
      where: { spaceId: user.space.id, sentToId: user.id, status: "Pending approval" },
      orderBy: { submittedAt: "asc" },
      include: { part: { select: { id: true, partNumber: true, name: true } }, case: { select: { id: true, caseNumber: true, productName: true } } },
    }),
    db.partForm.findMany({
      where: { spaceId: user.space.id, submittedById: user.id, status: "Pending approval", sentToId: { not: null } },
      orderBy: { submittedAt: "asc" },
      include: { part: { select: { id: true, partNumber: true, name: true } }, case: { select: { id: true, caseNumber: true, productName: true } } },
    }),
  ]);

  // One entry per tab; a new list is one more entry here.
  const tabs: Array<{ key: string; label: string; title: string; empty: string; rows: Row[] }> = [
    {
      key: "mine",
      label: "Waiting for my approval",
      title: "Waiting for my approval",
      empty: "Nothing is waiting for you.",
      rows: mine.map((f) => ({
        id: f.id,
        ...whereFrom(f),
        form: `${f.name}${f.code ? ` (${f.code})` : ""}`,
        stage: f.stageName,
        status: f.status,
        who: `From ${f.submittedByName ?? "—"}`,
        when: f.submittedAt ? fmtDateTime(f.submittedAt, timeZone) : "",
      })),
    },
    {
      key: "sent",
      label: "Sent by me",
      title: "Sent by me, still waiting",
      empty: "Nothing you sent is waiting.",
      rows: sent.map((f) => ({
        id: f.id,
        ...whereFrom(f),
        form: `${f.name}${f.code ? ` (${f.code})` : ""}`,
        stage: f.stageName,
        status: f.status,
        who: `Waiting for ${f.sentToName ?? "—"}`,
        when: f.submittedAt ? fmtDateTime(f.submittedAt, timeZone) : "",
      })),
    },
  ];
  const asked = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  const tab = tabs.find((t) => t.key === asked) ?? tabs[0];

  return (
    <div className="flex max-w-[1100px] flex-col gap-4">
      <div role="tablist" aria-label="Approvals" className="border-line flex gap-1 overflow-x-auto rounded-[14px] border bg-white px-3">
        {tabs.map((t) => {
          const selected = t.key === tab.key;
          return (
            <Link
              key={t.key}
              href={`/approvals?tab=${t.key}`}
              role="tab"
              aria-selected={selected}
              scroll={false}
              className={
                "flex h-12 flex-none items-center gap-2 border-b-2 px-3 text-[13.5px] font-semibold whitespace-nowrap no-underline " +
                (selected ? "border-brand text-brand" : "text-ink-3 border-transparent")
              }
            >
              {t.label}
              <span
                className={
                  "rounded-full px-[7px] py-px font-mono text-[11px] font-bold " + (selected ? "bg-brand-tint text-brand-ink" : "bg-chip text-ink-3")
                }
              >
                {t.rows.length}
              </span>
            </Link>
          );
        })}
      </div>
      <List title={tab.title} empty={tab.empty} rows={tab.rows} />
    </div>
  );
}

interface Row {
  id: string;
  /** The form, on its part's or its case's page. */
  href: string;
  part: string;
  form: string;
  stage: string;
  status: string;
  who: string;
  when: string;
}

function List({ title, empty, rows }: { title: string; empty: string; rows: Row[] }) {
  return (
    <section className="border-line overflow-hidden rounded-[14px] border bg-white">
      <div className="border-line-2 flex items-center gap-2.5 border-b px-5 py-3.5">
        <h2 className="m-0 flex-1 text-[15px] font-bold">{title}</h2>
        <span className="bg-chip text-ink-2 rounded-full px-2 py-0.5 font-mono text-xs font-semibold">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="text-muted px-5 py-6 text-center text-[13px]">{empty}</div>
      ) : (
        <ul className="m-0 list-none p-0">
          {rows.map((r) => (
            <li key={r.id} className="border-line-3 hover:bg-subtle relative border-b last:border-b-0">
              <Link
                href={r.href}
                className="text-ink flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 no-underline"
              >
                <span className="flex min-w-[220px] flex-1 flex-col gap-0.5">
                  <span className="text-[13.5px] font-semibold">{r.form}</span>
                  <span className="text-muted text-[12px]">
                    {r.part} · {r.stage}
                  </span>
                </span>
                <span className="text-ink-2 text-[12.5px]">{r.who}</span>
                <span className="text-muted font-mono text-[11.5px]">{r.when}</span>
                <FormStatusPill status={r.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Where a form is filled: its part — or its case, for a case stage's form. */
function whereFrom(f: {
  id: string;
  area?: string;
  part: { id: string; partNumber: string; name: string } | null;
  case: { id: string; caseNumber: string | null; productName: string | null } | null;
}): { href: string; part: string } {
  if (f.part) return { href: `/parts/${f.part.id}?tab=forms&form=${f.id}`, part: `${f.part.partNumber} · ${f.part.name}` };
  // An order form opens on the case's Order tab.
  if (f.case) return { href: `/cases/${f.case.id}?tab=${f.area === "order" ? "order" : "stages"}&form=${f.id}`, part: `Case ${f.case.caseNumber ?? "—"}${f.case.productName ? ` · ${f.case.productName}` : ""}` };
  return { href: "/approvals", part: "—" };
}
