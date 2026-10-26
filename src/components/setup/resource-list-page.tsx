import Link from "next/link";

import { ArchivedList, type ArchivedRow } from "@/components/setup/archived-list";
import { IdFormat } from "@/components/setup/id-format";
import { ResourceList, type ListRow } from "@/components/setup/resource-list";
import { IntroBanner, S_BTN_DARK } from "@/components/setup/ui";
import { canManageSpace, requireSpaceUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { createResourceAction } from "@/lib/resources/actions";
import { KINDS, type ResourceKind } from "@/lib/resources/config";
import { getIdRule, usedIds } from "@/lib/resources/id-queries";
import { countArchived, iso, listResources, spaceToday } from "@/lib/resources/queries";
import { alertsFor, effectiveStatus, listCells, summaryCards } from "@/lib/resources/status";

/** Types to preview {TYPE} with: those in use, then the field's own choices. */
function typeChoices(kind: ResourceKind, inUse: string[]): string[] {
  const config = KINDS[kind];
  const field = config.fields.find((f) => f.key === config.ids?.type);
  return [...new Set([...inUse, ...(field?.options ?? [])].map((t) => t.trim()).filter(Boolean))].slice(0, 30);
}

/**
 * The list page every kind of master data shares: intro, active / archived
 * switch, summary cards, alerts, search, and the table or cards.
 */
export async function ResourceListPage({ kind, archived }: { kind: ResourceKind; archived: boolean }) {
  const user = await requireSpaceUser();
  const config = KINDS[kind];
  const canEdit = canManageSpace(user);

  const [today, records, archivedCount, activeCount, idRule, ids] = await Promise.all([
    spaceToday(user.space.id),
    listResources(user.space.id, kind, archived),
    countArchived(user.space.id, kind),
    db.resource.count({ where: { spaceId: user.space.id, kind, archivedAt: null } }),
    getIdRule(user.space.id, kind),
    canEdit ? usedIds(user.space.id, kind) : Promise.resolve([]),
  ]);

  // Hospitals: the people who work there (Users & Roles).
  if (kind === "hospitals") {
    const people = await db.user.findMany({ where: { spaceId: user.space.id, isActive: true }, select: { name: true, hospitalIds: true } });
    for (const { view } of records) {
      const here = people.filter((p) => p.hospitalIds.includes(view.id)).map((p) => p.name);
      const departments = Array.isArray(view.data.departments) ? (view.data.departments as Array<{ name?: string }>).map((x) => x.name ?? "").filter(Boolean) : [];
      view.data = { ...view.data, surgeons: here.join(", "), departmentNames: departments.join(", ") };
    }
  }

  // Sites: their vendor, what is there and who works there.
  if (kind === "sites") {
    const [others, people] = await Promise.all([
      db.resource.findMany({ where: { spaceId: user.space.id, archivedAt: null }, select: { id: true, kind: true, name: true, data: true } }),
      db.user.findMany({ where: { spaceId: user.space.id, isActive: true }, select: { name: true, siteIds: true } }),
    ]);
    for (const { view } of records) {
      const items = others.filter((o) => ((o.data ?? {}) as { siteId?: string }).siteId === view.id).length;
      const members = people.filter((p) => p.siteIds.includes(view.id)).map((p) => p.name);
      view.data = {
        ...view.data,
        vendorName: others.find((o) => o.id === view.data.vendorId)?.name ?? "",
        equipmentCount: items ? `${items} item${items === 1 ? "" : "s"}` : "",
        memberNames: members.length ? `${members.length} member${members.length === 1 ? "" : "s"} · ${members.slice(0, 3).join(", ")}${members.length > 3 ? "…" : ""}` : "",
      };
    }
  }

  // Viewers: which products use them.
  if (kind === "viewers") {
    const products = await db.resource.findMany({ where: { spaceId: user.space.id, kind: "products", archivedAt: null }, select: { name: true, data: true } });
    for (const { view } of records) {
      const users = products.filter((p) => {
        const d = (p.data ?? {}) as { viewerIds?: unknown; scopes?: Array<{ viewerIds?: unknown }> };
        const has = (ids: unknown) => Array.isArray(ids) && ids.includes(view.id);
        return has(d.viewerIds) || (d.scopes ?? []).some((sc) => has(sc.viewerIds));
      });
      view.data = { ...view.data, usedBy: users.map((p) => p.name).join(", ") };
    }
  }

  // Products and sub-scopes point at other records by id: their rows show the names.
  if (kind === "products" || kind === "subscopes") {
    const others = await db.resource.findMany({
      where: { spaceId: user.space.id, kind: { in: ["workflows", "products", "subscopes"] }, archivedAt: null },
      select: { id: true, kind: true, name: true, data: true },
    });
    const nameOf = new Map(others.map((o) => [o.id, o.name]));
    for (const { view } of records) {
      const data = { ...view.data };
      data.workflowName = nameOf.get(String(data.workflowId ?? "")) ?? "";
      // A product's workflows: all, or the ones chosen (an older one named a single workflow).
      const ids = Array.isArray(data.workflowIds) ? (data.workflowIds as string[]) : data.workflowId ? [String(data.workflowId)] : [];
      data.workflowNames = ids.length ? ids.map((id) => nameOf.get(id) ?? "a removed workflow").join(", ") : "";
      data.kindLabel = data.mode === "scopes" ? "With sub-scopes" : "One workflow";
      data.tagList = Array.isArray(data.tags) ? (data.tags as string[]).join(", ") : "";
      if (kind === "subscopes") data.productName = nameOf.get(String(data.productId ?? "")) ?? "";
      if (kind === "products") {
        const scopes = data.mode === "scopes" && Array.isArray(data.scopes) ? (data.scopes as Array<{ name?: string }>) : [];
        data.subscopeCount = scopes.length ? `${scopes.length} sub-scope${scopes.length === 1 ? "" : "s"}` : "";
        data.scopeNames = scopes.map((sc) => sc.name ?? "").join(", ");
      }
      view.data = data;
    }
  }

  const tabs = (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="bg-[#EEF0F3] flex gap-1 rounded-[11px] p-1">
        {(
          [
            ["Active", activeCount, config.route, !archived],
            ["Archived", archivedCount, `${config.route}?view=archived`, archived],
          ] as const
        ).map(([label, count, href, on]) => (
          <Link
            key={label}
            href={href}
            className={
              "flex h-[34px] items-center rounded-lg px-3.5 text-[12.5px] font-semibold whitespace-nowrap no-underline " +
              (on ? "text-brand-ink bg-white shadow-[0_1px_2px_rgba(16,24,40,.1)]" : "text-ink-3")
            }
          >
            {label} ({count})
          </Link>
        ))}
      </div>
      <span className="text-muted text-[12.5px]">
        {archived ? "Archived records are read-only." : "Archiving keeps the full record — nothing is lost."}
      </span>
    </div>
  );

  const intro = (
    <IntroBanner icon={config.icon} before={config.intro[0]} space={user.space.name} after={config.intro[1]} />
  );

  if (archived) {
    const rows: ArchivedRow[] = records.map(({ row, view }) => {
      const { id, cells } = listCells(view, today);
      const counts = [
        `${row.scheduleItems.length} schedule item${row.scheduleItems.length === 1 ? "" : "s"}`,
        ...(row.lots.length ? [`${row.lots.length} lot${row.lots.length === 1 ? "" : "s"}`] : []),
        "its records and documents",
      ];
      return {
        id: row.id,
        name: row.name || config.newName,
        summary: [id, cells[0].main, cells[1].main].filter((s) => s && s !== "—").join(" · "),
        archivedOn: iso(row.archivedAt) ?? "",
        archivedBy: row.archivedByName ?? "",
        reason: row.archiveReason ?? "",
        contents: counts.join(", "),
        deletion: row.deletionRequestedAt
          ? {
              by: row.deletionRequestedByName ?? "",
              on: iso(row.deletionRequestedAt) ?? "",
              reason: row.deletionReason ?? "",
              mine: row.deletionRequestedById === user.id,
            }
          : null,
      };
    });

    return (
      <div className="flex flex-col gap-5">
        {intro}
        {tabs}
        <ArchivedList route={config.route} title={config.title} rows={rows} canEdit={canEdit} />
      </div>
    );
  }

  const views = records.map((r) => r.view);
  const rows: ListRow[] = records.map(({ row, view }) => {
    const { id, cells } = listCells(view, today);
    const status = effectiveStatus(view, today);
    return {
      id: row.id,
      name: row.name || config.newName,
      sub: id,
      // A product keeps its image with its details; other records have their photo.
      photo: row.imageId ? `/api/files/${row.imageId}` : kind === "products" && typeof view.data.imageId === "string" && view.data.imageId ? `/api/files/${view.data.imageId}` : null,
      swatch: kind === "materials" ? String(view.data.color ?? "") || null : null,
      cells,
      status: { label: status.label, tone: status.tone },
    };
  });

  return (
    <div className="flex flex-col gap-5">
      {intro}

      <section className="border-line flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-[14px] border bg-white px-4 py-[18px] sm:px-[22px]">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="m-0 text-[15px] font-bold">{config.title}</h2>
          <p className="text-muted m-0 text-[12.5px] leading-[1.5]">{config.description}</p>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            {config.ids && idRule ? (
              <IdFormat
                kind={kind}
                title={config.title}
                fieldLabel={config.fields.find((f) => f.key === config.ids!.field)?.label ?? "ID"}
                typeLabel={config.fields.find((f) => f.key === config.ids!.type)?.label ?? "Type"}
                rule={idRule}
                suggested={config.ids.pattern}
                used={ids.map((i) => i.value)}
                types={typeChoices(kind, records.map((r) => String(((r.row.data ?? {}) as Record<string, unknown>)[config.ids!.type] ?? "")))}
              />
            ) : null}
            <form action={createResourceAction}>
              <input type="hidden" name="kind" value={kind} />
              <button type="submit" className={S_BTN_DARK}>
                {config.addLabel}
              </button>
            </form>
          </div>
        ) : null}
      </section>

      {tabs}

      <ResourceList
        route={config.route}
        icon={config.icon}
        columns={config.columns}
        searchPlaceholder={config.searchPlaceholder}
        rows={rows}
        alerts={views.flatMap((v) => alertsFor(v, today)).sort((a, b) => Number(b.critical) - Number(a.critical))}
        cards={kind === "workflows" ? [] : summaryCards(config, views, today)}
        hasStatus={kind !== "workflows"}
        emptyText={
          kind === "workflows"
            ? "No workflows yet. Create one to define its production stages."
            : `Nothing here yet.${canEdit ? ` Use "${config.addLabel.replace(/^\+ /, "")}" to add the first.` : ""}`
        }
      />
    </div>
  );
}
