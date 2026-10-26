import { z } from "zod";

/**
 * Header and footer designs for controlled-document QA forms — designed once
 * in QA Form Setup, chosen by each form. A design is a grid of cells (twelve
 * columns; a cell spans columns and rows). The words in a cell are the form's
 * own: {form.name}, {form.code}, {form.rev}… come from each QA form, and
 * {company.…} from Company details — so a design holds no text of its own that
 * a form would have to repeat.
 *
 * No server imports: the editor and the form view read this.
 */

export const LAYOUT_COLUMNS = 12;

export interface LayoutCell {
  /** Text with variables; for a logo cell, what shows when there is no logo text. */
  text: string;
  kind: "text" | "logo";
  /** Columns spanned, of twelve; rows spanned. */
  span: number;
  rows: number;
  align: "left" | "center" | "right";
  bold: boolean;
  size: "sm" | "md" | "lg" | "xl";
  /** Background colour (#rrggbb), or "" for none. */
  fill: string;
}

export interface LayoutPart {
  cells: LayoutCell[];
  /** Lines around and between the cells. */
  border: boolean;
}

export interface DocLayoutDef {
  id: string;
  name: string;
  header: LayoutPart;
  footer: LayoutPart;
}

/** The form's own words a design can show — maintained on each QA form. */
export const FORM_TOKENS: Array<{ token: string; label: string }> = [
  { token: "{form.name}", label: "Form name" },
  { token: "{form.code}", label: "Document no. / code" },
  { token: "{form.rev}", label: "Revision" },
  { token: "{form.issue}", label: "Issue no." },
  { token: "{form.effective}", label: "Effective date" },
  { token: "{form.validity}", label: "Valid until" },
  { token: "{form.clause}", label: "Reference standard / clause" },
  { token: "{page}", label: "Page" },
  { token: "{pages}", label: "Pages" },
  { token: "{company.name}", label: "Company name" },
  { token: "{company.address}", label: "Company address" },
  { token: "{company.phone}", label: "Company phone" },
  { token: "{company.email}", label: "Company email" },
  { token: "{company.website}", label: "Company website" },
  { token: "{company.licence}", label: "Mfg. licence no." },
  { token: "{space.name}", label: "Space name" },
];

export const cell = (text: string, extra: Partial<LayoutCell> = {}): LayoutCell => ({
  text,
  kind: "text",
  span: 12,
  rows: 1,
  align: "left",
  bold: false,
  size: "md",
  fill: "",
  ...extra,
});

const COMPANY_LINE = "{company.name} | {company.address} | {company.website} | {company.email} | Tel: {company.phone}";

/** The two designs every space starts with — editable like any other. */
export const BUILT_IN_LAYOUTS: DocLayoutDef[] = [
  {
    id: "reference",
    name: "Reference standards",
    header: {
      border: true,
      cells: [
        cell("{space.name}", { kind: "logo", span: 3, rows: 5, align: "center" }),
        cell("Reference Standards", { span: 5, align: "center", bold: true }),
        cell("{form.clause}", { span: 4, align: "center", bold: true }),
        cell("{form.name}", { span: 5, rows: 4, align: "center", bold: true, size: "lg" }),
        cell("Document No.:", { span: 2, align: "right", bold: true }),
        cell("{form.code}", { span: 2, bold: true }),
        cell("Issue No:", { span: 2, align: "right", bold: true }),
        cell("{form.issue}", { span: 2, bold: true }),
        cell("Effective Date:", { span: 2, align: "right", bold: true }),
        cell("{form.effective}", { span: 2, bold: true }),
        cell("Rev. No.:", { span: 2, align: "right", bold: true }),
        cell("{form.rev}", { span: 2, bold: true }),
      ],
    },
    footer: { border: false, cells: [] },
  },
  {
    id: "banner",
    name: "Banner — effective · validity · form · ver.",
    header: {
      border: true,
      cells: [
        cell("{company.name}", { kind: "logo", span: 3, align: "center" }),
        cell("{form.name}", { span: 9, align: "center", bold: true, size: "xl" }),
        cell("Effective: {form.effective}", { span: 3 }),
        cell("Validity: {form.validity}", { span: 3 }),
        cell("FORM", { span: 1, align: "center", bold: true }),
        cell("{form.code}", { span: 2, align: "center" }),
        cell("Ver. {form.rev}", { span: 1, align: "center" }),
        cell("Page {page} of {pages}", { span: 2, align: "center", bold: true }),
        cell("{form.name}", { span: 12, align: "center", size: "lg", fill: "#F9FAFB" }),
      ],
    },
    footer: { border: false, cells: [cell(COMPANY_LINE, { align: "center", size: "sm" })] },
  },
];

const cellSchema = z.object({
  text: z.string().max(400),
  kind: z.enum(["text", "logo"]),
  span: z.number().int().min(1).max(LAYOUT_COLUMNS),
  rows: z.number().int().min(1).max(8),
  align: z.enum(["left", "center", "right"]),
  bold: z.boolean(),
  size: z.enum(["sm", "md", "lg", "xl"]),
  fill: z.string().regex(/^(#[0-9a-fA-F]{6})?$/, "Colours look like #F2F4F7."),
});
const partSchema = z.object({ cells: z.array(cellSchema).max(60), border: z.boolean() });
export const layoutSchema = z.object({
  id: z.string().regex(/^(reference|banner|layout-[a-z0-9-]{4,40})$/),
  name: z.string().trim().min(1, "Give each design a name.").max(80),
  header: partSchema,
  footer: partSchema,
});
export const layoutsSchema = z.array(layoutSchema).max(30);

/** A space's designs: what it saved, with the two it started with where it has not changed them. */
export function readLayouts(value: unknown): DocLayoutDef[] {
  const parsed = layoutsSchema.safeParse(value);
  const saved = parsed.success ? (parsed.data as DocLayoutDef[]) : [];
  const ids = new Set(saved.map((l) => l.id));
  return [...BUILT_IN_LAYOUTS.filter((l) => !ids.has(l.id)), ...saved].sort((a, b) => order(a) - order(b));
}
const order = (l: DocLayoutDef) => (l.id === "reference" ? 0 : l.id === "banner" ? 1 : 2);

/** The design a form uses, by its header style: its own, else the reference-standards one. */
export function layoutFor(layouts: DocLayoutDef[], docStyle: string | undefined): DocLayoutDef {
  return layouts.find((l) => l.id === (docStyle || "reference")) ?? layouts.find((l) => l.id === "reference") ?? BUILT_IN_LAYOUTS[0];
}

/**
 * A cell's words, its variables filled: a value not there shows as "—" —
 * except in a line of "|"-separated parts, where an empty part is left out.
 */
export function cellText(text: string, values: Record<string, string>): string {
  const fill = (part: string) => {
    let empty = false;
    let any = false;
    const out = part.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_, key: string) => {
      any = true;
      const v = (values[key] ?? "").trim();
      if (!v) empty = true;
      return v;
    });
    return { out: out.trim(), empty: any && empty };
  };
  if (text.includes("|")) {
    return text
      .split("|")
      .map(fill)
      // A part whose value is missing ("Tel: " with no phone) is left out.
      .filter((p) => p.out && !p.empty)
      .map((p) => p.out)
      .join("  |  ");
  }
  return text.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_, key: string) => (values[key] ?? "").trim() || "—");
}

/** The form's own words, as a design reads them. */
export function formTokens(meta: { name: string; code: string; rev: string; issue: string; effective: string; validity?: string; clause: string }): Record<string, string> {
  return {
    "form.name": meta.name,
    "form.code": meta.code,
    "form.rev": meta.rev,
    "form.issue": meta.issue,
    "form.effective": meta.effective,
    "form.validity": meta.validity ?? "",
    "form.clause": meta.clause,
    page: "1",
    pages: "1",
  };
}

export const newLayoutId = () => `layout-${Math.random().toString(36).slice(2, 10)}`;
