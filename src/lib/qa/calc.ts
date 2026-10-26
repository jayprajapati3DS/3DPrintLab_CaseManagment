import type { GridColumn, QaItem, QaSection } from "@/lib/qa/template";
import { resolve, type Context } from "@/lib/qa/variables";

/**
 * Dates, times, durations and calculated fields on quality forms.
 *
 * A calculated field holds a formula over other fields of the same form,
 * named by their label in square brackets, and variables in braces:
 *
 *   [Print start] + [Print time]                    → the end, a date & time
 *   [End] - [Start]                                  → how long, a duration
 *   [No. of parts printed] - [No. of parts rejected] → a number
 *   round([Quantity produced] / {part.qty} * 100, 1) → a percentage
 *   addMonths([Mfd. date], 24)                       → an expiry date
 *   sum([Print runs], "Material used")               → a data table's column total
 *   count([Files received])                          → how many rows a table has
 *
 * Values carry their kind, and the arithmetic follows it: a date & time plus a
 * duration is a date & time, two dates & times apart are a duration, a date
 * plus a number of days is a date. Literals can be durations: 90m, 1h30m, 2d.
 *
 * Pure — the form computes live with it, and the server again when it saves.
 */

export type Value =
  | { t: "num"; v: number }
  /** Minutes. */
  | { t: "dur"; v: number }
  /** Milliseconds since the epoch, read as wall-clock time (no time zone). */
  | { t: "dt"; v: number }
  /** Days since the epoch. */
  | { t: "date"; v: number }
  /** Minutes since midnight. */
  | { t: "time"; v: number }
  /** Quoted text in a formula — a column's name for sum() / avg() / count(). */
  | { t: "str"; s: string }
  /** A data table: its rows, each by lower-case column name. */
  | { t: "rows"; rows: Array<Record<string, Value | null>> };

const DAY_MS = 86_400_000;
const pad = (n: number, w = 2) => String(Math.trunc(n)).padStart(w, "0");

// --- Reading entered text ----------------------------------------------------------------

/** "1:30", "90", "90m", "1h 30m", "2h", "1d 2h" → minutes; null when it cannot be read. */
export function parseDuration(text: string): number | null {
  const s = text.trim().toLowerCase();
  if (!s) return null;
  const m = /^(-?)(\d+):([0-5]?\d)$/.exec(s);
  if (m) return (m[1] ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  // A bare number is minutes.
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  const parts = [...s.matchAll(/(\d+(?:\.\d+)?)\s*(d|h|m|min|mins|hr|hrs)\b/g)];
  if (!parts.length || parts.map((p) => p[0]).join("").replace(/\s/g, "") !== s.replace(/\s/g, "")) return null;
  return parts.reduce((sum, p) => sum + Number(p[1]) * (p[2] === "d" ? 1440 : p[2].startsWith("h") ? 60 : 1), 0);
}

export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const total = Math.round(Math.abs(minutes));
  return `${sign}${Math.floor(total / 60)}:${pad(total % 60)}`;
}

function parseDate(text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? null : Math.round(ms / DAY_MS);
}

function parseDateTime(text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(text.trim());
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isNaN(ms) ? null : ms;
}

function parseTime(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** A field's text as a value of its kind. */
export function readValue(type: QaItem["type"], text: string): Value | null {
  const s = text.trim();
  if (!s) return null;
  switch (type) {
    case "date": {
      const v = parseDate(s);
      return v === null ? null : { t: "date", v };
    }
    case "datetime": {
      const v = parseDateTime(s);
      return v === null ? null : { t: "dt", v };
    }
    case "time": {
      const v = parseTime(s);
      return v === null ? null : { t: "time", v };
    }
    case "duration": {
      const v = parseDuration(s);
      return v === null ? null : { t: "dur", v };
    }
    case "yesno":
      // Yes counts as 1 and No as 0, so a formula can count the yeses.
      return s === "Yes" ? { t: "num", v: 1 } : s === "No" ? { t: "num", v: 0 } : null;
    default:
      return guess(s);
  }
}

/** Text of unknown kind — a variable's value, a stored result — read as best it can be. */
function guess(text: string): Value | null {
  const s = text.trim().replace(/,/g, "");
  if (/^-?\d+(\.\d+)?$/.test(s)) return { t: "num", v: Number(s) };
  if (/^-?\d+(\.\d+)?\s*%$/.test(s)) return { t: "num", v: Number(s.replace("%", "")) };
  const dt = parseDateTime(s);
  if (dt !== null) return { t: "dt", v: dt };
  const date = parseDate(s);
  if (date !== null) return { t: "date", v: date };
  const time = parseTime(s);
  if (time !== null) return { t: "time", v: time };
  return null;
}

export function formatValue(value: Value): string {
  switch (value.t) {
    case "num": {
      const r = Math.round(value.v * 100) / 100;
      return Object.is(r, -0) ? "0" : String(r);
    }
    case "dur":
      return formatDuration(value.v);
    case "time": {
      const m = ((Math.round(value.v) % 1440) + 1440) % 1440;
      return `${pad(m / 60)}:${pad(m % 60)}`;
    }
    case "date": {
      const d = new Date(value.v * DAY_MS);
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
    case "dt": {
      const d = new Date(value.v);
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    }
    case "str":
      return value.s;
    case "rows":
      return `${value.rows.length} row${value.rows.length === 1 ? "" : "s"}`;
  }
}

/** A value as a plain number for limits: minutes for durations and times, days for dates. */
export function numeric(value: Value): number {
  if (value.t === "str") return Number.NaN;
  if (value.t === "rows") return value.rows.length;
  return value.t === "dt" ? value.v / 60_000 : value.v;
}

/** A limit typed for a field: "1:30" for a duration, a number otherwise. */
export function limitNumber(type: QaItem["type"], text: string): number | null {
  const s = text.trim();
  if (!s || s === "—") return null;
  if (type === "duration") return parseDuration(s);
  const v = guess(s);
  return v ? numeric(v) : null;
}

// --- Formulas -------------------------------------------------------------------------------

type Token =
  | { k: "num"; v: Value }
  | { k: "ref"; label: string }
  | { k: "var"; token: string }
  | { k: "op"; v: "+" | "-" | "*" | "/" }
  | { k: "("; }
  | { k: ")"; }
  | { k: ","; }
  | { k: "fn"; name: string };

export const FUNCTIONS = ["round", "min", "max", "abs", "addDays", "addMonths", "hours", "minutes", "days", "sum", "avg", "count"] as const;

class FormulaError extends Error {}
/** Values of kinds that do not go together — a matter of the values, not of how the formula is written. */
class KindError extends FormulaError {}

function tokenize(formula: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const s = formula;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = s.indexOf(ch, i + 1);
      if (end < 0) throw new FormulaError("A quoted name is not closed.");
      out.push({ k: "num", v: { t: "str", s: s.slice(i + 1, end) } });
      i = end + 1;
      continue;
    }
    if (ch === "[") {
      const end = s.indexOf("]", i);
      if (end < 0) throw new FormulaError("A [field] is not closed.");
      out.push({ k: "ref", label: s.slice(i + 1, end).trim() });
      i = end + 1;
      continue;
    }
    if (ch === "{") {
      const end = s.indexOf("}", i);
      if (end < 0) throw new FormulaError("A {variable} is not closed.");
      out.push({ k: "var", token: s.slice(i + 1, end).trim() });
      i = end + 1;
      continue;
    }
    if ("+-*/".includes(ch)) {
      out.push({ k: "op", v: ch as "+" | "-" | "*" | "/" });
      i += 1;
      continue;
    }
    if (ch === "×") {
      out.push({ k: "op", v: "*" });
      i += 1;
      continue;
    }
    if (ch === "÷") {
      out.push({ k: "op", v: "/" });
      i += 1;
      continue;
    }
    if (ch === "(" || ch === ")" || ch === ",") {
      out.push({ k: ch } as Token);
      i += 1;
      continue;
    }
    // A number, or a duration literal: 90m, 1h30m, 2d, 1.5h.
    const lit = /^(\d+(?:\.\d+)?)(?:\s*(d|h|m)(?![a-z])(?:\s*(\d+(?:\.\d+)?)\s*(h|m)(?![a-z]))?)?/i.exec(s.slice(i));
    if (lit && lit[0]) {
      if (lit[2]) {
        const unit = (u: string) => (u.toLowerCase() === "d" ? 1440 : u.toLowerCase() === "h" ? 60 : 1);
        const minutes = Number(lit[1]) * unit(lit[2]) + (lit[3] ? Number(lit[3]) * unit(lit[4]) : 0);
        out.push({ k: "num", v: { t: "dur", v: minutes } });
      } else {
        out.push({ k: "num", v: { t: "num", v: Number(lit[1]) } });
      }
      i += lit[0].length;
      continue;
    }
    const word = /^[A-Za-z]+/.exec(s.slice(i));
    if (word) {
      if (!FUNCTIONS.includes(word[0] as (typeof FUNCTIONS)[number])) throw new FormulaError(`"${word[0]}" is not a function a formula can use.`);
      out.push({ k: "fn", name: word[0] });
      i += word[0].length;
      continue;
    }
    throw new FormulaError(`"${ch}" cannot be used in a formula.`);
  }
  return out;
}

/** The labels a formula names in [brackets]. */
export function formulaRefs(formula: string): string[] {
  return [...formula.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim());
}

/** A formula with one field's name changed, when that field is renamed. */
export function renameRef(formula: string, from: string, to: string): string {
  return formula.replace(/\[([^\]]+)\]/g, (whole, name: string) => (name.trim() === from.trim() ? `[${to}]` : whole));
}

const KIND_NAMES: Record<Value["t"], string> = {
  num: "a number",
  dur: "a duration",
  dt: "a date & time",
  date: "a date",
  time: "a time",
  str: "text",
  rows: "a table",
};

/** A table's column, read for sum() / avg() / count(): the values of the rows that have one. */
function column(table: Value, name: Value | undefined, fn: string): Value[] {
  if (table.t !== "rows") throw new KindError(`${fn}() of a column needs a table, e.g. ${fn}([Runs], "Qty").`);
  if (!name || name.t !== "str") throw new KindError(`Name the column in quotes, e.g. ${fn}([Runs], "Qty").`);
  const key = name.s.trim().toLowerCase();
  if (table.rows.length && !table.rows.some((r) => key in r)) throw new FormulaError(`The table has no column "${name.s}".`);
  return table.rows.map((r) => r[key]).filter((v): v is Value => Boolean(v));
}

/** Add up numbers or durations of one kind. */
function total(values: Value[], fn: string): Value {
  if (values.length === 0) return { t: "num", v: 0 };
  const kind = values[0].t;
  if (kind !== "num" && kind !== "dur") throw new KindError(`${fn}() adds numbers or durations, not ${KIND_NAMES[kind]}.`);
  if (values.some((v) => v.t !== kind)) throw new KindError(`${fn}() needs values of one kind.`);
  return { t: kind, v: values.reduce((n, v) => n + (v as { v: number }).v, 0) } as Value;
}

function add(a: Value, b: Value, sign: 1 | -1): Value {
  if (a.t === "num" && b.t === "num") return { t: "num", v: a.v + sign * b.v };
  if (a.t === "dur" && b.t === "dur") return { t: "dur", v: a.v + sign * b.v };
  if (a.t === "dt" && b.t === "dur") return { t: "dt", v: a.v + sign * b.v * 60_000 };
  if (sign === 1 && a.t === "dur" && b.t === "dt") return { t: "dt", v: b.v + a.v * 60_000 };
  if (a.t === "dt" && b.t === "dt" && sign === -1) return { t: "dur", v: (a.v - b.v) / 60_000 };
  if (a.t === "date" && b.t === "num") return { t: "date", v: a.v + sign * Math.round(b.v) };
  if (a.t === "date" && b.t === "dur") return { t: "date", v: a.v + sign * Math.round(b.v / 1440) };
  if (a.t === "date" && b.t === "date" && sign === -1) return { t: "num", v: a.v - b.v };
  if (a.t === "date" && b.t === "time" && sign === 1) return { t: "dt", v: a.v * DAY_MS + b.v * 60_000 };
  if (a.t === "time" && b.t === "dur") return { t: "time", v: a.v + sign * b.v };
  // Two times of day apart: the time between them, past midnight if need be.
  if (a.t === "time" && b.t === "time" && sign === -1) return { t: "dur", v: ((a.v - b.v) % 1440 + 1440) % 1440 };
  if (a.t === "dt" && b.t === "date" && sign === -1) return { t: "dur", v: (a.v - b.v * DAY_MS) / 60_000 };
  throw new KindError(`Cannot ${sign === 1 ? "add" : "subtract"} ${KIND_NAMES[b.t]} ${sign === 1 ? "to" : "from"} ${KIND_NAMES[a.t]}.`);
}

function multiply(a: Value, b: Value, op: "*" | "/"): Value {
  if (op === "*") {
    if (a.t === "num" && b.t === "num") return { t: "num", v: a.v * b.v };
    if (a.t === "dur" && b.t === "num") return { t: "dur", v: a.v * b.v };
    if (a.t === "num" && b.t === "dur") return { t: "dur", v: a.v * b.v };
    throw new KindError(`Cannot multiply ${KIND_NAMES[a.t]} by ${KIND_NAMES[b.t]}.`);
  }
  if (b.t === "num" && b.v === 0) throw new FormulaError("Division by zero.");
  if (b.t === "dur" && b.v === 0) throw new FormulaError("Division by a zero duration.");
  if (a.t === "num" && b.t === "num") return { t: "num", v: a.v / b.v };
  if (a.t === "dur" && b.t === "num") return { t: "dur", v: a.v / b.v };
  if (a.t === "dur" && b.t === "dur") return { t: "num", v: a.v / b.v };
  throw new KindError(`Cannot divide ${KIND_NAMES[a.t]} by ${KIND_NAMES[b.t]}.`);
}

function call(name: string, args: Value[]): Value {
  const arg = (i: number, kinds: Value["t"][]) => {
    const v = args[i];
    if (!v) throw new FormulaError(`${name}() needs more values.`);
    if (!kinds.includes(v.t)) throw new KindError(`${name}() cannot take ${KIND_NAMES[v.t]}.`);
    return v;
  };
  switch (name) {
    case "round": {
      const v = arg(0, ["num", "dur"]) as { t: "num" | "dur"; v: number };
      const places = args[1] ? (arg(1, ["num"]) as { v: number }).v : 0;
      const f = 10 ** Math.max(0, Math.min(6, Math.round(places)));
      return { t: v.t, v: Math.round(v.v * f) / f } as Value;
    }
    case "abs": {
      const v = arg(0, ["num", "dur"]) as { t: "num" | "dur"; v: number };
      return { t: v.t, v: Math.abs(v.v) } as Value;
    }
    case "min":
    case "max": {
      if (args.length < 2) throw new FormulaError(`${name}() needs at least two values.`);
      const kind = args[0].t;
      if (args.some((a) => a.t !== kind)) throw new KindError(`${name}() needs values of one kind.`);
      const nums = args.map((a) => numeric(a));
      const pick = name === "min" ? Math.min(...nums) : Math.max(...nums);
      return { t: kind, v: pick } as Value;
    }
    case "addDays": {
      const v = arg(0, ["date", "dt"]) as { t: "date" | "dt"; v: number };
      const n = (arg(1, ["num"]) as { v: number }).v;
      return v.t === "date" ? { t: "date", v: v.v + Math.round(n) } : { t: "dt", v: v.v + Math.round(n) * DAY_MS };
    }
    case "addMonths": {
      const v = arg(0, ["date", "dt"]) as { t: "date" | "dt"; v: number };
      const n = Math.round((arg(1, ["num"]) as { v: number }).v);
      const ms = v.t === "date" ? v.v * DAY_MS : v.v;
      const d = new Date(ms);
      const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1, d.getUTCHours(), d.getUTCMinutes()));
      // The same day of the month, or the last day of a shorter month.
      const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
      target.setUTCDate(Math.min(d.getUTCDate(), last));
      return v.t === "date" ? { t: "date", v: Math.round(target.getTime() / DAY_MS) } : { t: "dt", v: target.getTime() };
    }
    case "sum":
    case "avg": {
      if (!args.length) throw new FormulaError(`${name}() needs values.`);
      const values = args[0].t === "rows" ? column(args[0], args[1], name) : args;
      const sum = total(values, name);
      if (name === "sum") return sum;
      return values.length ? ({ t: sum.t, v: (sum as { v: number }).v / values.length } as Value) : { t: "num", v: 0 };
    }
    case "count": {
      const table = args[0];
      if (!table || table.t !== "rows") throw new KindError("count() takes a table, e.g. count([Files received]).");
      return { t: "num", v: args[1] ? column(table, args[1], name).length : table.rows.length };
    }
    case "hours":
      return { t: "num", v: (arg(0, ["dur"]) as { v: number }).v / 60 };
    case "minutes":
      return { t: "num", v: (arg(0, ["dur"]) as { v: number }).v };
    case "days":
      return { t: "num", v: (arg(0, ["dur"]) as { v: number }).v / 1440 };
  }
  throw new FormulaError(`"${name}" is not a function a formula can use.`);
}

/** What a formula's names stand for; null when the field is still empty. */
export type Lookup = (ref: { label?: string; token?: string }) => Value | null;

/** Thrown when a field the formula needs is still empty: there is no result yet, but nothing is wrong. */
class Pending extends Error {}

function run(formula: string, lookup: Lookup): Value {
  const tokens = tokenize(formula);
  if (!tokens.length) throw new FormulaError("Enter a formula.");
  let at = 0;
  const peek = () => tokens[at];

  function primary(): Value {
    const t = tokens[at++];
    if (!t) throw new FormulaError("The formula ends too early.");
    if (t.k === "num") return t.v;
    if (t.k === "ref" || t.k === "var") {
      const v = lookup(t.k === "ref" ? { label: t.label } : { token: t.token });
      if (!v) throw new Pending();
      return v;
    }
    if (t.k === "op" && t.v === "-") {
      const v = primary();
      if (v.t === "num" || v.t === "dur") return { t: v.t, v: -v.v } as Value;
      throw new KindError(`Cannot negate ${KIND_NAMES[v.t]}.`);
    }
    if (t.k === "(") {
      const v = sum();
      if (tokens[at++]?.k !== ")") throw new FormulaError("A bracket ( is not closed.");
      return v;
    }
    if (t.k === "fn") {
      if (tokens[at++]?.k !== "(") throw new FormulaError(`Write ${t.name}( … ).`);
      const args: Value[] = [];
      if (peek()?.k !== ")") {
        for (;;) {
          args.push(sum());
          if (peek()?.k === ",") {
            at += 1;
            continue;
          }
          break;
        }
      }
      if (tokens[at++]?.k !== ")") throw new FormulaError(`${t.name}( is not closed.`);
      return call(t.name, args);
    }
    throw new FormulaError("The formula is not complete.");
  }
  function product(): Value {
    let v = primary();
    for (let t = peek(); t?.k === "op" && (t.v === "*" || t.v === "/"); t = peek()) {
      at += 1;
      v = multiply(v, primary(), t.v);
    }
    return v;
  }
  function sum(): Value {
    let v = product();
    for (let t = peek(); t?.k === "op" && (t.v === "+" || t.v === "-"); t = peek()) {
      at += 1;
      v = add(v, product(), t.v === "+" ? 1 : -1);
    }
    return v;
  }

  const result = sum();
  if (at < tokens.length) throw new FormulaError("Something follows the end of the formula — an operator may be missing.");
  return result;
}

/** What is wrong with a formula's writing, in words — or null. Fields are not looked up. */
export function formulaProblem(formula: string): string | null {
  try {
    run(formula, () => ({ t: "num", v: 1 }));
    return null;
  } catch (error) {
    // Every name stands in as the number 1, so a mix of kinds is not the
    // writing's fault — the real values decide that. Report the writing only.
    if (error instanceof FormulaError && !(error instanceof KindError)) return error.message;
    return null;
  }
}

export interface Computed {
  value: Value | null;
  /** The result as shown and stored. Empty while a field it needs is empty. */
  text: string;
  /** Why it could not be worked out — not set merely because a field is still empty. */
  error: string | null;
}

const ENTRY_TYPES = new Set(["text", "number", "date", "datetime", "time", "duration", "select", "sign", "yesno"]);

// --- Data tables ----------------------------------------------------------------------------

/** One row of a data table, as stored: its cells by column id. */
export interface GridRow {
  id: string;
  c: Record<string, string>;
}

/** A data table's stored text — JSON — as rows; [] when empty or unreadable. */
export function readRows(text: string | undefined): GridRow[] {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r): r is GridRow => Boolean(r) && typeof r === "object" && typeof (r as GridRow).id === "string")
      .map((r) => ({ id: r.id, c: r.c && typeof r.c === "object" ? r.c : {} }));
  } catch {
    return [];
  }
}

const columnItem = (c: GridColumn): QaItem => ({
  id: c.id,
  type: c.kind === "select" || c.kind === "image" ? "text" : c.kind === "check" ? "yesno" : c.kind,
  label: c.label,
  value: "",
  req: c.req,
  lsl: "",
  usl: "",
  src: "",
  opts: c.opts,
  qty: false,
  noMeasure: false,
  formula: c.formula,
});

/** The calculated cells of one row, worked out from the row's other cells. */
export function computeRow(columns: GridColumn[], row: GridRow, context: Context): Record<string, Computed> {
  if (!columns.some((c) => c.kind === "calc")) return {};
  return computeAll([{ id: "row", title: "", cols: 1, items: columns.map(columnItem) }], (item) => row.c[item.id] ?? "", context);
}

/** A data table as a value: each row by lower-case column name, calculated cells included. */
function tableValue(columns: GridColumn[], rows: GridRow[], context: Context): Value {
  return {
    t: "rows",
    rows: rows.map((row) => {
      const calc = computeRow(columns, row, context);
      const out: Record<string, Value | null> = {};
      for (const c of columns) {
        out[c.label.trim().toLowerCase()] = c.kind === "calc" ? (calc[c.id]?.value ?? null) : readValue(c.kind === "select" || c.kind === "image" ? "text" : c.kind === "check" ? "yesno" : c.kind, row.c[c.id] ?? "");
      }
      return out;
    }),
  };
}

/**
 * Work out every calculated field of a form. `entered` gives a field's
 * current text (what was typed, or its pre-fill).
 */
export function computeAll(sections: QaSection[], entered: (item: QaItem) => string, context: Context): Record<string, Computed> {
  const items = sections.flatMap((s) => s.items);
  const byLabel = new Map<string, QaItem[]>();
  for (const item of items) {
    const key = resolve(item.label, context).trim().toLowerCase();
    byLabel.set(key, [...(byLabel.get(key) ?? []), item]);
    // The label as typed too, so [{part.id} check] style labels resolve either way.
    const raw = item.label.trim().toLowerCase();
    if (raw !== key) byLabel.set(raw, [...(byLabel.get(raw) ?? []), item]);
  }
  const out: Record<string, Computed> = {};
  const busy = new Set<string>();

  function valueOf(item: QaItem): Value | null {
    if (item.type === "calc") return compute(item).value;
    if (item.type === "info") return guess(resolve(item.value, context));
    if (item.type === "grid") return tableValue(item.columns ?? [], readRows(entered(item)), context);
    if (!ENTRY_TYPES.has(item.type)) return null;
    return readValue(item.type, entered(item));
  }

  function compute(item: QaItem): Computed {
    if (out[item.id]) return out[item.id];
    if (busy.has(item.id)) return { value: null, text: "", error: "The formula refers back to itself." };
    busy.add(item.id);
    let result: Computed;
    try {
      const value = run(item.formula ?? "", (ref) => {
        if (ref.token !== undefined) {
          const text = context[ref.token];
          if (text === undefined) throw new FormulaError(`{${ref.token}} is not a variable.`);
          return guess(text);
        }
        const found = byLabel.get((ref.label ?? "").toLowerCase()) ?? [];
        if (found.length === 0) throw new FormulaError(`There is no field called [${ref.label}] on this form.`);
        if (found.length > 1) throw new FormulaError(`Two fields are called [${ref.label}] — rename one.`);
        if (found[0].id === item.id) throw new FormulaError("The formula refers back to itself.");
        return valueOf(found[0]);
      });
      result = { value, text: formatValue(value), error: null };
    } catch (error) {
      result =
        error instanceof Pending
          ? { value: null, text: "", error: null }
          : { value: null, text: "", error: error instanceof Error ? error.message : "The formula could not be worked out." };
    }
    busy.delete(item.id);
    out[item.id] = result;
    return result;
  }

  for (const item of items) if (item.type === "calc") compute(item);
  return out;
}
