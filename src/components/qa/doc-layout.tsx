import { cellText, LAYOUT_COLUMNS, type LayoutCell, type LayoutPart } from "@/lib/qa/layouts";

/**
 * One part of a header/footer design — the header above a form, or the footer
 * below it — drawn as its grid of cells with the form's own words filled in.
 */

const SIZE: Record<LayoutCell["size"], string> = { sm: "text-[11.5px]", md: "text-[12.5px]", lg: "text-[15px]", xl: "text-[18px]" };
const ALIGN: Record<LayoutCell["align"], string> = { left: "text-left justify-start", center: "text-center justify-center", right: "text-right justify-end" };

export function DocLayoutPart({ part, values, testId }: { part: LayoutPart; values: Record<string, string>; testId?: string }) {
  if (part.cells.length === 0) return null;
  return (
    <div
      data-testid={testId}
      className={"grid text-[#101828] " + (part.border ? "gap-px border border-[#9CA3AF] bg-[#9CA3AF]" : "gap-x-2 gap-y-1")}
      style={{ gridTemplateColumns: `repeat(${LAYOUT_COLUMNS}, minmax(0, 1fr))` }}
    >
      {part.cells.map((c, i) => (
        <div
          key={i}
          className={"flex items-center px-2.5 py-1.5 " + SIZE[c.size] + " " + ALIGN[c.align] + (c.bold ? " font-bold" : "") + (part.border ? " bg-white" : "")}
          style={{ gridColumn: `span ${Math.min(c.span, LAYOUT_COLUMNS)} / span ${Math.min(c.span, LAYOUT_COLUMNS)}`, gridRow: c.rows > 1 ? `span ${c.rows} / span ${c.rows}` : undefined, ...(c.fill ? { background: c.fill } : {}) }}
        >
          {c.kind === "logo" ? <Logo text={logoText(c.text, values)} /> : <span className="min-w-0 [overflow-wrap:anywhere] whitespace-pre-line">{cellText(c.text, values)}</span>}
        </div>
      ))}
    </div>
  );
}

/** A logo's words — the company's name, else the space's, as the forms have always fallen back. */
function logoText(text: string, values: Record<string, string>): string {
  const own = cellText(text, values);
  return own && own !== "—" ? own : values["company.name"] || values["space.name"] || "Company";
}

/** The company's mark: its first word large, the rest small beneath — as the forms have always shown it. */
function Logo({ text }: { text: string }) {
  const [first, ...rest] = (text === "—" ? "Company" : text).split(" ");
  return (
    <span className="flex flex-col items-center leading-tight">
      <span className="text-[22px] font-extrabold tracking-[-0.5px] text-[#1F2A37]">{first}</span>
      {rest.length ? <span className="text-[10px] font-bold tracking-[1.5px] text-[#0E9384] uppercase">{rest.join(" ")}</span> : null}
    </span>
  );
}
