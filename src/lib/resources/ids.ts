import { z } from "zod";

/**
 * Automatic IDs for master data: an asset ID, tool ID, item code… made from a
 * pattern such as `PR-{TYPE}-{##}`. Typing an ID by hand always works; the
 * pattern only fills one in — when asked, or, with automatic IDs on, when the
 * ID is left blank.
 *
 * The running part is worked out from the IDs already in use: the next ID is
 * one past the highest that matches the same pattern (with the same type and
 * date), so IDs typed by hand in that format are counted too and nothing is
 * stored that could drift from the records.
 *
 * Pure: the setup panel previews with it, the server assigns with it.
 */

export interface IdRule {
  /** Assign an ID on save when the field is left blank. */
  auto: boolean;
  pattern: string;
}

/** What a pattern can contain. Exactly one running part ({###}, {AA} or {XXX}). */
export const ID_TOKENS: Array<{ token: string; label: string; hint: string }> = [
  { token: "{###}", label: "Number", hint: "001, 002, 003… — one # per digit" },
  { token: "{AA}", label: "Letters", hint: "AA, AB … AZ, BA… — one A per letter" },
  { token: "{XXX}", label: "Letters + numbers", hint: "001 … 009, 00A … 00Z, 010… — one X per character" },
  { token: "{TYPE}", label: "Type code", hint: "From the record's type or technology: SLA, CMM, HTF…" },
  { token: "{YYYY}", label: "Year", hint: "2026" },
  { token: "{YY}", label: "Year (2 digits)", hint: "26" },
  { token: "{MM}", label: "Month", hint: "01 – 12" },
];

/**
 * A case's own answers, for case IDs: the surgeon's and the patient's initials,
 * the patient ID, the surgery and delivery dates (DDMMYY), the hospital's code.
 * The running part counts across them — 000123_HR_2606_MA, then 000124_…
 * whoever the patient; {HOSPITAL}{####} gives 132837, then 382838 at another
 * hospital.
 */
export const CASE_FIELD_TOKENS: Array<{ token: string; label: string; hint: string }> = [
  { token: "{SURGEON}", label: "Surgeon initials", hint: "Dr. Heli Rushinek → HR" },
  { token: "{PATIENT}", label: "Patient initials", hint: "M.A. → MA" },
  { token: "{PID}", label: "Patient ID", hint: "As entered: 2606" },
  { token: "{SURGERY}", label: "Surgery date", hint: "DDMMYY: 041026" },
  { token: "{DELIVERY}", label: "Delivery date", hint: "DDMMYY: 300926" },
  { token: "{HOSPITAL}", label: "Hospital code", hint: "The hospital's code (Hospitals list): Hadassah → 13" },
];
export type FieldToken = "SURGEON" | "PATIENT" | "PID" | "SURGERY" | "DELIVERY" | "HOSPITAL";
const FIELD_NAMES: FieldToken[] = ["SURGEON", "PATIENT", "PID", "SURGERY", "DELIVERY", "HOSPITAL"];

const RUNNING = /\{(#+|A+|X+)\}/g;
const ANY_TOKEN = /\{([A-Z#]+)\}/g;
const KNOWN = /^(#+|A+|X+|TYPE|YYYY|YY|MM|SURGEON|PATIENT|PID|SURGERY|DELIVERY|HOSPITAL)$/;

export const idRuleSchema = z.object({
  auto: z.boolean(),
  pattern: z.string().trim().max(40, "Keep the pattern to 40 characters."),
});

/** What is wrong with a pattern, in words — or null. */
export function patternProblem(pattern: string): string | null {
  if (!pattern.trim()) return "Enter a pattern, e.g. PR-{###}.";
  for (const m of pattern.matchAll(ANY_TOKEN)) {
    if (!KNOWN.test(m[1])) return `{${m[1]}} is not a part a pattern can use.`;
  }
  const running = [...pattern.matchAll(RUNNING)];
  if (running.length === 0) return "Add a running part: {###} for numbers, {AA} for letters or {XXX} for both.";
  if (running.length > 1) return "Use only one running part ({###}, {AA} or {XXX}).";
  if (running[0][1].length > 8) return "The running part can be at most 8 characters wide.";
  if (/[{}]/.test(pattern.replace(ANY_TOKEN, ""))) return "A brace is not closed — tokens look like {###}.";
  return null;
}

// --- The running part ----------------------------------------------------------------------

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function encode(kind: "#" | "A" | "X", width: number, n: number): string {
  if (kind === "#") return String(n).padStart(width, "0");
  if (kind === "X") return n.toString(36).toUpperCase().padStart(width, "0");
  // Letters count from AA… (or A…) as zero: 1 → AA, 2 → AB, 27 → BA.
  let value = n - 1;
  let out = "";
  do {
    out = LETTERS[value % 26] + out;
    value = Math.floor(value / 26);
  } while (value > 0);
  return out.padStart(width, "A");
}

function decode(kind: "#" | "A" | "X", text: string): number | null {
  const upper = text.toUpperCase();
  if (kind === "#") return /^\d+$/.test(upper) ? Number(upper) : null;
  if (kind === "X") return /^[0-9A-Z]+$/.test(upper) ? parseInt(upper, 36) : null;
  if (!/^[A-Z]+$/.test(upper)) return null;
  let value = 0;
  for (const ch of upper) value = value * 26 + LETTERS.indexOf(ch);
  return value + 1;
}

const CHARS: Record<"#" | "A" | "X", string> = { "#": "\\d", A: "[A-Za-z]", X: "[0-9A-Za-z]" };
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A short code for a type: "SLA" stays, "Heat treatment furnace" → HTF, "Caliper" → CAL. */
export function typeCode(type: string): string {
  const clean = type.trim();
  if (!clean) return "GEN";
  if (/^[A-Za-z0-9]{1,4}$/.test(clean)) return clean.toUpperCase();
  const words = clean.match(/[A-Za-z0-9]+/g) ?? [];
  if (words.length >= 2) return words.map((w) => w[0]).join("").toUpperCase().slice(0, 4);
  return (words[0] ?? "GEN").slice(0, 3).toUpperCase();
}

export interface IdContext {
  /** The record's type or technology, for {TYPE}. */
  type: string;
  now: Date;
  /** A case's own answers, for {SURGEON}, {PATIENT}, {PID}, {SURGERY}, {DELIVERY}, {HOSPITAL}. */
  fields?: Partial<Record<FieldToken, string>>;
  /** The running part starts no lower than this — to carry on from numbers given elsewhere. */
  start?: number;
}

/** Initials of a name, its titles left out: "Dr. Heli Rushinek" → HR, "M.A." → MA. */
export function initialsOf(name: string): string {
  const words = (name.match(/[A-Za-z][A-Za-z'-]*/g) ?? []).filter((w) => !/^(dr|prof|mr|mrs|ms|miss|md)$/i.test(w));
  return words.map((w) => w[0]).join("").toUpperCase();
}

/** A date for an ID: DDMMYY. */
export function idDate(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(`${date.slice(0, 10)}T00:00:00Z`) : date;
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getUTCDate()).padStart(2, "0")}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCFullYear()).slice(2)}`;
}

/** What a field token puts in an ID: letters and digits only, upper case. */
const fieldValue = (context: IdContext, name: FieldToken) => (context.fields?.[name] ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();

/** The pattern with everything but the running part filled in, split around it. */
function frame(pattern: string, context: IdContext) {
  const year = String(context.now.getFullYear());
  const dated = (text: string) =>
    text
      .replaceAll("{TYPE}", typeCode(context.type))
      .replaceAll("{YYYY}", year)
      .replaceAll("{YY}", year.slice(2))
      .replaceAll("{MM}", String(context.now.getMonth() + 1).padStart(2, "0"));
  const fixed = (text: string) => FIELD_NAMES.reduce((t, name) => t.replaceAll(`{${name}}`, fieldValue(context, name)), dated(text));
  // For counting, a case's own parts match anything: the number runs on across patients and surgeons.
  const shape = (text: string) =>
    dated(text)
      .split(/(\{(?:SURGEON|PATIENT|PID|SURGERY|DELIVERY|HOSPITAL)\})/)
      .map((part) => (/^\{[A-Z]+\}$/.test(part) ? "[0-9A-Za-z]*" : escape(part)))
      .join("");
  const m = /\{(#+|A+|X+)\}/.exec(pattern)!;
  const beforeShape = shape(pattern.slice(0, m.index));
  return {
    before: fixed(pattern.slice(0, m.index)),
    after: fixed(pattern.slice(m.index + m[0].length)),
    beforeShape,
    // Right after a case's own answer ({HOSPITAL}{####}), only the running part's width tells them apart.
    exact: beforeShape.endsWith("]*"),
    afterShape: shape(pattern.slice(m.index + m[0].length)),
    kind: m[1][0] as "#" | "A" | "X",
    width: m[1].length,
  };
}

/**
 * The next IDs the pattern gives, after those already in use. `count` > 1
 * previews the ones after it too.
 */
export function nextIds(pattern: string, context: IdContext, existing: Iterable<string>, count = 1): string[] {
  if (patternProblem(pattern)) return [];
  const { before, after, beforeShape, afterShape, kind, width, exact } = frame(pattern, context);
  const shape = new RegExp(`^${beforeShape}(${CHARS[kind]}${exact ? `{${width}}` : "+"})${afterShape}$`, "i");
  const used = new Set<string>();
  let highest = Math.max(0, Math.floor(context.start ?? 1) - 1);
  for (const id of existing) {
    const trimmed = id.trim();
    if (!trimmed) continue;
    used.add(trimmed.toUpperCase());
    const m = shape.exec(trimmed);
    const n = m ? decode(kind, m[1]) : null;
    if (n !== null && n > highest) highest = n;
  }
  const out: string[] = [];
  for (let n = highest + 1; out.length < count && n < highest + 10_000; n += 1) {
    const id = `${before}${encode(kind, width, n)}${after}`;
    if (!used.has(id.toUpperCase())) out.push(id);
  }
  return out;
}

export function nextId(pattern: string, context: IdContext, existing: Iterable<string>): string | null {
  return nextIds(pattern, context, existing, 1)[0] ?? null;
}

export function readIdRule(value: unknown, fallback: string): IdRule {
  const parsed = idRuleSchema.safeParse(value);
  if (!parsed.success || patternProblem(parsed.data.pattern)) return { auto: false, pattern: fallback };
  return parsed.data;
}
