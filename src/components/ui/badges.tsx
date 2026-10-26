import {
  priorityBadge,
  productColours,
  stateEdge,
  statusBadge,
} from "@/lib/cases/classify";

/** No "use client": these render on either side, wherever they are imported. */

export function StatusBadge({ status }: { status: string | null }) {
  const { bg, fg } = statusBadge(status);
  return (
    <span
      className="inline-block rounded-md px-2 py-0.5 text-[11.5px] font-bold whitespace-nowrap"
      style={{ background: bg, color: fg }}
    >
      {status ?? "No status"}
    </span>
  );
}

export function PriorityBadge({
  priority,
  compact = false,
}: {
  priority: string | null;
  compact?: boolean;
}) {
  if (!priority) return <span className="text-faint">—</span>;
  const { bg, fg } = priorityBadge(priority);
  return (
    <span
      className={
        "inline-block rounded-md px-2 py-0.5 font-bold whitespace-nowrap " +
        (compact ? "text-[10px] tracking-[0.4px] uppercase" : "text-[11.5px]")
      }
      style={{ background: bg, color: fg }}
    >
      {priority}
    </span>
  );
}

/** `● ON HOLD` / `● CANCELLED`, beside a status badge. */
export function StateFlag({ state }: { state: string | null }) {
  const { color, label } = stateEdge(state);
  if (!label || !color) return null;
  return (
    <span className="text-[10.5px] font-bold tracking-[0.4px] whitespace-nowrap" style={{ color }}>
      ● {label}
    </span>
  );
}

/** The product's picture — or, without one, the gradient square that stands in for it. */
/** A product's — or a case's — picture; `src` (a case's own image) wins over the product's `imageId`. */
export function ProductTile({ product, size, imageId, src }: { product: string | null; size: number; imageId?: string | null; src?: string | null }) {
  if (src || imageId) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a stored upload, served by the files route
      <img
        src={src || `/api/files/${imageId}`}
        alt=""
        aria-hidden="true"
        className="border-line flex-none border bg-white object-contain"
        style={{ width: size, height: size, borderRadius: Math.round(size * 0.26) }}
      />
    );
  }
  const [from, to] = productColours(product);
  const icon = Math.round(size * 0.5);
  return (
    <span
      className="flex flex-none items-center justify-center text-white"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.26),
        background: `linear-gradient(135deg, ${from}, ${to})`,
      }}
      aria-hidden="true"
    >
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9" />
      </svg>
    </span>
  );
}

export function ProductDot({ product }: { product: string | null }) {
  return (
    <span
      className="h-[9px] w-[9px] flex-none rounded-[2px]"
      style={{ background: productColours(product)[1] }}
      aria-hidden="true"
    />
  );
}
