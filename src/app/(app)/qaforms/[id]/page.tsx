import type { Metadata } from "next";

import { QaEditor } from "@/app/(app)/qaforms/[id]/qa-editor";
import { assertVisible, canManageSpace, requireSpaceUser, userRoleNames } from "@/lib/auth/rbac";
import { spaceRoles } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { getPart, getRequestSetup, partInspection } from "@/lib/parts/queries";
import { generalContext, partContext } from "@/lib/qa/context";
import { qaLibraries } from "@/lib/qa/libraries";
import { getTemplate, previewParts, stageNames, docLayouts } from "@/lib/qa/queries";
import { newTemplate, readTemplate } from "@/lib/qa/template";
import { notFound } from "next/navigation";
import { catalogueForForms, withCaseForm } from "@/lib/qa/variables";
import { getCaseSetup } from "@/lib/cases/queries";
import { spaceTimeZone } from "@/lib/queries/cases";
import { spaceToday } from "@/lib/resources/queries";

export const metadata: Metadata = { title: "QA form" };

export default async function QaFormEditorPage({ params }: PageProps<"/qaforms/[id]">) {
  const user = await requireSpaceUser();
  const { id } = await params;
  // Opened from "+ New QA form": nothing is stored until it is first saved.
  const creating = id === "new";
  if (creating && !canManageSpace(user)) notFound();
  const template = creating
    ? { id: "new", ...newTemplate((await db.qaTemplate.count({ where: { spaceId: user.space.id } })) + 1) }
    : assertVisible(await getTemplate(user.space.id, id));

  const [setup, stages, libraries, parts, timeZone, today, usedOn, roles] = await Promise.all([
    getRequestSetup(user.space),
    stageNames(user.space.id),
    qaLibraries(user.space.id),
    previewParts(user.space.id),
    spaceTimeZone(user.space.id),
    spaceToday(user.space.id),
    creating ? [] : db.partForm.findMany({ where: { templateId: template.id }, distinct: ["partId"], select: { partId: true } }),
    // The roles a signature can be kept for: this app's, and the platform roles that may sign in here.
    spaceRoles(user.space.id),
  ]);

  // The preview starts on a part with a drawing, so a balloon table shows rows.
  const previewId = parts[0]?.id ?? null;
  const part = previewId ? await getPart(user.space.id, previewId) : null;
  const context = part
    ? await partContext(part, user.space, { id: user.id, name: user.name, roles: userRoleNames(user) }, today, timeZone)
    : await generalContext(user.space, { id: user.id, name: user.name, roles: userRoleNames(user) }, today, timeZone);

  return (
    <QaEditor
      id={template.id}
      initial={readTemplate(template)}
      canEdit={canManageSpace(user)}
      stages={stages}
      variables={withCaseForm(catalogueForForms(setup.forms), await getCaseSetup(user.space.id, user.space.name))}
      libraries={libraries}
      parts={parts.map(({ id: pid, label }) => ({ id: pid, label }))}
      initialPartId={previewId}
      initialContext={context}
      initialInspection={part ? partInspection(part) : null}
      usedOnParts={usedOn.length}
      roles={roles}
      layouts={await docLayouts(user.space.id)}
    />
  );
}
