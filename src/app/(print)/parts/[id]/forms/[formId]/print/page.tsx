import type { Metadata } from "next";
import Link from "next/link";

import { PrintButton } from "@/app/(print)/parts/[id]/forms/[formId]/print/print-button";
import { toFormProps } from "@/app/(app)/parts/[id]/qa-section";
import { QaFormView } from "@/components/qa/form-view";
import { recordAudit } from "@/lib/audit";
import { assertVisible, requireSpaceUser, userRoleNames } from "@/lib/auth/rbac";
import { fmtDateTime } from "@/lib/format";
import { getPart, partInspection } from "@/lib/parts/queries";
import { partContext } from "@/lib/qa/context";
import { qaLibraries } from "@/lib/qa/libraries";
import { partForms, qaSettings, docLayoutFor } from "@/lib/qa/queries";
import { spaceTimeZone } from "@/lib/queries/cases";
import { seesPart } from "@/lib/sites/scope";
import { spaceToday } from "@/lib/resources/queries";

export const metadata: Metadata = { title: "Quality record" };

/** One quality form as a record on paper: the form, then who saved, submitted and approved it. */
export default async function PrintFormPage({ params }: PageProps<"/parts/[id]/forms/[formId]/print">) {
  const user = await requireSpaceUser();
  const { id, formId } = await params;
  const fetched = await getPart(user.space.id, id);
  // A site-only person prints only their sites' parts.
  const part = assertVisible(fetched && seesPart(user, fetched) ? fetched : null);
  const form = assertVisible((await partForms(user.space.id, part.id)).find((f) => f.id === formId));

  const [timeZone, today, settings, libraries] = await Promise.all([
    spaceTimeZone(user.space.id),
    spaceToday(user.space.id),
    qaSettings(user.space.id),
    qaLibraries(user.space.id, part.siteId),
  ]);
  const context = await partContext(part, user.space, { id: user.id, name: user.name, roles: userRoleNames(user), siteOnly: user.siteOnly }, today, timeZone);
  const props = toFormProps(form, settings, user.id, timeZone);

  await recordAudit({
    action: "qa.form_print",
    entityType: "part",
    spaceId: user.space.id,
    entityId: form.id,
    entityName: `${part.partNumber} · ${form.code || form.name}`,
    summary: `Printed ${form.name} (${form.status})`,
    actorId: user.id,
    actorEmail: user.email,
  });

  const signatures: Array<[string, string | null, Date | null]> = [
    ["Last saved by", form.savedByName, form.savedAt],
    ["Submitted by", form.submittedByName, form.submittedAt],
    ["Approved by", form.approvedByName, form.approvedAt],
  ];

  return (
    <main className="mx-auto flex max-w-[900px] flex-col gap-4 px-4 py-6 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/parts/${part.id}?tab=forms`} className="text-ink-2 text-[13px] font-semibold no-underline">
          ‹ Back to the part
        </Link>
        <PrintButton />
      </div>

      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#101828] pb-2">
        <div className="flex flex-col">
          <span className="text-lg font-bold">{form.name}</span>
          <span className="text-ink-3 font-mono text-xs">
            {[form.code, form.issue && `Issue ${form.issue}`, form.rev && `Rev ${form.rev}`, form.clause].filter(Boolean).join(" · ")}
          </span>
        </div>
        <div className="text-right text-xs">
          <div className="font-mono font-semibold">{part.partNumber}</div>
          <div>{part.name}</div>
          <div className="text-ink-3">Stage: {form.stageName} · Status: {form.status}</div>
        </div>
      </header>

      <div className="border-line overflow-hidden rounded-[10px] border print:rounded-none print:border-0">
        <QaFormView
          meta={{ ...props.meta, docLayout: form.docLayout, validity: form.validity, docStyle: form.docStyle, layout: await docLayoutFor(user.space.id, form.docStyle) }}
          sections={props.sections}
          context={context}
          libraries={libraries}
          inspection={partInspection(part)}
          initial={props.initial}
          snap={props.snap}
          partLine={`${part.partNumber} · ${part.name}`}
          partId={null}
          editable={false}
          canApprove={false}
          approveHint={null}
          preview
        />
      </div>

      <table className="w-full border-collapse text-[12.5px]">
        <tbody>
          {signatures.map(([label, who, when]) => (
            <tr key={label}>
              <td className="border border-[#101828] px-2 py-1.5 font-bold">{label}</td>
              <td className="border border-[#101828] px-2 py-1.5">{who ?? "—"}</td>
              <td className="border border-[#101828] px-2 py-1.5 font-mono">{when ? fmtDateTime(when, timeZone) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-faint m-0 text-[11px]">
        Printed {fmtDateTime(new Date(), timeZone)} by {user.name} · {user.space.name}. Signatures are the signed-in accounts that saved,
        submitted and approved the record in the Manufacturing Management system.
      </p>
    </main>
  );
}
