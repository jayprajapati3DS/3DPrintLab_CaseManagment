import type { Tone } from "@/lib/resources/status";

/**
 * The small pieces every setup screen is made of. No "use client": they render
 * on either side, wherever they are imported.
 */

const TONES: Record<Tone, string> = {
  green: "bg-ok-tint text-ok",
  amber: "bg-warn-tint text-warn",
  grey: "bg-chip text-ink-3",
  blue: "bg-info-tint text-info",
  red: "bg-bad-tint text-bad",
};

export const TONE_TEXT: Record<Tone, string> = {
  green: "text-ok",
  amber: "text-warn",
  grey: "text-muted",
  blue: "text-info",
  red: "text-bad",
};

export function Pill({ tone, children, small = false }: { tone: Tone; children: React.ReactNode; small?: boolean }) {
  return (
    <span
      className={
        `inline-block rounded-full font-semibold whitespace-nowrap ${TONES[tone]} ` +
        (small ? "px-2 py-0.5 text-[11px]" : "px-[9px] py-[3px] text-[11.5px]")
      }
    >
      {children}
    </span>
  );
}

export function Icon({ d, size = 17, className }: { d: string; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={d} />
    </svg>
  );
}

/** The peach banner that opens each setup page. */
export function IntroBanner({ icon, before, space, after }: { icon: string; before: string; space: string; after: string }) {
  return (
    <div className="flex items-center gap-3.5 rounded-[14px] border border-[#FBD5C5] bg-[#FFF6F2] px-4 py-4 sm:px-[18px]">
      <span className="text-brand flex h-9 w-9 flex-none items-center justify-center rounded-[9px] bg-white">
        <Icon d={icon} size={18} />
      </span>
      <p className="text-ink-2 m-0 text-[13.5px] leading-[1.5]">
        {before}
        <b className="text-ink">{space}</b>
        {after}
      </p>
    </div>
  );
}

export function SectionCard({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-line flex min-w-0 flex-col gap-3.5 rounded-[14px] border bg-white px-4 py-[18px] sm:px-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="m-0 text-sm font-bold">{title}</h3>
          {hint ? <p className="text-muted m-0 text-[12.5px] leading-[1.5]">{hint}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A feature that is planned, said plainly where it would be. */
export function Planned({ phase, title, children }: { phase: number; title: string; children: React.ReactNode }) {
  return (
    <div className="border-field flex flex-col items-center gap-1.5 rounded-[14px] border border-dashed bg-white px-6 py-10 text-center">
      <div className="text-brand-ink text-[11px] font-semibold tracking-[0.9px] uppercase">Planned · phase {phase}</div>
      <div className="text-[15px] font-bold">{title}</div>
      <p className="text-muted m-0 max-w-[460px] text-[13px] leading-[1.5]">{children}</p>
    </div>
  );
}

// Control styles, as the setup board draws them: 38px controls, 8px radius.
export const S_INPUT =
  "border-field text-ink h-[38px] w-full rounded-lg border bg-white px-2.5 text-[13px] disabled:bg-subtle disabled:text-ink-3";
export const S_LABEL = "text-ink-3 text-[11px] font-semibold tracking-[0.5px] uppercase";
export const S_BTN_DARK =
  "bg-ink h-9 rounded-[9px] border-0 px-3.5 text-[13px] font-semibold whitespace-nowrap text-white disabled:opacity-45";
export const S_BTN_PRIMARY =
  "bg-brand h-9 rounded-[9px] border-0 px-3.5 text-[13px] font-bold whitespace-nowrap text-white disabled:opacity-45";
export const S_BTN_OUTLINE =
  "border-field text-ink h-9 rounded-[9px] border bg-white px-3 text-[13px] font-semibold whitespace-nowrap disabled:opacity-45";
export const S_BTN_SMALL =
  "border-field text-ink-2 h-8 rounded-lg border bg-white px-2.5 text-[12.5px] font-semibold whitespace-nowrap disabled:opacity-45";
export const S_BTN_DANGER =
  "text-bad h-9 rounded-[9px] border border-[#FDA29B] bg-white px-3 text-[13px] font-semibold whitespace-nowrap disabled:opacity-45";
export const S_TH = "text-muted px-3 py-2.5 text-left text-[10.5px] font-bold tracking-[0.5px] uppercase whitespace-nowrap";
export const S_TD = "border-line-3 text-ink-2 border-t px-3 py-2.5 align-top text-[13px]";
