import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FormsList } from "@/app/(app)/partsetup/forms-list";
import { RuleCard } from "@/app/(app)/partsetup/rule-card";
import { SetupBuilder } from "@/app/(app)/partsetup/setup-builder";
import { canManageSpace, requireSpaceUser } from "@/lib/auth/rbac";
import { fmtDateTime } from "@/lib/format";
import { getRequestSetup, requestFormSummaries } from "@/lib/parts/queries";
import { spaceTimeZone } from "@/lib/queries/cases";

export const metadata: Metadata = { title: "Part Request Setup" };

/**
 * Part Request Setup: the list of request forms with the part-ID rule they
 * share — or, with ?form=<id>, one form open for editing.
 */
export default async function PartSetupPage({ searchParams }: PageProps<"/partsetup">) {
  const user = await requireSpaceUser();
  const { form: formParam } = await searchParams;
  const formId = typeof formParam === "string" ? formParam : null;
  const [setup, timeZone] = await Promise.all([getRequestSetup(user.space), spaceTimeZone(user.space.id)]);
  const canEdit = canManageSpace(user);

  if (formId) {
    const form = setup.forms.find((f) => f.id === formId);
    if (!form) notFound();
    const summary = (await requestFormSummaries(user.space)).find((f) => f.id === form.id);
    const savedNote = summary?.updatedAt
      ? `Last saved ${fmtDateTime(summary.updatedAt, timeZone)}${summary.updatedByName ? ` by ${summary.updatedByName}` : ""}.`
      : "Not saved yet — the default fields are in use.";
    return (
      <SetupBuilder
        key={form.id}
        initial={form}
        others={setup.forms.filter((f) => f.id !== form.id)}
        rule={setup.rule}
        canEdit={canEdit}
        spaceName={user.space.name}
        savedNote={savedNote}
      />
    );
  }

  const rows = await requestFormSummaries(user.space);
  return (
    <div className="flex max-w-[1100px] flex-col gap-4">
      <RuleCard initial={setup.rule} canEdit={canEdit} spaceName={user.space.name} />
      <FormsList
        canEdit={canEdit}
        rows={rows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          isDefault: r.isDefault,
          sections: r.sections,
          fields: r.fields,
          parts: r.parts,
          saved: r.updatedAt ? `Saved ${fmtDateTime(r.updatedAt, timeZone)}${r.updatedByName ? ` by ${r.updatedByName}` : ""}` : "Default fields — not saved yet",
        }))}
      />
    </div>
  );
}
