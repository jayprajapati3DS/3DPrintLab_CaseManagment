import type { Metadata } from "next";
import Link from "next/link";

import { ChooseWorkflow, ImageSizePicker, MoveBar, PartEdit } from "@/app/(app)/parts/[id]/part-controls";
import {
  FormDialogMount,
  loadPartQa,
  Traceability,
  type PartQa,
} from "@/app/(app)/parts/[id]/qa-section";
import { FormStatusPill } from "@/components/qa/form-view";
import { BalloonDrawing } from "@/components/parts/balloons";
import { CubeChip, StagePill } from "@/components/parts/ui";
import { LockIcon, StatusTimeline } from "@/components/stages/timeline";
import { infoLockedFor, isOptionalForm } from "@/lib/resources/config";
import { seesPart } from "@/lib/sites/scope";
import { Planned } from "@/components/setup/ui";
import { assertVisible, requireSpaceUser, userRoleNames } from "@/lib/auth/rbac";
import { fmtDate, fmtDateTime } from "@/lib/format";
import {
  formsRequiredAt,
  getPart,
  partRequestForm,
  partDetails,
  partInspection,
  partStageMeta,
  partLockStages,
  partStages,
  stageLabel,
  vendorStage,
  requestOptions,
  spacePeople,
  type PartRecord,
} from "@/lib/parts/queries";
import { DetailsEditor } from "@/app/(app)/parts/[id]/details-editor";
import { TeamPanel } from "@/components/team/team-panel";
import { casePeople } from "@/lib/cases/queries";
import { partTeam, rolesOfName } from "@/lib/team";
import { PartStatusTable as StagesTable } from "@/app/(app)/parts/[id]/status-table";
import {
  drawingLabel,
  EDITABLE_ON_PART,
  fieldVar,
  IMAGE_SIZE_CLASS,
  imageSize,
  linkLabel,
  tableMinWidth,
  tableTemplate,
  type RequestField,
  type RequestSection,
} from "@/lib/parts/request-form";
import { ensurePartForms } from "@/lib/qa/queries";
import { spaceTimeZone } from "@/lib/queries/cases";
import { spaceToday } from "@/lib/resources/queries";
import { daysBetween } from "@/lib/resources/status";

export const metadata: Metadata = { title: "Part" };

const TABS = [
  { key: "info", label: "Part Information", icon: "M12 16v-4M12 8h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z" },
  { key: "stages", label: "Status", icon: "M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3" },
  { key: "forms", label: "Quality Forms", icon: "M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1zM8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2M9 13l2 2 4-4" },
  { key: "tasks", label: "Tasks", icon: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" },
  { key: "files", label: "Files", icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6" },
  { key: "team", label: "Team", icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" },
  { key: "activity", label: "Activity Log", icon: "M12 8v4l3 3M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0z" },
] as const;
const MENU_ITEM = "text-ink flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] font-medium no-underline hover:bg-subtle";
type TabKey = (typeof TABS)[number]["key"];

const GRID: Record<1 | 2 | 3, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
};

export default async function PartPage({ params, searchParams }: PageProps<"/parts/[id]">) {
  const user = await requireSpaceUser();
  const { id } = await params;
  const fetched = await getPart(user.space.id, id);
  // A site-only person (a vendor's staff) sees only the parts made at their sites.
  const found = assertVisible(fetched && seesPart(user, fetched) ? fetched : null);
  // A part requested before the space had QA templates gets its forms now.
  await ensurePartForms(found);
  const part = found;
  const query = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const qa = await loadPartQa(part);

  // "current" was the old first tab: its forms are on Status now.
  const tab: TabKey = query.tab === "current" ? "stages" : TABS.some((t) => t.key === query.tab) ? (query.tab as TabKey) : "info";
  // Its workflow may lock the part information at this stage, for everyone or some roles.
  const lockStages = await partLockStages(part);
  const infoLock = infoLockedFor(lockStages, part.stageIndex, userRoleNames(user), "part");
  const editing = tab === "info" && query.edit === "1" && !infoLock;

  const [timeZone, today] = await Promise.all([spaceTimeZone(user.space.id), spaceToday(user.space.id)]);

  const stages = partStages(part);
  const meta = partStageMeta(part);
  const last = stages.length - 1;
  // A part requested before its route was decided: no stages until a workflow is chosen.
  const noWorkflow = stages.length === 0;
  const mine = part.assigneeId === user.id;
  // A part may belong to no case; everything about the case is then absent.
  const caseNumber = part.case ? (part.case.caseNumber ?? `#${part.case.platformCaseId}`) : null;
  const due = part.dueOn ? part.dueOn.toISOString().slice(0, 10) : null;
  const inspection = partInspection(part);
  const href = (key: TabKey) => (key === "info" ? `/parts/${part.id}` : `/parts/${part.id}?tab=${key}`);
  const formsHere = qa.forms.filter((f) => f.stageIndex === part.stageIndex);
  const dialogForm = one(query.form);
  // Closing the dialog returns to the tab it was opened from.
  const closeHref = tab === "info" ? `/parts/${part.id}` : `/parts/${part.id}?tab=${tab}`;
  // The current stage: since when, and when due.
  const requestImage = part.files.find((f) => f.kind === "image");
  const startedAt = part.stageIndex > 0 && meta[part.stageIndex - 1]?.at ? new Date(meta[part.stageIndex - 1].at!) : part.createdAt;
  const stageDue = meta[part.stageIndex]?.due || due;
  const stageDueIn = stageDue ? daysBetween(today, stageDue) : null;
  // Whether this stage's forms hold the part back, as the workflow says now.
  const formsNeeded = noWorkflow ? true : await formsRequiredAt(part, part.stageIndex);

  return (
    <div className="flex flex-col gap-4">
      <Link href="/parts" className="text-ink-3 self-start text-[13px] font-semibold no-underline">
        ← Back to parts
      </Link>

      {/* Header: the part, its case, and what can be done with it. */}
      <section className="border-line flex flex-wrap items-center gap-4 rounded-[14px] border bg-white px-4 py-5 sm:px-[22px]">
        <div className="flex flex-none" data-testid="part-image">
          {requestImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- the part's picture from its request
            <img src={`/api/part-files/${requestImage.id}`} alt="" className="border-line h-16 w-16 rounded-[16px] border bg-white object-contain" />
          ) : (
            <CubeChip size={64} />
          )}
        </div>
        <div className="flex min-w-[180px] flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="m-0 text-[19px] font-bold tracking-[-0.3px]">{part.name}</h2>
            <StagePill name={stageLabel(part)} stageIndex={part.stageIndex} stageCount={stages.length} />
          </div>
          <div className="text-muted font-mono text-[12.5px] break-all">
            {(user.siteOnly
              ? [part.partNumber, part.siteName]
              : [part.partNumber, caseNumber ? `Case ${caseNumber}` : "No case", part.case?.productName, part.case?.surgeonName, part.siteName]
            )
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <div className="flex flex-none items-center gap-2.5">
          {part.caseId && !user.siteOnly ? (
            <Link href={`/cases/${part.caseId}?tab=mfg`} className="bg-navy flex h-10 items-center gap-2 rounded-[9px] px-4 text-[13px] font-semibold text-white no-underline">
              Open case {caseNumber}
            </Link>
          ) : null}
          <details className="relative">
            <summary aria-label="More actions" className="border-line text-ink-2 flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-[9px] border bg-white">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="12" cy="5" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="12" cy="19" r="1.8" />
              </svg>
            </summary>
            <div role="menu" className="border-line absolute right-0 z-30 mt-1.5 flex w-[240px] flex-col rounded-[10px] border bg-white p-1 shadow-[0_12px_32px_rgba(16,24,40,.18)]">
              {infoLock ? (
                <span role="menuitem" aria-disabled="true" title={infoLock} className={MENU_ITEM + " cursor-not-allowed opacity-50"}>
                  Edit part details — locked
                </span>
              ) : (
                <Link role="menuitem" href={`/parts/${part.id}?tab=info&edit=1`} scroll={false} className={MENU_ITEM}>
                  Edit part details
                </Link>
              )}
              {user.siteOnly ? null : (
                <Link role="menuitem" href={`/parts?request=1&copy=${part.id}`} className={MENU_ITEM}>
                  Duplicate part — new request from this one
                </Link>
              )}
              <Link role="menuitem" href={href("forms")} scroll={false} className={MENU_ITEM}>
                All quality forms
              </Link>
            </div>
          </details>
        </div>
      </section>

      {/* Status timeline: where it is, and moving it on. */}
      <section className="border-line flex flex-col gap-4 rounded-[14px] border bg-white px-4 py-5 sm:px-[22px]" aria-label="Status timeline">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
          <span className="text-[14px]">
            <b className="text-ink">Status timeline</b> <span className="text-muted">· {noWorkflow ? "no workflow yet" : `${part.workflowName} · current progress`}</span>
          </span>
          {!noWorkflow ? (
            <span className="text-muted flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]" data-testid="stage-summary">
              <span>
                Started <b className="text-ink-2">{fmtDate(startedAt, timeZone)}</b>
              </span>
              <span className={stageDueIn !== null && stageDueIn < 0 ? "text-bad" : ""}>
                Due <b>{stageDue ? `${stageDue}${stageDueIn !== null ? ` · ${stageDueIn < 0 ? `${-stageDueIn} days overdue` : stageDueIn === 0 ? "today" : `in ${stageDueIn} days`}` : ""}` : "not set"}</b>
              </span>
              <span>
                Quality forms <b className="text-ink-2">{formsHere.length ? `${formsHere.filter((f) => f.status === "Approved").length} / ${formsHere.length} approved` : "none"}</b>
              </span>
              <Link href={`${href("stages")}#stage-${part.stageIndex + 1}`} scroll={false} className="text-brand-ink font-semibold no-underline">
                Open stage ›
              </Link>
            </span>
          ) : null}
        </div>
        {!noWorkflow && formsHere.some((f) => f.status !== "Approved") && !formsNeeded && part.stageIndex < last ? (
          <span data-testid="forms-optional" className="text-muted -mt-1 text-xs">
            Not required to move on — the part can go to {stages[part.stageIndex + 1]?.name} now; this stage&apos;s forms stay on it to complete and approve.
          </span>
        ) : null}
        {noWorkflow ? <ChooseWorkflow partId={part.id} options={(await requestOptions(user.space.id)).workflows} /> : <StatusTimeline stages={lockStages} current={part.stageIndex} />}
        <MoveBar
          noWorkflow={noWorkflow}
          partId={part.id}
          assigneeName={part.assigneeName}
          mine={mine}
          prevName={part.stageIndex > 0 ? stages[part.stageIndex - 1].name : null}
          nextName={part.stageIndex < last ? stages[part.stageIndex + 1].name : null}
        />
        {part.stageIndex === vendorStage(part) ? (
          <div className="bg-warn-tint text-warn flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border border-[#FEDF89] px-3.5 py-2.5 text-[12.5px]">
            <span className="min-w-[220px] flex-1">
              <b>At the vendor{part.vendor ? ` — ${part.vendor}` : ""}.</b> It comes back through Goods Receipt: receive it on a GRN as an outsourced part, and accepting the
              line moves it on.
            </span>
            <Link href="/grn" className="text-brand-ink font-semibold no-underline">
              Go to Goods Receipt ›
            </Link>
          </div>
        ) : null}
      </section>

      <section className="border-line min-w-0 overflow-hidden rounded-[14px] border bg-white">
        <div role="tablist" aria-label="Part sections" className="border-line-2 flex gap-1 overflow-x-auto border-b px-2 sm:px-4">
          {TABS.map((t) => {
            const selected = t.key === tab;
            return (
              <Link
                key={t.key}
                href={href(t.key)}
                role="tab"
                aria-selected={selected}
                scroll={false}
                className={
                  "flex h-12 flex-none items-center gap-2 border-b-2 px-3 text-[13.5px] font-semibold whitespace-nowrap no-underline " +
                  (selected ? "border-brand text-brand" : "text-ink-3 border-transparent")
                }
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={t.icon} />
                </svg>
                {t.label}
              </Link>
            );
          })}
        </div>

        {tab === "info" ? <InfoTab part={part} qa={qa} editing={editing} infoLock={infoLock} restricted={user.siteOnly} caseNumber={caseNumber} timeZone={timeZone} space={user.space} /> : null}

        {tab === "stages" ? (
          <div className="flex flex-col" data-testid="part-status">
            <div className="flex flex-col gap-0.5 px-4 py-4 sm:px-[22px]">
              <h3 className="m-0 text-[15px] font-bold">Workflow statuses</h3>
              <p className="text-muted m-0 text-[12.5px]">Stages and their quality forms come from the production workflow. Assign an owner and set a due date per stage.</p>
            </div>
            {noWorkflow ? (
              <div className="text-muted border-line-2 mx-4 mb-5 rounded-[10px] border border-dashed px-4 py-6 text-center text-[13px] sm:mx-[22px]">
                No stages yet — they come from the production workflow, once one is chosen for this part.
              </div>
            ) : (
              <StagesTable part={part} qa={qa} people={await spacePeople(user.space.id)} timeZone={timeZone} />
            )}
          </div>
        ) : null}

        {tab === "forms" ? <PartFormsTable part={part} qa={qa} timeZone={timeZone} /> : null}

        {tab === "tasks" ? (
          <div className="p-4 sm:p-[22px]">
            <Planned phase={3} title="Tasks are coming next">
              Default tasks from the workflow&apos;s stages, and tasks assigned by hand, will be listed here for this part.
            </Planned>
          </div>
        ) : null}

        {tab === "files" ? <FilesTab part={part} timeZone={timeZone} /> : null}

        {tab === "team" ? <TeamPanel subject="part" sections={partTeam(part, qa.forms, rolesOfName(await casePeople(user.space.id)))} /> : null}

        {tab === "activity" ? (
          <div className="flex flex-col gap-3.5 p-4 sm:p-[22px]">
            <div className="flex flex-col gap-0.5">
              <h3 className="m-0 text-[15px] font-bold">Activity Log</h3>
              <p className="text-muted m-0 text-[12.5px]">Every action on this part — with who and when.</p>
            </div>
            {part.activity.length === 0 ? (
              <div className="text-muted py-6 text-center text-[13px]">No activity recorded yet for this part.</div>
            ) : (
              <ol className="m-0 flex list-none flex-col p-0">
                {part.activity.map((entry) => (
                  <li key={entry.id} className="border-line-3 flex gap-3 border-b py-3 last:border-b-0">
                    <span className="bg-brand mt-[5px] h-2 w-2 flex-none rounded-full" />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="text-[13.5px] font-bold">{entry.title}</span>
                        <span className="text-muted font-mono text-[11.5px]">{fmtDateTime(entry.createdAt, timeZone)}</span>
                      </div>
                      {entry.detail ? <span className="text-ink-2 text-[13px] break-words">{entry.detail}</span> : null}
                      <span className="text-muted text-xs">{entry.byName}</span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : null}
      </section>

      {tab === "info" && inspection && (inspection.images.length > 0 || inspection.rows.length > 0) ? (
        <section className="border-line flex flex-col gap-3.5 rounded-[14px] border bg-white p-4 sm:p-[22px]">
          <span className="text-muted text-[11px] font-bold tracking-[0.7px] uppercase">
            Inspection drawing · {inspection.images.length} drawing{inspection.images.length === 1 ? "" : "s"} ·{" "}
            {inspection.rows.length} balloon{inspection.rows.length === 1 ? "" : "s"}
          </span>
          {inspection.images.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {inspection.images.map((image, i) =>
                image.fileId ? (
                  <BalloonDrawing
                    key={image.id}
                    image={image}
                    url={`/api/part-files/${image.fileId}`}
                    points={inspection.points.filter((p) => p.imgId === image.id)}
                    label={`Drawing ${i + 1}`}
                  />
                ) : null,
              )}
            </div>
          ) : null}
          <div className="border-line-2 overflow-x-auto rounded-lg border">
            <div style={{ minWidth: tableMinWidth(inspection.columns.length) }}>
              <div
                className="border-line-2 bg-subtle text-ink-3 grid gap-1.5 border-b px-2.5 py-2 text-[10.5px] font-bold tracking-[0.4px]"
                style={{ gridTemplateColumns: tableTemplate(inspection.columns.length, false) }}
              >
                <div>Sl. No.</div>
                <div>Balloon ID</div>
                {inspection.columns.map((c) => (
                  <div key={c.id}>{c.label}</div>
                ))}
              </div>
              {inspection.rows.map((row, i) => (
                <div
                  key={row.id}
                  className="border-line-3 grid items-baseline gap-1.5 border-b px-2.5 py-2 text-[12.5px] last:border-b-0"
                  style={{ gridTemplateColumns: tableTemplate(inspection.columns.length, false) }}
                >
                  <div className="text-ink-3 font-mono">{i + 1}</div>
                  <div className="flex flex-col">
                    <span className="text-brand-ink font-mono font-bold">{row.balloon || "—"}</span>
                    <span className="text-faint text-[10px]">{drawingLabel(inspection.images, row.imgId)}</span>
                  </div>
                  {inspection.columns.map((c) => (
                    <div key={c.id} className="break-words">
                      {row.vals[c.id] || <span className="text-faint">—</span>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {dialogForm ? (
        <FormDialogMount
          part={part}
          qa={qa}
          formId={dialogForm}
          versionId={one(query.version)}
          closeHref={closeHref}
          space={user.space}
          user={user}
          today={today}
          timeZone={timeZone}
        />
      ) : null}
    </div>
  );
}

// --- Part info -----------------------------------------------------------------------------

async function InfoTab({
  part,
  qa,
  editing,
  infoLock,
  restricted,
  caseNumber,
  timeZone,
  space,
}: {
  part: PartRecord;
  qa: PartQa;
  editing: boolean;
  /** Why the information cannot be changed at its stage — or null. */
  infoLock: string | null;
  /** Site-only: no link to the case, no duplicating. */
  restricted: boolean;
  caseNumber: string | null;
  timeZone: string;
  space: { id: string; name: string; slug: string };
}) {
  const printFiles = part.files.filter((f) => f.kind === "print");
  const details = partDetails(part);
  const requestSections = (await partRequestForm(space, part.requestFormId)).sections;

  return (
    <div className="flex flex-col gap-4 p-4 sm:px-[22px] sm:py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="m-0 text-[15px] font-bold">Part Information</h3>
          <span className="text-muted text-[12.5px]">
            {editing ? "Editing production details for this part" : "As submitted in the part request form"}
          </span>
        </div>
        <div className="flex gap-2">
          {restricted ? null : (
            <Link
              href={`/parts?request=1&copy=${part.id}`}
              className="border-field text-ink flex h-9 items-center rounded-[9px] border bg-white px-3.5 text-[13px] font-semibold no-underline"
            >
              Duplicate
            </Link>
          )}
          {infoLock ? (
            <span data-testid="info-locked" title={infoLock} className="flex h-9 items-center gap-1.5 rounded-[9px] border border-[#D0D5DD] bg-[#F2F4F7] px-3.5 text-[13px] font-semibold text-[#344054]">
              <LockIcon size={13} />
              Locked
            </span>
          ) : (
          <Link
            href={editing ? `/parts/${part.id}?tab=info` : `/parts/${part.id}?tab=info&edit=1`}
            scroll={false}
            className={
              "flex h-9 items-center rounded-[9px] border px-3.5 text-[13px] font-semibold no-underline " +
              (editing ? "border-ink bg-ink text-white" : "border-field text-ink bg-white")
            }
          >
            {editing ? "Done" : "Edit"}
          </Link>
          )}
        </div>
      </div>

      <dl className="border-line-2 bg-subtle m-0 flex flex-wrap gap-x-8 gap-y-3 rounded-[10px] border px-4 py-3.5">
        <Fact label="Requested by">{part.requestedByName}</Fact>
        <Fact label="Requested on">{fmtDate(part.createdAt, timeZone)}</Fact>
        {part.requestFormName ? <Fact label="Request form">{part.requestFormName}</Fact> : null}
        <Fact label="Part ID">
          <span className="font-mono text-[13px] break-all">{part.partNumber}</span>
        </Fact>
        <Fact label="Workflow">{part.workflowName || "—"}</Fact>
        <Fact label="Made">{part.sourcing === "Outsourced" ? `Outsourced${part.vendor ? ` · ${part.vendor}` : ""}` : "In-house"}</Fact>
        <Fact label="Manufacturing site">
          {part.siteId && !restricted ? (
            <Link href={`/sites/${part.siteId}`} className="text-brand-ink underline">
              {part.siteName ?? "—"}
            </Link>
          ) : (
            (part.siteName ?? "Not set")
          )}
        </Fact>
        <Fact label="Part type">{part.partType ?? "—"}</Fact>
        <Fact label="Material">{part.material ?? "—"}</Fact>
        <Fact label="Machine">{part.printer ?? "—"}</Fact>
        <Fact label="Due date">{part.dueOn ? part.dueOn.toISOString().slice(0, 10) : "—"}</Fact>
        <Fact label="Assigned">{part.assigneeName ?? "Unassigned"}</Fact>
        <Fact label="Case">
          {part.caseId && !restricted ? (
            <Link href={`/cases/${part.caseId}?tab=mfg`} className="text-brand-ink font-mono text-[13px] underline">
              {caseNumber}
            </Link>
          ) : part.caseId ? (
            <span className="font-mono text-[13px]">{caseNumber}</span>
          ) : (
            <span className="text-muted font-medium">None</span>
          )}
        </Fact>
      </dl>

      {editing ? (
        <>
          <PartEdit
            part={{
              id: part.id,
              workflowId: part.workflowId,
              workflowName: part.workflowName,
              partType: part.partType,
              technology: part.technology,
              sourcing: part.sourcing,
              vendor: part.vendor,
              assigneeId: part.assigneeId,
              due: part.dueOn ? part.dueOn.toISOString().slice(0, 10) : null,
              printer: part.printer,
              material: part.material,
              priority: part.priority,
              notes: part.notes,
              links: part.links,
              files: printFiles.map((f) => ({ id: f.id, name: f.name, size: f.size })),
            }}
            options={await requestOptions(space.id)}
            people={await spacePeople(space.id)}
          />
          {details.length > 0 ? (
            <div className="flex flex-col gap-2">
              <span className="text-muted text-[10.5px] font-semibold tracking-[0.6px]">REQUEST DETAILS</span>
              <dl className="border-line-2 m-0 grid grid-cols-1 gap-x-6 gap-y-2.5 rounded-[10px] border px-4 py-3.5 sm:grid-cols-2">
                {details.map((d) => (
                  <div key={d.var} className="flex min-w-0 flex-col gap-0.5">
                    <dt className="text-muted text-xs">{d.label}</dt>
                    <dd className="m-0 text-[13px] font-medium break-words whitespace-pre-wrap">{d.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </>
      ) : (
        <FormView part={part} sections={requestSections} caseNumber={caseNumber} />
      )}

      {/* The request's own questions — those left for later, and corrections — in either view; not while locked. */}
      {infoLock ? null : <DetailsEditor
        partId={part.id}
        fields={requestSections
          .flatMap((sec) => sec.fields)
          .filter((f) => f.show && !f.key && EDITABLE_ON_PART.includes(f.type))
          .map((f) => ({ id: f.id, label: f.label, type: f.type, options: f.options, req: f.req, later: f.onCreate === false }))}
        values={Object.fromEntries(
          requestSections
            .flatMap((sec) => sec.fields)
            .filter((f) => !f.key)
            .map((f) => [f.id, partDetails(part).find((d) => d.var === fieldVar(f))?.value ?? ""]),
        )}
      />}

      <Traceability part={part} qa={qa} timeZone={timeZone} />
    </div>
  );
}

/** The request form as it is set up now, filled with what this part was requested with. */
function FormView({
  part,
  sections,
  caseNumber,
}: {
  part: PartRecord;
  sections: RequestSection[];
  caseNumber: string | null;
}) {
  const details = new Map(partDetails(part).map((d) => [d.var, d.value]));
  const printFiles = part.files.filter((f) => f.kind === "print");
  const inspection = partInspection(part);

  const builtIn: Record<string, string | null> = {
    case: caseNumber,
    name: part.name,
    type: part.partType,
    qty: String(part.quantity),
    workflow: part.workflowName,
    material: part.material,
    printer: part.printer,
    sourcing: part.sourcing,
    vendor: part.vendor,
    due: part.dueOn ? part.dueOn.toISOString().slice(0, 10) : null,
    priority: part.priority,
    notes: part.notes,
  };

  function text(field: RequestField): string | null {
    if (field.type === "balloon") {
      const rows = inspection?.rows.length ?? 0;
      return rows ? `${rows} characteristic${rows === 1 ? "" : "s"} — see the inspection drawing below` : null;
    }
    if (field.key in builtIn) return builtIn[field.key];
    const name = fieldVar(field);
    return name ? (details.get(name) ?? null) : null;
  }

  return (
    <div className="border-line flex flex-col gap-[18px] rounded-xl border bg-white px-4 py-[18px] sm:px-5">
      {sections.map((section) => {
        const shown = section.fields.filter((f) => f.show);
        if (shown.length === 0) return null;
        return (
          <div key={section.id} className="flex flex-col gap-2.5">
            <div className="border-line-3 text-ink border-b pb-1.5 text-[11px] font-bold tracking-[0.8px] uppercase">
              {section.title}
            </div>
            <div className={`grid gap-3 ${GRID[section.cols]}`}>
              {shown.map((field) => {
                const image =
                  field.type === "image"
                    ? part.files.find((f) => f.kind === "image" && f.field === (field.var || field.key))
                    : null;
                // A large or full-width picture takes the whole row.
                const wide =
                  field.type === "textarea" || field.type === "file" || field.type === "balloon" || (image ? ["L", "XL"].includes(imageSize(image.displaySize)) : false);
                const value = text(field);
                return (
                  <div key={field.id} className={"flex min-w-0 flex-col gap-[5px] " + (wide ? "col-span-full" : "")}>
                    <span className="text-ink-2 text-xs font-semibold">{field.label}</span>
                    {field.type === "image" ? (
                      image ? (
                        <div className="flex flex-col items-start gap-1.5">
                          {/* eslint-disable-next-line @next/next/no-img-element -- a stored image, served by the file route */}
                          <img
                            src={`/api/part-files/${image.id}`}
                            alt={field.label}
                            data-size={imageSize(image.displaySize)}
                            className={`border-line-2 bg-subtle h-auto rounded-lg border object-contain ${IMAGE_SIZE_CLASS[imageSize(image.displaySize)]}`}
                          />
                          <ImageSizePicker fileId={image.id} label={field.label} value={imageSize(image.displaySize)} />
                        </div>
                      ) : (
                        <div className="border-line-2 bg-subtle flex h-[150px] items-center justify-center overflow-hidden rounded-lg border">
                          <span className="text-faint text-[12.5px]">No image</span>
                        </div>
                      )
                    ) : field.type === "file" ? (
                      <div className="border-field flex flex-wrap gap-2 rounded-lg border border-dashed bg-[#FCFCFD] p-2">
                        {printFiles.map((f) => (
                          <a
                            key={f.id}
                            href={`/api/part-files/${f.id}`}
                            className="border-line text-ink-2 inline-flex min-h-[30px] max-w-full items-center gap-1.5 rounded-[7px] border bg-white px-2.5 py-1 text-[12.5px] font-semibold no-underline"
                          >
                            <span aria-hidden="true">⤓</span>
                            <span className="truncate">{f.name}</span>
                          </a>
                        ))}
                        {part.links.map((url) => (
                          <a
                            key={url}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-[30px] max-w-full items-center gap-1.5 rounded-[7px] border border-[#D1E0FF] bg-[#F5F8FF] px-2.5 py-1 text-[12.5px] font-semibold text-[#155EEF] no-underline"
                          >
                            <span className="truncate">Link · {linkLabel(url)}</span>
                          </a>
                        ))}
                        {printFiles.length === 0 && part.links.length === 0 ? (
                          <span className="text-faint p-1 text-[12.5px]">No files attached</span>
                        ) : null}
                      </div>
                    ) : (
                      <div
                        className={
                          "border-line-2 border-b border-dashed pt-0.5 pb-1.5 text-[13.5px] leading-[1.45] break-words whitespace-pre-wrap " +
                          (value ? "text-ink font-medium" : "text-faint")
                        }
                      >
                        {value || "—"}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Quality Forms -----------------------------------------------------------------------------

/** The part's forms, stage by stage — laid out as a case's Quality Forms tab. */
function PartFormsTable({ part, qa, timeZone }: { part: PartRecord; qa: PartQa; timeZone: string }) {
  const stages = partStages(part);
  const meta = partStageMeta(part);
  const cell = "px-3 py-2.5 align-middle";
  const openCls = (primary: boolean) =>
    "inline-flex h-[30px] items-center rounded-[8px] px-3 text-[12.5px] font-semibold no-underline whitespace-nowrap " + (primary ? "bg-brand text-white" : "border-line text-ink-2 border bg-white");
  const withForms = stages.map((s, i) => ({ s, i, forms: qa.forms.filter((f) => f.stageIndex === i) })).filter((x) => x.forms.length > 0);
  return (
    <div className="flex flex-col gap-3 p-4 sm:p-[22px]" data-testid="part-forms">
      <div className="flex flex-col gap-0.5">
        <h3 className="m-0 text-[15px] font-bold">Quality Forms</h3>
        <p className="text-muted m-0 text-[12.5px]">The quality forms each stage of {part.workflowName || "its workflow"} calls for, by stage. Open any of them from its row.</p>
      </div>
      {withForms.length === 0 ? (
        <div className="border-field text-muted rounded-[12px] border border-dashed p-6 text-center text-[13px]">
          No quality forms on this part — its workflow&apos;s stages call for none{stages.length === 0 ? ", or it has no workflow yet" : ""}.
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
            {withForms.map(({ s, i, forms }) => {
              const done = i < part.stageIndex;
              const isNow = i === part.stageIndex;
              const startedAt = i === 0 ? part.createdAt : meta[i - 1]?.at ? new Date(meta[i - 1].at!) : null;
              return (
                <tbody key={s.id ?? i} id={`stage-${i + 1}`} aria-label={s.name}>
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
                          {done ? "Done" : isNow ? "Current" : "Upcoming"}
                        </span>
                        <span className="text-muted text-[12px]">{meta[i]?.assignee ?? (s.role || "Anyone")}</span>
                        <span className="flex-1" />
                        <span className="text-muted flex flex-wrap gap-x-4 gap-y-0.5 text-[12px]">
                          {startedAt && !(i > part.stageIndex) ? (
                            <span>
                              Started <b className="text-ink-2 font-semibold">{fmtDate(startedAt, timeZone)}</b>
                            </span>
                          ) : null}
                          <span>
                            Due <b className="text-ink-2 font-semibold">{meta[i]?.due || "not set"}</b>
                          </span>
                          {meta[i]?.at ? (
                            <span>
                              Moved on <b className="text-ink-2 font-semibold">{`${meta[i].by ?? "someone"} · ${fmtDateTime(new Date(meta[i].at!), timeZone)}`}</b>
                            </span>
                          ) : null}
                        </span>
                      </div>
                    </td>
                  </tr>
                  {forms.map((f) => (
                    <tr key={f.id} className="border-line-2 border-t">
                      <td className="py-2.5 pr-3 pl-[52px] align-middle">
                        <span className="flex flex-col">
                          <span className="text-ink font-medium">{f.name}</span>
                          {f.code ? <span className="text-muted font-mono text-[11.5px]">{f.code}</span> : null}
                        </span>
                      </td>
                      <td className={cell}>
                        <span className="rounded-md bg-[#F4F3FF] px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap text-[#5925DC]">Quality form</span>
                      </td>
                      <td className={cell + " text-ink-3"}>{f.sentToName ? `Sent to ${f.sentToName}` : f.assigneeName ?? (s.approvers ? `Approver: ${s.approvers}` : "Any approver")}</td>
                      <td className={cell + " text-ink-3 whitespace-nowrap"}>{meta[i]?.due || "—"}</td>
                      <td className={cell}>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <FormStatusPill status={f.status} />
                          {s.formsRequired === false || isOptionalForm(s, f) ? <span className="text-muted text-[11px]">optional</span> : null}
                        </span>
                      </td>
                      <td className={cell + " text-ink-3"}>
                        {f.approvedByName ? `Approved by ${f.approvedByName}` : f.submittedByName ? `Sent by ${f.submittedByName}` : f.savedByName ? `Saved by ${f.savedByName}` : "—"}
                      </td>
                      <td className="px-3.5 py-2 text-right align-middle">
                        <span className="inline-flex items-center gap-1.5">
                          <Link href={`/parts/${part.id}?tab=forms&form=${f.id}`} scroll={false} className={openCls(isNow && f.status !== "Approved")}>
                            {f.status === "Approved" ? "View form" : "Fill form"}
                          </Link>
                          <a href={`/parts/${part.id}/forms/${f.id}/print`} target="_blank" rel="noopener noreferrer" aria-label={`Download PDF of ${f.name}`} className={openCls(false)}>
                            PDF
                          </a>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
    </div>
  );
}

// --- Files -------------------------------------------------------------------------------------

const FILE_KINDS: Record<string, string> = {
  print: "Print file",
  image: "Request image",
  drawing: "Inspection drawing",
  evidence: "Quality form attachment",
};

/** Everything kept with the part — print files and links, its pictures, drawings and form attachments. */
function FilesTab({ part, timeZone }: { part: PartRecord; timeZone: string }) {
  const files = part.files.filter((f) => f.kind !== "signature");
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-[22px]" data-testid="part-files">
      <div className="flex flex-col gap-0.5">
        <h3 className="m-0 text-[15px] font-bold">Files</h3>
        <p className="text-muted m-0 text-[12.5px]">Print files and links from the request, its pictures and drawings, and what was attached to its quality forms.</p>
      </div>
      {files.length === 0 && part.links.length === 0 ? (
        <div className="border-field text-muted rounded-[12px] border border-dashed p-6 text-center text-[13px]">No files yet.</div>
      ) : (
        <ul className="border-line m-0 flex list-none flex-col rounded-[12px] border p-0">
          {files.map((f, i) => (
            <li key={f.id} className={"flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 " + (i ? "border-line-2 border-t" : "")}>
              {f.contentType.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element -- a stored upload
                <img src={`/api/part-files/${f.id}`} alt="" className="border-line h-10 w-10 flex-none rounded-md border bg-white object-contain" />
              ) : (
                <span className="text-ink-3 flex h-10 w-10 flex-none items-center justify-center rounded-md bg-[#F2F4F7] text-[10px] font-bold uppercase">{(f.name.split(".").pop() ?? "file").slice(0, 4)}</span>
              )}
              <span className="flex min-w-[180px] flex-1 flex-col gap-0.5">
                <a href={`/api/part-files/${f.id}`} target="_blank" rel="noopener noreferrer" className="text-brand-ink text-[13px] font-semibold underline [overflow-wrap:anywhere]">
                  {f.name}
                </a>
                <span className="text-muted text-[12px]">{[FILE_KINDS[f.kind] ?? f.kind, `${Math.max(1, Math.round(f.size / 1024))} KB`].join(" · ")}</span>
              </span>
              <span className="text-muted text-[12px]">
                {f.uploadedByName ?? "—"} · {fmtDateTime(f.createdAt, timeZone)}
              </span>
            </li>
          ))}
          {part.links.map((url, i) => (
            <li key={url} className={"flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 " + (files.length || i ? "border-line-2 border-t" : "")}>
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-md bg-[#F5F8FF] text-[10px] font-bold text-[#155EEF]">LINK</span>
              <a href={url} target="_blank" rel="noopener noreferrer" className="min-w-[180px] flex-1 text-[13px] font-semibold text-[#155EEF] underline [overflow-wrap:anywhere]">
                {linkLabel(url)}
              </a>
              <span className="text-muted text-[12px]">Link from the request</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-[3px]">
      <dt className="text-muted text-[10.5px] font-semibold tracking-[0.6px] uppercase">{label}</dt>
      <dd className="m-0 text-[13.5px] font-semibold">{children}</dd>
    </div>
  );
}
