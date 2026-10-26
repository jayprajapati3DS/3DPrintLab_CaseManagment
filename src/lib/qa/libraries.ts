import "server-only";

import { db } from "@/lib/db";
import type { LibOption, Libraries } from "@/lib/qa/evaluate";
import { USED_UP } from "@/lib/qa/evaluate";
import { KINDS, type ResourceKind } from "@/lib/resources/config";
import { iso, spaceToday, toItemView, toLotView } from "@/lib/resources/queries";
import { daysBetween, effectiveStatus, nextDue, type ResourceView } from "@/lib/resources/status";

/**
 * The live lists a QA form's dropdowns offer — machines, lots, operators,
 * parameter sets — each item with the facts the form shows under it and,
 * when it must not be used today, the reason why.
 */

const RESOURCE_SOURCES: Array<[source: keyof Libraries, kind: ResourceKind]> = [
  ["printers", "printers"],
  ["postproc", "postproc"],
  ["measuring", "measuring"],
  ["tooling", "tooling"],
  ["steril", "steril"],
  ["materials", "materials"],
  ["vendors", "vendors"],
  ["operators", "operators"],
  ["params", "params"],
  ["software", "software"],
];

const str = (value: unknown) => (value === null || value === undefined ? "" : String(value));

/** How an item is named in a dropdown. */
export function optionLabel(kind: ResourceKind, name: string, data: Record<string, unknown>): string {
  switch (kind) {
    case "operators":
      return data.role ? `${name} — ${str(data.role)}` : name;
    case "params":
      return data.code ? `${name} · ${str(data.code)}` : name;
    case "software":
      return data.version ? `${name} ${str(data.version)}` : name;
    default:
      return name;
  }
}

/** Why a record must not be picked today, or null. */
function warningFor(view: ResourceView, today: string): string | null {
  const status = effectiveStatus(view, today);
  const data = view.data;
  switch (view.kind) {
    case "vendors":
      if (status.tone === "red") return status.label;
      if (view.status !== "Approved") return `Supplier status is ${view.status || "not set"} — not on the approved list`;
      return null;
    case "operators":
      if (view.status === "In training") return "Person is in training — not yet qualified";
      break;
    case "params":
      if (view.status && view.status !== "Validated") return `Parameter set is ${view.status.toLowerCase()} — not validated`;
      break;
    case "software":
      if (data.installed && data.version && str(data.installed) !== str(data.version)) {
        return `Installed version ${str(data.installed)} is not the validated version ${str(data.version)}`;
      }
      break;
    case "materials":
      return null;
    default:
      break;
  }
  if (status.tone === "red") return `${status.label} — do not use for production`;
  if (status.tone === "grey" && view.status && !status.ready) return `Status is ${view.status} — do not use for production`;
  return null;
}

function infoFor(view: ResourceView, today: string): Array<[string, string]> {
  const status = effectiveStatus(view, today);
  const rows: Array<[string, string]> = [];
  if (status.label) rows.push(["Status", status.label]);
  for (const field of KINDS[view.kind].fields.slice(0, 4)) {
    if (field.ref) continue;
    const value = str(view.data[field.key]);
    if (value) rows.push([field.label, value]);
  }
  const maintenance = nextDue(view.items, "maintenance");
  if (maintenance?.dueOn) rows.push(["Next maintenance", maintenance.dueOn]);
  return rows.slice(0, 6);
}

/**
 * With a site: only the items set to that site, and those shared by all — a
 * part's forms offer what is where it is made.
 */
export async function qaLibraries(spaceId: string, siteId?: string | null): Promise<Libraries> {
  const [today, resources, technologies, partTypes] = await Promise.all([
    spaceToday(spaceId),
    db.resource.findMany({
      where: { spaceId, archivedAt: null, kind: { in: [...RESOURCE_SOURCES.map(([, k]) => k), "components", "packaging"] } },
      include: { scheduleItems: true, lots: { orderBy: { receivedOn: "asc" } } },
      orderBy: { name: "asc" },
    }),
    db.technology.findMany({ where: { spaceId }, orderBy: { name: "asc" } }),
    db.partType.findMany({ where: { spaceId }, orderBy: { name: "asc" } }),
  ]);

  const libraries: Libraries = {};
  const atSite = (data: unknown) => {
    const own = ((data ?? {}) as { siteId?: unknown }).siteId;
    return !siteId || !own || own === siteId;
  };
  const views = resources.filter((r) => atSite(r.data)).map((r) => ({
    row: r,
    view: {
      id: r.id,
      kind: r.kind as ResourceKind,
      name: r.name,
      status: r.status,
      data: (r.data ?? {}) as Record<string, unknown>,
      items: r.scheduleItems.map(toItemView),
      lots: r.lots.map(toLotView),
      pendingReviews: [],
    } satisfies ResourceView,
  }));

  for (const [source, kind] of RESOURCE_SOURCES) {
    libraries[source] = views
      .filter(({ view }) => view.kind === kind)
      .map(({ view }): LibOption => ({
        id: view.id,
        label: optionLabel(kind, view.name, view.data),
        warn: warningFor(view, today),
        info: infoFor(view, today),
        avail: null,
        unit: null,
      }));
  }

  // Material lots, component lots and packaging lots: what is picked, and
  // what a quantity used comes off, is always one lot — that is what makes a
  // screw or a pouch traceable to the implant it went into.
  const lotOptions = (kind: "materials" | "components" | "packaging") =>
    views
      .filter(({ view }) => view.kind === kind)
      .flatMap(({ row, view }) => {
        const itemWarn = kind === "materials" ? null : warningFor(view, today);
        return row.lots.map((lot): LibOption => {
        const remaining = Number(lot.remaining);
        const expiry = iso(lot.expiresOn);
        const unit = kind === "materials" ? str(view.data.unit) || "unit" : "pcs";
        let warn: string | null = itemWarn;
        if (expiry && daysBetween(today, expiry) < 0) warn = `Lot expired ${expiry} — quarantine, do not use`;
        else if (remaining <= 0) warn = USED_UP;
        return {
          id: lot.id,
          label: `${lot.lotNumber} — ${view.name}`,
          warn,
          info: [
            ["Remaining", `${Math.round(remaining * 1000) / 1000} ${unit}`],
            ...(lot.supplier ? ([["Supplier", lot.supplier]] as Array<[string, string]>) : []),
            ...(lot.coa ? ([["CoA", lot.coa]] as Array<[string, string]>) : []),
            ...(expiry ? ([["Expiry", expiry]] as Array<[string, string]>) : []),
            ...(lot.grnNumber ? ([["GRN", lot.grnNumber]] as Array<[string, string]>) : []),
          ],
          avail: Math.max(0, remaining),
          unit,
          material: view.name,
        };
        });
      });
  libraries.lots = lotOptions("materials");
  libraries.components = lotOptions("components");
  libraries.packaging = lotOptions("packaging");

  libraries.techs = technologies.map((t) => ({ id: t.id, label: t.name, warn: null, info: [], avail: null, unit: null }));
  libraries.partTypes = partTypes.map((t) => ({ id: t.id, label: t.name, warn: null, info: [["Code", t.code]], avail: null, unit: null }));
  return libraries;
}
