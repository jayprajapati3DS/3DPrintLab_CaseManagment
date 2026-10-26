import type { Metadata } from "next";
import Link from "next/link";

import { PrintButton } from "@/app/(print)/parts/[id]/forms/[formId]/print/print-button";
import { QaFormView } from "@/components/qa/form-view";
import { recordAudit } from "@/lib/audit";
import { assertVisible, requireSpaceUser, userRoleNames } from "@/lib/auth/rbac";
import { caseStages } from "@/lib/cases/stages";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { caseContext } from "@/lib/qa/context";
import { emptyState } from "@/lib/qa/evaluate";
import { qaLibraries } from "@/lib/qa/libraries";
import { formSections, docLayoutFor } from "@/lib/qa/queries";
import { readTemplate } from "@/lib/qa/template";
import { getCase, spaceTimeZone } from "@/lib/queries/cases";
import { spaceToday } from "@/lib/resources/queries";

export const metadata: Metadata = { title: "Quality form" };

/**
 * A case's quality form on paper — or saved as PDF: the form with the case's
 * details filled in, for the status that calls for it.
 */
export default async function PrintCaseFormPage({ params, searchParams }: PageProps<"/cases/[id]/forms/[templateId]/print">) {
  const user = await requireSpaceUser();
  const { id, templateId } = await params;
  const query = await searchParams;
  const record = assertVisible(await getCase(user.space.id, id));
  // The case's own record of the form — or, for a form not yet on the case, its template, empty.
  const own = await db.partForm.findFirst({ where: { id: templateId, caseId: record.id, spaceId: user.space.id } });
  const template = own ? null : assertVisible(await db.qaTemplate.findFirst({ where: { id: templateId, spaceId: user.space.id } }));
  const data = own ? { ...readTemplate({ ...own, attach: [] }), sections: formSections(own) } : readTemplate(template!);
  const values = own ? ((own.values ?? {}) as Record<string, string>) : {};
  const stages = await caseStages(user.space.id, record);
  const stageName = own?.stageName ?? stages[Number(query.stage) - 1]?.name ?? "";
  const caseNumber = record.caseNumber ?? `#${record.platformCaseId}`;

  const [timeZone, today, libraries] = await Promise.all([spaceTimeZone(user.space.id), spaceToday(user.space.id), qaLibraries(user.space.id)]);
  const context = await caseContext(record, user.space, { id: user.id, name: user.name, roles: userRoleNames(user) }, today, timeZone);

  await recordAudit({
    action: "qa.form_print",
    entityType: "case",
    spaceId: user.space.id,
    entityId: record.id,
    entityName: `${caseNumber} · ${data.code || data.name}`,
    summary: `Printed ${data.name}${stageName ? ` (${stageName})` : ""}`,
    actorId: user.id,
    actorEmail: user.email,
  });

  return (
    <main className="mx-auto flex max-w-[900px] flex-col gap-4 px-4 py-6 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/cases/${record.id}?tab=stages`} className="text-ink-2 text-[13px] font-semibold no-underline">
          ‹ Back to the case
        </Link>
        <PrintButton />
      </div>

      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#101828] pb-2">
        <div className="flex flex-col">
          <span className="text-lg font-bold">{data.name}</span>
          <span className="text-ink-3 font-mono text-xs">{[data.code, data.issue && `Issue ${data.issue}`, data.rev && `Rev ${data.rev}`, data.clause].filter(Boolean).join(" · ")}</span>
        </div>
        <div className="text-right text-xs">
          <div className="font-mono font-semibold">{caseNumber}</div>
          <div>{record.productName}</div>
          {stageName ? <div className="text-ink-3">Status: {stageName}</div> : null}
        </div>
      </header>

      <div className="border-line overflow-hidden rounded-[10px] border print:rounded-none print:border-0">
        <QaFormView
          meta={{
            id: null,
            name: data.name,
            code: data.code,
            clause: data.clause,
            issue: data.issue,
            effective: data.effective,
            rev: data.rev,
            docLayout: data.docLayout,
            validity: data.validity,
            docStyle: data.docStyle,
            layout: await docLayoutFor(user.space.id, data.docStyle),
            stageName,
            status: own?.status ?? "In progress",
            submittedByName: own?.submittedByName,
            submittedAt: own?.submittedAt ? fmtDateTime(own.submittedAt, timeZone) : null,
            approvedByName: own?.approvedByName,
            approvedAt: own?.approvedAt ? fmtDateTime(own.approvedAt, timeZone) : null,
          }}
          sections={data.sections}
          context={context}
          libraries={libraries}
          inspection={null}
          initial={own ? { values, measured: (own.measured ?? {}) as Record<string, string>, quantities: (own.quantities ?? {}) as Record<string, string> } : emptyState()}
          snap={own ? ((own.snap ?? {}) as Record<string, { label: string; line: string; warn: string | null }>) : {}}
          partLine=""
          partId={null}
          editable={false}
          canApprove={false}
          approveHint={null}
          preview
        />
      </div>
      {own ? (
        <table className="w-full border-collapse text-[12.5px]">
          <tbody>
            {(
              [
                ["Last saved by", own.savedByName, own.savedAt],
                ["Submitted by", own.submittedByName, own.submittedAt],
                ["Approved by", own.approvedByName, own.approvedAt],
              ] as Array<[string, string | null, Date | null]>
            ).map(([label, who, when]) => (
              <tr key={label}>
                <td className="border border-[#101828] px-2 py-1.5 font-bold">{label}</td>
                <td className="border border-[#101828] px-2 py-1.5">{who ?? "—"}</td>
                <td className="border border-[#101828] px-2 py-1.5 font-mono">{when ? fmtDateTime(when, timeZone) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <p className="text-faint m-0 text-[11px]">
        Printed {fmtDateTime(new Date(), timeZone)} by {user.name} · {user.space.name}.
      </p>
    </main>
  );
}
