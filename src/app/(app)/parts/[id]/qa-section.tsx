import type { Prisma } from "@prisma/client";
import Link from "next/link";

import { FormAssignee, FormDialog, InlineForm, type FormProps } from "@/app/(app)/parts/[id]/form-client";
import { FormStatusPill, type Lifecycle } from "@/components/qa/form-view";
import { userRoleNames } from "@/lib/auth/rbac";
import type { AppRole, SessionSpace } from "@/lib/auth/session";
import { fmtDateTime } from "@/lib/format";
import { spacePeopleWithRoles, type RolePerson } from "@/lib/auth/roles";
import { formsRequiredAt, partInspection, partLockStages, partStages, type PartRecord } from "@/lib/parts/queries";
import { orderWaiting } from "@/lib/resources/config";
import { partContext } from "@/lib/qa/context";
import type { FormState } from "@/lib/qa/evaluate";
import { qaLibraries } from "@/lib/qa/libraries";
import { formSections, formVersion, partForms, qaSettings, type PartFormRow, type QaSettings, docLayoutFor } from "@/lib/qa/queries";
import { chainField, signSteps } from "@/lib/qa/signoff";
import { roleAllowed, SOURCE_LABELS, type Source } from "@/lib/qa/template";
import { formChanges } from "@/lib/qa/versions";

/**
 * The part page's quality forms: the current stage's forms inline, the
 * Quality Forms tab, the form dialog, and the traceability table.
 */

/** Who is looking at the form: their roles decide which signatures they may sign. */
type FormUser = { id: string; name: string; role: AppRole; platformRoleName: string | null; siteOnly?: boolean };

const record0 = (value: unknown) => record(value);
const record = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, string>) : {});

/** Who is looking, and who is around: for sending a form for approval, and approving it. */
export interface ApprovalContext {
  people: RolePerson[];
  /** The stage's approver roles; "" when anyone may approve. */
  approverRoles: string;
  userRoles: string;
  isAdmin: boolean;
}

export function toFormProps(form: PartFormRow, settings: QaSettings, userId: string, timeZone: string, ctx?: ApprovalContext): FormProps {
  const approved = form.status === "Approved";
  const approverRoles = ctx?.approverRoles ?? "";
  let canApprove = !approved;
  let approveHint: string | null = null;
  // Reviewed by / Approved by fields: chosen people sign in turn.
  const sections = formSections(form);
  const chainItems = sections.flatMap((sec) => sec.items).filter((i) => chainField(i));
  const chained = chainItems.length > 0;
  const step = form.status === "Pending approval" ? signSteps(chainItems, record(form.values)).find((x) => !x.signed) : undefined;
  if (!approved && chained && form.status !== "Pending approval") {
    canApprove = false;
    approveHint = "Choose who reviews and approves it below, then submit — they sign in turn";
  } else if (!approved && chained && step && form.sentToId !== userId) {
    canApprove = false;
    approveHint = `Waiting for ${step.person.name} to ${step.kind === "reviewer" ? "review" : "approve"} it`;
  } else if (!approved && form.sentToId) {
    // Sent to one person: only they approve it.
    if (form.status !== "Pending approval" || form.sentToId !== userId) {
      canApprove = false;
      approveHint = `Sent to ${form.sentToName ?? "someone else"} — only they can approve it`;
    }
  } else if (!approved) {
    if (settings.separateApprover) {
      if (form.status !== "Pending approval") {
        canApprove = false;
        approveHint = "Submit for approval — another person approves";
      } else if (form.submittedById === userId) {
        canApprove = false;
        approveHint = "You submitted this — someone else must approve it";
      }
    }
    if (canApprove && approverRoles && ctx && !roleAllowed(approverRoles, ctx.userRoles)) {
      canApprove = false;
      approveHint = `Only ${approverRoles} approve this stage's forms`;
    }
  }
  // Who the form can be sent to: anyone holding an approver role — not oneself when someone else must approve.
  const eligible = (ctx?.people ?? []).filter((p) => !approverRoles || roleAllowed(approverRoles, p.roles));
  const sendChoices = eligible.filter((p) => !settings.separateApprover || p.id !== userId);
  const pending = form.status === "Pending approval" && Boolean(form.sentToId);
  const canPassOn = pending && (form.sentToId === userId || Boolean(ctx?.isAdmin));
  // Who each Reviewed by / Approved by field can be given to: the field's roles, or for approval the stage's.
  const fieldPeople = (item: (typeof chainItems)[number]) => {
    const roles = (item.roles ?? "").trim() || (chainField(item) === "approver" ? approverRoles : "");
    return (ctx?.people ?? []).filter((p) => !roles || roleAllowed(roles, p.roles));
  };
  const pickChoices = Object.fromEntries(chainItems.map((item) => [item.id, fieldPeople(item).filter((p) => !settings.separateApprover || p.id !== userId)]));
  const passOnChoices = (step ? fieldPeople(step.item) : eligible).filter(
    (p) => p.id !== form.sentToId && (!settings.separateApprover || p.id !== form.submittedById),
  );
  const latest = form.versions?.[0];
  const lifecycle: Lifecycle = {
    version: form.version,
    canRevert: form.status === "Pending approval" && (form.submittedById === userId || Boolean(ctx?.isAdmin)),
    canRevise: approved && (form.approvedById === userId || Boolean(ctx?.isAdmin)),
    canReject: form.status === "Pending approval" && Boolean(form.sentToId) && form.sentToId === userId,
    rejection:
      latest && latest.event === "rejected" && latest.version === form.version
        ? { byName: latest.byName, at: fmtDateTime(latest.createdAt, timeZone), reason: latest.reason ?? "" }
        : null,
    versions: (form.versions ?? []).map((v) => ({ id: v.id, version: v.version, event: v.event, byName: v.byName, at: fmtDateTime(v.createdAt, timeZone), reason: v.reason })),
    versionHref: form.caseId ? `/cases/${form.caseId}?tab=stages&form=${form.id}&version=` : `/parts/${form.partId}?tab=forms&form=${form.id}&version=`,
  };
  return {
    lifecycle,
    meta: {
      id: form.id,
      name: form.name,
      code: form.code,
      clause: form.clause,
      issue: form.issue,
      effective: form.effective,
      rev: form.rev,
      docLayout: form.docLayout,
      validity: form.validity,
      docStyle: form.docStyle,
      stageName: form.stageName,
      status: form.status,
      submittedByName: form.submittedByName,
      submittedAt: form.submittedAt ? fmtDateTime(form.submittedAt, timeZone) : null,
      approvedByName: form.approvedByName,
      approvedAt: form.approvedAt ? fmtDateTime(form.approvedAt, timeZone) : null,
      savedByName: form.savedByName,
      savedAt: form.savedAt ? fmtDateTime(form.savedAt, timeZone) : null,
    },
    sections,
    initial: {
      values: record(form.values),
      measured: record(form.measured),
      quantities: record(form.quantities),
    } satisfies FormState,
    snap: (form.snap ?? {}) as FormProps["snap"],
    // Sent for approval: only the person signing now may change it.
    editable: !approved && (form.status !== "Pending approval" || canApprove),
    canApprove,
    approveHint,
    approval: {
      approverRoles,
      sendChoices,
      sentToName: form.sentToName,
      sentToId: form.sentToId,
      chained,
      stepKind: step?.kind ?? null,
      stepNeedsImage: step?.item.style === "image",
      pickChoices,
      waiting: pending,
      canPassOn,
      passOnChoices: canPassOn ? passOnChoices : [],
    },
  };
}

export interface PartQa {
  forms: PartFormRow[];
  settings: QaSettings;
}

export async function loadPartQa(part: PartRecord): Promise<PartQa> {
  const [forms, settings] = await Promise.all([partForms(part.spaceId, part.id), qaSettings(part.spaceId)]);
  return { forms, settings };
}

/** What a form needs to be drawn: the values its variables read, and the libraries. */
async function formEnvironment(part: PartRecord, space: SessionSpace, user: FormUser, today: string, timeZone: string) {
  const [context, libraries, people] = await Promise.all([
    partContext(part, space, { id: user.id, name: user.name, roles: userRoleNames(user), siteOnly: user.siteOnly }, today, timeZone),
    qaLibraries(space.id, part.siteId),
    spacePeopleWithRoles(space.id),
  ]);
  const stages = partStages(part);
  /** What one form needs to be sent for approval, and approved. */
  const approval = (stageIndex: number): ApprovalContext => ({
    people,
    approverRoles: (stages[stageIndex]?.approvers ?? "").trim(),
    userRoles: userRoleNames(user).join(", "),
    isAdmin: user.role === "SPACE_ADMIN",
  });
  return { context, libraries, inspection: partInspection(part), approval };
}

// --- Current stage ----------------------------------------------------------------------------

export async function CurrentStageForms({
  part,
  qa,
  stageName,
  nextName,
  selected,
  space,
  user,
  today,
  timeZone,
}: {
  part: PartRecord;
  qa: PartQa;
  stageName: string;
  nextName: string | null;
  selected: string | undefined;
  space: SessionSpace;
  user: FormUser;
  today: string;
  timeZone: string;
}) {
  const here = qa.forms.filter((f) => f.stageIndex === part.stageIndex);
  if (here.length === 0) return null;
  const open = here.filter((f) => f.status !== "Approved").length;
  const chosen = here.find((f) => f.id === selected) ?? here.find((f) => f.status !== "Approved") ?? here[0];
  const [env, required] = await Promise.all([formEnvironment(part, space, user, today, timeZone), formsRequiredAt(part, part.stageIndex)]);

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F9DBAF] bg-[#FFF6F2] px-4 py-3 sm:px-[18px]">
        <div className="flex flex-col gap-0.5">
          <span className="text-brand-ink text-[11px] font-bold tracking-[0.7px] uppercase">Current stage · {stageName}</span>
          <span className="text-ink text-[14.5px] font-bold">
            {open ? `${open} quality form${open === 1 ? "" : "s"} to complete at this stage` : "All quality forms for this stage are approved"}
          </span>
          {open && !required && nextName ? (
            <span data-testid="forms-optional" className="text-muted text-xs">
              Not required to move on — the part can go to {nextName} now; the forms stay here to complete and approve.
            </span>
          ) : null}
          {!open && nextName ? <span className="text-muted text-xs">Use “Next” to move to {nextName}.</span> : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {here.map((f) => {
            const on = f.id === chosen.id;
            return (
              <Link
                key={f.id}
                href={`/parts/${part.id}?f=${f.id}`}
                scroll={false}
                aria-current={on ? "true" : undefined}
                className={
                  "text-ink inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] font-semibold no-underline " +
                  (on ? "border-brand-edge bg-white" : "border-field bg-white/60")
                }
              >
                {f.name}
                <FormStatusPill status={f.status} />
              </Link>
            );
          })}
        </div>
      </div>
      <InlineForm
        form={toFormProps(chosen, qa.settings, user.id, timeZone, env.approval(chosen.stageIndex))}
        context={env.context}
        libraries={env.libraries}
        inspection={env.inspection}
        partLine={`${part.partNumber} · ${part.name}`}
        partId={part.id}
      />
    </div>
  );
}

// --- The dialog --------------------------------------------------------------------------------

export async function FormDialogMount({
  part,
  qa,
  formId,
  versionId,
  closeHref,
  space,
  user,
  today,
  timeZone,
}: {
  part: PartRecord;
  qa: PartQa;
  formId: string;
  /** A kept version to show instead of the current record. */
  versionId?: string;
  closeHref: string;
  space: SessionSpace;
  user: FormUser;
  today: string;
  timeZone: string;
}) {
  const form = qa.forms.find((f) => f.id === formId);
  if (!form) return null;
  const env = await formEnvironment(part, space, user, today, timeZone);
  const props = toFormProps(form, qa.settings, user.id, timeZone, env.approval(form.stageIndex));
  // A stage that fills its forms in order: this one waits until the one before it is submitted.
  const waits =
    form.status !== "Pending approval" && form.status !== "Approved"
      ? orderWaiting((await partLockStages(part))[form.stageIndex], form, qa.forms.filter((f) => f.stageIndex === form.stageIndex))
      : null;
  const current = waits ? { ...props, editable: false, approveHint: `Fill "${waits}" first — this stage's forms are filled in order` } : props;
  const kept = versionId ? await formVersion(form.id, versionId) : null;
  let shown = current;
  if (kept) {
    const record = (v: { sections: unknown; values: unknown; measured: unknown; snap: unknown }) => ({
      sections: formSections(v as { sections: Prisma.JsonValue }),
      values: record0(v.values),
      measured: record0(v.measured),
      snap: (v.snap ?? {}) as Record<string, { label: string } | undefined>,
    });
    const when = fmtDateTime(kept.createdAt, timeZone);
    shown = {
      ...current,
      meta: {
        ...current.meta,
        status: kept.event === "approved" ? "Approved" : "Rejected",
        submittedByName: kept.submittedByName,
        submittedAt: kept.submittedAt ? fmtDateTime(kept.submittedAt, timeZone) : null,
        approvedByName: kept.event === "approved" ? kept.byName : null,
        approvedAt: kept.event === "approved" ? when : null,
      },
      sections: formSections(kept),
      initial: { values: record0(kept.values), measured: record0(kept.measured), quantities: record0(kept.quantities) },
      snap: (kept.snap ?? {}) as FormProps["snap"],
      editable: false,
      canApprove: false,
      approveHint: null,
      lifecycle: {
        ...current.lifecycle!,
        version: kept.version,
        canRevert: false,
        canRevise: false,
        canReject: false,
        rejection: null,
        viewing: {
          title: `Version ${kept.version} — ${kept.event === "approved" ? "approved" : "rejected"} by ${kept.byName} · ${when}${kept.reason ? ` · "${kept.reason}"` : ""}`,
          currentHref: `/parts/${part.id}?tab=forms&form=${form.id}`,
          changes: formChanges(record(kept), record(form)),
        },
      },
    };
  }
  return (
    <FormDialog
      key={kept?.id ?? form.id}
      // Its header & footer: the design it uses, as the space has it now.
      form={{ ...shown, meta: { ...shown.meta, layout: await docLayoutFor(space.id, form.docStyle) } }}
      context={env.context}
      libraries={env.libraries}
      inspection={env.inspection}
      partLine={`${part.partNumber} · ${part.name}`}
      partId={part.id}
      closeHref={closeHref}
    />
  );
}

// --- Quality Forms tab ---------------------------------------------------------------------------

export function FormsTab({
  part,
  qa,
  people,
  userId,
  timeZone,
}: {
  part: PartRecord;
  qa: PartQa;
  people: Array<{ id: string; name: string }>;
  userId: string;
  timeZone: string;
}) {
  return (
    <div className="flex flex-col gap-3.5 p-4 sm:p-[22px]">
      <div className="flex flex-col gap-0.5">
        <h3 className="m-0 text-[15px] font-bold">Quality forms</h3>
        <p className="text-muted m-0 text-[12.5px]">
          ISO 13485 records for this part, attached to its production stages. Forms at the current stage must be approved to advance, unless the workflow says that stage does not need them.
        </p>
      </div>
      {qa.forms.length === 0 ? (
        <div className="border-field text-muted rounded-xl border border-dashed px-5 py-8 text-center text-[13px]">
          No quality forms attached to this part&apos;s workflow. Add forms to its stages in QA Form Setup.
        </div>
      ) : (
        qa.forms.map((form) => {
          const blocking = form.stageIndex === part.stageIndex && form.status !== "Approved";
          return (
            <div key={form.id} className="border-line flex flex-wrap items-start gap-3.5 rounded-xl border px-4 py-3.5">
              <span className="bg-brand-wash text-brand flex h-9 w-9 flex-none items-center justify-center rounded-[9px]">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1zM8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2M9 13l2 2 4-4" />
                </svg>
              </span>
              <div className="flex min-w-[220px] flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold">{form.name}</span>
                  <FormStatusPill status={form.status} />
                  {form.outOfSpec ? <span className="bg-bad-tint text-bad rounded-full px-2 py-0.5 text-[11px] font-bold">{form.outOfSpec} out of spec</span> : null}
                </div>
                <span className="text-muted font-mono text-[11.5px]">{[form.code, form.stageName, form.clause].filter(Boolean).join(" · ")}</span>
                {blocking ? <span className="text-bad text-xs font-semibold">● Required to advance</span> : null}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-muted text-[11px] font-semibold tracking-[0.5px]">ASSIGNEE</span>
                  <FormAssignee
                    formId={form.id}
                    assigneeId={form.assigneeId}
                    assigneeName={form.assigneeName}
                    people={people}
                    meId={userId}
                    locked={form.status === "Approved"}
                  />
                </div>
                {form.savedAt ? (
                  <span className="text-ok text-xs">
                    ✓ Last saved by {form.savedByName} · {fmtDateTime(form.savedAt, timeZone)}
                    {form.approvedByName ? ` · approved by ${form.approvedByName}` : ""}
                  </span>
                ) : null}
              </div>
              <Link
                href={`/parts/${part.id}?tab=forms&form=${form.id}`}
                scroll={false}
                className={
                  "flex h-9 items-center rounded-[9px] px-3.5 text-[13px] font-semibold no-underline " +
                  (form.status === "Approved" ? "border-field text-ink border bg-white" : "bg-ink text-white")
                }
              >
                {form.status === "Approved" ? "View record" : "Open form"}
              </Link>
            </div>
          );
        })
      )}
    </div>
  );
}

// --- Traceability ----------------------------------------------------------------------------------

export function Traceability({ part, qa, timeZone }: { part: PartRecord; qa: PartQa; timeZone: string }) {
  const rows = qa.forms.flatMap((form) => form.uses.filter((u) => u.source !== "custom").map((use) => ({ use, form })));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h4 className="m-0 text-sm font-bold">Traceability — recorded in quality forms</h4>
        <p className="text-muted m-0 text-[12.5px]">
          Printer, lots, equipment, operators and parameters picked in this part&apos;s QA forms. Each record also appears on that item&apos;s page.
        </p>
      </div>
      {rows.length === 0 ? (
        <div className="border-field text-faint rounded-[10px] border border-dashed px-4 py-5 text-center text-[12.5px]">
          Nothing recorded yet — records appear when a QA form with library dropdowns (printer, lot, equipment, operator…) is saved.
        </div>
      ) : (
        <div className="border-line-2 overflow-x-auto rounded-[10px] border">
          <table className="w-full min-w-[640px] border-collapse">
            <thead className="bg-subtle">
              <tr>
                {["Type", "Item", "Recorded in", "By · when"].map((h) => (
                  <th key={h} className="text-muted px-3 py-2.5 text-left text-[10.5px] font-bold tracking-[0.5px] uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ use, form }) => (
                <tr key={use.id}>
                  <td className="border-line-3 text-ink-3 border-t px-3 py-2.5 align-top text-[12.5px]">{SOURCE_LABELS[use.source as Source] ?? use.source}</td>
                  <td className="border-line-3 border-t px-3 py-2.5 align-top text-[13px] font-semibold">
                    {use.label}
                    {use.quantity ? <span className="text-muted block font-mono text-[11.5px] font-normal">{Number(use.quantity)} {use.unit ?? ""} used</span> : null}
                  </td>
                  <td className="border-line-3 border-t px-3 py-2.5 align-top text-[12.5px]">
                    <Link href={`/parts/${part.id}?tab=info&form=${form.id}`} scroll={false} className="text-ink font-semibold no-underline">
                      {form.name}
                    </Link>{" "}
                    <span className="text-muted">({form.status})</span>
                    <span className="text-muted block text-[11.5px]">
                      {use.field} · {form.stageName}
                    </span>
                  </td>
                  <td className="border-line-3 text-ink-3 border-t px-3 py-2.5 align-top text-[12.5px]">
                    {form.savedByName ?? "—"}
                    <span className="block font-mono text-[11.5px]">{form.savedAt ? fmtDateTime(form.savedAt, timeZone) : ""}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
