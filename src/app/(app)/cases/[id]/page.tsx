import type { Metadata } from "next";
import Link from "next/link";

import { LocalCaseInfo } from "@/app/(app)/cases/[id]/local-case";
import { PatientPanel } from "@/app/(app)/cases/[id]/patient-panel";
import { RequestPart } from "@/components/parts/request-part";
import { CubeChip, SourcingTag, StagePill, Stepper } from "@/components/parts/ui";
import { ProductTile, StateFlag, StatusBadge } from "@/components/ui/badges";
import { assertVisible, canManageSpace, requireSpaceUser, userRoleNames } from "@/lib/auth/rbac";
import { decryptSecret } from "@/lib/crypto";
import { fmtDate, fmtDateTime, shortPatientName } from "@/lib/format";
import { caseParts, getPart, NO_WORKFLOW, partStages, spacePeople, stageLabel } from "@/lib/parts/queries";
import { TeamPanel } from "@/components/team/team-panel";
import { caseTeam, rolesOfName } from "@/lib/team";
import { PartStatusTable } from "@/app/(app)/parts/[id]/status-table";
import { ProductionDashboard } from "@/components/parts/production-dashboard";
import { loadPartQa } from "@/app/(app)/parts/[id]/qa-section";
import { getCase, spaceTimeZone } from "@/lib/queries/cases";
import { caseDetails, caseFieldVar, caseFormFor, type CaseSetup } from "@/lib/cases/case-form";
import { caseHospitals, casePeople } from "@/lib/cases/queries";
import { NewCaseDialog } from "@/components/cases/new-case-dialog";
import { caseStagesFor, extrasFor, readCatalog } from "@/lib/cases/catalog";
import { getCaseSetup } from "@/lib/cases/queries";
import { addWorkingDays, caseStageIndex, caseStages, caseTasks, ensureCaseTasks, readStageMarks, stageTimes } from "@/lib/cases/stages";
import { FormStatusPill, QaFormView } from "@/components/qa/form-view";
import { caseContext } from "@/lib/qa/context";
import { caseForms, ensureCaseForms, qaSettings, docLayoutFor } from "@/lib/qa/queries";
import { spacePeopleWithRoles } from "@/lib/auth/roles";
import { FormDialog } from "@/app/(app)/parts/[id]/form-client";
import { toFormProps } from "@/app/(app)/parts/[id]/qa-section";
import { qaLibraries } from "@/lib/qa/libraries";
import { readTemplate, templateLabel } from "@/lib/qa/template";
import { spaceToday } from "@/lib/resources/queries";
import { emptyState } from "@/lib/qa/evaluate";
import { AddCaseFiles, CaseImageBadge, CaseMenu, CaseMoveBar, StageDueInput, StageOwnerSelect, TaskCheck, TaskPlan } from "@/app/(app)/cases/[id]/case-controls";
import { db } from "@/lib/db";
import { StatusTimeline } from "@/components/stages/timeline";
import { OrderTab } from "@/app/(app)/cases/[id]/order-tab";
import { addableOrderTemplates, caseOrderForms, ensureOrderForms } from "@/lib/cases/orders";
import { seesCase } from "@/lib/sites/scope";
import { infoLockedFor, orderWaiting } from "@/lib/resources/config";

export const metadata: Metadata = { title: "Case" };

const ALL_TABS = [
  { key: "info", label: "Case Information", icon: "M12 16v-4M12 8h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z" },
  // Forms between the surgeon and the team, not tied to a status.
  { key: "order", label: "Order", icon: "M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1zM16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 14l2 2 4-4" },
  { key: "status", label: "Status", icon: "M22 12h-4l-3 9L9 3l-3 9H2" },
  // A case opened here: its stages, with their tasks, forms and viewers — "Status", as on a synced case.
  { key: "stages", label: "Status", icon: "M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3" },
  { key: "forms", label: "Quality Forms", icon: "M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1zM16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" },
  { key: "mfg", label: "Manufacturing", icon: "M2 20h20M4 20V9l5 3V9l5 3V9l5 3v8M17 4v5" },
  { key: "tasks", label: "Tasks", icon: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" },
  { key: "files", label: "Files", icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6" },
  { key: "team", label: "Team", icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" },
  { key: "activity", label: "Activity Log", icon: "M12 8v4l3 2M3.05 11a9 9 0 1 1 .5 4M3 4v5h5" },
] as const;
type TabKey = (typeof ALL_TABS)[number]["key"];
/** A case opened here moves through its stages here; a synced one shows the platform's status. */
const LOCAL_TABS: TabKey[] = ["info", "order", "stages", "forms", "mfg", "tasks", "files", "team", "activity"];
/** The tabs that list the stages' tasks, forms and viewers — and open them in a side panel. */
const STAGE_TABS: TabKey[] = ["stages", "forms", "tasks", "order"];
const SYNCED_TABS: TabKey[] = ["info", "status", "mfg", "team", "activity"];

export default async function CasePage({ params, searchParams }: PageProps<"/cases/[id]">) {
  const user = await requireSpaceUser();
  const { id } = await params;
  const found = await getCase(user.space.id, id);
  // A surgeon opens only the cases they operate on — and sees their Order tab only.
  const surgeon = user.surgeonOnly;
  const record = assertVisible(found && seesCase(user, found) ? found : null);
  const timeZone = await spaceTimeZone(user.space.id);

  const query = await searchParams;
  const rawTab = query.tab;
  const TABS = ALL_TABS.filter((t) => (surgeon ? ["order"] : record.origin === "local" ? LOCAL_TABS : SYNCED_TABS).includes(t.key));
  const tab: TabKey = surgeon ? "order" : TABS.some((t) => t.key === rawTab) ? (rawTab as TabKey) : "info";
  const requesting = query.request === "1";
  const parts = tab === "mfg" || tab === "team" ? await caseParts(user.space.id, record.id) : [];
  // Each part's stage status, opened under it as on its own page.
  const partStatus = new Map(
    (
      await Promise.all(
        parts.map(async (p) => {
          const full = await getPart(user.space.id, p.id);
          return full ? ([p.id, { part: full, qa: await loadPartQa(full) }] as const) : null;
        }),
      )
    ).filter((x): x is NonNullable<typeof x> => x !== null),
  );
  const statusPeople = parts.length ? await spacePeople(user.space.id) : [];
  const activity = tab === "activity" ? await caseActivity(user.space.id, record.id) : [];
  // Its last edit, for Case Information.
  const lastEdit = await db.auditLog.findFirst({
    where: { spaceId: user.space.id, entityType: "case", entityId: record.id, action: "case.update" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, actorEmail: true, actor: { select: { name: true } } },
  });

  // A case opened in this app — not synced — shows its own form's answers and files.
  const local = record.origin === "local";
  const [setup, files] = local
    ? await Promise.all([
        getCaseSetup(user.space.id, user.space.name),
        db.caseFile.findMany({
          where: { caseId: record.id, spaceId: user.space.id },
          orderBy: { createdAt: "asc" },
          select: { id: true, field: true, name: true, size: true, contentType: true, createdAt: true, uploadedByName: true },
        }),
      ])
    : [null, []];
  // What its product — or sub-scope — comes with: image, viewers, scan protocols.
  const extras = local ? await caseExtras(user.space.id, record, userRoleNames(user)) : null;
  // Its stages — the product's case stages — where it is, and who moved it on from each.
  const stages = local ? await caseStages(user.space.id, record) : [];
  const at = caseStageIndex(stages, record);
  const marks = readStageMarks(record.stageMeta);
  const mine = record.assigneeId === user.id;
  const imageSrc = record.imageFileId ? `/api/case-files/${record.imageFileId}` : null;
  // Each stage's start, due date and finish; today, for what is overdue.
  const times = stageTimes(stages, at, Boolean(record.completedAt), record.platformCreatedAt, marks);
  const today0 = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  // The quality forms the stages call for, by their label in the stage setup.
  const templates = local && stages.some((s) => s.forms.length) ? await db.qaTemplate.findMany({ where: { spaceId: user.space.id } }) : [];
  const templateFor = (label: string) =>
    templates.find((t) => templateLabel(t).toLowerCase() === label.trim().toLowerCase()) ?? templates.find((t) => t.name.toLowerCase() === label.trim().toLowerCase()) ?? null;
  // The case's own records of them, created the first time the case is opened.
  if (local && stages.length) await ensureCaseForms(record, stages, at);
  // Its Order tab gets its product's automatic forms the first time it is opened.
  if (local) await ensureOrderForms(record);
  const qaForms = local ? await caseForms(user.space.id, record.id) : [];
  const orderRows = tab === "order" && local ? await caseOrderForms(user.space.id, record.id) : [];
  const formFor = (stageIndex: number, templateId: string | undefined) => qaForms.find((f) => f.stageIndex === stageIndex && f.templateId === templateId) ?? null;
  const formsAt = (stageIndex: number) => qaForms.filter((f) => f.stageIndex === stageIndex);
  // A form record opened: filled, saved, sent for approval and approved here.
  const openRecord = STAGE_TABS.includes(tab) && typeof query.form === "string" ? (qaForms.find((f) => f.id === query.form) ?? null) : null;
  /** Whether a status's forms can be filled now: only while the case is at it, unless the status allows any time. */
  const fillState = (i: number): "open" | "upcoming" | "closed" =>
    // An order form (no stage) can be filled whatever the status.
    i < 0 || stages[i]?.formsFill === "anytime" ? "open" : i < at ? "closed" : i > at ? "upcoming" : "open";
  // A status that fills its forms in order: the earlier form this one waits for.
  const waitingFor = (stageIndex: number, form: { name: string; code: string }) => orderWaiting(stages[stageIndex], form, formsAt(stageIndex));
  const openWaits = openRecord && openRecord.status !== "Pending approval" && openRecord.status !== "Approved" ? waitingFor(openRecord.stageIndex, openRecord) : null;
  const recordDialog = openRecord
    ? await caseFormDialog(openRecord, stages, user, timeZone, query.mode === "view", fillState(openRecord.stageIndex) !== "open" || Boolean(openWaits), openWaits ? `Fill "${openWaits}" first — this status's forms are filled in order` : undefined)
    : null;
  // A template with no record on this case (added to the product later): previewed.
  const openForm = !openRecord && STAGE_TABS.includes(tab) && typeof query.form === "string" ? (templates.find((t) => t.id === query.form) ?? null) : null;
  const formPanel = openForm
    ? {
        template: openForm,
        data: readTemplate(openForm),
        stageName: stages[Number(query.stage) - 1]?.name ?? "",
        /** View: read-only; Edit: the fields open to fill. */
        mode: query.mode === "edit" ? ("edit" as const) : ("view" as const),
        libraries: await qaLibraries(user.space.id),
        context: await caseContext(record, user.space, { id: user.id, name: user.name, roles: userRoleNames(user) }, await spaceToday(user.space.id), timeZone),
      }
    : null;
  const closeForm = `/cases/${record.id}?tab=${tab}&stage=${typeof query.stage === "string" ? query.stage : ""}`;
  const stageViewerIds = [...new Set(stages.flatMap((s) => (s.viewers ?? []).map((v) => v.viewerId)))];
  const stageViewers =
    STAGE_TABS.includes(tab) && stageViewerIds.length
      ? await db.resource.findMany({ where: { id: { in: stageViewerIds }, spaceId: user.space.id, kind: "viewers", archivedAt: null }, select: { id: true, name: true, data: true } })
      : [];
  const stageViewerNames = new Map(stageViewers.map((v) => [v.id, v.name]));
  const stageViewerUrls = new Map(stageViewers.map((v) => [v.id, String(((v.data ?? {}) as Record<string, unknown>).url ?? "")]));
  // The stage tasks, as records to tick off — made the first time the case is opened.
  if (local && stages.length) await ensureCaseTasks(record, stages);
  const taskRecords = local ? await caseTasks(user.space.id, record.id) : [];
  const tasksAt = (stageIndex: number) => taskRecords.filter((x) => x.stageIndex === stageIndex);
  /** A task's due date: as set on it, else its stage's start plus its days. */
  const taskDue = (x: (typeof taskRecords)[number]) => {
    if (x.dueOn) return x.dueOn;
    const start = times[x.stageIndex ?? 0]?.startedAt;
    const days = stages[x.stageIndex ?? 0]?.tasks.find((t) => t.name === x.name)?.days ?? 0;
    return start ? addWorkingDays(start, days) : null;
  };
  // A stage task opened from a row.
  const openTask = STAGE_TABS.includes(tab) && typeof query.task === "string" ? (taskRecords.find((x) => x.id === query.task) ?? null) : null;
  const taskPanel = openTask
    ? {
        task: openTask,
        stage: stages[openTask.stageIndex ?? 0],
        due: taskDue(openTask),
        people: (await casePeople(user.space.id)).map((p) => ({ id: p.id, name: p.name, detail: p.roles.join(", ") })),
      }
    : null;
  // Who a status can be planned for, and whether this person may plan them.
  const canPlan = mine || canManageSpace(user);
  // The product may lock the case information at this status, for everyone or some roles.
  const infoLock = local ? infoLockedFor(stages, at, userRoleNames(user), "case") : null;
  const editHref = infoLock ? null : "/cases/" + record.id + "?edit=1";
  // On hold, cancelled or archived: why, and by whom — from the case's trail.
  const onHold = /hold/i.test(record.caseState ?? "");
  const cancelled = /cancel/i.test(record.caseState ?? "");
  const stateAction = onHold ? "case.hold" : cancelled ? "case.cancel" : record.isArchived ? "case.archive" : null;
  const stateNote = local && stateAction
    ? await db.auditLog.findFirst({
        where: { spaceId: user.space.id, entityType: "case", entityId: record.id, action: stateAction },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, after: true, actorEmail: true, actor: { select: { name: true } } },
      })
    : null;
  const planPeople =
    tab === "stages" && local ? (await casePeople(user.space.id)).map((p) => ({ id: p.id, name: p.name, detail: p.roles.join(", ") })) : [];
  const initials = local ? (caseDetails(record).find((d) => d.var === "case.patientInitials")?.value ?? null) : null;

  const patientName = decryptSecret(record.patientNameEncrypted);
  const caseNumber = record.caseNumber ?? `#${record.platformCaseId}`;
  const editing = local && setup && query.edit === "1" && !infoLock ? await editState(user.space.id, record, setup, caseNumber) : null;

  return (
    <div className="flex flex-col gap-4">
      <Link href={surgeon ? "/orders" : "/cases"} className="text-ink-3 self-start text-[13px] font-semibold no-underline">
        {surgeon ? "← Back to my orders" : "← Back to cases"}
      </Link>
      {editing && setup ? (
        <NewCaseDialog setup={setup} products={[]} subscopes={[]} people={editing.people} hospitals={editing.hospitals} used={[]} closeHref={`/cases/${record.id}`} edit={editing.edit} />
      ) : null}

      <section className="border-line flex flex-wrap items-center gap-4 rounded-[14px] border bg-white px-4 py-5 sm:px-[22px]">
        <div className="flex flex-none" data-testid="case-image">
          {local && !surgeon ? (
            <CaseImageBadge caseId={record.id} hasOwn={Boolean(record.imageFileId)}>
              <ProductTile product={record.productName} imageId={extras?.imageId} src={imageSrc} size={64} />
            </CaseImageBadge>
          ) : (
            <ProductTile product={record.productName} size={56} />
          )}
        </div>
        <div className="flex min-w-[180px] flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="m-0 text-[19px] font-bold tracking-[-0.3px]">{record.productName ?? "Case"}</h2>
            <StatusBadge status={record.caseStatus} />
            <StateFlag state={record.caseState} />
          </div>
          <div className="text-muted font-mono text-[12.5px]">
            {[caseNumber, initials ?? (patientName ? shortPatientName(patientName) : null), record.surgeonName].filter(Boolean).join(" · ")}
          </div>
        </div>
        {local && !surgeon ? (
          <div className="flex flex-none items-center gap-2.5" data-testid="case-viewers">
            {/* The viewer buttons the product turns on at the current status, for this person's roles. */}
            {(extras?.viewers ?? []).map((v) =>
              /^https?:\/\//.test(v.url) ? (
                <a
                  key={v.id}
                  href={v.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-navy flex h-10 items-center gap-2 rounded-[9px] px-4 text-[13px] font-semibold text-white no-underline"
                >
                  <CubeIcon />
                  Open {v.name}
                </a>
              ) : (
                <span
                  key={v.id}
                  title="This viewer has no link yet — set it on the Viewer list."
                  className="bg-navy flex h-10 cursor-not-allowed items-center gap-2 rounded-[9px] px-4 text-[13px] font-semibold text-white opacity-60"
                >
                  <CubeIcon />
                  Open {v.name}
                </span>
              ),
            )}
            <CaseMenu
              caseId={record.id}
              editHref={editHref}
              hasOwnImage={Boolean(record.imageFileId)}
              onHold={onHold}
              cancelled={cancelled}
              archived={record.isArchived}
              canHold={canPlan}
              isAdmin={canManageSpace(user)}
            />
          </div>
        ) : surgeon ? null : (
          <Link href={`/cases/${record.id}/edit`} className="bg-navy flex h-10 flex-none items-center gap-2 rounded-[9px] px-4 text-[13px] font-semibold text-white no-underline">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#FF8A5C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
            Edit case
          </Link>
        )}
      </section>

      {local && stateAction ? (
        <div
          role="status"
          data-testid="case-state-note"
          className={"flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[12px] border px-4 py-3 text-[13px] " + (cancelled ? "border-[#FECDCA] bg-[#FEF3F2]" : onHold ? "border-[#FEDF89] bg-[#FFFAEB]" : "border-line bg-[#F9FAFB]")}
        >
          <b className={cancelled ? "text-[#B42318]" : onHold ? "text-[#B54708]" : "text-ink-2"}>{cancelled ? "Cancelled" : onHold ? "On hold" : "Archived"}</b>
          {stateNote ? (
            <span className="text-ink-2">
              {String(((stateNote.after ?? {}) as Record<string, unknown>).comment ?? "") || "No comment."}
              <span className="text-muted"> — {stateNote.actor?.name ?? stateNote.actorEmail ?? "someone"} · {fmtDateTime(stateNote.createdAt, timeZone)}</span>
            </span>
          ) : null}
        </div>
      ) : null}

      {local && !surgeon ? (
        <section className="border-line flex flex-col gap-4 rounded-[14px] border bg-white px-4 py-5 sm:px-[22px]" aria-label="Status timeline">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
            <span className="text-[14px]">
              <b className="text-ink">Status timeline</b> <span className="text-muted">· {record.completedAt ? "completed" : "current progress"}</span>
            </span>
            {stages.length > 0 && !record.completedAt ? (
              <span className="text-muted flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]" data-testid="stage-summary">
                <span>
                  Started <b className="text-ink-2">{times[at]?.startedAt ? fmtDate(times[at].startedAt!, timeZone) : "—"}</b>
                </span>
                <span className={times[at]?.dueAt && times[at].dueAt! < today0 ? "text-bad" : ""}>
                  Due <b>{times[at]?.dueAt ? `${fmtDate(times[at].dueAt!, timeZone)} · ${dueWords(times[at].dueAt!, today0)}` : "not set"}</b>
                </span>
                <span>
                  Quality forms <b className="text-ink-2">{formsAt(at).length ? `${formsAt(at).filter((f) => f.status === "Approved").length} / ${formsAt(at).length} approved` : "none"}</b>
                </span>
                <span>
                  Tasks <b className="text-ink-2">{tasksAt(at).length ? `${tasksAt(at).filter((x) => x.status === "Done").length} / ${tasksAt(at).length} done` : "none"}</b>
                </span>
                <Link href={`/cases/${record.id}?tab=stages&stage=${at + 1}#stage-${at + 1}`} scroll={false} className="text-brand-ink font-semibold no-underline">
                  Open stage ›
                </Link>
              </span>
            ) : null}
          </div>
          {stages.length > 0 ? <StatusTimeline stages={stages} current={record.completedAt ? stages.length : at} /> : null}
          <CaseMoveBar
            caseId={record.id}
            assigneeName={record.assigneeName}
            mine={mine}
            prevName={at > 0 ? stages[at - 1].name : null}
            nextName={at < stages.length - 1 ? stages[at + 1].name : null}
            noStages={stages.length === 0}
          />
        </section>
      ) : null}

      <section className="border-line overflow-hidden rounded-[14px] border bg-white">
        <div role="tablist" className="border-line-2 flex gap-1 overflow-x-auto border-b px-2 sm:px-4">
          {TABS.map((t) => {
            const selected = t.key === tab;
            return (
              <Link
                key={t.key}
                href={t.key === "info" ? `/cases/${record.id}` : `/cases/${record.id}?tab=${t.key}`}
                role="tab"
                aria-selected={selected}
                scroll={false}
                className={
                  "flex h-12 flex-none items-center gap-2 border-b-2 px-3 text-[13.5px] font-semibold whitespace-nowrap no-underline " +
                  (selected ? "border-brand text-brand" : "text-ink-3 border-transparent")
                }
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d={t.icon} />
                </svg>
                {t.label}
              </Link>
            );
          })}
        </div>

        <div className="px-4 py-5 sm:px-[22px]">
          {tab === "order" && local ? (
            <OrderTab
              caseId={record.id}
              surgeonName={record.surgeonName}
              forms={orderRows}
              addable={surgeon || user.siteOnly ? [] : (await addableOrderTemplates(user.space.id, record.productId))
                .filter((t) => !orderRows.some((f) => !f.withdrawnAt && f.name === t.name && f.code === t.code))
                .map((t) => ({ id: t.id, label: t.code ? `${t.name} (${t.code})` : t.name }))}
              canManage={!surgeon && !user.siteOnly}
              timeZone={timeZone}
            />
          ) : null}
          {tab === "info" && local && setup ? <LocalCaseInfo
              record={record}
              setup={setup}
              files={files}
              timeZone={timeZone}
              extras={extras}
              editHref={editHref ?? undefined}
              locked={infoLock}
              lastEdit={lastEdit ? { at: lastEdit.createdAt, by: lastEdit.actor?.name ?? lastEdit.actorEmail ?? "someone" } : null}
            /> : null}

          {tab === "info" && !local ? (
            <div className="flex flex-col gap-7">
              <h3 className="m-0 text-[15px] font-bold">Case Information</h3>

              <Group title="Case identification">
                <Value label="Case number" mono>
                  {caseNumber}
                </Value>
                <Value label="Case code" mono>
                  {record.caseCode}
                </Value>
                <Value label="Product">{record.productName}</Value>
                <Value label="Scope / application">{record.scopeName}</Value>
              </Group>

              <Group title="Clinical team">
                <Value label="Surgeon">{record.surgeonName}</Value>
                <Value label="Sales rep">
                  {record.representativeName ? (
                    <span className="bg-info-tint text-info rounded-full px-2.5 py-0.5 text-xs font-semibold">
                      {record.representativeName}
                    </span>
                  ) : null}
                </Value>
                <Value label="Hospital">{record.hospitalName}</Value>
              </Group>

              <PatientPanel
                caseId={record.id}
                initial={patientName?.trim()[0]?.toUpperCase() ?? ""}
                hasPatient={Boolean(patientName || record.patientAge || record.patientGender)}
              />

              <Group title="Scheduling & logistics">
                <Value label="Surgery date">
                  {record.surgeryDate ? fmtDate(record.surgeryDate, timeZone) : null}
                </Value>
                <Value label="Anticipated ship date">
                  {record.anticipatedShipDate ? fmtDate(record.anticipatedShipDate, timeZone) : null}
                </Value>
              </Group>
            </div>
          ) : null}

          {tab === "status" ? (
            <div className="flex flex-col gap-7">
              <div className="flex flex-col gap-1">
                <h3 className="m-0 text-[15px] font-bold">Status</h3>
                <p className="text-muted m-0 text-[13px]">
                  {local
                    ? "Opened in this app. Its stages will follow its product's workflow."
                    : "Mirrored from the 3D Surgical Platform. It changes there, and arrives here with the next sync."}
                </p>
              </div>
              <Group title={local ? "Status" : "On the platform"}>
                <Value label="Status">
                  <StatusBadge status={record.caseStatus} />
                </Value>
                <Value label="Case state">{record.caseState}</Value>
                <Value label="Priority">{record.priority}</Value>
                <Value label="Archived">{record.isArchived ? "Yes" : "No"}</Value>
              </Group>
              {local ? null : (
              <Group title="Record">
                <Value label="Created on the platform">
                  {fmtDateTime(record.platformCreatedAt, timeZone)}
                </Value>
                <Value label="First synced">{fmtDateTime(record.firstSeenAt, timeZone)}</Value>
                <Value label="Last synced">{fmtDateTime(record.lastSyncedAt, timeZone)}</Value>
                <Value label="Platform case id" mono>
                  {String(record.platformCaseId)}
                </Value>
              </Group>
              )}
            </div>
          ) : null}

          {tab === "stages" ? (
            <div className="-mx-4 -my-5 flex flex-col sm:-mx-[22px]" data-testid="case-stages">
              <div className="flex flex-col gap-0.5 px-4 py-4 sm:px-[22px]">
                <h3 className="m-0 text-[15px] font-bold">Workflow statuses</h3>
                <p className="text-muted m-0 text-[12.5px]">
                  Statuses, forms and tasks come from the product configuration. {canPlan ? "You can reassign the owner and set a due date per status." : "The case's owner or an admin can reassign the owner and set a due date per status."}
                </p>
              </div>
              {stages.length === 0 ? (
                <div className="border-field text-muted mx-4 mb-5 rounded-[12px] border border-dashed p-6 text-center text-[13px] sm:mx-[22px]">
                  This case&apos;s product has no case stages yet — set them on the Products page.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1320px] border-collapse text-[13px]" data-testid="status-table">
                    <thead>
                      <tr className="border-line-2 bg-subtle text-muted border-y text-left text-[11px] tracking-[0.6px] whitespace-nowrap uppercase">
                        <th className="w-[56px] py-3 pr-2 pl-4 font-semibold sm:pl-[22px]">#</th>
                        <th className="min-w-[160px] px-3 py-3 font-semibold">Status</th>
                        <th className="min-w-[400px] px-3 py-3 font-semibold">Quality forms</th>
                        <th className="min-w-[220px] px-3 py-3 font-semibold">Tasks</th>
                        <th className="px-3 py-3 font-semibold">Assigned to</th>
                        <th className="px-3 py-3 font-semibold">Due date</th>
                        <th className="px-3 py-3 font-semibold">Completed by</th>
                        <th className="py-3 pr-4 pl-3 font-semibold sm:pr-[22px]">Completed time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stages.map((s, i) => {
                        const done = i < at || Boolean(record.completedAt);
                        const isNow = i === at && !record.completedAt;
                        const t = times[i];
                        const mark = marks[i];
                        const approval = s.forms.length > 0 && s.formsRequired !== false;
                        const overdue = isNow && t.dueAt !== null && t.dueAt < today0;
                        // The owner: who the status is planned for; the one working on it now, when it is current.
                        const owner = mark?.ownerId ?? (isNow ? (record.assigneeId ?? "") : "");
                        return (
                          <tr key={s.id || i} id={`stage-${i + 1}`} aria-current={isNow ? "step" : undefined} className={"border-line-2 border-b align-top " + (isNow ? "bg-[#FFFCF5]" : "")}>
                            <td className="py-3.5 pr-2 pl-4 sm:pl-[22px]">
                              <span
                                className={
                                  "flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 text-[12px] font-bold " +
                                  (done ? "border-brand bg-brand text-white" : isNow ? "border-brand text-brand bg-white" : "border-[#D0D5DD] bg-white text-[#98A2B3]")
                                }
                              >
                                {done ? (
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                                  </svg>
                                ) : (
                                  i + 1
                                )}
                              </span>
                            </td>
                            <td className="px-3 py-3.5">
                              <div className="flex flex-col gap-1">
                                <span className={"text-[13.5px] font-bold " + (done || isNow ? "text-ink" : "text-ink-2")}>{s.name}</span>
                                {approval ? <span className="self-start rounded bg-[#FFFAEB] px-1.5 py-[1px] text-[10px] font-bold tracking-[0.5px] text-[#DC6803]">APPROVAL</span> : null}
                                {s.role ? <span className="text-muted text-[11.5px]">{s.role}</span> : null}
                              </div>
                            </td>
                            <td className="px-3 py-3.5">
                              {s.forms.length === 0 ? (
                                <span className="text-faint">—</span>
                              ) : (
                                <ul className="border-line m-0 flex w-[380px] list-none flex-col overflow-hidden rounded-[10px] border bg-white p-0" aria-label={`${s.name} quality forms`}>
                                  {s.forms.map((label, k) => {
                                    const tpl = templateFor(label);
                                    const own = formFor(i, tpl?.id);
                                    // A status passed before the form was put on it has no record of it.
                                    const status = own?.status ?? (done ? "Not filled" : isNow ? "In progress" : "Upcoming");
                                    const formHref = `/cases/${record.id}?tab=stages&stage=${i + 1}&form=${own?.id ?? tpl?.id ?? ""}`;
                                    const waits = tpl && status !== "Pending approval" && status !== "Approved" ? waitingFor(i, tpl) : null;
                                    const canFill = (fillState(i) === "open" && !waits) || status === "Pending approval";
                                    const icon = "text-ink-3 hover:text-brand flex h-[26px] w-[26px] flex-none items-center justify-center rounded-md hover:bg-[#FFF4ED]";
                                    return (
                                      <li
                                        key={k}
                                        data-testid={tpl ? "status-form" : undefined}
                                        className={"flex min-h-[38px] items-center gap-2 px-2.5 py-1.5 " + (k ? "border-line-2 border-t " : "") + (isNow && tpl ? "bg-[#FFFCF5]" : "")}
                                      >
                                        <span className="flex min-w-0 flex-1 flex-col">
                                          {tpl ? (
                                            <Link href={formHref} scroll={false} className="text-ink text-[12.5px] leading-[1.3] font-semibold no-underline hover:underline">
                                              {tpl.name}
                                              {tpl.code ? <span className="text-muted ml-1.5 font-mono text-[10.5px] font-normal">{tpl.code}</span> : null}
                                            </Link>
                                          ) : (
                                            <span className="text-ink-3 text-[12.5px] leading-[1.3]" title="Not found in QA Form Setup">
                                              {label} · <i>not in QA Form Setup</i>
                                            </span>
                                          )}
                                          {waits ? (
                                            <span className="text-muted text-[11px]" data-testid="form-waits">
                                              after {waits}
                                            </span>
                                          ) : null}
                                        </span>
                                        {tpl ? (
                                          <>
                                            <FormStatusPill status={status} />
                                            <span className="flex flex-none items-center">
                                              <Link href={`${formHref}&mode=view`} scroll={false} aria-label={`View ${tpl.name}`} title="View" className={icon}>
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                                  <circle cx="12" cy="12" r="3" />
                                                </svg>
                                              </Link>
                                              {canFill ? (
                                                <Link
                                                  href={`${formHref}&mode=edit`}
                                                  scroll={false}
                                                  aria-label={`Edit ${tpl.name}`}
                                                  title={status === "Approved" || status === "Pending approval" ? "Open" : "Fill / edit"}
                                                  className={isNow && status !== "Approved" ? "bg-brand flex h-[26px] w-[26px] flex-none items-center justify-center rounded-md text-white" : icon}
                                                >
                                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                    <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                                                  </svg>
                                                </Link>
                                              ) : (
                                                <span
                                                  data-testid="form-locked"
                                                  title={waits ? `Opens once "${waits}" is submitted` : fillState(i) === "upcoming" ? `Opens when the case reaches ${s.name}` : `Closed — filled while the case was at ${s.name}`}
                                                  className="text-faint flex h-[26px] w-[26px] flex-none items-center justify-center"
                                                >
                                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                    <rect x="4" y="11" width="16" height="10" rx="2" />
                                                    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                                                  </svg>
                                                  <span className="sr-only">{waits ? `Waits for ${waits}` : fillState(i) === "upcoming" ? "Opens at this status" : "Closed"}</span>
                                                </span>
                                              )}
                                              <a
                                                href={`/cases/${record.id}/forms/${own?.id ?? tpl.id}/print?stage=${i + 1}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                aria-label={`Download PDF of ${tpl.name}`}
                                                title="Download PDF"
                                                className={icon}
                                              >
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                                                </svg>
                                              </a>
                                            </span>
                                          </>
                                        ) : null}
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                            </td>
                            <td className="px-3 py-3.5">
                              {tasksAt(i).length === 0 ? (
                                <span className="text-faint">—</span>
                              ) : (
                                <ul className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="status-tasks">
                                  {tasksAt(i).map((task) => {
                                    const finished = task.status === "Done";
                                    return (
                                      <li key={task.id} className="flex items-center gap-2">
                                        <TaskCheck taskId={task.id} name={task.name} done={finished} />
                                        <Link
                                          href={`/cases/${record.id}?tab=stages&stage=${i + 1}&task=${task.id}`}
                                          scroll={false}
                                          title={finished && task.completedByName ? `Done by ${task.completedByName}` : "Open the task"}
                                          className={"text-[12.5px] no-underline hover:underline " + (finished ? "text-ink-3 line-through" : isNow ? "text-ink" : "text-[#98A2B3]")}
                                        >
                                          {task.name}
                                        </Link>
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                            </td>
                            <td className="px-3 py-3">
                              <StageOwnerSelect caseId={record.id} index={i} stageName={s.name} value={owner} people={planPeople} disabled={!canPlan || done} />
                            </td>
                            <td className="px-3 py-3">
                              <StageDueInput caseId={record.id} index={i} stageName={s.name} value={mark?.due ?? (t.dueAt ? t.dueAt.toISOString().slice(0, 10) : "")} disabled={!canPlan || done} />
                              {overdue ? <div className="text-bad mt-1 text-[11.5px] font-semibold">{dueWords(t.dueAt!, today0)}</div> : null}
                              {!mark?.due && t.dueAt && !done ? <div className="text-muted mt-1 text-[11px]">{t.planned ? "Estimated" : "From working days"}</div> : null}
                            </td>
                            <td className="text-ink-2 px-3 py-3.5">{done && t.doneBy ? t.doneBy : <span className="text-faint">—</span>}</td>
                            <td className="text-ink-3 py-3.5 pr-4 pl-3 whitespace-nowrap sm:pr-[22px]">
                              {done && t.doneAt ? fmtDateTime(t.doneAt, timeZone) : <span className="text-faint">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}

          {tab === "forms" || tab === "tasks" ? (
            <div className="flex flex-col gap-3" data-testid={tab === "forms" ? "case-forms" : "case-tasks"}>
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                  <h3 className="m-0 text-[15px] font-bold">{tab === "forms" ? "Quality Forms" : tab === "tasks" ? "Tasks" : "Status"}</h3>
                  <p className="text-muted m-0 text-[12.5px]">
                    The case stages of {record.productName ?? "its product"}
                    {record.scopeName ? ` · ${record.scopeName}` : ""} — {tab === "forms" ? "the quality forms each stage calls for" : tab === "tasks" ? "the tasks of each stage" : "each stage's tasks, quality forms and viewers"}, by stage. Open any of them from its row.
                  </p>
                </div>
              </div>
              {stages.length === 0 ? (
                <div className="border-field text-muted rounded-[12px] border border-dashed p-6 text-center text-[13px]">
                  This case&apos;s product has no case stages yet — set them on the Products page.
                </div>
              ) : (tab === "forms" && !stages.some((s) => s.forms.length)) || (tab === "tasks" && !stages.some((s) => s.tasks.length)) ? (
                <div className="border-field text-muted rounded-[12px] border border-dashed p-6 text-center text-[13px]">
                  {tab === "forms" ? "No stage of this product calls for a quality form — add them to its stages on the Products page." : "No stage of this product has tasks — add them to its stages on the Products page."}
                </div>
              ) : (
                <div className="border-line overflow-x-auto rounded-[12px] border">
                  <table className="w-full min-w-[880px] border-collapse text-[13px]" data-testid="stage-table">
                    <thead>
                      <tr className="bg-subtle text-muted text-left text-[11px] tracking-[0.6px] uppercase">
                        <th className="px-3.5 py-2.5 font-semibold">Item</th>
                        <th className="px-3 py-2.5 font-semibold">Type</th>
                        <th className="px-3 py-2.5 font-semibold">Who</th>
                        <th className="px-3 py-2.5 font-semibold">Due</th>
                        <th className="px-3 py-2.5 font-semibold">Status</th>
                        <th className="px-3 py-2.5 font-semibold">Done by</th>
                        <th className="px-3.5 py-2.5 text-right font-semibold">
                          <span className="sr-only">Open</span>
                        </th>
                      </tr>
                    </thead>
                    {stages.map((s, i) => {
                      const done = i < at || Boolean(record.completedAt);
                      const isNow = i === at && !record.completedAt;
                      const t = times[i];
                      const overdue = isNow && t.dueAt !== null && t.dueAt < today0;
                      const state = done ? "Done" : isNow ? "Current" : "Upcoming";
                      const rowCls = "border-line-2 border-t";
                      const cell = "px-3 py-2.5 align-middle";
                      const openCls = (primary: boolean) =>
                        "inline-flex h-[30px] items-center rounded-[8px] px-3 text-[12.5px] font-semibold no-underline whitespace-nowrap " +
                        (primary ? "bg-brand text-white" : "border-line text-ink-2 border bg-white");
                      // Quality Forms and Tasks list only theirs — and only the stages that have some.
                      const tasks = tab === "forms" ? [] : tasksAt(i);
                      const forms = tab === "tasks" ? [] : s.forms;
                      // Viewers are on the header's Open button and menu, not in these lists.
                      const shownViewers: NonNullable<typeof s.viewers> = [];
                      const empty = tasks.length === 0 && forms.length === 0 && shownViewers.length === 0;
                      if (empty) return null;
                      return (
                        <tbody key={s.id || i} id={`stage-${i + 1}`} aria-label={s.name}>
                          {/* The stage as a section: where it stands, its dates, who moved it on. */}
                          <tr className={"border-line border-t " + (isNow ? "bg-brand-wash" : "bg-white")} aria-current={isNow ? "step" : undefined}>
                            <td colSpan={7} className="px-3.5 py-3">
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                                <span
                                  className={
                                    "flex h-6 w-6 flex-none items-center justify-center rounded-full text-[11.5px] font-bold " +
                                    (done ? "bg-[#12B76A] text-white" : isNow ? "bg-brand text-white" : "bg-[#F2F4F7] text-[#667085]")
                                  }
                                >
                                  {i + 1}
                                </span>
                                <span className="text-ink text-[14px] font-bold">{s.name}</span>
                                <span className={"rounded-full px-2 py-0.5 text-[11px] font-semibold " + (done ? "bg-[#ECFDF3] text-[#067647]" : isNow ? "bg-white text-[#C4320A]" : "bg-[#F2F4F7] text-[#475467]")}>
                                  {state}
                                </span>
                                <span className="text-muted text-[12px]">{s.role || "Anyone"}</span>
                                <span className="flex-1" />
                                <span className="text-muted flex flex-wrap gap-x-4 gap-y-0.5 text-[12px]">
                                  <span>
                                    Started <b className="text-ink-2 font-semibold">{t.startedAt ? `${t.planned ? "≈ " : ""}${fmtDate(t.startedAt, timeZone)}` : "—"}</b>
                                  </span>
                                  <span className={overdue ? "text-bad" : ""}>
                                    Due{" "}
                                    <b className={overdue ? "font-semibold" : "text-ink-2 font-semibold"}>
                                      {t.dueAt ? `${t.planned ? "≈ " : ""}${fmtDate(t.dueAt, timeZone)}${isNow ? ` · ${dueWords(t.dueAt, today0)}` : ""}` : "not set"}
                                    </b>
                                  </span>
                                  {t.doneAt ? (
                                    <span>
                                      Moved on <b className="text-ink-2 font-semibold">{`${t.doneBy ?? "someone"} · ${fmtDateTime(t.doneAt, timeZone)}`}</b>
                                    </span>
                                  ) : null}
                                </span>
                              </div>
                            </td>
                          </tr>
                          {tasks.map((task) => (
                            <tr key={task.id} className={rowCls}>
                              <td className="py-2.5 pr-3 pl-[52px] align-middle">
                                <span className="flex items-center gap-2.5">
                                  <TaskCheck taskId={task.id} name={task.name} done={task.status === "Done"} />
                                  <span className={"font-medium " + (task.status === "Done" ? "text-ink-3 line-through" : "text-ink")}>{task.name}</span>
                                </span>
                              </td>
                              <td className={cell}>
                                <TypeTag kind="Task" />
                              </td>
                              <td className={cell + " text-ink-3"}>{task.assigneeName ?? record.assigneeName ?? (s.role || "—")}</td>
                              <td className={cell + " text-ink-3 whitespace-nowrap"}>{taskDue(task) ? fmtDate(taskDue(task)!, timeZone) : "—"}</td>
                              <td className={cell}>
                                <FormStatusPill status={task.status === "Done" ? "Approved" : isNow ? "In progress" : "Upcoming"} />
                              </td>
                              <td className={cell + " text-ink-3"}>{task.completedByName ? `${task.completedByName} · ${fmtDateTime(task.completedAt!, timeZone)}` : "—"}</td>
                              <td className="px-3.5 py-2 text-right align-middle">
                                <Link href={`/cases/${record.id}?tab=${tab}&stage=${i + 1}&task=${task.id}`} scroll={false} className={openCls(false)}>
                                  Open
                                </Link>
                              </td>
                            </tr>
                          ))}
                          {forms.map((label, k) => {
                            const tpl = templateFor(label);
                            const own = formFor(i, tpl?.id);
                            return (
                              <tr key={`f${k}`} className={rowCls}>
                                <td className="py-2.5 pr-3 pl-[52px] align-middle">
                                  <span className="flex flex-col">
                                    <span className="text-ink font-medium">{tpl?.name ?? label}</span>
                                    {tpl?.code ? <span className="text-muted font-mono text-[11.5px]">{tpl.code}</span> : null}
                                  </span>
                                </td>
                                <td className={cell}>
                                  <TypeTag kind="Quality form" />
                                </td>
                                <td className={cell + " text-ink-3"}>{s.approvers ? `Approver: ${s.approvers}` : "Any approver"}</td>
                                <td className={cell + " text-ink-3 whitespace-nowrap"}>{t.dueAt ? fmtDate(t.dueAt, timeZone) : "—"}</td>
                                <td className={cell}>
                                  <span className="flex flex-wrap items-center gap-1.5">
                                    <FormStatusPill status={own?.status ?? (done ? "Not filled" : isNow ? "In progress" : "Upcoming")} />
                                    {s.formsRequired === false ? <span className="text-muted text-[11px]">optional</span> : null}
                                  </span>
                                </td>
                                <td className={cell + " text-ink-3"}>
                                  {own?.approvedByName ? `Approved by ${own.approvedByName}` : own?.submittedByName ? `Sent by ${own.submittedByName}` : own?.savedByName ? `Saved by ${own.savedByName}` : "—"}
                                </td>
                                <td className="px-3.5 py-2 text-right align-middle">
                                  {tpl ? (
                                    <Link href={`/cases/${record.id}?tab=${tab}&stage=${i + 1}&form=${own?.id ?? tpl.id}`} scroll={false} className={openCls(isNow)}>
                                      {fillState(i) === "open" && own?.status !== "Approved" ? "Fill form" : "View form"}
                                    </Link>
                                  ) : (
                                    <span className="text-muted text-[12px]">Not in QA Form Setup</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                          {shownViewers.map((v) => {
                            const url = stageViewerUrls.get(v.viewerId) ?? "";
                            return (
                              <tr key={`v${v.viewerId}`} className={rowCls}>
                                <td className="py-2.5 pr-3 pl-[52px] align-middle">
                                  <span className="text-ink font-medium">{stageViewerNames.get(v.viewerId)}</span>
                                </td>
                                <td className={cell}>
                                  <TypeTag kind="Viewer" />
                                </td>
                                <td className={cell + " text-ink-3"}>{v.roles || "Everyone"}</td>
                                <td className={cell + " text-faint"}>—</td>
                                <td className={cell + " text-ink-3"}>{isNow ? "Shown now" : "Shown at this stage"}</td>
                                <td className={cell + " text-faint"}>—</td>
                                <td className="px-3.5 py-2 text-right align-middle">
                                  {/^https?:\/\//.test(url) ? (
                                    <a href={url} target="_blank" rel="noopener noreferrer" className={openCls(false)}>
                                      Open viewer
                                    </a>
                                  ) : (
                                    <span className="text-muted text-[12px]">No link yet</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                          {empty ? (
                            <tr className={rowCls}>
                              <td colSpan={7} className="text-muted py-2.5 pr-3 pl-[52px] text-[12.5px]">
                                No tasks, quality forms or viewers at this stage.
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      );
                    })}
                  </table>
                </div>
              )}
            </div>
          ) : null}

          {tab === "files" ? (
            <div className="flex flex-col gap-4" data-testid="case-files">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <h3 className="m-0 text-[15px] font-bold">Files</h3>
                  <p className="text-muted m-0 text-[12.5px]">Everything uploaded with this case — on its form, as its image, or added here.</p>
                </div>
                <AddCaseFiles caseId={record.id} />
              </div>
              {files.length === 0 ? (
                <div className="border-field text-muted rounded-[12px] border border-dashed p-6 text-center text-[13px]">No files yet.</div>
              ) : (
                <ul className="border-line m-0 flex list-none flex-col rounded-[12px] border p-0">
                  {files.map((f, i) => (
                    <li key={f.id} className={"flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 " + (i ? "border-line-2 border-t" : "")}>
                      {f.contentType.startsWith("image/") ? (
                        // eslint-disable-next-line @next/next/no-img-element -- a stored upload, served by the case files route
                        <img src={`/api/case-files/${f.id}`} alt="" className="border-line h-10 w-10 flex-none rounded-md border bg-white object-contain" />
                      ) : (
                        <span className="bg-[#F2F4F7] text-ink-3 flex h-10 w-10 flex-none items-center justify-center rounded-md text-[10px] font-bold uppercase">
                          {(f.name.split(".").pop() ?? "file").slice(0, 4)}
                        </span>
                      )}
                      <span className="flex min-w-[180px] flex-1 flex-col gap-0.5">
                        <a href={`/api/case-files/${f.id}`} target="_blank" rel="noopener noreferrer" className="text-brand-ink text-[13px] font-semibold underline [overflow-wrap:anywhere]">
                          {f.name}
                        </a>
                        <span className="text-muted text-[12px]">
                          {[fileSource(f.field, f.id === record.imageFileId, setup), `${Math.max(1, Math.round(f.size / 1024))} KB`].join(" · ")}
                        </span>
                      </span>
                      <span className="text-muted text-[12px]">
                        {f.uploadedByName ?? "—"} · {fmtDateTime(f.createdAt, timeZone)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {extras?.protocols.length ? (
                <div className="flex flex-col gap-2">
                  <h4 className="text-brand m-0 text-[11px] font-bold tracking-[0.8px] uppercase">Scan protocols · from the product</h4>
                  <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                    {extras.protocols.map((p) => (
                      <li key={p.id}>
                        <a href={`/api/files/${p.id}`} target="_blank" rel="noopener noreferrer" className="text-brand-ink text-[13px] font-semibold underline [overflow-wrap:anywhere]">
                          {p.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "team" ? (
            <div className="-mx-4 -my-5 sm:-mx-[22px]">
              <TeamPanel
                subject="case"
                sections={caseTeam({
                  record,
                  rolesOf: rolesOfName(await casePeople(user.space.id)),
                  stages,
                  marks,
                  forms: qaForms,
                  tasks: taskRecords,
                  parts: [...partStatus.values()],
                })}
              />
            </div>
          ) : null}

          {tab === "activity" ? (
            <div className="flex flex-col gap-3" data-testid="case-activity">
              <div className="flex flex-col gap-0.5">
                <h3 className="m-0 text-[15px] font-bold">Activity</h3>
                <p className="text-muted m-0 text-[12.5px]">Everything done to this case and its parts — newest first.</p>
              </div>
              {activity.length === 0 ? (
                <div className="border-field text-muted rounded-[12px] border border-dashed p-6 text-center text-[13px]">Nothing recorded yet.</div>
              ) : (
                <ol className="border-line m-0 flex list-none flex-col rounded-[12px] border p-0">
                  {activity.map((a, i) => (
                    <li key={a.id} className={"flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3 " + (i ? "border-line-2 border-t" : "")}>
                      <span className="text-muted w-[150px] flex-none font-mono text-[12px]">{fmtDateTime(a.createdAt, timeZone)}</span>
                      <span className="flex min-w-[200px] flex-1 flex-col gap-0.5">
                        <span className="text-ink text-[13px]">{a.summary || a.action}</span>
                        <span className="text-muted text-[12px]">
                          {a.actor?.name ?? a.actorEmail ?? "System"}
                          {a.entityType !== "case" && a.entityName ? ` · ${a.entityName}` : ""}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : null}

          {tab === "mfg" ? (
            <div className="flex flex-col gap-3.5">
              <ProductionDashboard parts={[...partStatus.values()].map((x) => ({ part: x.part, forms: x.qa.forms }))} timeZone={timeZone} now={new Date().getTime()} />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-[3px]">
                  <h3 className="m-0 text-[15px] font-bold">Part requests</h3>
                  <p className="text-muted m-0 text-[12.5px]">
                    {parts.length} {parts.length === 1 ? "part" : "parts"} · production runs through the
                    manufacturing workflows
                  </p>
                </div>
                {record.bucket !== "ARCHIVED" ? (
                  <Link
                    href={`/cases/${record.id}?tab=mfg&request=1`}
                    scroll={false}
                    className="bg-brand flex h-[38px] items-center rounded-[9px] px-[15px] text-[13px] font-semibold text-white no-underline"
                  >
                    + Request a part
                  </Link>
                ) : null}
              </div>

              {parts.length === 0 ? (
                <div className="border-field text-muted rounded-xl border border-dashed px-6 py-10 text-center text-[13px]">
                  {record.bucket === "ARCHIVED"
                    ? "No parts were requested for this case."
                    : "No parts requested yet. Use “+ Request a part” to start production for this case."}
                </div>
              ) : null}

              {parts.map((part) => {
                const stages = partStages(part);
                const due = part.dueOn ? part.dueOn.toISOString().slice(0, 10) : null;
                return (
                  <div key={part.id} className="border-line flex flex-col gap-4 rounded-xl border px-[18px] py-4">
                    <div className="flex flex-wrap items-start gap-x-3.5 gap-y-2.5">
                      <CubeChip />
                      <div className="flex min-w-[180px] flex-1 flex-col gap-1">
                        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                          <span className="text-sm font-bold">{part.name}</span>
                          <Link href={`/parts/${part.id}`} className="text-brand-ink font-mono text-xs break-all underline">
                            {part.partNumber}
                          </Link>
                        </div>
                        <div className="text-ink-3 text-[12.5px]">
                          {[part.technology, part.material, `qty ${part.quantity}`, due ? `due ${due}` : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-brand-ink text-xs font-semibold">{part.workflowName || NO_WORKFLOW}</span>
                          <SourcingTag sourcing={part.sourcing} />
                        </div>
                      </div>
                      <StagePill
                        name={stageLabel(part)}
                        stageIndex={part.stageIndex}
                        stageCount={stages.length}
                      />
                    </div>
                    {stages.length > 0 ? (
                      <Stepper stages={stages.map((s) => s.name)} current={part.stageIndex} small />
                    ) : (
                      <span className="text-muted text-[12.5px]">No production workflow yet — choose one on the part to get its stages.</span>
                    )}
                    {stages.length > 0 && partStatus.get(part.id) ? (
                      <details className="group border-line-2 -mx-[18px] -mb-4 border-t" data-testid="part-status-toggle">
                        <summary className="text-brand-ink flex cursor-pointer list-none items-center gap-1.5 px-[18px] py-2.5 text-[12.5px] font-semibold">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-open:rotate-90" aria-hidden="true">
                            <path d="m9 18 6-6-6-6" />
                          </svg>
                          Stage status, forms and owners
                        </summary>
                        <PartStatusTable part={partStatus.get(part.id)!.part} qa={partStatus.get(part.id)!.qa} people={statusPeople} timeZone={timeZone} />
                      </details>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </section>

      {recordDialog ? (
        <FormDialog
          form={recordDialog.form}
          context={recordDialog.context}
          libraries={recordDialog.libraries}
          inspection={null}
          partLine={`Case ${caseNumber}${record.productName ? ` · ${record.productName}` : ""}`}
          partId={null}
          closeHref={closeForm}
          printHref={`/cases/${record.id}/forms/${openRecord!.id}/print`}
          headerActions={{
            // Viewing: Edit opens it to fill — when it can be filled now.
            editHref:
              query.mode === "view" && openRecord!.status !== "Approved" && (fillState(openRecord!.stageIndex) === "open" || openRecord!.status === "Pending approval")
                ? `/cases/${record.id}?tab=${tab}&stage=${openRecord!.stageIndex + 1}&form=${openRecord!.id}&mode=edit`
                : null,
            pdfHref: `/cases/${record.id}/forms/${openRecord!.id}/print`,
          }}
        />
      ) : null}

      {formPanel ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-[rgba(16,24,40,.45)]" role="dialog" aria-modal="true" aria-label={formPanel.data.name} data-testid="case-form-panel">
          <Link href={closeForm} scroll={false} aria-hidden="true" tabIndex={-1} className="flex-1" />
          <div className="flex h-full w-full max-w-[920px] flex-col overflow-hidden bg-white shadow-[0_12px_32px_rgba(16,24,40,.25)]">
            <div className="bg-navy flex items-center gap-3 px-5 py-3.5 text-white">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[15px] font-bold">{formPanel.data.name}</span>
                <span className="text-navy-muted truncate text-[12px]">
                  {[caseNumber, record.productName, formPanel.stageName].filter(Boolean).join(" · ")}
                </span>
              </div>
              <span className="flex flex-none items-center gap-2" data-testid="form-panel-actions">
                <Link
                  href={`/cases/${record.id}?tab=${tab}&stage=${query.stage ?? ""}&form=${formPanel.template.id}${formPanel.mode === "edit" ? "" : "&mode=edit"}`}
                  scroll={false}
                  className="rounded-[8px] border border-white/30 px-3 py-1.5 text-[12.5px] font-semibold text-white no-underline"
                >
                  {formPanel.mode === "edit" ? "View" : "Edit"}
                </Link>
                <a
                  href={`/cases/${record.id}/forms/${formPanel.template.id}/print?stage=${query.stage ?? ""}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-[8px] border border-white/30 px-3 py-1.5 text-[12.5px] font-semibold text-white no-underline"
                >
                  Download PDF
                </a>
                <Link href={closeForm} scroll={false} className="bg-brand rounded-[8px] px-3 py-1.5 text-[12.5px] font-semibold text-white no-underline">
                  Close
                </Link>
              </span>
            </div>
            <div className="border-brand-edge bg-brand-wash text-ink-2 border-b px-5 py-2 text-[12.5px]">
              {formPanel.mode === "edit" ? (
                <>
                  <b>Edit — preview.</b> The fields open as they will to fill. Saving, submitting and approval come once you confirm.
                </>
              ) : (
                <>
                  <b>View</b> — the form with this case&apos;s details filled in.
                </>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
              <QaFormView
                meta={{
                  id: null,
                  name: formPanel.data.name,
                  code: formPanel.data.code,
                  clause: formPanel.data.clause,
                  issue: formPanel.data.issue,
                  effective: formPanel.data.effective,
                  rev: formPanel.data.rev,
                  docLayout: formPanel.data.docLayout,
                  validity: formPanel.data.validity,
                  docStyle: formPanel.data.docStyle,
                  layout: await docLayoutFor(user.space.id, formPanel.data.docStyle),
                  stageName: formPanel.stageName,
                  status: "In progress",
                }}
                sections={formPanel.data.sections}
                context={formPanel.context}
                libraries={formPanel.libraries}
                inspection={null}
                initial={emptyState()}
                partLine=""
                partId={null}
                editable={formPanel.mode === "edit"}
                canApprove={false}
                approveHint={null}
                preview
              />
            </div>
          </div>
        </div>
      ) : null}

      {taskPanel ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-[rgba(16,24,40,.45)]" role="dialog" aria-modal="true" aria-label={taskPanel.task.name} data-testid="case-task-panel">
          <Link href={closeForm} scroll={false} aria-hidden="true" tabIndex={-1} className="flex-1" />
          <div className="flex h-full w-full max-w-[520px] flex-col overflow-hidden bg-white shadow-[0_12px_32px_rgba(16,24,40,.25)]">
            <div className="bg-navy flex items-center gap-3 px-5 py-3.5 text-white">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[15px] font-bold">{taskPanel.task.name}</span>
                <span className="text-navy-muted truncate text-[12px]">{[caseNumber, record.productName, taskPanel.stage?.name].filter(Boolean).join(" · ")}</span>
              </div>
              <Link href={closeForm} scroll={false} className="rounded-[8px] border border-white/30 px-3 py-1.5 text-[12.5px] font-semibold text-white no-underline">
                Close
              </Link>
            </div>
            <div className="m-0 flex flex-1 flex-col gap-4 overflow-y-auto p-5">
              <dl className="m-0 grid grid-cols-[120px_1fr] gap-x-4 gap-y-2.5 text-[13px]">
                <dt className="text-muted">Stage</dt>
                <dd className="text-ink m-0 font-semibold">{taskPanel.stage?.name ?? "—"}</dd>
                <dt className="text-muted">Assigned to</dt>
                <dd className="text-ink m-0 font-semibold">{taskPanel.task.assigneeName ?? record.assigneeName ?? (taskPanel.stage?.role || "Unassigned")}</dd>
                <dt className="text-muted">Due</dt>
                <dd className="text-ink m-0 font-semibold">{taskPanel.due ? fmtDate(taskPanel.due, timeZone) : "—"}</dd>
                <dt className="text-muted">Status</dt>
                <dd className="text-ink m-0 font-semibold">
                  {taskPanel.task.status === "Done" ? `Done by ${taskPanel.task.completedByName ?? "—"} · ${fmtDateTime(taskPanel.task.completedAt!, timeZone)}` : "Open"}
                </dd>
              </dl>
              <TaskCheck taskId={taskPanel.task.id} name={taskPanel.task.name} done={taskPanel.task.status === "Done"} label />
              <TaskPlan
                taskId={taskPanel.task.id}
                name={taskPanel.task.name}
                assigneeId={taskPanel.task.assigneeId ?? ""}
                due={taskPanel.due ? taskPanel.due.toISOString().slice(0, 10) : ""}
                people={taskPanel.people}
              />
              <div className="text-muted text-[12px]">The case moves on from {taskPanel.stage?.name ?? "this status"} once its tasks are done and its quality forms approved.</div>
            </div>
          </div>
        </div>
      ) : null}

      {tab === "mfg" && requesting && record.bucket !== "ARCHIVED" ? (
        <RequestPart space={user.space} caseId={record.id} closeHref={`/cases/${record.id}?tab=mfg`} from="case" />
      ) : null}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3.5">
      <h4 className="text-brand m-0 text-[11px] font-bold tracking-[0.8px] uppercase">{title}</h4>
      <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function CubeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF8A5C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12" />
    </svg>
  );
}


/**
 * One of the case's form records, ready for the form dialog: its fields and
 * values, who may send and approve it — as on a part.
 */
async function caseFormDialog(
  form: Awaited<ReturnType<typeof caseForms>>[number],
  stages: Array<{ approvers?: string }>,
  user: Awaited<ReturnType<typeof requireSpaceUser>>,
  timeZone: string,
  viewOnly: boolean,
  /** Not fillable now: its status is not the case's, and it is not filled any time — or it waits for an earlier form. */
  closed = false,
  /** Why, when it is not the status. */
  closedHint?: string,
) {
  const roles = userRoleNames(user);
  const [settings, people, libraries, today] = await Promise.all([
    qaSettings(user.space.id),
    spacePeopleWithRoles(user.space.id),
    qaLibraries(user.space.id),
    spaceToday(user.space.id),
  ]);
  const record = await getCase(user.space.id, form.caseId!);
  const context = await caseContext(record!, user.space, { id: user.id, name: user.name, roles }, today, timeZone);
  const props = toFormProps(form, settings, user.id, timeZone, {
    people,
    approverRoles: (stages[form.stageIndex]?.approvers ?? "").trim(),
    userRoles: roles.join(", "),
    isAdmin: user.role === "SPACE_ADMIN",
  });
  // Its header & footer: the design it uses, as the space has it now.
  props.meta = { ...props.meta, layout: await docLayoutFor(user.space.id, form.docStyle) };
  if (viewOnly) return { form: { ...props, editable: false, canApprove: false }, context, libraries };
  if (closed) return { form: { ...props, editable: form.status === "Pending approval" && props.canApprove, approveHint: props.canApprove ? props.approveHint : (closedHint ?? props.approveHint ?? `Filled while the case is at ${form.stageName}`) }, context, libraries };
  return { form: props, context, libraries };
}

/** What a row of the Stages table is. */
function TypeTag({ kind }: { kind: "Task" | "Quality form" | "Viewer" }) {
  const tone = kind === "Task" ? "bg-[#EFF8FF] text-[#175CD3]" : kind === "Quality form" ? "bg-[#F4F3FF] text-[#5925DC]" : "bg-[#F2F4F7] text-[#344054]";
  return <span className={"rounded-md px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap " + tone}>{kind}</span>;
}

/** "in 2 days", "today", "3 days overdue". */
function dueWords(due: Date, today: Date): string {
  const days = Math.round((Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate()) - today.getTime()) / 86400000);
  if (days === 0) return "due today";
  return days > 0 ? `in ${days} day${days === 1 ? "" : "s"}` : `${-days} day${days === -1 ? "" : "s"} overdue`;
}

/** Where a case's file came from: the form field it answers, the case image, or added on the Files tab. */
function fileSource(field: string | null, isImage: boolean, setup: CaseSetup | null): string {
  if (isImage || field === "caseImage") return "Case image";
  if (!field) return "Added on the case";
  const label = setup?.forms.flatMap((f) => f.sections.flatMap((s) => s.fields)).find((x) => x.var === field)?.label;
  return label ? `Case form · ${label}` : "Case form";
}

function Value({
  label,
  mono = false,
  children,
}: {
  label: string;
  mono?: boolean;
  children: React.ReactNode;
}) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className="flex flex-col gap-1">
      <div className="text-muted text-[11px] font-semibold tracking-[0.5px] uppercase">{label}</div>
      <div className={"text-sm font-medium " + (mono ? "font-mono" : "")}>
        {empty ? <span className="text-faint">—</span> : children}
      </div>
    </div>
  );
}

/**
 * The image, viewers and scan protocols a case's product (or sub-scope)
 * carries. A viewer's button shows when the stage the case is at lists it, for
 * the roles it names (none named: everyone).
 */
async function caseExtras(spaceId: string, record: { productId: string | null; subscopeId: string | null; caseStatus: string | null }, roles: string[]) {
  if (!record.productId) return null;
  const product = await db.resource.findFirst({ where: { id: record.productId, spaceId, kind: "products" }, select: { data: true } });
  if (!product) return null;
  const catalog = readCatalog(product.data);
  const extras = extrasFor(catalog, record.subscopeId);
  const stage = caseStagesFor(catalog, record.subscopeId).find((st) => st.name.trim().toLowerCase() === (record.caseStatus ?? "").trim().toLowerCase());
  const mine = roles.map((r) => r.toLowerCase());
  const visible = extras.viewerIds.filter((vid) => {
    const entry = stage?.viewers?.find((v) => v.viewerId === vid);
    if (!entry) return false;
    const allowed = entry.roles.split(",").map((r) => r.trim().toLowerCase()).filter(Boolean);
    return allowed.length === 0 || allowed.some((r) => mine.includes(r));
  });
  const viewers = visible.length
    ? await db.resource.findMany({ where: { id: { in: visible }, spaceId, kind: "viewers", archivedAt: null }, select: { id: true, name: true, imageId: true, data: true } })
    : [];
  return {
    imageId: extras.imageId,
    protocols: extras.protocols,
    viewers: viewers.map((v) => {
      const data = (v.data ?? {}) as Record<string, unknown>;
      return { id: v.id, name: v.name, logoId: v.imageId, type: String(data.type ?? ""), url: String(data.url ?? "") };
    }),
  };
}

/** What the edit dialog starts from: the case's form and every answer it holds, by field. */
async function editState(
  spaceId: string,
  record: {
    id: string;
    caseFormId: string | null;
    productName: string | null;
    scopeName: string | null;
    priority: string | null;
    surgeryDate: Date | null;
    anticipatedShipDate: Date | null;
    surgeonName: string | null;
    hospitalName: string | null;
    patientIdEncrypted: string | null;
    details: unknown;
  },
  setup: CaseSetup,
  caseNumber: string,
) {
  const [people, hospitals, files] = await Promise.all([
    casePeople(spaceId),
    caseHospitals(spaceId),
    db.caseFile.findMany({ where: { caseId: record.id, spaceId }, select: { field: true, name: true } }),
  ]);
  const form = caseFormFor(setup, record.caseFormId);
  const answers = new Map(caseDetails(record).map((d) => [d.var, d]));
  const values: Record<string, string> = {};
  const links: Record<string, string[]> = {};
  const held: Record<string, string[]> = {};
  const byName = (list: Array<{ id: string; name: string }>, name: string | null) => (name ? (list.find((x) => x.name === name)?.id ?? "") : "");
  for (const f of form.sections.flatMap((x) => x.fields)) {
    const answer = answers.get(caseFieldVar(f));
    switch (f.key) {
      case "priority":
        values[f.id] = record.priority ?? "";
        break;
      case "surgeryDate":
        values[f.id] = record.surgeryDate ? record.surgeryDate.toISOString().slice(0, 10) : "";
        break;
      case "deliveryDate":
        values[f.id] = record.anticipatedShipDate ? record.anticipatedShipDate.toISOString().slice(0, 10) : "";
        break;
      case "surgeon":
        values[f.id] = byName(people, record.surgeonName);
        break;
      case "hospital":
        values[f.id] = byName(hospitals, record.hospitalName);
        break;
      case "patientId":
        values[f.id] = decryptSecret(record.patientIdEncrypted) ?? "";
        break;
      case "projectManager":
      case "secondarySurgeons":
      case "salesPeople":
        values[f.id] = (answer?.ids ?? (answer?.value ?? "").split(", ").map((n) => byName(people, n))).filter(Boolean).join(",");
        break;
      default:
        if (f.type === "file") {
          held[f.id] = files.filter((x) => x.field === f.var).map((x) => x.name);
          links[f.id] = (answer?.value ?? "").split(", ").filter((v) => /^https?:\/\//.test(v));
        } else if (answer) values[f.id] = answer.value;
    }
  }
  return {
    people,
    hospitals,
    edit: { caseId: record.id, caseNumber, formId: form.id, product: record.productName ?? "—", scope: record.scopeName, values, links, held },
  };
}

/** The case's trail: its own events, and those of its parts and their quality forms. */
async function caseActivity(spaceId: string, caseId: string) {
  const parts = await db.part.findMany({ where: { spaceId, caseId }, select: { id: true } });
  const partIds = parts.map((x) => x.id);
  // Its parts' forms, and the forms of its own stages.
  const forms = await db.partForm.findMany({ where: { OR: [{ partId: { in: partIds } }, { caseId }] }, select: { id: true } });
  const ids = [caseId, ...partIds, ...forms.map((f) => f.id)];
  return db.auditLog.findMany({
    where: { spaceId, entityId: { in: ids } },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: { id: true, createdAt: true, action: true, summary: true, entityType: true, entityName: true, actorEmail: true, actor: { select: { name: true } } },
  });
}
