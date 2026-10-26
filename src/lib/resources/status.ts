import { KINDS, type KindConfig, type ResourceKind, type Track, type WorkflowData } from "@/lib/resources/config";

/**
 * What a record's state *is*, as opposed to what somebody set it to.
 *
 * A caliper marked "In service" whose calibration lapsed last week is not in
 * service. Every status shown in the application comes through here, so the
 * list, the detail page and the alert panel always agree — and so the rules
 * (what counts as due soon, when stock is low, when a tool is worn out) are
 * written once.
 *
 * Pure functions over plain data; dates are ISO `YYYY-MM-DD` strings and
 * "today" is passed in, so the same code runs on either side and in tests.
 */

export type Tone = "green" | "amber" | "grey" | "blue" | "red";

export interface ItemView {
  id: string;
  track: Track;
  name: string;
  dueOn: string | null;
  repeatMonths: number | null;
  lastDoneOn: string | null;
  lastResult: string | null;
}

export interface LotView {
  id: string;
  lotNumber: string;
  remaining: number;
  received: number;
  expiresOn: string | null;
}

export interface ResourceView {
  id: string;
  kind: ResourceKind;
  name: string;
  status: string;
  data: Record<string, unknown>;
  items: ItemView[];
  lots: LotView[];
  /** Maintenance records waiting for a change-control review. */
  pendingReviews: Array<{ recordId: string; itemName: string; doneOn: string }>;
}

// --- Dates ---------------------------------------------------------------------

const DAY_MS = 86_400_000;

function utc(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

/** Whole days from `from` to `to`; negative when `to` is in the past. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

/** Calendar months, clamped to the month's last day (31 Jan + 1 → 28/29 Feb). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export function relativeDue(days: number): string {
  if (days < 0) return `Overdue by ${-days} day${days === -1 ? "" : "s"}`;
  if (days === 0) return "Due today";
  return `Due in ${days} day${days === 1 ? "" : "s"}`;
}

/** How far ahead "due soon" looks. */
export const SOON_DAYS = 30;

// --- Schedule items --------------------------------------------------------------

export type ItemLevel = "failed" | "overdue" | "soon" | "ok" | "done" | "none";

export interface ItemStatus {
  level: ItemLevel;
  label: string;
  tone: Tone;
  days: number | null;
}

export function itemStatus(item: ItemView, today: string): ItemStatus {
  const days = item.dueOn ? daysBetween(today, item.dueOn) : null;
  if (item.lastResult === "Fail") return { level: "failed", label: "Failed", tone: "red", days };
  if (days !== null && days < 0) return { level: "overdue", label: "Overdue", tone: "red", days };
  if (days !== null && days <= SOON_DAYS) return { level: "soon", label: "Due soon", tone: "amber", days };
  if (days !== null) return { level: "ok", label: "Scheduled", tone: "green", days };
  if (item.lastDoneOn) return { level: "done", label: "Completed", tone: "green", days };
  return { level: "none", label: "No date set", tone: "grey", days };
}

/** The soonest due item on a track, which is what "next maintenance" means. */
export function nextDue(items: ItemView[], track: Track): ItemView | null {
  return (
    items
      .filter((i) => i.track === track && i.dueOn)
      .sort((a, b) => (a.dueOn! < b.dueOn! ? -1 : 1))[0] ?? null
  );
}

function worst(items: ItemView[], track: Track, today: string): ItemLevel {
  const levels = items.filter((i) => i.track === track).map((i) => itemStatus(i, today).level);
  for (const level of ["failed", "overdue", "soon"] as const) {
    if (levels.includes(level)) return level;
  }
  return "ok";
}

// --- Stock, life, expiry -----------------------------------------------------------

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const str = (value: unknown): string => (typeof value === "string" ? value : value == null ? "" : String(value));

/**
 * What is in stock: the sum of an item's lots. Materials, standard components
 * and packaging all keep their stock this way — there is no stock figure to
 * type, only lots received on a GRN, opening stock and adjustments.
 */
export function materialStock(view: ResourceView): { quantity: number; received: number; threshold: number; unit: string } {
  const pieces = view.kind === "components" || view.kind === "packaging";
  return {
    quantity: view.lots.reduce((sum, lot) => sum + Math.max(0, lot.remaining), 0),
    received: view.lots.reduce((sum, lot) => sum + lot.received, 0),
    threshold: num(pieces ? view.data.reorder : view.data.threshold) ?? 0,
    unit: pieces ? "pcs" : str(view.data.unit) || "unit",
  };
}

/** The lot in use: the oldest one with stock left, as stock is drawn first in, first out. */
export function currentLot(view: ResourceView): LotView | null {
  return view.lots.find((l) => l.remaining > 0) ?? null;
}

/** True when there is stock, but every lot holding it is past its expiry. */
function allUsableExpired(view: ResourceView, today: string): boolean {
  const usable = view.lots.filter((l) => l.remaining > 0);
  return usable.length > 0 && usable.every((l) => l.expiresOn !== null && daysBetween(today, l.expiresOn) < 0);
}

export function toolLife(view: ResourceView): { used: number; limit: number; percent: number; unit: string } | null {
  const limit = num(view.data.lifeLimit);
  if (!limit) return null;
  const used = num(view.data.used) ?? 0;
  return { used, limit, percent: Math.round((used / limit) * 100), unit: str(view.data.lifeUnit) };
}

/** Lots and packaging are flagged this far ahead of their expiry. */
const EXPIRY_SOON_DAYS = { materials: 60, packaging: 90 } as const;

// --- Effective status ---------------------------------------------------------------

const GOOD = new Set(["In service", "Available", "Validated", "Active", "Approved", "Qualified", "In use"]);
const WARN = new Set(["In validation", "On hold", "Quarantine", "Maintenance", "In training", "Validation pending", "Needs regrind / resurface", "Trial"]);
const RETIRED = new Set(["Retired", "Obsolete", "Superseded", "Out of service"]);

function storedTone(status: string): Tone {
  if (status === "In use") return "blue";
  if (GOOD.has(status)) return "green";
  if (WARN.has(status)) return "amber";
  if (RETIRED.has(status)) return "grey";
  return status ? "red" : "grey";
}

export interface EffectiveStatus {
  label: string;
  tone: Tone;
  /** True when nothing stands in the way of using the record today. */
  ready: boolean;
}

export function effectiveStatus(view: ResourceView, today: string): EffectiveStatus {
  const config = KINDS[view.kind];

  if (view.kind === "workflows") {
    return { label: "", tone: "grey", ready: true };
  }

  if (view.kind === "materials") {
    const { quantity, threshold } = materialStock(view);
    if (quantity <= 0) return { label: "Out of stock", tone: "red", ready: false };
    if (quantity < threshold) return { label: "Low stock", tone: "amber", ready: true };
    return { label: "In stock", tone: "green", ready: true };
  }

  const qual = worst(view.items, "qualification", today);
  const maint = worst(view.items, "maintenance", today);
  const stored = { label: view.status || "—", tone: storedTone(view.status), ready: GOOD.has(view.status) };

  if (view.kind === "vendors") {
    if (qual === "failed") return { label: "Evaluation failed", tone: "red", ready: false };
    if (qual === "overdue") return { label: "Re-evaluation overdue", tone: "red", ready: false };
    return stored;
  }

  // A problem only overrides a status that claims all is well. Something
  // already marked out of service is not made more so by an overdue service.
  if (!GOOD.has(view.status)) return stored;

  const qualLabel = config.tabLabels?.qual ?? "Qualification";
  const maintLabel = config.tabLabels?.maint ?? "Maintenance";

  if (maint === "overdue") return { label: `${maintLabel} overdue`, tone: "red", ready: false };
  if (qual === "failed") return { label: `${qualLabel} failed`, tone: "red", ready: false };
  if (qual === "overdue") {
    const word = config.due?.track === "qualification" ? config.due.word : qualLabel;
    return { label: `${word} overdue`, tone: "red", ready: false };
  }

  if ((view.kind === "packaging" || view.kind === "components") && allUsableExpired(view, today)) {
    return { label: "Lot expired", tone: "red", ready: false };
  }

  if (view.kind === "tooling") {
    const life = toolLife(view);
    if (life && life.percent >= 100) return { label: "End of life", tone: "red", ready: false };
  }

  return stored;
}

// --- Alerts ------------------------------------------------------------------------

export interface Alert {
  critical: boolean;
  resourceId: string;
  resourceName: string;
  text: string;
  /** The tab to open. */
  tab: "maint" | "qual" | "lots" | "overview";
}

export function alertsFor(view: ResourceView, today: string): Alert[] {
  const config = KINDS[view.kind];
  const out: Alert[] = [];
  const add = (critical: boolean, text: string, tab: Alert["tab"]) =>
    out.push({ critical, resourceId: view.id, resourceName: view.name || config.newName, text, tab });

  for (const item of view.items) {
    const status = itemStatus(item, today);
    const tab = item.track === "maintenance" ? "maint" : "qual";
    if (status.level === "failed") add(true, `${item.name} — last result Fail`, tab);
    else if (status.level === "overdue") add(true, `${item.name} — ${relativeDue(status.days!).toLowerCase()} (${item.dueOn})`, tab);
    else if (status.level === "soon") add(false, `${item.name} — ${relativeDue(status.days!).toLowerCase()} (${item.dueOn})`, tab);
  }

  for (const review of view.pendingReviews) {
    add(false, `Change-control review pending — ${review.itemName} on ${review.doneOn}`, "qual");
  }

  if (view.kind === "materials") {
    const { quantity, threshold, unit } = materialStock(view);
    if (view.lots.length > 0 && quantity <= 0) add(true, `Out of stock — 0 ${unit} in stock`, "lots");
    else if (quantity < threshold) {
      add(false, `Low stock — ${fmtQty(quantity)} ${unit} in stock (threshold ${threshold})`, "lots");
    }
    for (const lot of view.lots) {
      if (!lot.expiresOn || lot.remaining <= 0) continue;
      const days = daysBetween(today, lot.expiresOn);
      if (days < 0) add(true, `Lot ${lot.lotNumber} expired ${lot.expiresOn} — quarantine`, "lots");
      else if (days <= EXPIRY_SOON_DAYS.materials) add(false, `Lot ${lot.lotNumber} expires ${lot.expiresOn}`, "lots");
    }
  }

  if (config.stock) {
    const { quantity } = materialStock(view);
    const reorder = num(view.data.reorder);
    if (view.lots.length > 0 && quantity <= 0) add(true, "Out of stock — 0 pcs in stock", "lots");
    else if (reorder !== null && quantity < reorder) {
      add(false, `Stock is below the reorder level — ${fmtQty(quantity)} pcs (reorder at ${reorder})`, "lots");
    }
    for (const lot of view.lots) {
      if (!lot.expiresOn || lot.remaining <= 0) continue;
      const days = daysBetween(today, lot.expiresOn);
      if (days < 0) add(true, `Lot ${lot.lotNumber} expired ${lot.expiresOn} — quarantine and replace before use`, "lots");
      else if (days <= EXPIRY_SOON_DAYS.packaging) add(false, `Lot ${lot.lotNumber} expires ${lot.expiresOn}`, "lots");
    }
  }

  if (view.kind === "tooling") {
    const life = toolLife(view);
    if (life && life.percent >= 100) add(true, "Life limit reached — regrind, resurface or retire before next use", "overview");
    else if (life && life.percent >= 80) {
      add(false, `Nearing its life limit (${life.used} / ${life.limit} ${life.unit})`, "overview");
    }
  }

  return out.sort((a, b) => Number(b.critical) - Number(a.critical));
}

// --- List rows -----------------------------------------------------------------------

export interface Cell {
  main: string;
  sub?: string;
  subTone?: Tone;
}

export function fmtQty(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

function dueCell(view: ResourceView, track: Track, today: string): Cell {
  const item = nextDue(view.items, track);
  if (!item?.dueOn) return { main: "—" };
  const days = daysBetween(today, item.dueOn);
  return {
    main: item.dueOn,
    sub: relativeDue(days),
    subTone: days < 0 ? "red" : days <= SOON_DAYS ? "amber" : "grey",
  };
}

const join = (...parts: string[]) => parts.filter(Boolean).join(" · ");

/** The four cells before "Status", and the line under the name. */
export function listCells(view: ResourceView, today: string): { id: string; cells: [Cell, Cell, Cell] } {
  const d = (key: string) => str(view.data[key]);

  switch (view.kind) {
    case "workflows": {
      const stages = (view.data as unknown as WorkflowData).stages ?? [];
      return {
        id: "",
        cells: [{ main: d("method") || "—" }, { main: `${stages.length} stage${stages.length === 1 ? "" : "s"}` }, { main: "" }],
      };
    }
    case "printers":
      return {
        id: join(d("assetId"), d("serial") ? `S/N ${d("serial")}` : ""),
        cells: [{ main: d("tech") || "—", sub: d("process") }, dueCell(view, "qualification", today), dueCell(view, "maintenance", today)],
      };
    case "materials": {
      const { quantity, unit } = materialStock(view);
      return {
        id: d("code"),
        cells: [
          { main: d("tech") || "—" },
          { main: `${fmtQty(quantity)} ${unit}` },
          { main: `${view.lots.length} lot${view.lots.length === 1 ? "" : "s"}` },
        ],
      };
    }
    case "vendors":
      return {
        id: join(d("code"), d("contact")),
        cells: [{ main: d("kind") || "—", sub: d("specialty") }, { main: d("location") || "—" }, { main: d("lead") ? `${d("lead")} days` : "—" }],
      };
    case "measuring":
      return {
        id: d("assetId"),
        cells: [{ main: d("kind") || "—" }, { main: join(d("range"), d("resolution")) || "—" }, dueCell(view, "maintenance", today)],
      };
    case "postproc":
      return {
        id: d("assetId"),
        cells: [{ main: d("kind") || "—" }, dueCell(view, "qualification", today), dueCell(view, "maintenance", today)],
      };
    case "steril":
      return {
        id: d("code"),
        cells: [
          { main: (d("method") || "—") + (d("provider") === "Contract sterilizer" ? " · contract" : "") },
          { main: d("params") || "—" },
          dueCell(view, "qualification", today),
        ],
      };
    case "components":
    case "packaging": {
      const stock = view.lots.length ? materialStock(view).quantity : null;
      const reorder = num(view.data.reorder);
      const low = stock !== null && reorder !== null && stock < reorder;
      const lot = currentLot(view);
      const third =
        view.kind === "components"
          ? { main: join(d("size"), d("material")) || "—" }
          : { main: lot ? join(lot.lotNumber, lot.expiresOn ?? "") : "—" };
      return {
        id: view.kind === "components" ? d("partNo") : d("code"),
        cells: [
          { main: d(view.kind === "components" ? "category" : "kind") || "—" },
          third,
          {
            main: stock === null ? "—" : `${stock.toLocaleString("en-IN")} pcs`,
            sub: low ? `Below reorder level (${reorder})` : undefined,
            subTone: "amber",
          },
        ],
      };
    }
    case "tooling": {
      const life = toolLife(view);
      return {
        id: d("toolId"),
        cells: [
          { main: d("kind") || "—" },
          { main: d("usedOn") || "—" },
          life
            ? {
                main: `${life.used} / ${life.limit} ${life.unit}`,
                sub: `${life.percent}% used`,
                subTone: life.percent >= 100 ? "red" : life.percent >= 80 ? "amber" : "grey",
              }
            : { main: "No life limit" },
        ],
      };
    }
    case "software": {
      const installed = d("installed");
      return {
        id: join(d("code"), d("vendor")),
        cells: [
          { main: d("purpose") || "—" },
          { main: (d("version") || "—") + (installed && installed !== d("version") ? ` · installed ${installed}` : "") },
          dueCell(view, "qualification", today),
        ],
      };
    }
    case "params":
      return {
        id: d("code"),
        cells: [{ main: join(d("machine"), d("material")) || "—" }, { main: d("keyParams") || "—" }, dueCell(view, "qualification", today)],
      };
    case "operators":
      return {
        id: d("empId"),
        cells: [{ main: d("role") || "—" }, { main: d("qualifiedFor") || "—" }, dueCell(view, "qualification", today)],
      };
    // Workflow and product names are filled in by the list page, which knows the other records.
    case "products":
      return {
        id: d("code"),
        cells: [
          { main: d("kindLabel") || "One workflow", sub: d("tagList") || undefined },
          d("subscopeCount") ? { main: d("subscopeCount"), sub: d("scopeNames") } : stagesCell(view, "Not set yet"),
          { main: d("workflowNames") || "All workflows" },
        ],
      };
    case "sites":
      return {
        id: d("code"),
        cells: [{ main: d("type") || "—", sub: d("vendorName") || undefined }, { main: d("city") || "—" }, { main: d("equipmentCount") || "Nothing yet", sub: d("memberNames") || undefined }],
      };
    case "hospitals":
      return {
        id: d("code"),
        cells: [{ main: d("city") || "—", sub: d("contact") || undefined }, { main: d("departmentNames") || "None yet" }, { main: d("surgeons") || "None yet" }],
      };
    case "viewers":
      return {
        id: "",
        cells: [{ main: d("type") || "—" }, { main: d("description") || "—" }, { main: d("usedBy") || "Not used yet" }],
      };
    case "subscopes":
      return {
        id: d("code"),
        cells: [{ main: d("productName") || "—" }, view.data.ownStages === true ? stagesCell(view, "Same as the product") : { main: "Same as the product" }, { main: d("workflowName") || "Same as the product" }],
      };
  }
}

// --- Summary cards -----------------------------------------------------------------

export interface SummaryCard {
  label: string;
  value: string;
  tone?: Tone;
}

export function summaryCards(config: KindConfig, views: ResourceView[], today: string): SummaryCard[] {
  const statuses = views.map((v) => effectiveStatus(v, today));
  const ready = statuses.filter((s) => s.ready).length;
  const count = (track: Track, level: ItemLevel) =>
    views.filter((v) => v.items.some((i) => i.track === track && itemStatus(i, today).level === level)).length;
  const dueCard = (label: string, track: Track): SummaryCard => {
    const overdue = count(track, "overdue") + count(track, "failed");
    const soon = count(track, "soon");
    return {
      label,
      value: overdue ? `${overdue + soon} (${overdue} overdue)` : String(soon),
      tone: overdue ? "red" : soon ? "amber" : undefined,
    };
  };

  switch (config.summary) {
    case "simple": {
      const active = views.filter((v) => v.status !== "Inactive").length;
      return [
        { label: "Total", value: String(views.length) },
        { label: "Active", value: String(active), tone: "green" },
        { label: "Inactive", value: String(views.length - active) },
      ];
    }
    case "catalog": {
      const active = views.filter((v) => v.status !== "Inactive").length;
      const withScopes = views.filter((v) => v.data.mode === "scopes").length;
      return [
        { label: "Total", value: String(views.length) },
        { label: "Active", value: String(active), tone: "green" },
        { label: "Inactive", value: String(views.length - active) },
        { label: "With sub-scopes", value: String(withScopes) },
      ];
    }
    case "machines":
      return [
        { label: "Machines", value: String(views.length) },
        { label: "Available", value: String(statuses.filter((s) => s.tone === "green").length), tone: "green" },
        dueCard("Qualification due / overdue", "qualification"),
        dueCard("Maintenance due / overdue", "maintenance"),
      ];
    case "equipment":
      return [
        { label: "Equipment", value: String(views.length) },
        { label: "Ready to use", value: String(ready), tone: "green" },
        dueCard("Maintenance due / overdue", "maintenance"),
        dueCard("Qualification due / overdue", "qualification"),
      ];
    case "due": {
      const track = config.due?.track ?? "qualification";
      const word = config.due?.word ?? "Review";
      const overdue = count(track, "overdue") + count(track, "failed");
      return [
        { label: "Total", value: String(views.length) },
        { label: "Ready to use", value: String(ready), tone: "green" },
        { label: `${word} due ≤ 30 days`, value: String(count(track, "soon")), tone: count(track, "soon") ? "amber" : undefined },
        { label: `${word} overdue`, value: String(overdue), tone: overdue ? "red" : undefined },
      ];
    }
    case "life": {
      const lives = views.map(toolLife);
      const near = lives.filter((l) => l && l.percent >= 80 && l.percent < 100).length;
      const end = lives.filter((l) => l && l.percent >= 100).length;
      return [
        { label: "Total", value: String(views.length) },
        { label: "Ready to use", value: String(ready), tone: "green" },
        { label: "Nearing end of life (≥ 80%)", value: String(near), tone: near ? "amber" : undefined },
        { label: "End of life reached", value: String(end), tone: end ? "red" : undefined },
      ];
    }
    case "stock": {
      const low = views.filter((v) => {
        const reorder = num(v.data.reorder);
        return reorder !== null && materialStock(v).quantity < reorder;
      }).length;
      const fourth: SummaryCard =
        config.kind === "packaging"
          ? (() => {
              const n = views.filter((v) =>
                v.lots.some((l) => l.remaining > 0 && l.expiresOn && daysBetween(today, l.expiresOn) <= EXPIRY_SOON_DAYS.packaging),
              ).length;
              return { label: "Expired / expiring ≤ 90 days", value: String(n), tone: n ? "red" : undefined };
            })()
          : (() => {
              const n = views.filter((v) => v.status === "On hold").length;
              return { label: "On hold", value: String(n), tone: n ? "amber" : undefined };
            })();
      return [
        { label: "Total items", value: String(views.length) },
        { label: "Usable", value: String(ready), tone: "green" },
        { label: "Below reorder level", value: String(low), tone: low ? "amber" : undefined },
        fourth,
      ];
    }
    case "materials": {
      const low = statuses.filter((s) => s.label === "Low stock").length;
      const out = statuses.filter((s) => s.label === "Out of stock").length;
      return [
        { label: "Materials", value: String(views.length) },
        { label: "In stock", value: String(statuses.filter((s) => s.label === "In stock").length), tone: "green" },
        { label: "Low stock", value: String(low), tone: low ? "amber" : undefined },
        { label: "Out of stock", value: String(out), tone: out ? "red" : undefined },
      ];
    }
    case "vendors": {
      const overdue = statuses.filter((s) => s.tone === "red").length;
      return [
        { label: "Suppliers", value: String(views.length) },
        { label: "Approved", value: String(views.filter((v) => v.status === "Approved").length), tone: "green" },
        { label: "On trial", value: String(views.filter((v) => v.status === "Trial").length) },
        { label: "Evaluation overdue / failed", value: String(overdue), tone: overdue ? "red" : undefined },
      ];
    }
  }
}

/** A product's or sub-scope's case stages: how many, first to last. */
function stagesCell(view: ResourceView, none: string): Cell {
  const stages = Array.isArray(view.data.stages) ? (view.data.stages as Array<{ name?: unknown }>) : [];
  if (!stages.length) return { main: none };
  const name = (i: number) => String(stages[i]?.name ?? "");
  return { main: `${stages.length} stage${stages.length === 1 ? "" : "s"}`, sub: stages.length > 1 ? `${name(0)} → ${name(stages.length - 1)}` : name(0) };
}
