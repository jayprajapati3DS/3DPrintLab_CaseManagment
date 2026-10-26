"use client";

import { useRef } from "react";

import {
  drawingLabel,
  tableMinWidth,
  tableTemplate,
  type BalloonColumn,
  type InspectionImage,
  type InspectionPoint,
  type InspectionRow,
} from "@/lib/parts/request-form";

/**
 * Inspection drawings with numbered balloons.
 *
 * A balloon marks one characteristic to inspect: an arrow tip on the drawing,
 * a numbered circle beside it, and a row in the table below. Positions are
 * percentages of the image, so a balloon stays on its feature at any size —
 * a phone in the workshop or a monitor in the office.
 */

export interface DrawingImage extends InspectionImage {
  /** Where the browser can load the picture from. */
  url: string;
  /** The picked file, until the request is saved. */
  file?: File;
}

export interface BalloonState {
  images: DrawingImage[];
  points: InspectionPoint[];
  rows: InspectionRow[];
  /** The last balloon number given out; numbers are never reused. */
  seq: number;
}

export const emptyBalloons = (): BalloonState => ({ images: [], points: [], rows: [], seq: 0 });

const clamp = (n: number) => Math.min(100, Math.max(0, n));
const rowIdFor = (n: number) => `b${n}`;

// --- The drawing, with its leader lines ------------------------------------------------

function Leaders({ image, points }: { image: InspectionImage; points: InspectionPoint[] }) {
  const { w, h } = image;
  const size = Math.max(w, h);
  const head = size * 0.022;
  const stroke = size * 0.0035;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0 h-full w-full overflow-visible"
    >
      {points.map((p) => {
        const x1 = (p.bx / 100) * w;
        const y1 = (p.by / 100) * h;
        const x2 = (p.x / 100) * w;
        const y2 = (p.y / 100) * h;
        const length = Math.hypot(x2 - x1, y2 - y1) || 1;
        const ux = (x2 - x1) / length;
        const uy = (y2 - y1) / length;
        // The arrowhead: its tip on the feature, its base a head-length back.
        const bx = x2 - ux * head;
        const by = y2 - uy * head;
        const half = head * 0.4;
        const arrow = `${x2},${y2} ${bx - uy * half},${by + ux * half} ${bx + uy * half},${by - ux * half}`;
        return (
          <g key={p.n}>
            <line x1={x1} y1={y1} x2={bx} y2={by} stroke="#E24E1B" strokeWidth={stroke} strokeLinecap="round" />
            <polygon points={arrow} fill="#E24E1B" />
          </g>
        );
      })}
    </svg>
  );
}

const BALLOON =
  "bg-brand absolute flex h-[26px] w-[26px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white p-0 font-mono text-[11px] font-bold text-white shadow-[0_1px_4px_rgba(0,0,0,.35)]";

/** A drawing as it was saved: balloons in place, nothing to move. */
export function BalloonDrawing({
  image,
  url,
  points,
  label,
}: {
  image: InspectionImage;
  url: string;
  points: InspectionPoint[];
  label: string;
}) {
  return (
    <figure className="border-line m-0 overflow-hidden rounded-[10px] border">
      <figcaption className="border-line-2 bg-subtle flex items-center gap-2 border-b px-3 py-2 text-[12.5px]">
        <span className="font-bold">{label}</span>
        <span className="text-muted min-w-0 flex-1 truncate">{image.name}</span>
        <span className="bg-brand-tint text-brand-ink rounded-full px-2 py-px text-[11px] font-bold">
          {points.length} {points.length === 1 ? "balloon" : "balloons"}
        </span>
      </figcaption>
      <div className="relative bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element -- a stored drawing, served by the file route */}
        <img src={url} alt={`${label} — ${image.name}`} className="block h-auto w-full" />
        <Leaders image={image} points={points} />
        {points.map((p) => (
          <span key={p.n} className={BALLOON} style={{ left: `${p.bx}%`, top: `${p.by}%` }}>
            {p.n}
          </span>
        ))}
      </div>
    </figure>
  );
}

// --- The editor ------------------------------------------------------------------------

export function BalloonEditor({
  columns,
  value,
  onChange,
  onError,
}: {
  columns: BalloonColumn[];
  value: BalloonState;
  onChange: (next: BalloonState) => void;
  onError: (message: string) => void;
}) {
  // A drag ends with a click on whatever is under the pointer; without this a
  // balloon dragged across the drawing would drop a second one where it lands.
  const draggedAt = useRef(0);

  async function addImages(files: FileList | null) {
    if (!files) return;
    const added: DrawingImage[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) {
        onError(`"${file.name}" is not an image.`);
        continue;
      }
      if (value.images.length + added.length >= 12) {
        onError("A request takes at most 12 drawings.");
        break;
      }
      const url = URL.createObjectURL(file);
      try {
        const size = await imageSize(url);
        added.push({ id: `i${crypto.randomUUID().slice(0, 8)}`, name: file.name, w: size.w, h: size.h, url, file });
      } catch {
        URL.revokeObjectURL(url);
        onError(`"${file.name}" could not be read as an image.`);
      }
    }
    if (added.length > 0) onChange({ ...value, images: [...value.images, ...added] });
  }

  function removeImage(id: string) {
    const image = value.images.find((i) => i.id === id);
    if (image) URL.revokeObjectURL(image.url);
    onChange({
      ...value,
      images: value.images.filter((i) => i.id !== id),
      points: value.points.filter((p) => p.imgId !== id),
      rows: value.rows.filter((r) => r.imgId !== id),
    });
  }

  function place(imgId: string, event: React.MouseEvent<HTMLButtonElement>) {
    if (Date.now() - draggedAt.current < 350) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = clamp(((event.clientX - rect.left) / rect.width) * 100);
    const y = clamp(((event.clientY - rect.top) / rect.height) * 100);
    const n = value.seq + 1;
    // The balloon sits up and to the right of its feature, unless that would
    // put it off the drawing.
    const bx = x + 9 > 95 ? x - 9 : x + 9;
    const by = y - 14 < 5 ? y + 14 : y - 14;
    onChange({
      ...value,
      seq: n,
      points: [...value.points, { n, imgId, x, y, bx: clamp(bx), by: clamp(by) }],
      rows: [...value.rows, { id: rowIdFor(n), imgId, balloon: String(n), vals: {} }],
    });
  }

  function movePoint(n: number, which: "tip" | "balloon", x: number, y: number) {
    onChange({
      ...value,
      points: value.points.map((p) =>
        p.n !== n ? p : which === "tip" ? { ...p, x: clamp(x), y: clamp(y) } : { ...p, bx: clamp(x), by: clamp(y) },
      ),
    });
  }

  function startDrag(n: number, which: "tip" | "balloon", event: React.PointerEvent<HTMLButtonElement>) {
    // The drawing the handle sits on: positions are measured against it.
    const frame = event.currentTarget.closest<HTMLElement>("[data-drawing]");
    if (!frame) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const rect = frame.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      draggedAt.current = Date.now();
      movePoint(n, which, ((e.clientX - rect.left) / rect.width) * 100, ((e.clientY - rect.top) / rect.height) * 100);
    };
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  }

  function nudge(point: InspectionPoint, which: "tip" | "balloon", event: React.KeyboardEvent) {
    const step = event.shiftKey ? 5 : 1;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const by = delta[event.key];
    if (!by) return;
    event.preventDefault();
    const [x, y] = which === "tip" ? [point.x, point.y] : [point.bx, point.by];
    movePoint(point.n, which, x + by[0], y + by[1]);
  }

  function removeRow(row: InspectionRow) {
    onChange({
      ...value,
      rows: value.rows.filter((r) => r.id !== row.id),
      points: value.points.filter((p) => rowIdFor(p.n) !== row.id),
    });
  }

  const setRow = (id: string, fn: (row: InspectionRow) => InspectionRow) =>
    onChange({ ...value, rows: value.rows.map((r) => (r.id === id ? fn(r) : r)) });

  const template = tableTemplate(columns.length, true);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="bg-ink relative inline-flex h-9 cursor-pointer items-center gap-1.5 overflow-hidden rounded-lg px-3.5 text-[12.5px] font-semibold text-white">
          + Add drawing image(s)
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            aria-label="Add drawing images"
            onChange={(e) => {
              void addImages(e.target.files);
              e.target.value = "";
            }}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
        <span className="text-muted min-w-[200px] flex-1 text-xs">
          Click a drawing to place a numbered balloon (each adds a row below). Drag the balloon or its arrow point to
          adjust — or focus one and use the arrow keys.
        </span>
      </div>

      {value.images.map((image, index) => {
        const points = value.points.filter((p) => p.imgId === image.id);
        const label = `Drawing ${index + 1}`;
        return (
          <div key={image.id} className="border-line overflow-hidden rounded-[10px] border">
            <div className="border-line-2 bg-subtle flex items-center gap-2 border-b px-3 py-2 text-[12.5px]">
              <span className="font-bold">{label}</span>
              <span className="text-muted min-w-0 flex-1 truncate">{image.name}</span>
              <span className="bg-brand-tint text-brand-ink rounded-full px-2 py-px text-[11px] font-bold whitespace-nowrap">
                {points.length} {points.length === 1 ? "balloon" : "balloons"}
              </span>
              <button
                type="button"
                onClick={() => removeImage(image.id)}
                className="h-7 rounded-md border border-[#FECDCA] bg-white px-2.5 text-xs font-semibold text-[#D92D20]"
              >
                Remove
              </button>
            </div>
            <div data-drawing className="relative touch-manipulation">
              <button
                type="button"
                onClick={(e) => place(image.id, e)}
                aria-label={`${label} — click to place a balloon`}
                className="block w-full cursor-crosshair border-0 bg-white p-0"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the picked file */}
                <img src={image.url} alt={label} className="block h-auto w-full" />
              </button>
              <Leaders image={image} points={points} />
              {points.map((p) => (
                <span key={p.n} className="contents">
                  <button
                    type="button"
                    onPointerDown={(e) => startDrag(p.n, "tip", e)}
                    onKeyDown={(e) => nudge(p, "tip", e)}
                    aria-label={`Arrow point of balloon ${p.n} — drag or use arrow keys to move`}
                    title="Drag to move the arrow point"
                    style={{ left: `${p.x}%`, top: `${p.y}%` }}
                    className="border-brand absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-move touch-none rounded-full border-2 bg-white/55 p-0"
                  />
                  <button
                    type="button"
                    onPointerDown={(e) => startDrag(p.n, "balloon", e)}
                    onKeyDown={(e) => nudge(p, "balloon", e)}
                    aria-label={`Balloon ${p.n} — drag or use arrow keys to move`}
                    title="Drag to move the balloon"
                    style={{ left: `${p.bx}%`, top: `${p.by}%` }}
                    className={`${BALLOON} cursor-move touch-none`}
                  >
                    {p.n}
                  </button>
                </span>
              ))}
            </div>
          </div>
        );
      })}

      <div className="border-line overflow-x-auto rounded-[10px] border">
        <div style={{ minWidth: tableMinWidth(columns.length) }}>
          <div
            className="border-line-2 bg-subtle text-ink-3 grid gap-1.5 border-b px-2.5 py-2 text-[10.5px] font-bold tracking-[0.4px]"
            style={{ gridTemplateColumns: template }}
          >
            <div>Sl. No.</div>
            <div>Balloon ID</div>
            {columns.map((c) => (
              <div key={c.id} className="truncate" title={c.label}>
                {c.label}
              </div>
            ))}
            <div />
          </div>
          {value.rows.map((row, index) => (
            <div
              key={row.id}
              className="border-line-3 grid items-center gap-1.5 border-b px-2.5 py-1.5"
              style={{ gridTemplateColumns: template }}
            >
              <div className="text-ink-3 font-mono text-[12.5px]">{index + 1}</div>
              <div className="flex flex-col gap-0.5">
                <input
                  aria-label="Balloon ID"
                  value={row.balloon}
                  maxLength={20}
                  onChange={(e) => setRow(row.id, (r) => ({ ...r, balloon: e.target.value }))}
                  className="border-field h-[30px] w-full min-w-0 rounded-md border px-1.5 font-mono text-[12.5px]"
                />
                <span className="text-faint text-[10px]">{drawingLabel(value.images, row.imgId)}</span>
              </div>
              {columns.map((c) => (
                <input
                  key={c.id}
                  aria-label={`${c.label}, row ${index + 1}`}
                  value={row.vals[c.id] ?? ""}
                  maxLength={300}
                  onChange={(e) => setRow(row.id, (r) => ({ ...r, vals: { ...r.vals, [c.id]: e.target.value } }))}
                  className="border-field h-[30px] w-full min-w-0 rounded-md border px-1.5 text-[12.5px]"
                />
              ))}
              <button
                type="button"
                onClick={() => removeRow(row)}
                aria-label={`Remove row ${index + 1}`}
                className="text-faint h-7 w-7 rounded-md border-0 bg-transparent"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        {value.rows.length === 0 ? (
          <div className="text-faint p-3 text-center text-xs">
            No characteristics yet — place balloons on a drawing or add a row.
          </div>
        ) : null}
        <div className="px-2.5 py-2">
          <button
            type="button"
            disabled={value.rows.length >= 300}
            onClick={() =>
              onChange({
                ...value,
                rows: [...value.rows, { id: `m${crypto.randomUUID().slice(0, 8)}`, imgId: "", balloon: "", vals: {} }],
              })
            }
            className="border-field text-ink-2 h-[30px] rounded-md border border-dashed bg-white px-2.5 text-xs font-semibold"
          >
            + Add row
          </button>
        </div>
      </div>
    </div>
  );
}

function imageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
    img.onerror = () => reject(new Error("not an image"));
    img.src = url;
  });
}
