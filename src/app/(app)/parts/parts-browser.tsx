"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";

import { CubeChip, StagePill } from "@/components/parts/ui";
import type { PartListParams, PartListResult, PartRow, PartSort, PartTile } from "@/lib/parts/queries";

const TILE_DEFS: Array<{ key: PartTile; label: string; bg: string; fg: string; icon: string }> = [
  { key: "all", label: "All parts", bg: "#FFF1EB", fg: "#E24E1B", icon: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" },
  { key: "new", label: "New request", bg: "#EFF8FF", fg: "#175CD3", icon: "M12 5v14M5 12h14" },
  { key: "progress", label: "In progress", bg: "#FFFAEB", fg: "#B54708", icon: "M12 8v4l3 3M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0z" },
  { key: "completed", label: "Completed", bg: "#ECFDF3", fg: "#067647", icon: "M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14l-3-3" },
  { key: "archived", label: "Archived", bg: "#F2F4F7", fg: "#475467", icon: "M21 8v13H3V8M1 3h22v5H1zM10 12h4" },
];

const SORT_LABELS: Record<PartSort, string> = {
  id: "Part ID — latest first",
  idAsc: "Part ID — A to Z",
  due: "Due date",
  name: "Part name",
  material: "Material",
  progress: "Stage progress",
};

type ColumnKey = "case" | "material" | "machine" | "status" | "due";
const COLUMNS: Array<{ key: ColumnKey; label: string; width: string }> = [
  { key: "case", label: "Case", width: "minmax(0,0.7fr)" },
  { key: "material", label: "Material", width: "minmax(0,1fr)" },
  { key: "machine", label: "Machine", width: "minmax(0,1fr)" },
  { key: "status", label: "Status", width: "minmax(0,1.1fr)" },
  { key: "due", label: "Due", width: "minmax(0,0.7fr)" },
];

// Which columns show, and cards or a table, are personal choices kept in this browser.
const PREFS_KEY = "mms.parts.cols";
const VIEW_KEY = "mms.parts.view";
const listeners = new Set<() => void>();
const subscribe = (callback: () => void) => {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
};
function readPrefs(): string {
  try {
    return window.localStorage.getItem(PREFS_KEY) ?? "";
  } catch {
    return "";
  }
}
function readView(): string {
  try {
    return window.localStorage.getItem(VIEW_KEY) ?? "";
  } catch {
    return "";
  }
}
function writeView(view: "list" | "grid") {
  try {
    window.localStorage.setItem(VIEW_KEY, view);
  } catch {
    // As with the columns: kept until reload when storage is refused.
  }
  listeners.forEach((l) => l());
}
function writePrefs(next: Partial<Record<ColumnKey, boolean>>) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    // Private windows can refuse storage; the choice then lasts until reload.
  }
  listeners.forEach((l) => l());
}

function buildHref(pathname: string, params: PartListParams, change: Partial<PartListParams> & { request?: boolean }) {
  const next = { ...params, ...change };
  if (change.page === undefined) next.page = 1;
  const sp = new URLSearchParams();
  if (next.q) sp.set("q", next.q);
  if (next.tile !== "all") sp.set("tile", next.tile);
  if (next.sort !== "id") sp.set("sort", next.sort);
  if (next.page > 1) sp.set("page", String(next.page));
  if (change.request) sp.set("request", "1");
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function PartsBrowser({ params, result }: { params: PartListParams; result: PartListResult }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [colsOpen, setColsOpen] = useState(false);
  const [query, setQuery] = useState(params.q);

  const raw = useSyncExternalStore(subscribe, readPrefs, () => "");
  const view: "list" | "grid" = useSyncExternalStore(subscribe, readView, () => "") === "grid" ? "grid" : "list";
  const visible = useMemo(() => {
    const defaults: Record<ColumnKey, boolean> = { case: true, material: true, machine: true, status: true, due: true };
    try {
      return { ...defaults, ...(raw ? (JSON.parse(raw) as Partial<Record<ColumnKey, boolean>>) : {}) };
    } catch {
      return defaults;
    }
  }, [raw]);

  const href = (change: Partial<PartListParams> & { request?: boolean }) => buildHref(pathname, params, change);

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const typed = query.trim();
    if (typed === params.q) return;
    const timer = setTimeout(() => {
      startTransition(() => router.replace(buildHref(pathname, params, { q: typed }), { scroll: false }));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, params, pathname, router]);

  const shown = COLUMNS.filter((c) => visible[c.key]);
  const template = ["minmax(0,1.25fr)", "minmax(0,1.7fr)", ...shown.map((c) => c.width)].join(" ");

  return (
    <div className="flex flex-col gap-4">
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
              <span className="flex min-w-0 flex-col">
                <span className="text-ink font-mono text-[19px] leading-tight font-semibold">
                  {result.tileCounts[tile.key].toLocaleString("en-IN")}
                </span>
                <span className="text-ink-3 truncate text-xs">{tile.label}</span>
              </span>
            </Link>
          );
        })}
      </div>

      <div className="relative z-[4] flex flex-wrap items-center gap-2.5">
        <label className="relative flex w-full sm:w-[300px]">
          <span className="text-faint absolute top-[11px] left-3">
            <Icon d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3" size={15} />
          </span>
          <input
            type="search"
            aria-label="Search parts"
            placeholder="Search part, ID, material, case…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="border-line text-ink h-[38px] w-full rounded-[9px] border bg-white pr-3 pl-[34px] text-[13px]"
          />
        </label>
        <span className="text-muted text-[12.5px]" aria-live="polite">
          {pending ? "Loading…" : `${result.total.toLocaleString("en-IN")} shown`}
        </span>
        <div className="hidden flex-1 sm:block" />
        <label className="text-faint flex items-center gap-2 text-xs">
          Sort
          <select
            value={params.sort}
            onChange={(e) => startTransition(() => router.push(href({ sort: e.target.value as PartSort }), { scroll: false }))}
            className="border-line text-ink-2 h-[38px] rounded-[9px] border bg-white px-2.5 text-[13px]"
          >
            {(Object.keys(SORT_LABELS) as PartSort[]).map((s) => (
              <option key={s} value={s}>
                {SORT_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <div className="bg-chip hidden rounded-[9px] p-[3px] md:flex">
          <ViewButton label="Card view" active={view === "grid"} onClick={() => writeView("grid")} icon="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />
          <ViewButton label="List view" active={view === "list"} onClick={() => writeView("list")} icon="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
        </div>
        <div className={"relative hidden " + (view === "list" ? "md:block" : "")}>
          <button
            type="button"
            onClick={() => setColsOpen((o) => !o)}
            aria-expanded={colsOpen}
            className="border-line text-ink flex h-[38px] items-center gap-[7px] rounded-[9px] border bg-white px-[13px] text-[13px] font-semibold"
          >
            ☰ Columns
          </button>
          {colsOpen ? (
            <div className="border-line shadow-popover absolute top-[46px] right-0 flex w-[200px] flex-col gap-0.5 rounded-xl border bg-white px-3 py-2">
              {COLUMNS.map((c) => (
                <label key={c.key} className="text-ink-2 flex min-h-[30px] cursor-pointer items-center gap-[9px] text-[13px]">
                  <input
                    type="checkbox"
                    className="m-0 h-4 w-4"
                    checked={visible[c.key]}
                    onChange={() => writePrefs({ ...visible, [c.key]: !visible[c.key] })}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          ) : null}
        </div>
        <Link
          href={href({ request: true, page: params.page })}
          scroll={false}
          className="bg-brand-ink ml-auto flex h-[38px] items-center rounded-[9px] px-[15px] text-[13px] font-semibold whitespace-nowrap text-white no-underline sm:ml-0"
        >
          + Request a part
        </Link>
      </div>

      {/* The table, from tablet up, when chosen; cards otherwise — always on a phone, where seven columns cannot fit. */}
      <div className={"border-line hidden overflow-hidden rounded-[14px] border bg-white " + (view === "list" ? "md:block" : "")}>
        <div
          className="text-muted border-line-2 grid gap-3 border-b px-[18px] py-3 text-[11px] font-semibold tracking-[0.6px] uppercase"
          style={{ gridTemplateColumns: template }}
        >
          <div>Part ID</div>
          <div>Part</div>
          {shown.map((c) => (
            <div key={c.key}>{c.label}</div>
          ))}
        </div>
        {result.rows.map((row) => (
          <TableRow key={row.id} row={row} visible={visible} template={template} />
        ))}
        {result.rows.length === 0 ? <Empty total={result.tileCounts.all} /> : null}
      </div>

      <div className={"grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 " + (view === "list" ? "md:hidden" : "")} data-testid="part-cards">
        {result.rows.map((row) => (
          <PartCard key={row.id} row={row} />
        ))}
        {result.rows.length === 0 ? (
          <div className="border-line col-span-full rounded-[14px] border bg-white">
            <Empty total={result.tileCounts.all} />
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
            <PageLink href={href({ page: params.page + 1 })} disabled={params.page >= result.pageCount}>
              Next →
            </PageLink>
          </div>
        </nav>
      ) : null}
    </div>
  );
}

const meta = (row: PartRow) =>
  [row.technology, `qty ${row.quantity}`, row.workflowName].filter(Boolean).join(" · ");

function TableRow({ row, visible, template }: { row: PartRow; visible: Record<ColumnKey, boolean>; template: string }) {
  return (
    <div
      className="border-line-3 hover:bg-subtle relative grid items-center gap-3 border-b px-[18px] py-[13px] text-[13px] last:border-b-0"
      style={{ gridTemplateColumns: template }}
    >
      <Link href={`/parts/${row.id}`} className="text-ink font-mono text-[12.5px] font-semibold [overflow-wrap:anywhere] no-underline after:absolute after:inset-0">
        {row.partNumber}
      </Link>
      <div className="flex min-w-0 items-center gap-2.5">
        <PartThumb row={row} size={34} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-ink truncate text-[13.5px] font-semibold">{row.name}</span>
          <span className="text-muted truncate text-[11.5px]">{meta(row)}</span>
        </div>
      </div>
      {visible.case ? (
        row.caseId ? (
          <Link href={`/cases/${row.caseId}`} className="text-brand-ink relative z-[1] justify-self-start font-mono text-[12.5px] underline">
            {row.caseNumber}
          </Link>
        ) : (
          <span className="text-faint">—</span>
        )
      ) : null}
      {visible.material ? <div className="text-ink-2 truncate">{row.material ?? "—"}</div> : null}
      {visible.machine ? <div className="text-ink-2 truncate">{row.printer ?? "—"}</div> : null}
      {visible.status ? (
        <div className="min-w-0">
          <StagePill name={row.stageName} stageIndex={row.stageIndex} stageCount={row.stageCount} />
        </div>
      ) : null}
      {visible.due ? <div className="text-ink-2 font-mono text-[12.5px]">{row.due ?? "—"}</div> : null}
    </div>
  );
}

/** A part as a card: what it is, where it is on its route, and the facts the table shows. */
function PartCard({ row }: { row: PartRow }) {
  const percent = row.stageCount > 1 ? Math.round((row.stageIndex / (row.stageCount - 1)) * 100) : row.stageCount === 1 ? 100 : 0;
  return (
    <div className="border-line hover:border-brand-edge relative flex flex-col gap-3 rounded-[14px] border bg-white p-4">
      <div className="flex items-start gap-3">
        <PartThumb row={row} size={80} />
        <Link href={`/parts/${row.id}`} className="text-ink flex min-w-0 flex-1 flex-col gap-0.5 no-underline after:absolute after:inset-0">
          <span className="text-sm font-bold [overflow-wrap:anywhere]">{row.name}</span>
          <span className="text-brand font-mono text-xs font-semibold break-all">{row.partNumber}</span>
          <span className="text-muted truncate text-xs">{meta(row) || "—"}</span>
        </Link>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <StagePill name={row.stageName} stageIndex={row.stageIndex} stageCount={row.stageCount} />
          {row.stageCount ? (
            <span className="text-muted font-mono text-[11.5px] whitespace-nowrap">
              Stage {row.stageIndex + 1} of {row.stageCount}
            </span>
          ) : null}
        </div>
        <div className="bg-chip h-1.5 overflow-hidden rounded-full" role="progressbar" aria-label="Stage progress" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="bg-brand h-full rounded-full" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <dl className="border-line-3 m-0 grid grid-cols-2 gap-x-3 gap-y-2 border-t pt-3 text-[12.5px]">
        <Fact label="Case">
          {row.caseId ? (
            <Link href={`/cases/${row.caseId}`} className="text-brand-ink relative z-[1] font-mono underline">
              {row.caseNumber}
            </Link>
          ) : (
            <span className="text-muted">No case</span>
          )}
        </Fact>
        <Fact label="Due">
          <span className="font-mono">{row.due ?? "—"}</span>
        </Fact>
        <Fact label="Material">{row.material ?? "—"}</Fact>
        <Fact label="Machine">{row.printer ?? "—"}</Fact>
      </dl>
    </div>
  );
}

/** The product image from the part request, or the part icon when there is none. */
function PartThumb({ row, size }: { row: PartRow; size: number }) {
  if (!row.imageId) return <CubeChip size={size} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a stored request image
    <img
      src={`/api/part-files/${row.imageId}`}
      alt=""
      loading="lazy"
      width={size}
      height={size}
      className="border-line-2 flex-none rounded-[10px] border bg-white object-cover"
      style={{ width: size, height: size }}
    />
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-faint text-[10.5px] font-semibold tracking-[0.5px] uppercase">{label}</dt>
      <dd className="text-ink-2 m-0 truncate">{children}</dd>
    </div>
  );
}

function ViewButton({ label, active, onClick, icon }: { label: string; active: boolean; onClick: () => void; icon: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={
        "flex h-8 w-9 items-center justify-center rounded-[7px] border-0 " +
        (active ? "text-ink bg-white shadow-[0_1px_2px_rgba(16,24,40,.08)]" : "text-muted bg-transparent")
      }
    >
      <Icon d={icon} size={16} />
    </button>
  );
}

function Empty({ total }: { total: number }) {
  return (
    <div className="text-muted p-9 text-center text-[13px]">
      {total === 0 ? "No parts yet. Request the first one with “+ Request a part”." : "No parts match."}
    </div>
  );
}

function PageLink({ href, disabled, children }: { href: string; disabled: boolean; children: React.ReactNode }) {
  const className = "border-field flex h-[34px] items-center rounded-lg border bg-white px-3 text-[12.5px] font-semibold no-underline";
  if (disabled) return <span className={`${className} text-faint`}>{children}</span>;
  return (
    <Link href={href} className={`${className} text-ink`}>
      {children}
    </Link>
  );
}

function Icon({ d, size }: { d: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
