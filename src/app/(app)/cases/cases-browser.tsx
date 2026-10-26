"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Fragment,
  useEffect,
  useMemo,
  useOptimistic,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";

import {
  PriorityBadge,
  ProductDot,
  ProductTile,
  StateFlag,
  StatusBadge,
} from "@/components/ui/badges";
import { stateEdge } from "@/lib/cases/classify";
import { DEFAULT_SORT, DEFAULT_TILE } from "@/lib/cases/list-defaults";
import type {
  CaseListParams,
  CaseListResult,
  CaseRow,
  Facet,
  Sort,
  Tile,
} from "@/lib/queries/cases";

// --- Static definitions --------------------------------------------------------

const TILE_DEFS: Array<{ key: Tile; label: string; bg: string; fg: string; icon: string }> = [
  { key: "all", label: "All Cases", bg: "#FFF1EB", fg: "#E24E1B", icon: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" },
  { key: "new", label: "New", bg: "#EFF8FF", fg: "#175CD3", icon: "M12 5v14M5 12h14" },
  { key: "progress", label: "In Progress", bg: "#FFFAEB", fg: "#B54708", icon: "M12 8v4l3 3M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0z" },
  { key: "completed", label: "Completed", bg: "#ECFDF3", fg: "#067647", icon: "M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14l-3-3" },
  { key: "archived", label: "Archived", bg: "#F2F4F7", fg: "#475467", icon: "M21 8v13H3V8M1 3h22v5H1zM10 12h4" },
];

const FACET_LABELS: Record<Facet, string> = {
  product: "Product",
  scope: "Scope",
  status: "Status",
  surgeon: "Surgeon",
  hospital: "Hospital",
  priority: "Priority",
  state: "Case state",
};
const FACET_ORDER: Facet[] = ["product", "scope", "status", "surgeon", "hospital", "priority", "state"];

const SORT_LABELS: Record<Sort, string> = {
  caseid: "Case ID (latest first)",
  surgery: "Surgery date",
  newest: "Newest case",
  product: "Product",
  surgeon: "Surgeon",
  status: "Status",
  priority: "Priority",
};

type ColumnKey = "image" | "product" | "scope" | "surgeon" | "patient" | "hospital" | "date" | "priority" | "status";

const COLUMNS: Array<{ key: ColumnKey; label: string; width: string }> = [
  { key: "image", label: "Image", width: "44px" },
  { key: "product", label: "Product", width: "minmax(0,1.5fr)" },
  { key: "scope", label: "Scope", width: "minmax(0,1.5fr)" },
  { key: "surgeon", label: "Surgeon", width: "minmax(0,1fr)" },
  { key: "patient", label: "Patient", width: "minmax(0,0.9fr)" },
  { key: "hospital", label: "Hospital", width: "minmax(0,1.3fr)" },
  { key: "date", label: "Surgery date", width: "minmax(0,0.9fr)" },
  { key: "priority", label: "Priority", width: "minmax(0,0.7fr)" },
  { key: "status", label: "Status", width: "minmax(0,1.3fr)" },
];

// --- Per-viewer preferences ----------------------------------------------------
// The view and the visible columns are a personal choice, not part of a link
// someone might share, so they live in this browser rather than in the URL.

interface Prefs {
  view?: "list" | "grid";
  cols?: Partial<Record<ColumnKey, boolean>>;
}

const PREFS_KEY = "mms.cases.prefs";
const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function readPrefs(): string {
  try {
    return window.localStorage.getItem(PREFS_KEY) ?? "";
  } catch {
    return "";
  }
}

function writePrefs(next: Prefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    // Private windows can refuse storage; the choice then lasts until reload.
  }
  listeners.forEach((l) => l());
}

function usePrefs(): Prefs {
  const raw = useSyncExternalStore(subscribe, readPrefs, () => "");
  return useMemo(() => {
    try {
      return raw ? (JSON.parse(raw) as Prefs) : {};
    } catch {
      return {};
    }
  }, [raw]);
}

// --- URL ---------------------------------------------------------------------------

type ParamChange = Partial<Omit<CaseListParams, "filters">> & {
  filters?: Record<Facet, string[]>;
};

/** Build the URL for a change to the list's parameters. */
function buildHref(pathname: string, params: CaseListParams, change: ParamChange): string {
  const next = { ...params, ...change, filters: change.filters ?? params.filters };
  // Any change other than turning the page goes back to the first one.
  if (change.page === undefined) next.page = 1;
  const sp = new URLSearchParams();
  if (next.q) sp.set("q", next.q);
  if (next.tile !== DEFAULT_TILE) sp.set("tile", next.tile);
  if (next.sort !== DEFAULT_SORT) sp.set("sort", next.sort);
  if (next.page > 1) sp.set("page", String(next.page));
  for (const facet of FACET_ORDER) {
    for (const value of next.filters[facet]) sp.append(facet, value);
  }
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

// --- Component -------------------------------------------------------------------

export function CasesBrowser({
  params,
  result,
}: {
  params: CaseListParams;
  result: CaseListResult;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<"filters" | "columns" | null>(null);
  const [openGroup, setOpenGroup] = useState<Facet>("product");
  const [query, setQuery] = useState(params.q);
  const prefs = usePrefs();
  // A ticked box should look ticked at once, not when the server answers.
  const [filters, setFilters] = useOptimistic(params.filters);

  const view = prefs.view ?? "list";

  // Hospital is off by default, as in the design. A column with no data in
  // this space also starts hidden, so a list is not half dashes before the
  // platform supplies the field.
  const visible = useMemo(() => {
    const defaults: Record<ColumnKey, boolean> = {
      image: true,
      product: true,
      surgeon: true,
      patient: true,
      scope: true,
      hospital: false,
      date: true,
      priority: result.facets.priority.length > 0,
      status: true,
    };
    return { ...defaults, ...prefs.cols };
  }, [prefs.cols, result.facets.priority.length]);

  const href = (change: ParamChange) => buildHref(pathname, params, change);

  function go(url: string) {
    startTransition(() => router.push(url, { scroll: false }));
  }

  // The header's search box can change `q` from outside; follow it, but not
  // while it merely echoes what is being typed here.
  const [seenQ, setSeenQ] = useState(params.q);
  if (params.q !== seenQ) {
    setSeenQ(params.q);
    if (params.q !== query.trim()) setQuery(params.q);
  }

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const typed = query.trim();
    if (typed === params.q) return;
    const timer = setTimeout(() => {
      startTransition(() =>
        router.replace(buildHref(pathname, params, { q: typed }), { scroll: false }),
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [query, params, pathname, router]);

  function applyFilters(next: Record<Facet, string[]>) {
    startTransition(() => {
      setFilters(next);
      router.push(href({ filters: next }), { scroll: false });
    });
  }

  function toggleFilter(facet: Facet, value: string) {
    const current = filters[facet];
    const nextValues = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    applyFilters({ ...filters, [facet]: nextValues });
  }

  const filterCount = FACET_ORDER.reduce((n, f) => n + filters[f].length, 0);
  const emptyFilters = Object.fromEntries(FACET_ORDER.map((f) => [f, []])) as unknown as Record<
    Facet,
    string[]
  >;

  const shownColumns = COLUMNS.filter((c) => visible[c.key]);
  const template = [
    ...(visible.image ? ["44px"] : []),
    // Wide enough for an ID like 132837_HR_2606_MA; a longer one wraps rather than being cut off.
    "minmax(0,1.9fr)",
    ...shownColumns.filter((c) => c.key !== "image").map((c) => c.width),
  ].join(" ");

  return (
    <div className="flex flex-col gap-4">
      {/* Tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 lg:gap-3.5">
        {TILE_DEFS.map((tile) => {
          const selected = params.tile === tile.key;
          return (
            <Link
              key={tile.key}
              href={href({ tile: tile.key })}
              scroll={false}
              aria-current={selected ? "true" : undefined}
              className={
                "flex items-center gap-3 rounded-xl border px-4 py-3.5 no-underline " +
                (selected ? "border-brand-edge bg-brand-wash" : "border-line bg-white")
              }
            >
              <span
                className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px]"
                style={{ background: tile.bg, color: tile.fg }}
              >
                <Icon d={tile.icon} size={17} />
              </span>
              <span className="flex flex-col">
                <span className="text-ink font-mono text-[19px] leading-tight font-semibold">
                  {result.tileCounts[tile.key].toLocaleString("en-IN")}
                </span>
                <span className="text-ink-3 text-xs">{tile.label}</span>
              </span>
            </Link>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="relative flex w-full sm:w-auto">
          <span className="text-faint absolute top-[11px] left-[11px]">
            <Icon d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3" size={15} />
          </span>
          <input
            type="search"
            aria-label="Search cases"
            placeholder="Search cases, product, scope, surgeon…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="border-line text-ink h-[38px] w-full rounded-[9px] border bg-white pr-3 pl-[33px] sm:w-[260px] text-[13px]"
          />
        </label>

        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen(open === "filters" ? null : "filters")}
            aria-expanded={open === "filters"}
            className={
              "text-ink-2 flex h-[38px] items-center gap-2 rounded-[9px] border bg-white px-3 text-[13px] font-semibold " +
              (filterCount > 0 ? "border-brand-edge" : "border-line")
            }
          >
            <Icon d="M22 3H2l8 9.5V19l4 2v-8.5z" size={15} />
            Filters
            {filterCount > 0 ? (
              <span className="bg-brand rounded-full px-1.5 text-[11px] font-bold text-white">
                {filterCount}
              </span>
            ) : null}
          </button>

          {open === "filters" ? (
            <div className="border-line shadow-popover absolute top-[46px] left-0 z-20 flex max-h-[70vh] w-[290px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border bg-white">
              <div className="border-line-3 flex items-center justify-between border-b px-4 py-3">
                <span className="text-sm font-bold">Filter cases</span>
                <button
                  type="button"
                  onClick={() => applyFilters(emptyFilters)}
                  disabled={filterCount === 0}
                  className="text-brand-ink border-0 bg-transparent p-0 text-[12.5px] font-semibold disabled:opacity-40"
                >
                  Clear all
                </button>
              </div>
              <div className="overflow-y-auto">
                {FACET_ORDER.map((facet) => {
                  const values = result.facets[facet];
                  const selected = filters[facet];
                  const expanded = openGroup === facet;
                  return (
                    <div key={facet} className="border-line-3 border-b last:border-b-0">
                      <button
                        type="button"
                        onClick={() => setOpenGroup(facet)}
                        aria-expanded={expanded}
                        className="flex w-full items-center justify-between border-0 bg-transparent px-4 py-2.5 text-left text-[13px] font-semibold"
                      >
                        <span>
                          {FACET_LABELS[facet]}
                          {selected.length > 0 ? (
                            <span className="text-brand-ink"> · {selected.length}</span>
                          ) : null}
                        </span>
                        <span className="text-faint text-[10px]">{expanded ? "▲" : "▼"}</span>
                      </button>
                      {expanded ? (
                        <div className="flex max-h-[220px] flex-col gap-0.5 overflow-y-auto px-4 pb-2.5">
                          {values.length === 0 ? (
                            <span className="text-muted text-xs">No values yet.</span>
                          ) : (
                            values.map((v) => (
                              <label
                                key={v.value}
                                className="text-ink-2 flex cursor-pointer items-center gap-2 py-1 text-[13px]"
                              >
                                <input
                                  type="checkbox"
                                  className="h-4 w-4"
                                  checked={selected.includes(v.value)}
                                  onChange={() => toggleFilter(facet, v.value)}
                                />
                                <span className="min-w-0 flex-1 truncate">{v.value}</span>
                                <span className="text-muted font-mono text-[11.5px]">{v.count}</span>
                              </label>
                            ))
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        <span className="text-muted text-[12.5px]" aria-live="polite">
          {pending ? "Loading…" : `${result.total.toLocaleString("en-IN")} shown`}
        </span>

        <div className="hidden flex-1 lg:block" />

        <label className="text-muted flex min-w-0 items-center gap-2 text-[12.5px]">
          Sort
          <select
            value={params.sort}
            onChange={(e) => go(href({ sort: e.target.value as Sort }))}
            className="border-line text-ink h-[38px] min-w-0 rounded-[9px] border bg-white px-2.5 text-[13px] font-medium"
          >
            {(Object.keys(SORT_LABELS) as Sort[]).map((s) => (
              <option key={s} value={s}>
                {SORT_LABELS[s]}
              </option>
            ))}
          </select>
        </label>

        <div className="bg-chip hidden rounded-[9px] p-[3px] lg:flex">
          <ViewButton
            label="Grid view"
            active={view === "grid"}
            onClick={() => writePrefs({ ...prefs, view: "grid" })}
            icon="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"
          />
          <ViewButton
            label="List view"
            active={view === "list"}
            onClick={() => writePrefs({ ...prefs, view: "list" })}
            icon="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"
          />
        </div>

        {view === "list" ? (
          <div className="relative hidden lg:block">
            <button
              type="button"
              onClick={() => setOpen(open === "columns" ? null : "columns")}
              aria-expanded={open === "columns"}
              className="border-line text-ink-2 flex h-[38px] items-center gap-2 rounded-[9px] border bg-white px-3 text-[13px] font-semibold"
            >
              <Icon d="M3 6h18M3 12h18M3 18h18" size={15} />
              Columns
            </button>
            {open === "columns" ? (
              <div className="border-line shadow-popover absolute top-[46px] right-0 z-20 flex w-[210px] flex-col gap-0.5 rounded-xl border bg-white p-3">
                <div className="pb-1.5 text-[13px] font-bold">Show columns</div>
                {COLUMNS.map((c) => (
                  <label
                    key={c.key}
                    className="text-ink-2 flex cursor-pointer items-center gap-2 py-1 text-[13px]"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={visible[c.key]}
                      onChange={() =>
                        writePrefs({ ...prefs, cols: { ...visible, [c.key]: !visible[c.key] } })
                      }
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Results */}
      {view === "list" ? (
        <div className="border-line hidden overflow-x-auto rounded-[14px] border bg-white lg:block">
          <div className="min-w-[860px]">
          <div
            className="text-muted border-line-3 bg-subtle grid items-center gap-3 border-b py-2.5 pr-[18px] pl-[18px] text-[11px] font-semibold tracking-[0.6px] uppercase"
            style={{ gridTemplateColumns: template }}
          >
            {visible.image ? <div /> : null}
            <div>Case ID</div>
            {shownColumns
              .filter((c) => c.key !== "image")
              .map((c) => (
                <div key={c.key}>{c.label}</div>
              ))}
          </div>
          {result.rows.length === 0 ? (
            <div className="text-muted px-5 py-12 text-center text-[13.5px]">
              {result.tileCounts.all === 0
                ? "No cases yet. They appear here after the first sync from the platform."
                : "No cases match these filters."}
            </div>
          ) : (
            result.rows.map((row) => (
              <ListRow key={row.id} row={row} visible={visible} template={template} />
            ))
          )}
          </div>
        </div>
      ) : null}
      {/* Cards: the grid view, and what a phone shows in place of the table. */}
      <div className={"grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 " + (view === "list" ? "lg:hidden" : "")}>
          {result.rows.map((row) => (
            <GridCard key={row.id} row={row} />
          ))}
          {result.rows.length === 0 ? (
            <div className="border-line text-muted col-span-full rounded-[14px] border bg-white px-5 py-12 text-center text-[13.5px]">
              {result.tileCounts.all === 0
                ? "No cases yet. They appear here after the first sync from the platform."
                : "No cases match these filters."}
            </div>
          ) : null}
        </div>

      {result.pageCount > 1 ? (
        <nav aria-label="Pages" className="flex items-center justify-between text-[13px]">
          <span className="text-muted">
            Page {params.page} of {result.pageCount}
          </span>
          <div className="flex gap-2">
            <PageLink href={href({ page: params.page - 1 })} disabled={params.page <= 1}>
              ← Previous
            </PageLink>
            <PageLink
              href={href({ page: params.page + 1 })}
              disabled={params.page >= result.pageCount}
            >
              Next →
            </PageLink>
          </div>
        </nav>
      ) : null}
    </div>
  );
}

function ListRow({
  row,
  visible,
  template,
}: {
  row: CaseRow;
  visible: Record<ColumnKey, boolean>;
  template: string;
}) {
  const edge = stateEdge(row.state);
  return (
    <Link
      href={`/cases/${row.id}`}
      className={
        "border-line-3 text-ink hover:bg-subtle grid items-center gap-3 border-b border-l-[3px] py-[11px] pr-[18px] pl-[15px] text-[13.5px] no-underline last:border-b-0 " +
        (edge.dimmed ? "opacity-60" : "")
      }
      style={{ gridTemplateColumns: template, borderLeftColor: edge.color ?? "transparent" }}
    >
      {visible.image ? <ProductTile product={row.product} imageId={row.imageId} src={row.imageSrc} size={34} /> : null}
      <span className="text-brand font-mono text-[12.5px] font-semibold [overflow-wrap:anywhere]" title={row.caseNumber ?? undefined}>
        {/* A long ID wraps at its underscores, not mid-number. */}
        {(row.caseNumber ?? "").split("_").map((piece, i) => (
          <Fragment key={i}>
            {i ? "_" : null}
            {i ? <wbr /> : null}
            {piece}
          </Fragment>
        ))}
      </span>
      {visible.product ? (
        <span className="flex min-w-0 items-center gap-2">
          <ProductDot product={row.product} />
          <span className="truncate font-semibold">{row.product ?? "—"}</span>
        </span>
      ) : null}
      {visible.scope ? (
        <span className="text-ink-2 truncate" title={row.scope ?? undefined}>
          {row.scope ?? "—"}
        </span>
      ) : null}
      {visible.surgeon ? <span className="text-ink-3 truncate">{row.surgeon ?? "—"}</span> : null}
      {visible.patient ? <span className="text-ink-3 truncate">{row.patient}</span> : null}
      {visible.hospital ? <span className="text-ink-3 truncate">{row.hospital ?? "—"}</span> : null}
      {visible.date ? <span className="text-ink-3">{row.surgeryDate}</span> : null}
      {visible.priority ? (
        <span>
          <PriorityBadge priority={row.priority} />
        </span>
      ) : null}
      {visible.status ? (
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <StatusBadge status={row.status} />
          <StateFlag state={row.state} />
        </span>
      ) : null}
    </Link>
  );
}

function GridCard({ row }: { row: CaseRow }) {
  const edge = stateEdge(row.state);
  return (
    <Link
      href={`/cases/${row.id}`}
      className={
        "text-ink flex flex-col gap-3 rounded-[14px] border border-l-[3px] bg-white p-4 no-underline " +
        (edge.dimmed ? "opacity-60" : "")
      }
      style={{ borderColor: edge.color ?? "#E4E7EC" }}
    >
      <div className="flex items-start gap-3">
        <ProductTile product={row.product} imageId={row.imageId} src={row.imageSrc} size={72} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start justify-between gap-2">
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-bold">{row.product ?? "—"}</span>
              {row.scope ? <span className="text-ink-2 truncate text-[12.5px]">{row.scope}</span> : null}
            </span>
            {row.priority ? <PriorityBadge priority={row.priority} compact /> : null}
          </div>
          <span className="text-brand font-mono text-[12.5px] font-semibold">{row.caseNumber}</span>
          <span className="text-ink-3 truncate text-[12.5px]">
            {[row.surgeon, row.hospital].filter(Boolean).join(" · ") || "—"}
          </span>
        </div>
      </div>
      <div className="border-line-3 flex items-center justify-between border-t pt-3">
        <StatusBadge status={row.status} />
        <span className="text-muted font-mono text-[11.5px]">Due {row.surgeryDateShort}</span>
      </div>
    </Link>
  );
}

function ViewButton({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={
        "flex h-8 w-9 items-center justify-center rounded-[7px] border-0 " +
        (active
          ? "text-ink bg-white shadow-[0_1px_2px_rgba(16,24,40,.08)]"
          : "text-muted bg-transparent")
      }
    >
      <Icon d={icon} size={16} />
    </button>
  );
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const className =
    "border-field flex h-[34px] items-center rounded-lg border bg-white px-3 text-[12.5px] font-semibold no-underline";
  if (disabled) {
    return <span className={`${className} text-faint`}>{children}</span>;
  }
  return (
    <Link href={href} className={`${className} text-ink`}>
      {children}
    </Link>
  );
}

function Icon({ d, size }: { d: string; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
