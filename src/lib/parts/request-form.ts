import { z } from "zod";

/**
 * The part request: the ID every new part is given, and the form people fill
 * in to ask for one. Both are configured per company space on the Part Request
 * Setup page; what is here is the shape of that configuration, the defaults a
 * new space starts with, and the rules that read it.
 *
 * Nothing in this file touches the server, so the setup page's live preview,
 * the request form and the action that saves a request all work from the same
 * definitions.
 */

// --- Form definition -------------------------------------------------------------

export const FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "date",
  "select",
  "checkbox",
  "file",
  "image",
  "balloon",
  // Built-in selects, whose options come from the space's master data.
  "case",
  "workflow",
  "parttype",
  "priority",
  "material",
  "printer",
  "sourcing",
  "vendor",
  "site",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** The types a person can add; the rest belong to built-in fields. */
export const CUSTOM_TYPES: Array<{ type: FieldType; label: string }> = [
  { type: "text", label: "Short text" },
  { type: "textarea", label: "Long text" },
  { type: "number", label: "Number" },
  { type: "date", label: "Date" },
  { type: "select", label: "Dropdown" },
  { type: "checkbox", label: "Checkbox" },
  { type: "file", label: "File upload" },
  { type: "image", label: "Image upload" },
  { type: "balloon", label: "Drawing + balloon table" },
];

/** How a type is named on a field card: the balloon table is a "drawing". */
export function typeTag(type: FieldType): string {
  return type === "balloon" ? "drawing" : type;
}

export interface BalloonColumn {
  id: string;
  label: string;
}

export interface RequestField {
  id: string;
  /** A built-in field's key — `case`, `name`, `qty`… — or "" for a custom one. */
  key: string;
  /** A custom field's variable name: `{request.<var>}` in QA forms. */
  var: string;
  /** Pre-filled in every new request. */
  def: string;
  label: string;
  type: FieldType;
  show: boolean;
  req: boolean;
  /** The system needs it: always shown, always required, cannot be removed. */
  locked: boolean;
  /** Choices of a custom dropdown. */
  options: string[];
  fileTypes: string[];
  /** A balloon table's columns, after "Sl. No." and "Balloon ID". */
  columns: BalloonColumn[];
  allowLinks: boolean;
  /** Asked when the part is requested — off: answered later, on the part's page. Absent: on. */
  onCreate?: boolean;
}

/** A field is asked in the request unless the form leaves it for the part's page; the system's own always are. */
export const askedOnRequest = (f: RequestField) => f.show && (f.onCreate !== false || f.locked);

/** Answers that can be given — or changed — on the part's page: a custom field's text, number, date, choice or tick. */
export const EDITABLE_ON_PART: FieldType[] = ["text", "textarea", "number", "date", "select", "checkbox"];

export interface RequestSection {
  id: string;
  title: string;
  cols: 1 | 2 | 3;
  fields: RequestField[];
}

export interface IdRule {
  prefix: string;
  /** "-", "_", "." or "" for none. */
  sep: string;
  tokens: TokenCode[];
  /** What the part sequence counts within; "case" when absent. */
  scope?: SeqScope;
  /** Digits of the part sequence: 2 → 01; 2 when absent. */
  width?: number;
}

/**
 * What the part sequence counts within, chosen on the rule card: each case,
 * each case and part type, each part type, each month or year, every part of
 * the space — or "auto", among the parts whose ID starts the same up to PART_SEQ.
 */
export const SEQ_SCOPES = ["case", "case-type", "type", "month", "year", "space", "auto"] as const;
export type SeqScope = (typeof SEQ_SCOPES)[number];
export const SEQ_SCOPE_LABELS: Record<SeqScope, { title: string; detail: string }> = {
  case: { title: "Per case", detail: "Each case counts its own parts: 01, 02, 03 — whatever their type." },
  "case-type": { title: "Per case and part type", detail: "Each part type counts on its own within a case: IMP-01, IMP-02, then MDL-01." },
  type: { title: "Per part type", detail: "Each part type has one running number across all cases." },
  month: { title: "Per month", detail: "One running number for the month; it starts again at 01 each month." },
  year: { title: "Per year", detail: "One running number for the year; it starts again at 01 each year." },
  space: { title: "Across all parts", detail: "One running number for every part of the space, whatever the case." },
  auto: { title: "Match the ID", detail: "Counts among the parts whose ID starts the same, up to PART_SEQ — set by the token order." },
};

/** Tokens the ID needs for a way of counting, else two parts would share an ID: [what, any of these tokens]. */
const SCOPE_NEEDS: Partial<Record<SeqScope, Array<[string, TokenCode[]]>>> = {
  case: [["the case", ["CASE_ID", "CASE_SEQ"]]],
  "case-type": [
    ["the case", ["CASE_ID", "CASE_SEQ"]],
    ["the part type", ["PART_TYPE"]],
  ],
  type: [["the part type", ["PART_TYPE"]]],
  month: [
    ["the year", ["YYYY"]],
    ["the month", ["MM"]],
  ],
  year: [["the year", ["YYYY"]]],
};

/** What the ID lacks for the chosen counting — "the part type (PART_TYPE)" — so two parts would share an ID. */
export function scopeMissing(rule: IdRule): string[] {
  if (!rule.tokens.includes("PART_SEQ")) return [];
  return (SCOPE_NEEDS[rule.scope ?? "case"] ?? []).filter(([, any]) => !any.some((t) => rule.tokens.includes(t))).map(([what, any]) => `${what} (${any.join(" or ")})`);
}

export interface RequestSetup {
  rule: IdRule;
  sections: RequestSection[];
}

// --- File types ---------------------------------------------------------------------

/** The file types a file field can allow, and the extensions each one means. */
export const FILE_TYPES: Record<string, string[]> = {
  STL: [".stl"],
  "3MF": [".3mf"],
  STEP: [".step", ".stp"],
  OBJ: [".obj"],
  DICOM: [".dcm", ".dicom"],
  PDF: [".pdf"],
  Image: [".png", ".jpg", ".jpeg", ".webp", ".gif"],
  ZIP: [".zip"],
};
export const FILE_TYPE_NAMES = Object.keys(FILE_TYPES);

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export function extensionsFor(fileTypes: string[]): string[] {
  return fileTypes.flatMap((t) => FILE_TYPES[t] ?? []);
}

export function fileAllowed(name: string, fileTypes: string[]): boolean {
  const lower = name.toLowerCase();
  return extensionsFor(fileTypes).some((ext) => lower.endsWith(ext));
}

/**
 * A download link as typed, made into a URL — or null when it is not one.
 * "drive.google.com/x" is accepted and given its scheme.
 */
export function normaliseLink(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  if (!/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function linkLabel(url: string): string {
  const bare = url.replace(/^https?:\/\//i, "");
  return bare.length > 60 ? `${bare.slice(0, 59)}…` : bare;
}

// --- Image display size ---------------------------------------------------------------

/** How large a request image is shown on the part, its QA forms and their print. */
export const IMAGE_SIZES = ["S", "M", "L", "XL"] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];
export const IMAGE_SIZE_LABELS: Record<ImageSize, string> = { S: "Small", M: "Medium", L: "Large", XL: "Full width" };
/** Tailwind width classes per size; the height follows the picture. */
export const IMAGE_SIZE_CLASS: Record<ImageSize, string> = {
  S: "w-[160px] max-w-full",
  M: "w-[280px] max-w-full",
  L: "w-[440px] max-w-full",
  XL: "w-full",
};
export const imageSize = (value: string | null | undefined): ImageSize => (IMAGE_SIZES.includes(value as ImageSize) ? (value as ImageSize) : "M");
/** The context key beside an image variable that holds its size: `request.productImage@size`. */
export const sizeKey = (variable: string) => `${variable}@size`;

// --- Fixed choices --------------------------------------------------------------------

export const PRIORITIES = ["Low", "Medium", "High", "Critical"] as const;
export const SOURCING = ["In-house", "Outsourced"] as const;

export const DEFAULT_BALLOON_COLUMNS: BalloonColumn[] = [
  { id: "c-char", label: "Characteristics" },
  { id: "c-spec", label: "Specification" },
  { id: "c-lsl", label: "LSL" },
  { id: "c-usl", label: "USL" },
];

// --- Variables ------------------------------------------------------------------------

/** Built-in fields have a fixed variable; everything else is `request.<name>`. */
const BUILT_IN_VARS: Record<string, string> = {
  case: "case.id",
  name: "part.name",
  type: "part.type",
  qty: "part.qty",
  workflow: "part.workflow",
  material: "part.material",
  printer: "part.printer",
  sourcing: "part.sourcing",
  vendor: "part.vendor",
  site: "site.name",
  due: "part.due",
  notes: "part.notes",
  balloon: "balloon.count",
};

/** camelCase of the words in a label: "Polishing requirement" → polishingRequirement. */
export function slugVar(label: string): string {
  const words = label.match(/[A-Za-z0-9]+/g) ?? [];
  const slug = words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join("");
  return slug || "field";
}

/** The variable a field's answer is available under, or null for files. */
export function fieldVar(field: RequestField): string | null {
  if (field.type === "file") return null;
  if (field.key && BUILT_IN_VARS[field.key]) return BUILT_IN_VARS[field.key];
  if (field.type === "balloon") return "balloon.count";
  return `request.${field.var || field.key || slugVar(field.label)}`;
}

/** The bare name of a custom field's variable: what `{request.…}` ends with. */
export function customVarName(field: RequestField): string {
  return field.var || field.key || slugVar(field.label);
}

export function uniqueVar(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}${n}`)) n += 1;
  return `${base}${n}`;
}

// --- Defaults ---------------------------------------------------------------------------

function field(
  id: string,
  label: string,
  type: FieldType,
  extra: Partial<RequestField> = {},
): RequestField {
  return {
    id,
    key: "",
    var: "",
    def: "",
    label,
    type,
    show: true,
    req: false,
    locked: false,
    options: [],
    fileTypes: [],
    columns: [],
    allowLinks: true,
    ...extra,
  };
}

const builtIn = (key: string, label: string, type: FieldType, extra: Partial<RequestField> = {}) =>
  field(`f-${key}`, label, type, { key, ...extra });
const locked = { req: true, locked: true } as const;

/** One of the ten acceptance-criteria sections: what, to what spec, tested how. */
function requirement(title: string, prefix: string, feature: string): RequestSection {
  return {
    id: `s-${prefix}`,
    title: `${title} Requirements`,
    cols: 3,
    fields: [
      field(`f-${prefix}-feature`, "Feature", "text", { var: `${prefix}Feature`, def: feature }),
      field(`f-${prefix}-spec`, "Specification", "text", { var: `${prefix}Specification` }),
      field(`f-${prefix}-test`, "Testing / acceptance method", "text", { var: `${prefix}TestMethod` }),
    ],
  };
}

export function defaultSections(): RequestSection[] {
  return [
    {
      id: "s-ident",
      title: "Part Identification",
      cols: 2,
      fields: [
        // Shown, but not required: a part can be requested for no case at all.
        builtIn("case", "Case", "case"),
        builtIn("name", "Part name", "text", locked),
        builtIn("type", "Part type", "parttype"),
        builtIn("qty", "Quantity", "number", locked),
      ],
    },
    {
      id: "s-production",
      title: "Production",
      cols: 2,
      fields: [
        // Optional: a part can be requested before its route is decided, and
        // gets its stages when a workflow is chosen on it.
        builtIn("workflow", "Production workflow", "workflow"),
        builtIn("material", "Material preference", "material"),
        builtIn("printer", "Printer / resource", "printer", { show: false }),
        builtIn("sourcing", "Sourcing", "sourcing", { req: true }),
        builtIn("vendor", "Outsource vendor", "vendor"),
        builtIn("site", "Manufacturing site", "site"),
      ],
    },
    {
      id: "s-scheduling",
      title: "Scheduling",
      cols: 2,
      fields: [
        builtIn("due", "Required by (due date)", "date", { req: true }),
        builtIn("priority", "Priority", "priority"),
        builtIn("notes", "Notes for production", "textarea"),
      ],
    },
    {
      id: "s-qac",
      title: "QAC — Product details",
      cols: 2,
      fields: [
        field("f-product-image", "Product image", "image", { var: "productImage" }),
        field("f-dimensions", "Dimensions", "textarea", { var: "dimensions" }),
        field("f-polishing", "Polishing requirement", "textarea", { var: "polishingRequirement" }),
      ],
    },
    requirement("Dimensional", "dimensional", "Size and shape"),
    requirement("Material", "material", "Material"),
    requirement("Workmanship", "workmanship", "Smoothness"),
    requirement("Process Capability", "processCapability", "Process & layer thickness"),
    requirement("Aesthetic", "aesthetic", "Finish"),
    requirement("Performance", "performance", "Strength"),
    requirement("Documentation", "documentation", "Material datasheet"),
    requirement("Packaging & Labelling", "packagingLabelling", "Standard packaging"),
    requirement("Lab Test", "labTest", "No"),
    requirement("Other", "other", "No"),
    {
      id: "s-files",
      title: "Files",
      cols: 1,
      fields: [builtIn("files", "Files for printing", "file", { fileTypes: ["STL", "3MF", "STEP", "PDF"] })],
    },
    {
      id: "s-drawing",
      title: "Inspection Drawing",
      cols: 1,
      fields: [
        builtIn("balloon", "Drawing with balloon characteristics", "balloon", {
          columns: DEFAULT_BALLOON_COLUMNS.map((c) => ({ ...c })),
        }),
      ],
    },
  ];
}

/** A short code for a space, from its name: "Jajal Medical" → JM. */
export function spaceCode(name: string): string {
  const words = name.match(/[A-Za-z0-9]+/g) ?? [];
  const initials = words.map((w) => w[0]).join("");
  const code = (initials.length >= 2 ? initials : (words[0] ?? "")).toUpperCase().slice(0, 8);
  return code || "PT";
}

export function defaultRule(spaceName: string): IdRule {
  return { prefix: spaceCode(spaceName), sep: "-", tokens: ["PRODUCT", "CASE_SEQ", "PART_SEQ"] };
}

export function defaultSetup(spaceName: string): RequestSetup {
  return { rule: defaultRule(spaceName), sections: defaultSections() };
}

// --- The part-ID rule ---------------------------------------------------------------------

export const TOKEN_CODES = [
  "PRODUCT",
  "CASE_ID",
  "CASE_SEQ",
  "PART_SEQ",
  "PART_TYPE",
  "MATERIAL",
  "YYYY",
  "MM",
  "SPACE",
] as const;
export type TokenCode = (typeof TOKEN_CODES)[number];

export const SEPARATORS = ["-", "_", ".", ""] as const;

export const TOKENS: Record<TokenCode, { description: string; sample: string }> = {
  PRODUCT: { description: "Product code", sample: "CRANIO" },
  CASE_ID: { description: "Case ID as on the platform", sample: "E123" },
  CASE_SEQ: { description: "Case number, without a lettered prefix (JM-0430 → 0430)", sample: "0428" },
  PART_SEQ: { description: "Part sequence", sample: "01" },
  PART_TYPE: { description: "Part type code", sample: "IMP" },
  MATERIAL: { description: "Material code", sample: "TI64" },
  YYYY: { description: "Year", sample: "" },
  MM: { description: "Month", sample: "" },
  SPACE: { description: "Company space code", sample: "" },
};

/** Letters and digits only, upper-cased: what may appear in a part ID. */
function code(value: string | null | undefined, max: number): string {
  return (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, max);
}

/** "Cranial Plate" → CRANIA; the first word of the product, cut to a short code. */
export function productCode(product: string | null | undefined): string {
  const first = (product ?? "").trim().split(/[\s/–—-]+/)[0] ?? "";
  return code(first, 6) || "PART";
}

/**
 * The case's own number, without a lettered prefix set off by a separator:
 * "JM-0430" → 0430, while "E934" — where the letter is part of the number —
 * stays E934.
 */
export function caseSequence(caseNumber: string | null | undefined): string {
  const value = (caseNumber ?? "").trim();
  const afterPrefix = /^[A-Za-z]+[-_ ./]+(.+)$/.exec(value)?.[1] ?? value;
  return code(afterPrefix, 16);
}

/** The case ID as the platform writes it — "E123", "JM-0430" — upper-cased, letters, digits and hyphens only. */
export function caseIdCode(caseNumber: string | null | undefined): string {
  return (caseNumber ?? "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").replace(/^-+|-+$/g, "").slice(0, 24);
}

export function materialCode(material: string | null | undefined): string {
  return code(material, 5) || "MAT";
}

export interface IdContext {
  /** The part belongs to no case: the case tokens have nothing to stand for. */
  noCase?: boolean;
  product?: string | null;
  caseNumber?: string | null;
  /** This part's number among the parts it is counted with (see sequenceFrame). */
  sequence?: number;
  /** Digits of the sequence; 2 when absent. */
  width?: number;
  /** Mark where the sequence goes instead of writing it — to find the IDs it counts among. */
  seqMark?: boolean;
  partTypeCode?: string | null;
  material?: string | null;
  spaceName: string;
  now: Date;
}

/** What a token stands for, for this part — or its sample when previewing. */
export function tokenValue(token: TokenCode, context: IdContext, preview = false): string {
  const sample = TOKENS[token].sample;
  switch (token) {
    case "PRODUCT":
      return context.product ? productCode(context.product) : preview ? sample : "PART";
    case "CASE_ID":
      if (context.noCase) return NO_CASE_CODE;
      return caseIdCode(context.caseNumber) || (preview ? sample : "CASE");
    case "CASE_SEQ":
      if (context.noCase) return NO_CASE_CODE;
      return caseSequence(context.caseNumber) || (preview ? sample : "0000");
    case "PART_SEQ":
      return context.seqMark ? SEQ_MARK : String(context.sequence ?? 1).padStart(context.width ?? 2, "0");
    case "PART_TYPE":
      return code(context.partTypeCode, 6) || (preview ? sample : "PRT");
    case "MATERIAL":
      return context.material ? materialCode(context.material) : preview ? sample : "MAT";
    case "YYYY":
      return String(context.now.getUTCFullYear());
    case "MM":
      return String(context.now.getUTCMonth() + 1).padStart(2, "0");
    case "SPACE":
      return spaceCode(context.spaceName);
  }
}

const SEQ_MARK = "\u0000";

/**
 * The text of a part ID before its sequence. PART_SEQ counts among the parts
 * whose ID starts the same — what comes before it decides what it counts:
 * CASE_ID-PART_TYPE-PART_SEQ numbers each case's implants and models apart,
 * CASE_ID-PART_SEQ-PART_TYPE each case whatever the type, and a prefix alone
 * every part. Null when the rule has no PART_SEQ.
 */
export function sequenceStem(rule: IdRule, context: IdContext): string | null {
  if (!rule.tokens.includes("PART_SEQ")) return null;
  const marked = buildPartNumber(rule, { ...context, seqMark: true });
  return marked.slice(0, marked.indexOf(SEQ_MARK));
}

/** The sequence a part ID carries right after its stem, or null when it does not follow the rule. */
export function sequenceAfterStem(rule: IdRule, stem: string, partNumber: string): number | null {
  if (!partNumber.startsWith(stem)) return null;
  const rest = partNumber.slice(stem.length);
  const last = rule.tokens[rule.tokens.length - 1] === "PART_SEQ";
  // With tokens after it the sequence ends at the separator — or the end, for
  // an ID given before those tokens were added; with no separator it is as
  // many digits as the rule gives it.
  const pattern = last ? /^(\d+)$/ : rule.sep ? new RegExp(`^(\\d+)(?:${escapeRegExp(rule.sep)}|$)`) : new RegExp(`^(\\d{${rule.width ?? 2}})`);
  const match = pattern.exec(rest);
  return match && match[1].length <= 9 ? Number(match[1]) : null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const COUNT_WORDS: Partial<Record<TokenCode, string>> = {
  CASE_ID: "case",
  CASE_SEQ: "case",
  PRODUCT: "product",
  PART_TYPE: "part type",
  MATERIAL: "material",
  YYYY: "year",
  MM: "month",
};

/** What PART_SEQ counts among, in words, from the tokens before it: "Counts per case and part type…". */
export function countingLabel(rule: IdRule): string {
  const at = rule.tokens.indexOf("PART_SEQ");
  if (at < 0) return "No part sequence in the ID — each part of a case is numbered, and the number is added only when two parts would otherwise share an ID.";
  const by = [...new Set(rule.tokens.slice(0, at).map((t) => COUNT_WORDS[t]).filter((w): w is string => Boolean(w)))];
  // The product comes with the case, so a case already implies it.
  const shown = by.includes("case") ? by.filter((w) => w !== "product") : by;
  if (shown.length === 0) return "Counts across all parts — one running number.";
  const list = shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  return `Counts per ${list} — a new ${shown.length === 1 ? shown[0] : "combination"} starts again at 1.`;
}

/** Tokens after PART_SEQ that would make it count differently if moved before it — told to the admin. */
export function labelOnlyTokens(rule: IdRule): TokenCode[] {
  const at = rule.tokens.indexOf("PART_SEQ");
  if (at < 0) return [];
  const before = new Set(rule.tokens.slice(0, at).map((t) => COUNT_WORDS[t]));
  return rule.tokens.slice(at + 1).filter((t) => COUNT_WORDS[t] && !before.has(COUNT_WORDS[t]) && !(t === "PRODUCT" && before.has("case")));
}

/** Four IDs as the rule numbers them: two implants and a model of case E123, then an implant of E124. */
export function numberingExamples(rule: IdRule, spaceName: string, now: Date): string[] {
  const seen = new Map<string, number>();
  return (
    [
      ["E123", "IMP"],
      ["E123", "IMP"],
      ["E123", "MDL"],
      ["E124", "IMP"],
    ] as const
  ).map(([caseNumber, type]) => {
    const context: IdContext = { caseNumber, product: "Cranial Plate", partTypeCode: type, material: "Ti-6Al-4V", spaceName, now };
    const scope = rule.scope ?? "case";
    // The examples share one date, so per month and per year count like across all parts.
    const key =
      scope === "auto"
        ? (sequenceStem(rule, context) ?? caseNumber)
        : scope === "case"
          ? caseNumber
          : scope === "case-type"
            ? `${caseNumber}|${type}`
            : scope === "type"
              ? type
              : "all";
    const sequence = (seen.get(key) ?? 0) + 1;
    seen.set(key, sequence);
    return buildPartNumber(rule, { ...context, sequence }, true);
  });
}

/** What stands in for the case number in the ID of a part without a case. */
export const NO_CASE_CODE = "GEN";

export function buildPartNumber(rule: IdRule, context: IdContext, preview = false): string {
  // Without a case there is no product either, so that token is left out
  // rather than filled with a placeholder: JM-GEN-07, not JM-PART-GEN-07.
  const tokens = context.noCase ? rule.tokens.filter((t) => t !== "PRODUCT") : rule.tokens;
  const withWidth = { ...context, width: rule.width ?? 2 };
  const parts = [rule.prefix, ...tokens.map((t) => tokenValue(t, withWidth, preview))];
  return parts.filter(Boolean).join(rule.sep);
}

export function cleanPrefix(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

// --- Validation of a saved setup ------------------------------------------------------------

const columnSchema = z.object({ id: z.string().min(1).max(40), label: z.string().trim().min(1).max(40) });

const fieldSchema = z.object({
  id: z.string().min(1).max(60),
  key: z.string().max(20),
  var: z.string().regex(/^[A-Za-z0-9_]*$/).max(60),
  def: z.string().max(500),
  label: z.string().trim().min(1, "Every field needs a label.").max(80),
  type: z.enum(FIELD_TYPES),
  show: z.boolean(),
  req: z.boolean(),
  locked: z.boolean(),
  options: z.array(z.string().trim().min(1).max(80)).max(60),
  fileTypes: z.array(z.string()).max(FILE_TYPE_NAMES.length),
  columns: z.array(columnSchema).max(12),
  allowLinks: z.boolean(),
  onCreate: z.boolean().optional(),
});

const sectionSchema = z.object({
  id: z.string().min(1).max(60),
  title: z.string().trim().min(1, "Every section needs a title.").max(80),
  cols: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  fields: z.array(fieldSchema).max(40),
});

export const setupSchema = z.object({
  rule: z.object({
    prefix: z.string().regex(/^[A-Z0-9]{0,8}$/),
    sep: z.enum(SEPARATORS),
    tokens: z.array(z.enum(TOKEN_CODES)).max(TOKEN_CODES.length),
    scope: z.enum(SEQ_SCOPES).optional(),
    width: z.number().int().min(1).max(6).optional(),
  }),
  sections: z.array(sectionSchema).min(1).max(40),
});

/** The fields a request cannot do without, and the type each must keep. */
const REQUIRED_BUILT_INS: Record<string, FieldType> = {
  name: "text",
  qty: "number",
};

/** The types a built-in key is allowed to have — a saved setup cannot retype them. */
const BUILT_IN_TYPES: Record<string, FieldType> = {
  ...REQUIRED_BUILT_INS,
  case: "case",
  workflow: "workflow",
  type: "parttype",
  material: "material",
  printer: "printer",
  sourcing: "sourcing",
  vendor: "vendor",
  site: "site",
  due: "date",
  priority: "priority",
  notes: "textarea",
  files: "file",
  balloon: "balloon",
};

/**
 * What is wrong with a setup, in words, or null when it can be saved. The
 * builder prevents most of these; this is what stands behind it.
 */
export function setupProblem(setup: RequestSetup): string | null {
  const fields = setup.sections.flatMap((s) => s.fields);

  for (const [key, type] of Object.entries(REQUIRED_BUILT_INS)) {
    const found = fields.filter((f) => f.key === key);
    if (found.length !== 1) return "The Part name and Quantity fields must stay on the form.";
    if (found[0].type !== type || !found[0].show || !found[0].req) {
      return `"${found[0].label}" must stay shown and required.`;
    }
  }

  const ids = new Set<string>();
  const vars = new Set<string>();
  for (const f of fields) {
    if (ids.has(f.id)) return "Two fields share an id — reload the page and try again.";
    ids.add(f.id);

    if (f.key) {
      if (BUILT_IN_TYPES[f.key] !== f.type) return `"${f.label}" is a built-in field and cannot change type.`;
      if (fields.filter((o) => o.key === f.key).length > 1) return `"${f.label}" appears twice.`;
    } else {
      if (!CUSTOM_TYPES.some((t) => t.type === f.type)) return `"${f.label}" has a type that cannot be added.`;
    }

    if (f.req && !f.show) return `"${f.label}" is required but hidden.`;
    if (f.type === "select" && f.show && f.options.length === 0) return `Give "${f.label}" at least one option.`;
    if (f.type === "file" && f.fileTypes.some((t) => !FILE_TYPES[t])) return `"${f.label}" allows an unknown file type.`;
    if (f.type === "file" && f.show && f.fileTypes.length === 0 && !f.allowLinks) {
      return `"${f.label}" allows neither files nor links.`;
    }

    const name = fieldVar(f);
    if (name && name.startsWith("request.")) {
      if (vars.has(name)) return `Two fields use the variable {${name}} — rename one of them.`;
      vars.add(name);
    }
  }

  if (fields.filter((f) => f.type === "balloon" && f.show).length > 1) {
    return "A request can carry one drawing with balloons — hide or remove the extra one.";
  }
  return null;
}

// --- Several request forms -----------------------------------------------------------------
// A space can keep more than one request form — one for anatomical models,
// one for implants… — sharing one part-ID rule. A field's variable is what
// quality forms read, so a variable named the same on two forms is one
// variable, and a QA form reads it from parts of either.

export interface RequestFormDef {
  id: string;
  name: string;
  /** One line shown when choosing a form. */
  description: string;
  /** Offered first, and used for parts from before forms could be chosen. */
  isDefault: boolean;
  sections: RequestSection[];
}

export interface RequestForms {
  rule: IdRule;
  forms: RequestFormDef[];
}

/** The id a space's first form has — also before anything is saved. */
export const firstFormId = (spaceId: string) => `std-${spaceId}`;

export function defaultForms(spaceId: string, spaceName: string): RequestForms {
  return {
    rule: defaultRule(spaceName),
    forms: [{ id: firstFormId(spaceId), name: "Standard", description: "", isDefault: true, sections: defaultSections() }],
  };
}

export const formsSchema = z.object({
  rule: setupSchema.shape.rule,
  forms: z
    .array(
      z.object({
        id: z.string().regex(/^[A-Za-z0-9_-]{4,80}$/),
        name: z.string().trim().min(1, "Every request form needs a name.").max(80),
        description: z.string().trim().max(200),
        isDefault: z.boolean(),
        sections: setupSchema.shape.sections,
      }),
    )
    .min(1, "Keep at least one request form.")
    .max(30, "A space can keep at most 30 request forms."),
});

/** What is wrong with a set of forms, in words — naming the form — or null. */
export function formsProblem(setup: RequestForms): string | null {
  const names = setup.forms.map((f) => f.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) return "Two request forms have the same name.";
  if (setup.forms.filter((f) => f.isDefault).length !== 1) return "Choose one request form as the default.";
  if (new Set(setup.forms.map((f) => f.id)).size !== setup.forms.length) return "Two request forms share an id — reload the page and try again.";
  for (const form of setup.forms) {
    const problem = setupProblem({ rule: setup.rule, sections: form.sections });
    if (problem) return setup.forms.length > 1 ? `${form.name}: ${problem}` : problem;
  }
  // A variable shared between forms must mean the same kind of answer, or a QA
  // form reading it would get a number from one form and text from the other.
  const kinds = new Map<string, { type: FieldType; form: string }>();
  for (const form of setup.forms) {
    for (const f of form.sections.flatMap((s) => s.fields)) {
      const name = fieldVar(f);
      if (!name?.startsWith("request.")) continue;
      const seen = kinds.get(name);
      if (seen && seen.type !== f.type) {
        return `{${name}} is a ${typeTag(seen.type)} on "${seen.form}" but a ${typeTag(f.type)} on "${form.name}" — give one of them another variable name.`;
      }
      if (!seen) kinds.set(name, { type: f.type, form: form.name });
    }
  }
  return null;
}

/** Every custom field on the other forms, once per variable — to add the same field to this form. */
export function sharedFields(forms: RequestFormDef[], exceptFormId: string): Array<{ field: RequestField; forms: string[] }> {
  const byVar = new Map<string, { field: RequestField; forms: string[] }>();
  for (const form of forms) {
    if (form.id === exceptFormId) continue;
    for (const f of form.sections.flatMap((s) => s.fields)) {
      if (f.key) continue;
      const name = fieldVar(f) ?? `file:${f.id}`;
      const entry = byVar.get(name);
      if (entry) entry.forms.push(form.name);
      else byVar.set(name, { field: f, forms: [form.name] });
    }
  }
  return [...byVar.values()];
}

// --- Inspection drawing (balloons) ----------------------------------------------------------

export interface InspectionImage {
  id: string;
  name: string;
  w: number;
  h: number;
  /** The stored file, once the request is saved. */
  fileId?: string;
}

/** Positions are percentages of the image: x,y the arrow tip, bx,by the balloon. */
export interface InspectionPoint {
  n: number;
  imgId: string;
  x: number;
  y: number;
  bx: number;
  by: number;
}

export interface InspectionRow {
  id: string;
  /** "" for a row typed in without a drawing. */
  imgId: string;
  balloon: string;
  vals: Record<string, string>;
}

export interface Inspection {
  images: InspectionImage[];
  points: InspectionPoint[];
  columns: BalloonColumn[];
  rows: InspectionRow[];
}

const percent = z.number().min(0).max(100);

export const inspectionSchema = z.object({
  images: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        name: z.string().max(200),
        w: z.number().positive().max(20000),
        h: z.number().positive().max(20000),
      }),
    )
    .max(12),
  points: z
    .array(
      z.object({
        n: z.number().int().positive().max(999),
        imgId: z.string().max(40),
        x: percent,
        y: percent,
        bx: percent,
        by: percent,
      }),
    )
    .max(300),
  rows: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        imgId: z.string().max(40),
        balloon: z.string().max(20),
        vals: z.record(z.string().max(40), z.string().max(300)),
      }),
    )
    .max(300),
});

/** The grid a balloon table is laid out on: two fixed columns, then the configured ones. */
export function tableTemplate(columns: number, withRemove: boolean): string {
  return `44px 96px repeat(${Math.max(columns, 1)}, minmax(0, 1fr))${withRemove ? " 28px" : ""}`;
}

/**
 * The narrowest a balloon table is drawn. Wider containers share the space
 * out; narrower ones — a phone — scroll sideways instead of crushing columns.
 */
export function tableMinWidth(columns: number): number {
  return 200 + Math.max(columns, 1) * 104;
}

/** Which drawing a table row belongs to — or "Manual" for one typed in. */
export function drawingLabel(images: InspectionImage[], imgId: string): string {
  const index = images.findIndex((i) => i.id === imgId);
  return index >= 0 ? `Drawing ${index + 1}` : "Manual";
}

// --- A part's stored answers -----------------------------------------------------------------

export interface PartDetail {
  label: string;
  /** `request.<name>`. */
  var: string;
  value: string;
}

// --- Manufacturing sites -------------------------------------------------------------------------

/** A manufacturing site a part can be made at: in-house, a partner hospital, or a vendor's. */
export interface SiteOption {
  id: string;
  name: string;
  type: string;
  /** The vendor it belongs to (by name), when it is an outsourced site. */
  vendor: string;
}

/** Which sites fit how a part is made: in-house and partner sites, or the chosen vendor's own sites. */
export function sitesFor(sites: SiteOption[], made: string, vendor: string): SiteOption[] {
  if (made === "Outsourced") return sites.filter((s) => s.type === "External vendor" && (!vendor || !s.vendor || s.vendor === vendor));
  if (made === "In-house") return sites.filter((s) => s.type !== "External vendor");
  return sites;
}
