"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";

import { Icon, Pill, TONE_TEXT } from "@/components/setup/ui";
import type { Alert, Cell, SummaryCard, Tone } from "@/lib/resources/status";

export interface ListRow {
  id: string;
  name: string;
  /** The line under the name: an asset ID, a part number, a contact. */
  sub: string;
  photo: string | null;
  /** A material's swatch colour. */
  swatch: string | null;
  cells: [Cell, Cell, Cell];
  status: { label: string; tone: Tone };
}

// One shared setting for every list, as in the design: table or cards.
const VIEW_KEY = "mms.setup.view";
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};
const readView = () => {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "card" ? "card" : "table";
  } catch {
    return "table";
  }
};
function setView(view: "table" | "card") {
  try {
    window.localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Storage can be refused; the choice then lasts until reload.
  }
  listeners.forEach((l) => l());
}

const EDGE: Record<Tone, string> = {
  green: "#12B76A",
  amber: "#F79009",
  grey: "#D0D5DD",
  blue: "#2E90FA",
  red: "#F04438",
};

export function ResourceList({
  route,
  icon,
  columns,
  searchPlaceholder,
  rows,
  alerts,
  cards,
  hasStatus,
  emptyText,
}: {
  route: string;
  icon: string;
  columns: [string, string, string, string];
  searchPlaceholder: string;
  rows: ListRow[];
  alerts: Alert[];
  cards: SummaryCard[];
  hasStatus: boolean;
  emptyText: string;
}) {
  const [query, setQuery] = useState("");
  const [allAlerts, setAllAlerts] = useState(false);
  const view = useSyncExternalStore(subscribe, readView, () => "table" as const);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.sub, r.status.label, ...r.cells.flatMap((c) => [c.main, c.sub ?? ""])]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, query]);

  const critical = alerts.filter((a) => a.critical).length;
  const template = hasStatus
    ? "minmax(0,1.7fr) minmax(0,1.1fr) minmax(0,1.2fr) minmax(0,1.1fr) 170px"
    : "minmax(0,1.7fr) minmax(0,1.1fr) minmax(0,1.2fr) minmax(0,1.1fr)";

  return (
    <>
      {cards.length > 0 && rows.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {cards.map((card) => (
            <div key={card.label} className="border-line flex flex-col gap-1 rounded-xl border bg-white px-4 py-3.5">
              <span className="text-muted text-[11px] font-semibold tracking-[0.5px] uppercase">{card.label}</span>
              <span className={"text-[22px] leading-tight font-bold " + (card.tone ? TONE_TEXT[card.tone] : "text-ink")}>
                {card.value}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {alerts.length > 0 ? (
        <section className="flex flex-col gap-2.5 rounded-[14px] border border-[#FECDCA] bg-[#FFFBFA] px-[18px] py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h3 className="text-bad m-0 text-[13.5px] font-bold">
              {alerts.length} alert{alerts.length === 1 ? "" : "s"} need attention
              {critical ? ` · ${critical} critical` : ""}
            </h3>
            {alerts.length > 5 ? (
              <button
                type="button"
                onClick={() => setAllAlerts((v) => !v)}
                className="text-brand-ink border-0 bg-transparent p-0 text-[12.5px] font-semibold"
              >
                {allAlerts ? "Show less" : `Show all (${alerts.length})`}
              </button>
            ) : null}
          </div>
          {(allAlerts ? alerts : alerts.slice(0, 5)).map((a, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_60px] items-center gap-x-3 gap-y-1.5 text-[12.5px] md:grid-cols-[130px_minmax(0,0.8fr)_minmax(0,2fr)_60px]">
              <span>
                <Pill tone={a.critical ? "red" : "amber"} small>
                  {a.critical ? "Critical" : "Due soon / action"}
                </Pill>
              </span>
              <span className="truncate font-semibold">{a.resourceName}</span>
              <span className="text-ink-2">{a.text}</span>
              <Link
                href={`${route}/${a.resourceId}${a.tab === "overview" ? "" : `?tab=${a.tab}`}`}
                className="border-field text-ink flex h-7 items-center justify-center rounded-[7px] border bg-white text-xs font-semibold no-underline"
              >
                Open
              </Link>
            </div>
          ))}
        </section>
      ) : null}

      <div className="flex items-center gap-2.5">
        <label className="relative flex flex-1">
          <span className="text-faint absolute top-[10px] left-[11px]">
            <Icon d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3" size={15} />
          </span>
          <input
            type="search"
            aria-label="Search"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="border-line text-ink h-9 w-full max-w-[420px] rounded-[9px] border bg-white pr-3 pl-[33px] text-[13px]"
          />
        </label>
        <div className="hidden gap-1 md:flex">
          <ViewButton label="Table view" active={view === "table"} onClick={() => setView("table")} d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
          <ViewButton label="Card view" active={view === "card"} onClick={() => setView("card")} d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />
        </div>
      </div>

      {view === "table" ? (
        <div className="border-line hidden overflow-hidden rounded-[14px] border bg-white md:block">
          <div
            className="text-muted bg-subtle grid items-center gap-3 px-[18px] py-2.5 text-[10.5px] font-bold tracking-[0.5px] uppercase"
            style={{ gridTemplateColumns: template }}
          >
            {columns.map((c, i) => (
              <div key={i}>{c}</div>
            ))}
            {hasStatus ? <div>Status</div> : null}
          </div>
          {shown.map((row) => (
            <Link
              key={row.id}
              href={`${route}/${row.id}`}
              className="border-line-3 text-ink hover:bg-subtle grid items-center gap-3 border-t px-[18px] py-3 text-[13.5px] no-underline"
              style={{ gridTemplateColumns: template }}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <Thumb row={row} icon={icon} size={36} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold">{row.name}</span>
                  {row.sub ? <span className="text-muted truncate font-mono text-[11.5px]">{row.sub}</span> : null}
                </span>
              </span>
              {row.cells.map((cell, i) => (
                <CellView key={i} cell={cell} />
              ))}
              {hasStatus ? (
                <span>
                  <Pill tone={row.status.tone}>{row.status.label}</Pill>
                </span>
              ) : null}
            </Link>
          ))}
          {shown.length === 0 ? (
            <div className="text-muted border-line-3 border-t px-5 py-10 text-center text-[13px]">
              {rows.length === 0 ? emptyText : "Nothing matches your search."}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className={"grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3 " + (view === "table" ? "md:hidden" : "")}>
          {shown.map((row) => (
            <Link
              key={row.id}
              href={`${route}/${row.id}`}
              className="border-line text-ink flex flex-col gap-2.5 rounded-xl border border-l-[3px] bg-white p-4 no-underline"
              style={{ borderLeftColor: hasStatus ? EDGE[row.status.tone] : "#E24E1B" }}
            >
              <div className="flex items-start gap-3">
                <Thumb row={row} icon={icon} size={72} />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-bold">{row.name}</span>
                  {row.sub ? <span className="text-muted truncate font-mono text-[11.5px]">{row.sub}</span> : null}
                  <span className="text-ink-3 truncate text-[12.5px]">
                    {[row.cells[0].main, row.cells[0].sub].filter(Boolean).join(" · ")}
                  </span>
                </div>
              </div>
              <div className="text-ink-3 flex flex-col gap-0.5 text-[12.5px]">
                <span className="truncate">
                  <span className="text-muted">{columns[2]}: </span>
                  {row.cells[1].main}
                </span>
                <span className="truncate">
                  <span className="text-muted">{columns[3]}: </span>
                  {row.cells[2].main}
                  {row.cells[2].sub ? (
                    <span className={TONE_TEXT[row.cells[2].subTone ?? "grey"]}> · {row.cells[2].sub}</span>
                  ) : null}
                </span>
              </div>
              {hasStatus ? (
                <div>
                  <Pill tone={row.status.tone}>{row.status.label}</Pill>
                </div>
              ) : null}
            </Link>
          ))}
          {shown.length === 0 ? (
            <div className="border-line text-muted col-span-full rounded-[14px] border bg-white px-5 py-10 text-center text-[13px]">
              {rows.length === 0 ? emptyText : "Nothing matches your search."}
            </div>
          ) : null}
        </div>
    </>
  );
}

function CellView({ cell }: { cell: Cell }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="text-ink-2 truncate">{cell.main}</span>
      {cell.sub ? (
        <span className={`truncate text-[11.5px] font-semibold ${TONE_TEXT[cell.subTone ?? "grey"]}`}>{cell.sub}</span>
      ) : null}
    </span>
  );
}

function Thumb({ row, icon, size }: { row: ListRow; icon: string; size: number }) {
  if (row.photo) {
    // A stored upload served by this application; the image optimiser adds nothing.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={row.photo} alt="" width={size} height={size} className="flex-none rounded-lg object-cover" style={{ width: size, height: size }} />;
  }
  if (row.swatch) {
    return <span className="h-3.5 w-3.5 flex-none rounded-full" style={{ background: row.swatch }} aria-hidden="true" />;
  }
  return (
    <span
      className="bg-chip text-faint flex flex-none items-center justify-center rounded-lg"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Icon d={icon} size={Math.round(size * 0.45)} />
    </span>
  );
}

function ViewButton({ label, active, onClick, d }: { label: string; active: boolean; onClick: () => void; d: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={
        "flex h-8 w-8 items-center justify-center rounded-lg border-0 " +
        (active ? "bg-brand-tint text-brand" : "text-muted bg-transparent")
      }
    >
      <Icon d={d} size={16} />
    </button>
  );
}
