import { z } from "zod";

/**
 * Goods receipt: how a space numbers its receipts and lots, what a receipt
 * asks for, what can be received, and the acceptance tests each kind of
 * delivery goes through before it is released into stock (ISO 13485 §7.4.3).
 *
 * Pure: GRN setup, the receipt screens and the server share it.
 */

export const LINE_TYPES = ["material", "component", "packaging", "part", "calibration", "equipment", "other"] as const;
export type LineType = (typeof LINE_TYPES)[number];

/** Types whose acceptance puts something into stock. */
export const STOCK_TYPES: LineType[] = ["material", "component", "packaging", "other"];
/** Types that carry a lot of their own. */
export const LOT_TYPES: Array<"material" | "component" | "packaging"> = ["material", "component", "packaging"];

export const TYPE_CHIPS: Record<LineType, { bg: string; fg: string }> = {
  material: { bg: "#FFF1EB", fg: "#C4320A" },
  component: { bg: "#EFF8FF", fg: "#175CD3" },
  packaging: { bg: "#F0FDF9", fg: "#107569" },
  part: { bg: "#F4F3FF", fg: "#5925DC" },
  calibration: { bg: "#FDF2FA", fg: "#C11574" },
  equipment: { bg: "#FFFAEB", fg: "#B54708" },
  other: { bg: "#F2F4F7", fg: "#344054" },
};

export const EQUIPMENT_CATEGORIES = [
  ["tooling", "Tooling & fixtures"],
  ["measuring", "Measuring equipment"],
  ["postproc", "Post-processing equipment"],
  ["steril", "Sterilization equipment"],
] as const;
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number][0];

export interface GrnTest {
  id: string;
  label: string;
  spec: string;
  /** Pieces observed. */
  n: number;
  rt: "passfail" | "yesno";
  /** Pieces that must pass; "" = all. */
  minPass: string;
  req: boolean;
}

export interface ExtraField {
  k: string;
  label: string;
  type: "text" | "number" | "date" | "select";
  opts: string;
  req: boolean;
}

export interface LineTypeConfig {
  on: boolean;
  label: string;
  checks: GrnTest[];
  extra: ExtraField[];
}

export interface HeaderField {
  k: string;
  label: string;
  type: "text" | "number" | "date" | "select";
  show: boolean;
  req: boolean;
  custom: boolean;
  /** A custom dropdown's choices; the built-in "condition" uses the conditions list. */
  opts: string;
}

export interface GrnConfig {
  prefix: string;
  sep: "-" | "/" | "";
  year: boolean;
  pad: 3 | 4 | 5;
  header: HeaderField[];
  types: Record<LineType, LineTypeConfig>;
  lotId: {
    mode: "auto" | "manual";
    format: string;
    pad: number;
    scope: "type" | "global";
    codes: { material: string; component: string; packaging: string };
  };
  rules: {
    /** Every test must pass to accept; off = only the required ones. */
    allChecks: boolean;
    inspDays: number;
    supplier: "warn" | "block";
    reasonReq: boolean;
  };
  conditions: string;
  docKinds: string;
}

// --- Defaults -------------------------------------------------------------------------------

const t = (id: string, label: string, spec: string, n: number, rt: GrnTest["rt"], minPass = ""): GrnTest => ({
  id,
  label,
  spec,
  n,
  rt,
  minPass,
  req: true,
});

export function defaultGrnConfig(): GrnConfig {
  return {
    prefix: "GRN",
    sep: "-",
    year: true,
    pad: 4,
    header: [
      { k: "po", label: "PO no.", type: "text", show: true, req: true, custom: false, opts: "" },
      { k: "poDate", label: "PO date", type: "date", show: true, req: false, custom: false, opts: "" },
      { k: "invoice", label: "Invoice no.", type: "text", show: true, req: false, custom: false, opts: "" },
      { k: "invoiceDate", label: "Invoice date", type: "date", show: true, req: false, custom: false, opts: "" },
      { k: "dn", label: "Delivery note no.", type: "text", show: true, req: true, custom: false, opts: "" },
      { k: "dnDate", label: "Delivery date", type: "date", show: true, req: false, custom: false, opts: "" },
      { k: "receivedBy", label: "Received by", type: "text", show: true, req: true, custom: false, opts: "" },
      { k: "condition", label: "Delivery condition", type: "select", show: true, req: false, custom: false, opts: "" },
      { k: "x_vehicle", label: "Transporter / AWB no.", type: "text", show: false, req: false, custom: true, opts: "" },
    ],
    types: {
      material: {
        on: true,
        label: "Raw material",
        checks: [
          t("m1", "CoA review", "Grade & chemistry per ASTM F3001 / supplier spec", 1, "passfail"),
          t("m2", "Quantity check", "Matches PO / delivery note", 1, "yesno"),
          t("m3", "Packaging & seals", "Intact, no damage or moisture", 1, "yesno"),
          t("m4", "Label check", "Lot no. and expiry visible and legible", 1, "yesno"),
        ],
        extra: [],
      },
      component: {
        on: true,
        label: "Standard component",
        checks: [
          t("c1", "Part / catalogue no.", "Matches PO", 1, "yesno"),
          t("c2", "Visual inspection", "No burrs, damage or discoloration", 5, "passfail"),
          t("c3", "Dimensional check", "Thread Ø and length per drawing", 3, "passfail"),
          t("c4", "Label, lot & expiry", "Present and legible", 1, "yesno"),
        ],
        extra: [],
      },
      packaging: {
        on: true,
        label: "Packaging & labelling",
        checks: [
          t("p1", "Item code & size", "As per specification", 1, "yesno"),
          t("p2", "Seal strength (peel test)", "≥ 1.5 N / 15 mm (ASTM F88)", 3, "passfail"),
          t("p3", "Barrier integrity (visual)", "No pinholes, tears or delamination", 10, "passfail", "8"),
          t("p4", "Label, lot & expiry", "Present and legible", 1, "yesno"),
        ],
        extra: [],
      },
      part: {
        on: true,
        label: "Outsourced part / service return",
        checks: [
          t("o1", "Part ID match", "Matches PO and part IDs", 1, "yesno"),
          t("o2", "Supplier CoC / certificate", "Received and signed", 1, "yesno"),
          t("o3", "Visual inspection", "No transport damage", 1, "passfail"),
          t("o4", "Incoming inspection form", "Completed on the part", 1, "yesno"),
        ],
        extra: [],
      },
      calibration: {
        on: true,
        label: "Calibration return",
        checks: [
          t("k1", "Certificate received", "Accredited lab (NABL / ISO 17025)", 1, "yesno"),
          t("k2", "Certificate matches instrument", "Asset ID / serial no.", 1, "yesno"),
          t("k3", "Results within tolerance", "Per instrument tolerance", 1, "passfail"),
          t("k4", "Calibration label", "Attached with next due date", 1, "yesno"),
        ],
        extra: [],
      },
      equipment: {
        on: true,
        label: "Equipment / tooling",
        checks: [
          t("e1", "Delivered complete", "Accessories and manuals per PO", 1, "yesno"),
          t("e2", "Serial / asset no.", "Recorded", 1, "yesno"),
          t("e3", "Transport damage", "None", 1, "passfail"),
          t("e4", "IQ planned", "Installation qualification scheduled", 1, "yesno"),
        ],
        extra: [],
      },
      other: {
        on: true,
        label: "Other (not stock-tracked)",
        checks: [t("x1", "Quantity", "Matches delivery note", 1, "yesno"), t("x2", "Visual", "No damage", 1, "passfail")],
        extra: [],
      },
    },
    lotId: { mode: "auto", format: "{TYPE}-{YYYY}-{SEQ}", pad: 4, scope: "type", codes: { material: "RM", component: "CP", packaging: "PK" } },
    rules: { allChecks: true, inspDays: 3, supplier: "warn", reasonReq: true },
    conditions: "Packaging intact, Minor outer damage — contents OK, Damaged — see notes, Temperature excursion",
    docKinds: "Delivery note, CoA, Invoice, Certificate, Inspection report, Other",
  };
}

export const LOT_PRESETS: Array<{ name: string; format: string; pad: number; scope: "type" | "global" }> = [
  { name: "Generic — IIR001", format: "IIR{SEQ}", pad: 3, scope: "global" },
  { name: "Generic — LOT00001", format: "LOT{SEQ}", pad: 5, scope: "global" },
  { name: "By type — RM-2026-0001", format: "{TYPE}-{YYYY}-{SEQ}", pad: 4, scope: "type" },
  { name: "By type & month — RM2609-001", format: "{TYPE}{YY}{MM}-{SEQ}", pad: 3, scope: "type" },
];

export const list = (text: string): string[] => [...new Set(text.split(",").map((s) => s.trim()).filter(Boolean))];

// --- Numbers ----------------------------------------------------------------------------------

/** The next GRN number: prefix, year, then one more than the highest number in use. */
export function nextGrnNumber(config: GrnConfig, existing: string[], now: Date): string {
  const head = [config.prefix, config.year ? String(now.getUTCFullYear()) : ""].filter(Boolean);
  const stem = head.join(config.sep);
  let max = 0;
  for (const number of existing) {
    if (stem && !number.startsWith(stem)) continue;
    const m = /(\d+)$/.exec(number);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return [...head, String(max + 1).padStart(config.pad, "0")].join(config.sep);
}

function lotPattern(config: GrnConfig, type: "material" | "component" | "packaging", now: Date) {
  const yyyy = String(now.getUTCFullYear());
  const tokens: Record<string, string> = {
    "{TYPE}": config.lotId.codes[type] || type.slice(0, 2).toUpperCase(),
    "{YYYY}": yyyy,
    "{YY}": yyyy.slice(2),
    "{MM}": String(now.getUTCMonth() + 1).padStart(2, "0"),
  };
  let format = config.lotId.format || "{TYPE}-{SEQ}";
  if (!format.includes("{SEQ}")) format += "{SEQ}";
  const [before, after] = format.split("{SEQ}");
  const fill = (part: string) => Object.entries(tokens).reduce((s, [k, v]) => s.split(k).join(v), part);
  return { before: fill(before), after: fill(after ?? "") };
}

/**
 * The next lot ID of a type. The running number continues from the highest
 * one already used with the same surrounding text — so a format with the
 * year starts again at 1 each January.
 */
export function nextLotId(config: GrnConfig, type: "material" | "component" | "packaging", existing: string[], now: Date): string {
  const pads = Math.min(6, Math.max(2, config.lotId.pad || 4));
  const mine = lotPattern(config, type, now);
  const prefixes =
    config.lotId.scope === "global" ? LOT_TYPES.map((t) => lotPattern(config, t, now)) : [mine];
  let max = 0;
  for (const id of existing) {
    for (const p of prefixes) {
      if (id.startsWith(p.before) && id.endsWith(p.after)) {
        const middle = id.slice(p.before.length, id.length - p.after.length);
        if (/^\d+$/.test(middle)) max = Math.max(max, Number(middle));
      }
    }
  }
  return `${mine.before}${String(max + 1).padStart(pads, "0")}${mine.after}`;
}

// --- Acceptance tests ----------------------------------------------------------------------------

export type PieceResult = "Pass" | "Fail" | "";

export interface TestEntry {
  n: number;
  res: PieceResult[];
}

export interface TestOutcome {
  state: "pass" | "fail" | "pending";
  passes: number;
  fails: number;
  done: number;
  n: number;
  need: number;
  label: string;
}

export function pieceWords(rt: GrnTest["rt"]): [string, string] {
  return rt === "yesno" ? ["Yes", "No"] : ["Pass", "Fail"];
}

export function testOutcome(test: GrnTest, entry: TestEntry | undefined): TestOutcome {
  const n = Math.max(1, entry?.n ?? test.n ?? 1);
  const res = Array.from({ length: n }, (_, i) => entry?.res?.[i] ?? "");
  const passes = res.filter((r) => r === "Pass").length;
  const fails = res.filter((r) => r === "Fail").length;
  const done = passes + fails;
  const min = test.minPass.trim() ? Math.min(n, Math.max(1, Number(test.minPass) || n)) : n;
  // It fails as soon as too many pieces have failed for the rest to make it.
  const state: TestOutcome["state"] = fails > n - min ? "fail" : passes >= min && done === n ? "pass" : "pending";
  const label = state === "pending" ? `${done} / ${n} done` : `${state === "pass" ? "Pass" : "Fail"} (${passes}/${n})`;
  return { state, passes, fails, done, n, need: min, label };
}

export function ruleText(test: GrnTest): string {
  const n = Math.max(1, test.n);
  const kind = test.rt === "yesno" ? "Yes / No" : "Pass / Fail";
  if (n === 1) return `${kind} · single check`;
  if (test.minPass.trim() && Number(test.minPass) < n) return `${kind} · pass if ≥ ${test.minPass} of ${n}`;
  return `${kind} · all ${n} must pass`;
}

export function testSummary(tests: GrnTest[], entries: Record<string, TestEntry>): string {
  return tests
    .map((test) => {
      const o = testOutcome(test, entries[test.id]);
      const [yes, no] = pieceWords(test.rt);
      const pieces = (entries[test.id]?.res ?? [])
        .slice(0, o.n)
        .map((r, i) => `#${i + 1} ${r === "Pass" ? yes : r === "Fail" ? no : "—"}`)
        .join(", ");
      return `${test.label} ${o.state === "pending" ? "INCOMPLETE" : o.state.toUpperCase()} (${o.passes}/${o.n})${pieces ? `: ${pieces}` : ""}`;
    })
    .join(" | ");
}

// --- Status --------------------------------------------------------------------------------------

export type Tone = "green" | "amber" | "grey" | "blue" | "red";

export function grnStatus(grn: { received: boolean; lines: Array<{ decision: string | null }> }): { label: string; tone: Tone } {
  if (!grn.received) return { label: "Draft", tone: "grey" };
  if (grn.lines.length === 0) return { label: "Received — no lines", tone: "amber" };
  const decided = grn.lines.filter((l) => l.decision === "Accepted" || l.decision === "Rejected");
  if (decided.length === 0) return { label: "Awaiting inspection", tone: "amber" };
  if (decided.length < grn.lines.length) return { label: "Partly inspected", tone: "blue" };
  return grn.lines.some((l) => l.decision === "Rejected") ? { label: "Closed — with rejections", tone: "amber" } : { label: "Closed", tone: "green" };
}

export function lineBadge(
  line: { type: string; decision: string | null; rejectedQty: unknown },
  received: boolean,
): { label: string; tone: Tone } {
  if (!received) return { label: "Draft", tone: "grey" };
  if (!line.decision) return { label: "To inspect", tone: "amber" };
  if (line.decision === "Quarantine") return { label: "Quarantine", tone: "amber" };
  if (line.decision === "Rejected") return { label: "Rejected", tone: "red" };
  const stock = STOCK_TYPES.includes(line.type as LineType);
  if (stock && Number(line.rejectedQty ?? 0) > 0) return { label: "Partly accepted", tone: "green" };
  return { label: stock ? "Released" : "Accepted", tone: "green" };
}

// --- Validation of a saved setup ------------------------------------------------------------------

const testSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().trim().min(1, "Every test needs a name.").max(120),
  spec: z.string().max(200),
  n: z.number().int().min(1).max(50),
  rt: z.enum(["passfail", "yesno"]),
  minPass: z.string().regex(/^\d{0,2}$/),
  req: z.boolean(),
});

const extraSchema = z.object({
  k: z.string().min(1).max(40),
  label: z.string().trim().min(1, "Every extra field needs a name.").max(80),
  type: z.enum(["text", "number", "date", "select"]),
  opts: z.string().max(500),
  req: z.boolean(),
});

const typeSchema = z.object({
  on: z.boolean(),
  label: z.string().trim().min(1).max(60),
  checks: z.array(testSchema).max(30),
  extra: z.array(extraSchema).max(20),
});

export const grnConfigSchema = z.object({
  prefix: z.string().regex(/^[A-Z0-9]{0,8}$/, "The prefix takes letters and digits only."),
  sep: z.enum(["-", "/", ""]),
  year: z.boolean(),
  pad: z.union([z.literal(3), z.literal(4), z.literal(5)]),
  header: z
    .array(
      z.object({
        k: z.string().min(1).max(40),
        label: z.string().trim().min(1, "Every receipt field needs a name.").max(60),
        type: z.enum(["text", "number", "date", "select"]),
        show: z.boolean(),
        req: z.boolean(),
        custom: z.boolean(),
        opts: z.string().max(500),
      }),
    )
    .max(30),
  types: z.object(Object.fromEntries(LINE_TYPES.map((k) => [k, typeSchema])) as Record<LineType, typeof typeSchema>),
  lotId: z.object({
    mode: z.enum(["auto", "manual"]),
    format: z.string().max(40),
    pad: z.number().int().min(2).max(6),
    scope: z.enum(["type", "global"]),
    codes: z.object({
      material: z.string().regex(/^[A-Z0-9]{1,6}$/, "Type codes take 1–6 letters or digits."),
      component: z.string().regex(/^[A-Z0-9]{1,6}$/, "Type codes take 1–6 letters or digits."),
      packaging: z.string().regex(/^[A-Z0-9]{1,6}$/, "Type codes take 1–6 letters or digits."),
    }),
  }),
  rules: z.object({
    allChecks: z.boolean(),
    inspDays: z.number().int().min(0).max(90),
    supplier: z.enum(["warn", "block"]),
    reasonReq: z.boolean(),
  }),
  conditions: z.string().max(1000),
  docKinds: z.string().max(1000),
});

/** A stored setup, completed from the defaults so a later version still reads an older one. */
export function readGrnConfig(value: unknown): GrnConfig {
  const defaults = defaultGrnConfig();
  const parsed = grnConfigSchema.safeParse(value);
  if (parsed.success) return parsed.data as GrnConfig;
  return defaults;
}
