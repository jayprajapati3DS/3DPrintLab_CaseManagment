import Link from "next/link";
import { notFound } from "next/navigation";

import { ArchiveButton } from "@/components/setup/archive-button";
import { DocumentsBlock, type DocumentRow } from "@/components/setup/documents-block";
import { LotsBlock, type LotRow } from "@/components/setup/lots-block";
import { OverviewForm, type OverviewOptions } from "@/components/setup/overview-form";
import { getIdRule } from "@/lib/resources/id-queries";
import { spaceRoles } from "@/lib/auth/roles";
import { ScheduleBlock, type RecordRow, type ScheduleItemRow } from "@/components/setup/schedule-block";
import { Pill, S_TD, S_TH, SectionCard } from "@/components/setup/ui";
import { BuildHistory, LiveStatus, UsageRecords } from "@/components/setup/usage-records";
import { CalibrationFacts, ItemReceipts, StockFacts, SupplierReceipts } from "@/components/setup/receipts";
import { HospitalTeam } from "@/components/setup/hospital-team";
import { SiteEquipment } from "@/components/sites/site-equipment";
import { SiteMembers } from "@/components/sites/site-members";
import { ProductEditor } from "@/components/setup/product-editor";
import { readDepartments } from "@/lib/cases/hospitals";
import { WorkflowEditor } from "@/components/setup/workflow-editor";
import { readCatalog } from "@/lib/cases/catalog";
import { canManageSpace, requireSpaceUser, ROLE_LABELS, userRoleNames } from "@/lib/auth/rbac";
import { newResourceDraft } from "@/lib/resources/actions";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { spaceTimeZone } from "@/lib/queries/cases";
import { templateLabel } from "@/lib/qa/template";
import {
  KINDS,
  kindForRoute,
  NEW_ID,
  tabLabel,
  TRACK_OF_TAB,
  type ResourceKind,
  type TabKey,
  type Track,
  type WorkflowData,
} from "@/lib/resources/config";
import {
  detailToView,
  getResource,
  iso,
  listResources,
  listTechnologies,
  resourceOptions,
  spaceToday,
  suppliedItems,
  toItemView,
  type ResourceDetail,
} from "@/lib/resources/queries";
import {
  alertsFor,
  daysBetween,
  effectiveStatus,
  fmtQty,
  itemStatus,
  listCells,
  materialStock,
  relativeDue,
  type Tone,
} from "@/lib/resources/status";

export const dynamic = "force-dynamic";

/** One record of master data: a machine, a material, a supplier, a workflow… */
export default async function ResourceDetailPage({ params, searchParams }: PageProps<"/[section]/[id]">) {
  const user = await requireSpaceUser();
  const { section, id } = await params;

  const kind = kindForRoute(`/${section}`);
  if (!kind) notFound();
  const config = KINDS[kind];

  // Opened from "Add": nothing is stored until the first save.
  if (id === NEW_ID) {
    if (!canManageSpace(user)) notFound();
    return <NewResource kind={kind} spaceId={user.space.id} />;
  }

  const resource = await getResource(user.space.id, kind, id);
  if (!resource) notFound();

  const archived = Boolean(resource.archivedAt);
  const canEdit = canManageSpace(user) && !archived;
  const canRecord = !archived;
  const today = await spaceToday(user.space.id);
  const name = resource.name || config.newName;

  const back = (
    <Link
      href={archived ? `${config.route}?view=archived` : config.route}
      className="text-ink-3 self-start text-[13px] font-semibold no-underline"
    >
      ‹ Back to list
    </Link>
  );

  const archivedBanner = archived ? (
    <div className="bg-chip text-ink-2 border-field rounded-[12px] border px-4 py-3 text-[13px] leading-[1.5]">
      <strong>Archived</strong> on {iso(resource.archivedAt)} by {resource.archivedByName} — {resource.archiveReason}.
      This record is read-only. Restore it from the Archived list to change it.
    </div>
  ) : null;

  // --- Workflows have their own editor ------------------------------------------
  if (kind === "workflows") {
    const data = resource.data as unknown as WorkflowData;
    const [technologies, templates, roles, siteRows] = await Promise.all([
      listTechnologies(user.space.id),
      db.qaTemplate.findMany({ where: { spaceId: user.space.id, usedFor: { in: ["manufacturing", "generic"] } }, orderBy: { createdAt: "asc" }, select: { name: true, code: true } }),
      spaceRoles(user.space.id),
      db.resource.findMany({ where: { spaceId: user.space.id, kind: "sites", archivedAt: null, NOT: { name: "" } }, orderBy: { name: "asc" }, select: { id: true, name: true, data: true } }),
    ]);
    const siteList = siteRows.map((x) => ({ id: x.id, name: x.name, type: String(((x.data ?? {}) as { type?: string }).type ?? "In-house") }));
    return (
      <div className="flex flex-col gap-4">
        {back}
        {archivedBanner}
        <WorkflowEditor
          // Remount after a save, so the editor starts again from what was stored.
          key={resource.updatedAt.toISOString()}
          id={resource.id}
          initialName={resource.name}
          initialMethod={data.method ?? ""}
          initialStages={data.stages ?? []}
          technologies={technologies.map((t) => t.name)}
          forms={templates.map(templateLabel)}
          roles={roles}
          canEdit={canEdit}
          sites={siteList}
          initialSourcing={data.sourcing === "Outsourced" ? "Outsourced" : "In-house"}
          initialSiteIds={data.siteIds ?? []}
          initialSiteId={data.siteId ?? ""}
        />
      </div>
    );
  }

  // --- Products: edited like a workflow, with case stages (or sub-scopes, each with its own)
  if (kind === "products") {
    return (
      <div className="flex flex-col gap-4">
        {back}
        {archivedBanner}
        <ProductEditor
          key={resource.updatedAt.toISOString()}
          id={resource.id}
          initialName={resource.name}
          initialStatus={resource.status}
          initial={readCatalog(resource.data)}
          canEdit={canEdit}
          history={await productHistory(user.space.id, resource.id)}
          {...await catalogEditorProps(user.space.id)}
        />
      </div>
    );
  }

  // --- Everything else -----------------------------------------------------------
  const view = detailToView(resource);
  const status = effectiveStatus(view, today);
  const alerts = alertsFor(view, today);
  const { id: idLine } = listCells(view, today);

  const rawTab = (await searchParams).tab;
  const tab: TabKey = config.tabs.includes(rawTab as TabKey) ? (rawTab as TabKey) : "overview";

  const freeDocs = resource.documents.filter((d) => d.kind !== "Photo");
  const counts: Partial<Record<TabKey, string>> = {
    lots: String(resource.lots.length),
    maint: String(resource.scheduleItems.filter((i) => i.track === "maintenance").length),
    qual: String(resource.scheduleItems.filter((i) => i.track === "qualification").length),
    docs: String(freeDocs.length),
  };

  return (
    <div className="flex flex-col gap-4">
      {back}
      {archivedBanner}

      <section className="border-line flex min-w-0 flex-col rounded-[14px] border bg-white">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 px-4 pt-[18px] pb-3.5 sm:px-[22px]">
          <div className="flex min-w-[160px] flex-1 flex-col gap-1">
            <span className="text-brand-ink text-[11px] font-bold tracking-[0.8px]">{config.eyebrow}</span>
            <h2 className="m-0 truncate text-base font-bold">{name}</h2>
            {idLine ? <span className="text-muted font-mono text-xs">{idLine}</span> : null}
          </div>
          {status.label ? <Pill tone={status.tone}>{status.label}</Pill> : null}
          {canEdit ? <ArchiveButton resourceId={resource.id} name={name} /> : null}
        </div>

        <div role="tablist" className="border-line-2 flex gap-1 overflow-x-auto border-t px-2 sm:px-4">
          {config.tabs.map((t) => {
            const on = t === tab;
            return (
              <Link
                key={t}
                href={t === "overview" ? `${config.route}/${resource.id}` : `${config.route}/${resource.id}?tab=${t}`}
                role="tab"
                aria-selected={on}
                scroll={false}
                className={
                  "flex h-[42px] flex-none items-center gap-1.5 border-b-2 px-3 text-[13px] font-semibold whitespace-nowrap no-underline " +
                  (on ? "border-brand text-brand-ink" : "text-ink-3 border-transparent")
                }
              >
                {tabLabel(config, t)}
                {counts[t] !== undefined ? (
                  <span className="bg-chip text-ink-3 rounded-full px-1.5 py-px text-[10.5px]">{counts[t]}</span>
                ) : null}
              </Link>
            );
          })}
        </div>
      </section>

      {!archived && alerts[0] ? (
        <div
          role="status"
          className={
            "rounded-[12px] border px-4 py-3 text-[13px] leading-[1.5] " +
            (alerts[0].critical
              ? "bg-bad-tint text-bad border-[#FECDCA]"
              : "bg-warn-tint text-warn border-[#FEDF89]")
          }
        >
          {alerts[0].text}
          {alerts.length > 1 ? ` · and ${alerts.length - 1} more` : ""}
        </div>
      ) : null}

      {tab === "overview" && (kind === "materials" || kind === "components" || kind === "packaging") ? (
        <StockFacts view={view} lots={resource.lots} />
      ) : null}
      {tab === "overview" && kind === "measuring" ? (
        <CalibrationFacts resourceId={resource.id} timeZone={await spaceTimeZone(user.space.id)} />
      ) : null}
      {tab === "overview" ? (
        <Overview resource={resource} kind={kind} spaceId={user.space.id} canEdit={canEdit} />
      ) : null}

      {/* A manufacturing site: what is there, and who works there. */}
      {tab === "equipment" && kind === "sites" ? <SiteEquipment spaceId={user.space.id} siteId={resource.id} canEdit={canEdit && !archived} /> : null}
      {tab === "members" && kind === "sites" ? (
        <SiteMembers
          siteId={resource.id}
          siteName={name}
          canEdit={canEdit && !archived}
          people={(
            await db.user.findMany({
              where: { spaceId: user.space.id, isActive: true, isSuperAdmin: false },
              orderBy: { name: "asc" },
              select: { id: true, name: true, email: true, role: true, platformRoleName: true, siteOnly: true, siteIds: true, passwordHash: true, platformUserId: true },
            })
          ).map((p) => ({
            id: p.id,
            name: p.name,
            email: p.email,
            role: p.platformRoleName || ROLE_LABELS[p.role],
            isAdmin: p.role === "SPACE_ADMIN",
            siteOnly: p.siteOnly,
            local: Boolean(p.passwordHash) && !p.platformUserId,
            member: p.siteIds.includes(resource.id),
          }))}
        />
      ) : null}

      {tab === "receipts" && kind === "vendors" ? (
        <SupplierReceipts spaceId={user.space.id} vendorId={resource.id} timeZone={await spaceTimeZone(user.space.id)} />
      ) : null}
      {tab === "receipts" && kind !== "vendors" ? (
        <ItemReceipts
          spaceId={user.space.id}
          resource={{ id: resource.id, kind }}
          lotIds={resource.lots.map((l) => l.id)}
          canReceive={canRecord}
          timeZone={await spaceTimeZone(user.space.id)}
        />
      ) : null}

      {tab === "maint" || tab === "qual" ? (
        <Schedule
          resource={resource}
          track={TRACK_OF_TAB[tab]!}
          label={tabLabel(config, tab)}
          hint={config.hints?.[TRACK_OF_TAB[tab]!] ?? ""}
          canEdit={canEdit}
          canRecord={canRecord}
          today={today}
          userName={user.name}
        />
      ) : null}

      {tab === "lots" ? (
        <Lots resource={resource} spaceId={user.space.id} canEdit={canEdit} canAdjust={canRecord} today={today} />
      ) : null}

      {tab === "supplied" ? <Supplied spaceId={user.space.id} vendor={{ id: resource.id, name: resource.name }} /> : null}

      {tab === "usage" ? (
        <UsageRecords
          spaceId={user.space.id}
          // A material is used through its lots.
          itemIds={[resource.id, ...resource.lots.map((l) => l.id)]}
          noun={config.noun}
          timeZone={await spaceTimeZone(user.space.id)}
        />
      ) : null}

      {tab === "history" ? (
        <BuildHistory spaceId={user.space.id} machine={{ id: resource.id, name: resource.name }} timeZone={await spaceTimeZone(user.space.id)} />
      ) : null}

      {tab === "docs" ? (
        <DocumentsBlock
          resourceId={resource.id}
          canUpload={canRecord}
          canRemove={canEdit}
          documents={freeDocs.map(
            (d): DocumentRow => ({
              id: d.id,
              name: d.name,
              kind: d.kind,
              source: d.record
                ? `${d.record.track === "maintenance" ? tabLabel(config, "maint") : tabLabel(config, "qual")} · ${d.record.itemName}`
                : "Uploaded in Documents",
              date: iso(d.createdAt) ?? "",
              sizeLabel: `${Math.max(1, Math.round(d.size / 1024))} KB`,
              linked: Boolean(d.recordId),
            }),
          )}
        />
      ) : null}
    </div>
  );
}

// --- Overview ---------------------------------------------------------------------

/** What the Overview form's dropdowns offer, and how the kind's ID is made. */
async function overviewSetup(spaceId: string, kind: ResourceKind) {
  const config = KINDS[kind];
  const refKinds = [...new Set(config.fields.map((f) => f.ref).filter((k): k is ResourceKind => Boolean(k)))];
  const suggestKinds = [...new Set(config.fields.map((f) => f.suggest).filter((k): k is ResourceKind => Boolean(k)))];

  const [technologies, refLists, suggestLists, idRule] = await Promise.all([
    listTechnologies(spaceId),
    Promise.all(refKinds.map((k) => resourceOptions(spaceId, k))),
    Promise.all(suggestKinds.map((k) => resourceOptions(spaceId, k))),
    getIdRule(spaceId, kind),
  ]);

  const options: OverviewOptions = {
    technologies: technologies.map((t) => t.name),
    refs: Object.fromEntries(refKinds.map((k, i) => [k, refLists[i]])),
    suggestions: Object.fromEntries(suggestKinds.map((k, i) => [k, suggestLists[i].map((r) => r.name).filter(Boolean)])),
  };
  return { options, idRule };
}

/** "Created on … by …" and "Last updated on … by …", from the audit trail. */
async function productHistory(spaceId: string, resourceId: string) {
  const [timeZone, created, updated] = await Promise.all([
    spaceTimeZone(spaceId),
    db.auditLog.findFirst({ where: { spaceId, entityId: resourceId, action: "resource.create" }, orderBy: { createdAt: "asc" }, select: { createdAt: true, actorEmail: true, actor: { select: { name: true } } } }),
    db.auditLog.findFirst({ where: { spaceId, entityId: resourceId, action: "resource.update" }, orderBy: { createdAt: "desc" }, select: { createdAt: true, actorEmail: true, actor: { select: { name: true } } } }),
  ]);
  const who = (row: { actorEmail: string | null; actor: { name: string } | null }) => row.actor?.name ?? row.actorEmail ?? "someone";
  return {
    created: created ? `Created on ${fmtDateTime(created.createdAt, timeZone)} by ${who(created)}` : null,
    updated: updated ? `Last updated on ${fmtDateTime(updated.createdAt, timeZone)} by ${who(updated)}` : "Not updated since",
  };
}

/** A hospital's departments and the people who work there. */
async function HospitalTeamBlock({ spaceId, hospitalId, data, canEdit }: { spaceId: string; hospitalId: string; data: unknown; canEdit: boolean }) {
  const users = await db.user.findMany({
    where: { spaceId, isActive: true },
    select: { id: true, name: true, role: true, platformRoleName: true, hospitalIds: true },
    orderBy: { name: "asc" },
  });
  return (
    <HospitalTeam
      hospitalId={hospitalId}
      initialDepartments={readDepartments(data)}
      initialPeople={users.filter((u) => u.hospitalIds.includes(hospitalId)).map((u) => u.id)}
      everyone={users.map((u) => ({ id: u.id, name: u.name, roles: userRoleNames(u).join(", ") }))}
      canEdit={canEdit}
    />
  );
}

/** What the product editor offers: manufacturing workflows, viewers, QA forms, roles. */
async function catalogEditorProps(spaceId: string) {
  const [rows, viewers, templates, roles, products, orderTemplates] = await Promise.all([
    db.resource.findMany({ where: { spaceId, kind: "workflows", archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.resource.findMany({ where: { spaceId, kind: "viewers", archivedAt: null, NOT: { status: "Inactive" } }, select: { id: true, name: true, data: true }, orderBy: { name: "asc" } }),
    db.qaTemplate.findMany({ where: { spaceId, usedFor: { in: ["product", "generic"] } }, orderBy: { createdAt: "asc" }, select: { name: true, code: true } }),
    spaceRoles(spaceId),
    db.resource.findMany({ where: { spaceId, kind: "products", archivedAt: null }, select: { data: true } }),
    db.qaTemplate.findMany({ where: { spaceId, usedFor: { in: ["order", "generic"] } }, orderBy: { createdAt: "asc" }, select: { name: true, code: true } }),
  ]);
  return {
    orderForms: orderTemplates.map(templateLabel),
    workflows: rows,
    allTags: [...new Set(products.flatMap((x) => readCatalog(x.data).tags))].sort((a, b) => a.localeCompare(b)),
    viewers: viewers.map((v) => ({ id: v.id, name: v.name, type: String(((v.data ?? {}) as Record<string, unknown>).type ?? "") })),
    forms: templates.map(templateLabel),
    roles,
  };
}

/**
 * A record opened from "Add", not saved yet: its Overview form only — the
 * other tabs need a stored record. Saving creates it and opens it.
 */
async function NewResource({ kind, spaceId }: { kind: ResourceKind; spaceId: string }) {
  const config = KINDS[kind];
  const draft = await newResourceDraft(kind);
  const back = (
    <Link href={config.route} className="text-ink-3 self-start text-[13px] font-semibold no-underline">
      ‹ Back to list
    </Link>
  );
  const note = (
    <div data-testid="not-saved" className="border-brand-edge bg-brand-wash text-ink-2 rounded-[12px] border px-4 py-3 text-[13px] leading-[1.5]">
      <strong>Not saved yet.</strong> Nothing is added until you save — leave this page to cancel.
      {kind === "workflows" || kind === "products" ? null : " Documents, history and the other tabs open once it is saved."}
    </div>
  );

  if (kind === "workflows") {
    const data = draft.data as unknown as WorkflowData;
    const [technologies, templates, roles, siteRows] = await Promise.all([
      listTechnologies(spaceId),
      db.qaTemplate.findMany({ where: { spaceId, usedFor: { in: ["manufacturing", "generic"] } }, orderBy: { createdAt: "asc" }, select: { name: true, code: true } }),
      spaceRoles(spaceId),
      db.resource.findMany({ where: { spaceId, kind: "sites", archivedAt: null, NOT: { name: "" } }, orderBy: { name: "asc" }, select: { id: true, name: true, data: true } }),
    ]);
    const siteList = siteRows.map((x) => ({ id: x.id, name: x.name, type: String(((x.data ?? {}) as { type?: string }).type ?? "In-house") }));
    return (
      <div className="flex flex-col gap-4">
        {back}
        {note}
        <WorkflowEditor
          id={NEW_ID}
          initialName=""
          initialMethod={data.method ?? ""}
          initialStages={data.stages ?? []}
          technologies={technologies.map((t) => t.name)}
          forms={templates.map(templateLabel)}
          roles={roles}
          canEdit
          sites={siteList}
        />
      </div>
    );
  }

  if (kind === "products") {
    return (
      <div className="flex flex-col gap-4">
        {back}
        {note}
        <ProductEditor
          id={NEW_ID}
          initialName=""
          initialStatus="Active"
          initial={readCatalog({})}
          canEdit
          {...await catalogEditorProps(spaceId)}
        />
      </div>
    );
  }

  const { options, idRule } = await overviewSetup(spaceId, kind);
  return (
    <div className="flex flex-col gap-4">
      {back}
      {note}
      <section className="border-line min-w-0 rounded-[14px] border bg-white">
        <div className="flex flex-col gap-1 px-4 pt-[18px] pb-3.5 sm:px-[22px]">
          <span className="text-brand-ink text-[11px] font-bold tracking-[0.8px]">{config.eyebrow}</span>
          <h2 className="m-0 truncate text-base font-bold">{config.newName}</h2>
        </div>
        <div className="border-line-2 border-t px-4 py-5 sm:px-[22px]">
          <OverviewForm
            resourceId={NEW_ID}
            kind={kind}
            name=""
            status={draft.status}
            data={draft.data}
            options={options}
            canEdit
            photoUrl={null}
            idRule={idRule}
          />
        </div>
      </section>
    </div>
  );
}

async function Overview({
  resource,
  kind,
  spaceId,
  canEdit,
}: {
  resource: ResourceDetail;
  kind: ResourceKind;
  spaceId: string;
  canEdit: boolean;
}) {
  const { options, idRule } = await overviewSetup(spaceId, kind);

  return (
    <div className="flex flex-col gap-4">
      <section className="border-line min-w-0 rounded-[14px] border bg-white px-4 py-5 sm:px-[22px]">
        <OverviewForm
          // Remount when the stored record changes, so the fields show it.
          key={resource.updatedAt.toISOString()}
          resourceId={resource.id}
          kind={kind}
          name={resource.name}
          status={resource.status}
          data={(resource.data ?? {}) as Record<string, unknown>}
          options={options}
          canEdit={canEdit}
          photoUrl={resource.imageId ? `/api/files/${resource.imageId}` : null}
          idRule={idRule}
        />
      </section>

      {kind === "hospitals" ? <HospitalTeamBlock spaceId={spaceId} hospitalId={resource.id} data={resource.data} canEdit={canEdit} /> : null}
      {kind === "printers" ? <QualifiedOperators spaceId={spaceId} machine={resource.name} /> : null}
      {kind === "printers" ? <LiveStatus spaceId={spaceId} machine={resource.name} /> : null}
      {kind === "materials" ? <ValidatedOn spaceId={spaceId} material={resource.name} /> : null}
    </div>
  );
}

/** People whose "Qualified for" names this machine. */
async function QualifiedOperators({ spaceId, machine }: { spaceId: string; machine: string }) {
  const today = await spaceToday(spaceId);
  const operators = machine.trim()
    ? (await listResources(spaceId, "operators")).filter(({ view }) =>
        String(view.data.qualifiedFor ?? "").toLowerCase().includes(machine.trim().toLowerCase()),
      )
    : [];

  return (
    <SectionCard
      title="Qualified operators"
      hint="Taken from Operator Qualifications: everyone whose “Qualified for” names this machine."
      action={
        <Link href="/operators" className="text-brand-ink text-[12.5px] font-semibold whitespace-nowrap no-underline">
          Manage people in Operator Qualifications ›
        </Link>
      }
    >
      <div className="border-line overflow-x-auto rounded-[10px] border">
        <table className="w-full min-w-[640px] border-collapse">
          <thead className="bg-subtle">
            <tr>
              {["Person", "Role", "Requalification", "Status"].map((h) => (
                <th key={h} className={S_TH}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {operators.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-muted px-3 py-8 text-center text-[13px]">
                  No qualified operators for this machine yet — add its name to a person&rsquo;s
                  &ldquo;Qualified for&rdquo;.
                </td>
              </tr>
            ) : null}
            {operators.map(({ row, view }) => {
              const status = effectiveStatus(view, today);
              const { cells } = listCells(view, today);
              return (
                <tr key={row.id}>
                  <td className={S_TD}>
                    <Link href={`/operators/${row.id}`} className="text-ink font-semibold no-underline">
                      {row.name}
                    </Link>
                    <span className="text-muted block font-mono text-[11.5px]">{String(view.data.empId ?? "")}</span>
                  </td>
                  <td className={S_TD}>{String(view.data.role ?? "")}</td>
                  <td className={S_TD}>
                    <span className="font-mono text-[12.5px]">{cells[2].main}</span>
                    {cells[2].sub ? <span className="text-muted block text-[11.5px]">{cells[2].sub}</span> : null}
                  </td>
                  <td className={S_TD}>
                    <Pill tone={status.tone} small>
                      {status.label}
                    </Pill>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

/** Parameter sets that name this material, and the machine each is for. */
async function ValidatedOn({ spaceId, material }: { spaceId: string; material: string }) {
  const today = await spaceToday(spaceId);
  const sets = material.trim()
    ? (await listResources(spaceId, "params")).filter(
        ({ view }) => String(view.data.material ?? "").trim().toLowerCase() === material.trim().toLowerCase(),
      )
    : [];

  return (
    <SectionCard title="Validated on machines" hint="From the process parameter sets that name this material.">
      {sets.length === 0 ? (
        <p className="text-muted m-0 text-[13px]">Not validated on any machine yet.</p>
      ) : (
        <div className="flex flex-col">
          {sets.map(({ row, view }) => {
            const status = effectiveStatus(view, today);
            return (
              <Link
                key={row.id}
                href={`/params/${row.id}`}
                className="border-line-3 text-ink grid grid-cols-1 items-center gap-x-3 gap-y-1 border-t sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_150px] py-2.5 text-[13px] no-underline first:border-t-0"
              >
                <span className="font-semibold">{String(view.data.machine ?? "—")}</span>
                <span className="text-ink-2 truncate">
                  {row.name} · <span className="font-mono text-[12.5px]">{String(view.data.code ?? "")}</span>
                </span>
                <span>
                  <Pill tone={status.tone} small>
                    {status.label}
                  </Pill>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

// --- Schedules ---------------------------------------------------------------------

function Schedule({
  resource,
  track,
  label,
  hint,
  canEdit,
  canRecord,
  today,
  userName,
}: {
  resource: ResourceDetail;
  track: Track;
  label: string;
  hint: string;
  canEdit: boolean;
  canRecord: boolean;
  today: string;
  userName: string;
}) {
  const items: ScheduleItemRow[] = resource.scheduleItems
    .filter((i) => i.track === track)
    .map((i) => {
      const item = toItemView(i);
      const status = itemStatus(item, today);
      return {
        id: item.id,
        name: item.name,
        dueOn: item.dueOn,
        repeatMonths: item.repeatMonths,
        lastDoneOn: item.lastDoneOn,
        lastResult: item.lastResult,
        status: { label: status.label, tone: status.tone },
        relative: status.days === null ? null : relativeDue(status.days),
      };
    });

  const records: RecordRow[] = resource.records
    .filter((r) => r.track === track)
    .map((r) => ({
      id: r.id,
      doneOn: iso(r.doneOn)!,
      itemName: r.itemName,
      doneBy: r.doneBy,
      recordedBy: r.recordedByName,
      result: r.result,
      ref: r.ref,
      note: r.note,
      changeControl: !r.affectsValidation
        ? null
        : r.reviewOutcome
          ? { pending: false, outcome: r.reviewOutcome, by: r.reviewedByName ?? "" }
          : { pending: true },
      documents: r.documents.map((d) => ({ id: d.id, name: d.name })),
    }));

  // Reviews are raised by maintenance and answered on the qualification tab.
  const reviews =
    track === "qualification"
      ? resource.records
          .filter((r) => r.affectsValidation && !r.reviewOutcome)
          .map((r) => ({ recordId: r.id, itemName: r.itemName, doneOn: iso(r.doneOn)!, note: r.note }))
      : [];

  return (
    <ScheduleBlock
      resourceId={resource.id}
      track={track}
      label={label}
      hint={hint}
      items={items}
      records={records}
      reviews={reviews}
      canEdit={canEdit}
      canRecord={canRecord}
      today={today}
      userName={userName}
    />
  );
}

// --- Lots ----------------------------------------------------------------------------

async function Lots({
  resource,
  spaceId,
  canEdit,
  canAdjust,
  today,
}: {
  resource: ResourceDetail;
  spaceId: string;
  canEdit: boolean;
  canAdjust: boolean;
  today: string;
}) {
  const view = detailToView(resource);
  const { quantity, received, threshold, unit } = materialStock(view);
  const suppliers = (await resourceOptions(spaceId, "vendors")).filter((v) => v.name);

  const lots: LotRow[] = resource.lots.map((lot) => {
    const expiresOn = iso(lot.expiresOn);
    const remaining = Number(lot.remaining);
    let expiry: LotRow["expiry"] = null;
    if (remaining <= 0) expiry = { label: "Used up", tone: "grey" };
    else if (expiresOn) {
      const days = daysBetween(today, expiresOn);
      if (days < 0) expiry = { label: "Expired", tone: "red" };
      else if (days <= 60) expiry = { label: `Expires in ${days} days`, tone: "amber" };
    }
    return {
      id: lot.id,
      lotNumber: lot.lotNumber,
      supplierLot: lot.supplierLot,
      remaining,
      received: Number(lot.received),
      receivedOn: iso(lot.receivedOn),
      supplier: lot.supplier,
      coa: lot.coa,
      expiresOn,
      expiry,
      adjustments: lot.adjustments.map((a) => ({
        quantity: Number(a.quantity),
        reason: a.reason,
        by: a.byName,
        date: iso(a.createdAt) ?? "",
      })),
      grn: lot.grnId && lot.grnNumber ? { id: lot.grnId, number: lot.grnNumber } : null,
      // Only opening stock entered in error can be removed; a received lot is the receipt's.
      removable: !lot.grnId && lot.adjustments.length === 0 && remaining === Number(lot.received),
    };
  });

  // Materials have a low-stock threshold; components and packaging a reorder level.
  const word = resource.kind === "materials" ? "threshold" : "reorder level";
  const tone: Tone = quantity <= 0 && resource.lots.length > 0 ? "red" : quantity < threshold ? "amber" : "green";
  return (
    <LotsBlock
      resourceId={resource.id}
      unit={unit}
      stock={{
        quantity: fmtQty(quantity),
        consumed: fmtQty(Math.max(0, received - quantity)),
        note:
          tone === "green"
            ? `Above the ${word} of ${threshold} ${unit}`
            : tone === "red"
              ? `Out of stock — reorder (${word} ${threshold} ${unit})`
              : `Low stock — reorder (${word} ${threshold} ${unit})`,
        tone,
      }}
      lots={lots}
      suppliers={suppliers}
      canEdit={canEdit}
      canAdjust={canAdjust}
      today={today}
    />
  );
}

// --- Supplied items --------------------------------------------------------------------

async function Supplied({ spaceId, vendor }: { spaceId: string; vendor: { id: string; name: string } }) {
  const rows = await suppliedItems(spaceId, vendor);
  return (
    <SectionCard
      title="Supplied items"
      hint="Material lots, components, packaging, services and outsourced workflows linked to this supplier — pulled live from the other pages."
    >
      <div className="border-line overflow-x-auto rounded-[10px] border">
        <table className="w-full min-w-[640px] border-collapse">
          <thead className="bg-subtle">
            <tr>
              {["Type", "Item", "Detail", "Date", ""].map((h, i) => (
                <th key={i} className={S_TH}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-muted px-3 py-8 text-center text-[13px]">
                  Nothing linked to this supplier yet. Pick it as the supplier on a material lot,
                  component or packaging item.
                </td>
              </tr>
            ) : null}
            {rows.map((row, i) => (
              <tr key={i}>
                <td className={S_TD}>
                  <Pill tone="grey" small>
                    {row.type}
                  </Pill>
                </td>
                <td className={`${S_TD} font-semibold`}>{row.item}</td>
                <td className={S_TD}>{row.detail}</td>
                <td className={`${S_TD} font-mono text-[12.5px]`}>{row.date}</td>
                <td className={S_TD}>
                  <Link href={row.href} className="text-brand-ink text-[12.5px] font-semibold no-underline">
                    Open ›
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
