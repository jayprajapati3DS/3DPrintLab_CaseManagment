/**
 * The pieces every parts screen shares: the stage pill, the stage stepper and
 * the part's cube. No "use client" — they render on either side.
 */

export const CUBE = "M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9";

/**
 * A part on its first stage is indigo, on its last green, between them orange;
 * one with no workflow yet, and so no stages, grey.
 */
export function stageTone(stageIndex: number, stageCount: number): { bg: string; fg: string } {
  if (stageCount === 0) return { bg: "#F2F4F7", fg: "#475467" };
  if (stageIndex >= stageCount - 1) return { bg: "#ECFDF3", fg: "#067647" };
  if (stageIndex === 0) return { bg: "#EEF4FF", fg: "#3538CD" };
  return { bg: "#FFF1EB", fg: "#C4320A" };
}

export function StagePill({
  name,
  stageIndex,
  stageCount,
  large = false,
}: {
  name: string;
  stageIndex: number;
  stageCount: number;
  large?: boolean;
}) {
  const tone = stageTone(stageIndex, stageCount);
  return (
    <span
      className={
        // A long stage name is cut short within its column; the whole name shows on hover.
        "inline-block max-w-full truncate rounded-full align-middle font-bold whitespace-nowrap " +
        (large ? "px-[11px] py-1 text-[12.5px]" : "px-[9px] py-[3px] text-[11.5px]")
      }
      style={{ background: tone.bg, color: tone.fg }}
      title={name}
    >
      {name}
    </span>
  );
}

export function CubeChip({ size = 38 }: { size?: number }) {
  return (
    <span
      className="bg-brand-wash text-brand flex flex-none items-center justify-center rounded-[10px]"
      style={{ width: size, height: size }}
    >
      <svg
        width={Math.round(size * 0.47)}
        height={Math.round(size * 0.47)}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={CUBE} />
      </svg>
    </span>
  );
}

/**
 * The workflow's stages in a row: done ones ticked green, the current one
 * ringed orange. With many stages on a narrow screen the row scrolls rather
 * than squeezing the names into a column of letters.
 */
export function Stepper({ stages, current, small = false }: { stages: string[]; current: number; small?: boolean }) {
  const dot = small ? 20 : 22;
  return (
    <div className="overflow-x-auto pb-1">
      <ol className="m-0 flex min-w-max list-none p-0 sm:min-w-0" aria-label="Stages">
        {stages.map((name, i) => {
          const done = i < current;
          const now = i === current;
          return (
            <li
              key={i}
              aria-current={now ? "step" : undefined}
              className="relative flex w-[92px] flex-none flex-col items-center gap-1.5 sm:w-auto sm:min-w-0 sm:flex-1"
            >
              {i < stages.length - 1 ? (
                <span
                  className="absolute left-1/2 h-0.5 w-full"
                  style={{ top: dot / 2 - 1, background: done ? "#12B76A" : "#E4E7EC" }}
                />
              ) : null}
              <span
                className="relative flex items-center justify-center rounded-full border-2"
                style={{
                  width: dot,
                  height: dot,
                  borderColor: done ? "#12B76A" : now ? "#E24E1B" : "#D0D5DD",
                  background: done ? "#12B76A" : "#FFFFFF",
                }}
              >
                {done ? (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                ) : null}
              </span>
              <span
                className={
                  "px-[3px] text-center leading-[1.25] " +
                  (small ? "text-[10.5px] " : "text-[11px] ") +
                  (now ? "text-ink font-bold" : done ? "text-ink-2 font-medium" : "text-faint font-medium")
                }
              >
                {name}
                {done ? <span className="sr-only"> (done)</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function SourcingTag({ sourcing }: { sourcing: string }) {
  const out = sourcing === "Outsourced";
  return (
    <span
      className={
        "rounded px-[7px] py-px text-[10px] font-bold tracking-[0.4px] uppercase " +
        (out ? "bg-warn-tint text-warn" : "bg-info-tint text-info")
      }
    >
      {out ? "Outsourced" : "In-house"}
    </span>
  );
}
