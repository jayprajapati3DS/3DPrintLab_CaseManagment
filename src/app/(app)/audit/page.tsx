import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import Link from "next/link";

import { IntroBanner, Pill, S_BTN_DARK, S_INPUT, S_LABEL, S_TD, S_TH } from "@/components/setup/ui";
import { requireSpaceUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { spaceTimeZone } from "@/lib/queries/cases";
import { KINDS, RESOURCE_KINDS, type ResourceKind } from "@/lib/resources/config";
import type { Tone } from "@/lib/resources/status";

export const metadata: Metadata = { title: "Audit Log" };
export const dynamic = "force-dynamic";

const LIMIT = 300;

/** What each `entityType` is called on screen. */
const MODULES: Record<string, string> = {
  ...Object.fromEntries(RESOURCE_KINDS.map((k) => [k, KINDS[k].title])),
  workflows: "Manufacturing workflows",
  tech: "Manufacturing tech",
  parttypes: "Part types",
  case: "Cases",
  part: "Parts",
  qa: "QA forms",
  grn: "Goods receipt",
  partsetup: "Part request setup",
  user: "Sign-in & accounts",
  role_mapping: "Users & roles",
  platform_connection: "Platform connection",
  space: "Company space",
};

const EVENTS: Record<string, [string, Tone]> = {
  "resource.create": ["Added", "grey"],
  "resource.update": ["Changed", "grey"],
  "resource.archive": ["Archived", "grey"],
  "resource.restore": ["Restored", "green"],
  "resource.deletion_request": ["Deletion requested", "amber"],
  "resource.deletion_cancel": ["Request cancelled", "grey"],
  "resource.delete": ["Permanently deleted", "red"],
  "schedule.item_add": ["Schedule item added", "grey"],
  "schedule.item_update": ["Schedule item changed", "grey"],
  "schedule.item_remove": ["Schedule item removed", "grey"],
  "schedule.maintenance_record": ["Maintenance recorded", "green"],
  "schedule.qualification_record": ["Qualification recorded", "green"],
  "schedule.change_control_review": ["Review closed", "blue"],
  "document.upload": ["Document uploaded", "grey"],
  "document.remove": ["Document removed", "grey"],
  "document.photo": ["Photo changed", "grey"],
  "stock.lot_receive": ["Lot received", "green"],
  "stock.lot_remove": ["Lot removed", "grey"],
  "stock.adjust": ["Stock adjusted", "amber"],
  "setup.technology_add": ["Technology added", "grey"],
  "setup.technology_remove": ["Technology removed", "grey"],
  "setup.part_type_add": ["Part type added", "grey"],
  "setup.part_type_update": ["Part type changed", "grey"],
  "setup.part_type_remove": ["Part type removed", "grey"],
  "setup.part_request_save": ["Part request setup saved", "amber"],
  "part.request": ["Part requested", "green"],
  "part.assign": ["Part owner changed", "grey"],
  "part.stage": ["Part stage moved", "blue"],
  "part.stage_meta": ["Stage owner / due changed", "grey"],
  "part.update": ["Part changed", "grey"],
  "part.file_add": ["Part file added", "grey"],
  "part.file_remove": ["Part file removed", "amber"],
  "part.link_add": ["Part link added", "grey"],
  "part.link_remove": ["Part link removed", "grey"],
  "qa.template_create": ["QA form added", "grey"],
  "qa.template_save": ["QA form changed", "amber"],
  "qa.template_delete": ["QA form deleted", "red"],
  "qa.settings": ["Approval rule changed", "amber"],
  "qa.company": ["Company details changed", "amber"],
  "qa.form_attach": ["Evidence attached", "grey"],
  "qa.form_pass_on": ["Approval passed on", "blue"],
  "qa.form_detach": ["Evidence removed", "amber"],
  "qa.form_draft": ["Quality form saved", "grey"],
  "qa.form_submit": ["Quality form submitted", "blue"],
  "qa.form_approve": ["Quality form approved", "green"],
  "qa.form_reject": ["Quality form rejected", "red"],
  "qa.form_revert": ["Quality form reverted to draft", "amber"],
  "qa.form_revise": ["Approved form revised", "amber"],
  "qa.form_print": ["Quality record printed", "grey"],
  "grn.receive": ["Goods received", "blue"],
  "grn.accept": ["Goods accepted", "green"],
  "grn.reject": ["Goods rejected", "red"],
  "grn.hold": ["Goods on hold", "amber"],
  "grn.delete_draft": ["Draft GRN deleted", "grey"],
  "grn.setup_save": ["GRN setup saved", "amber"],
  "auth.login": ["Signed in", "grey"],
  "auth.login_failed": ["Sign-in failed", "amber"],
  "auth.2fa_failed": ["Verification failed", "amber"],
  "auth.logout": ["Signed out", "grey"],
  "user.password_change": ["Password changed", "grey"],
  "user.signature_save": ["Signature saved", "grey"],
  "user.signature_remove": ["Signature removed", "grey"],
  "user.active.update": ["Account status changed", "amber"],
  "rolemapping.update": ["Role access changed", "amber"],
  "rolemapping.delete": ["Role access removed", "amber"],
  "case.patient_reveal": ["Patient details viewed", "amber"],
  "case.detail_refresh": ["Case refreshed", "grey"],
  "connection.update": ["Connection changed", "amber"],
  "connection.test": ["Connection tested", "grey"],
  "sync.start": ["Sync started", "grey"],
  "space.create": ["Space created", "grey"],
  "space.suspend": ["Space suspended", "red"],
  "space.reactivate": ["Space reactivated", "green"],
  "space.admin_password_reset": ["Admin password reset", "amber"],
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * The space's audit trail. Read-only by construction: nothing in the
 * application updates or deletes an audit row, and this page offers no way to.
 */
export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const user = await requireSpaceUser();
  const params = await searchParams;
  const q = one(params.q).trim().slice(0, 100);
  const moduleKey = one(params.module);
  const event = one(params.event);
  const from = one(params.from);
  const to = one(params.to);

  const and: Prisma.AuditLogWhereInput[] = [];
  if (q) {
    const contains = { contains: q, mode: "insensitive" as const };
    and.push({ OR: [{ entityName: contains }, { summary: contains }, { actorEmail: contains }] });
  }
  if (moduleKey && MODULES[moduleKey]) and.push({ entityType: moduleKey });
  if (event && EVENTS[event]) and.push({ action: event });
  if (isDate(from)) and.push({ createdAt: { gte: new Date(`${from}T00:00:00Z`) } });
  if (isDate(to)) and.push({ createdAt: { lt: new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000) } });

  const where: Prisma.AuditLogWhereInput = { spaceId: user.space.id, AND: and };

  const [entries, matching, total, timeZone] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: LIMIT,
      include: { actor: { select: { name: true } } },
    }),
    db.auditLog.count({ where }),
    db.auditLog.count({ where: { spaceId: user.space.id } }),
    spaceTimeZone(user.space.id),
  ]);

  const filtered = Boolean(q || moduleKey || event || from || to);

  return (
    <div className="flex flex-col gap-5">
      <IntroBanner
        icon="M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1zM8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2M8 11h8M8 15h8M8 19h5"
        before="Audit trail for "
        space={user.space.name}
        after=" — every change to master data, every archive, restore and deletion approval, and every sign-in. Entries cannot be edited or removed."
      />

      <section className="border-line flex min-w-0 flex-col gap-4 rounded-[14px] border bg-white px-4 py-[18px] sm:px-[22px]">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="flex flex-col gap-0.5">
            <h2 className="m-0 text-[15px] font-bold">Audit log</h2>
            <p className="text-muted m-0 text-[12.5px]">Read-only, time-stamped record. Newest first.</p>
          </div>
          <span className="text-muted font-mono text-xs">
            {matching.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")} entries
          </span>
        </div>

        <form className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_150px_150px_auto]">
          <label className="flex flex-col gap-[5px]">
            <span className={S_LABEL}>Search</span>
            <input name="q" type="search" defaultValue={q} placeholder="Search record, detail or person…" className={S_INPUT} />
          </label>
          <label className="flex flex-col gap-[5px]">
            <span className={S_LABEL}>Module</span>
            <select name="module" defaultValue={moduleKey} className={S_INPUT}>
              <option value="">All modules</option>
              {Object.entries(MODULES)
                .sort((a, b) => a[1].localeCompare(b[1]))
                .map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex flex-col gap-[5px]">
            <span className={S_LABEL}>Event type</span>
            <select name="event" defaultValue={event} className={S_INPUT}>
              <option value="">All event types</option>
              {Object.entries(EVENTS)
                .sort((a, b) => a[1][0].localeCompare(b[1][0]))
                .map(([key, [label]]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex flex-col gap-[5px]">
            <span className={S_LABEL}>From</span>
            <input name="from" type="date" defaultValue={isDate(from) ? from : ""} className={`${S_INPUT} font-mono`} />
          </label>
          <label className="flex flex-col gap-[5px]">
            <span className={S_LABEL}>To</span>
            <input name="to" type="date" defaultValue={isDate(to) ? to : ""} className={`${S_INPUT} font-mono`} />
          </label>
          <div className="flex items-center gap-2.5">
            <button type="submit" className={S_BTN_DARK + " h-[38px]"}>
              Filter
            </button>
            {filtered ? (
              <Link href="/audit" className="text-brand-ink text-[12.5px] font-semibold no-underline">
                Clear
              </Link>
            ) : null}
          </div>
        </form>

        <div className="border-line overflow-x-auto rounded-[10px] border">
          <table className="w-full min-w-[760px] border-collapse">
            <thead className="bg-subtle">
              <tr>
                {["Date", "Module", "Event", "Record · details", "By"].map((h) => (
                  <th key={h} className={S_TH}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-muted px-3 py-10 text-center text-[13px]">
                    {filtered ? "No audit entries match these filters." : "Nothing recorded yet."}
                  </td>
                </tr>
              ) : null}
              {entries.map((entry) => {
                const [label, tone] = EVENTS[entry.action] ?? [entry.action, "grey" as Tone];
                const route = KINDS[entry.entityType as ResourceKind]?.route;
                return (
                  <tr key={entry.id}>
                    <td className={`${S_TD} font-mono text-[12.5px] whitespace-nowrap`}>
                      {fmtDateTime(entry.createdAt, timeZone)}
                    </td>
                    <td className={S_TD}>{MODULES[entry.entityType] ?? entry.entityType}</td>
                    <td className={S_TD}>
                      <Pill tone={tone} small>
                        {label}
                      </Pill>
                    </td>
                    <td className={S_TD}>
                      {entry.entityName ? (
                        route && entry.entityId && entry.action !== "resource.delete" ? (
                          <Link href={`${route}/${entry.entityId}`} className="text-ink font-semibold no-underline">
                            {entry.entityName}
                          </Link>
                        ) : (
                          <span className="font-semibold">{entry.entityName}</span>
                        )
                      ) : null}
                      <span className="text-ink-3 block text-[12.5px] leading-[1.45]">{entry.summary}</span>
                    </td>
                    <td className={S_TD}>
                      {entry.actor?.name ?? entry.actorEmail ?? "—"}
                      {entry.actor?.name && entry.actorEmail ? (
                        <span className="text-muted block text-[11.5px]">{entry.actorEmail}</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {matching > LIMIT ? (
          <p className="text-muted m-0 text-[12.5px]">
            Showing the latest {LIMIT}. Narrow the dates or search to see older entries.
          </p>
        ) : null}
      </section>
    </div>
  );
}
