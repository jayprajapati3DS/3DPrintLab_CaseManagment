import type { Inspection } from "@/lib/parts/request-form";
import { computeAll, computeRow, limitNumber, numeric, parseDuration, readRows, readValue, type Computed, type Value } from "@/lib/qa/calc";
import { autoSigner, customOptions, roleAllowed, type QaItem, type QaSection, type Source } from "@/lib/qa/template";
import { resolve, type Context } from "@/lib/qa/variables";

/**
 * Reading a filled-in form: what each item shows, what passed and failed,
 * what is still missing and what may not be used. The form on screen runs
 * this as the operator types; the server runs it again before it accepts a
 * submission or an approval, so the two cannot disagree.
 */

/** One choice in a library dropdown. */
export interface LibOption {
  id: string;
  label: string;
  /** Why this item must not be used today — expired, overdue, not approved. */
  warn: string | null;
  /** What the form shows under a picked item. */
  info: Array<[string, string]>;
  /** Stock available, for libraries that record a quantity used. */
  avail: number | null;
  unit: string | null;
  /** A lot's material, so lots of the part's own material can come first. */
  material?: string | null;
}

export type Libraries = Partial<Record<Source, LibOption[]>>;

export interface FormState {
  /** By item id: entered text, a check result, a picked option's id, a signature. */
  values: Record<string, string>;
  /** By `${itemId}:${rowId}`: a balloon's measured value. */
  measured: Record<string, string>;
  /** By item id: the quantity used of the picked item. */
  quantities: Record<string, string>;
}

export const emptyState = (): FormState => ({ values: {}, measured: {}, quantities: {} });

/** The warning a lot has when nothing is left of it (src/lib/qa/libraries.ts). */
export const USED_UP = "Lot is used up (0 remaining)";

/**
 * The libraries as this form sees them while it is edited: what the form had
 * already taken from stock is back on the shelf — so a saved quantity can be
 * changed, even one that used a lot up. Saving then moves stock only by the
 * difference.
 */
export function withOwnUse(libraries: Libraries, own: Array<{ source: string; itemId: string; qty: number }>): Libraries {
  const back = new Map<string, number>();
  for (const u of own) {
    if (!u.itemId || !(u.qty > 0)) continue;
    const key = `${u.source}:${u.itemId}`;
    back.set(key, (back.get(key) ?? 0) + u.qty);
  }
  if (back.size === 0) return libraries;
  const out: Libraries = { ...libraries };
  for (const source of Object.keys(out) as Source[]) {
    out[source] = (out[source] ?? []).map((o) => {
      const q = back.get(`${source}:${o.id}`);
      if (!q || o.avail === null) return o;
      const avail = Math.round((o.avail + q) * 1000) / 1000;
      return { ...o, avail, warn: o.warn === USED_UP && avail > 0 ? null : o.warn };
    });
  }
  return out;
}

/** What a saved form took from stock, read from its saved picks and quantities. */
export function savedUse(sections: QaSection[], saved: FormState): Array<{ source: string; itemId: string; qty: number }> {
  const out: Array<{ source: string; itemId: string; qty: number }> = [];
  for (const item of sections.flatMap((s) => s.items)) {
    if (!item.qty || !item.src || item.src === "custom") continue;
    const itemId = saved.values[item.id];
    const qty = Number(String(saved.quantities[item.id] ?? "").replace(",", "."));
    if (itemId && Number.isFinite(qty) && qty > 0) out.push({ source: item.src, itemId, qty });
  }
  return out;
}

export type Result = "Pass" | "Fail" | "";

const toNumber = (text: string): number | null => {
  const cleaned = text.trim().replace(",", ".");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

/**
 * A duration or a calculated result against its limits — durations in h:mm or
 * minutes, other results as numbers. Blank when there is nothing to judge.
 */
export function judgeKind(type: QaItem["type"], text: string, lsl: string, usl: string): Result {
  const value = text.trim() ? readValue(type, text) : null;
  return value ? judgeValue(value, lsl, usl) : "";
}

/** A worked-out value against limits: a duration in h:mm or minutes, anything else as a number. */
export function judgeValue(value: Value, lsl: string, usl: string): Result {
  const n = numeric(value);
  const limitType = value.t === "dur" ? "duration" : "number";
  const lo = limitNumber(limitType, lsl);
  const hi = limitNumber(limitType, usl);
  if (lo === null && hi === null) return "";
  if (lo !== null && n < lo) return "Fail";
  if (hi !== null && n > hi) return "Fail";
  return "Pass";
}

/** The kinds of field a person types a value into, read the same way. */
export const ENTRY_TYPES: QaItem["type"][] = ["text", "sign", "date", "datetime", "time", "duration"];

/** Every calculated field of a form, from what is entered now. Hidden fields count as empty. */
export function calculations(sections: QaSection[], state: FormState, context: Context, hidden: Set<string> = new Set()): Record<string, Computed> {
  return computeAll(
    sections,
    (item) =>
      hidden.has(item.id)
        ? ""
        : item.type === "number" || item.type === "select" || item.type === "yesno" || item.type === "grid"
          ? (state.values[item.id] ?? "")
          : enteredText(item, state, context),
    context,
  );
}

// --- Attachments ------------------------------------------------------------------------------

export interface Attachment {
  id: string;
  name: string;
  type: string;
}

/** A photo / attachment field's stored files. */
export function readFiles(text: string | undefined): Attachment[] {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((f): f is Attachment => Boolean(f) && typeof f === "object" && typeof (f as Attachment).id === "string")
      : [];
  } catch {
    return [];
  }
}

// --- Showing a field only when … ----------------------------------------------------------------

/** What a field reads as, for another field's show-if: its value as a person would say it. */
function spoken(item: QaItem, state: FormState, context: Context, calc: Record<string, Computed>, libraries: Libraries): string {
  switch (item.type) {
    case "calc":
      return calc[item.id]?.text ?? "";
    case "select":
      return item.src === "custom" ? enteredText(item, state, context) : (pickedOption(item, state, context, libraries)?.label ?? "");
    case "number":
    case "check":
    case "yesno":
      return state.values[item.id] ?? "";
    case "grid": {
      const n = readRows(state.values[item.id]).length;
      return n ? String(n) : "";
    }
    case "file": {
      const n = readFiles(state.values[item.id]).length;
      return n ? String(n) : "";
    }
    case "info":
      return resolve(item.value, context).replace(/^—$/, "");
    default:
      return enteredText(item, state, context);
  }
}

const asNumber = (text: string): number | null => {
  const t = text.trim();
  if (!t) return null;
  if (/^-?\d+(\.\d+)?$/.test(t.replace(",", "."))) return Number(t.replace(",", "."));
  return parseDuration(t);
};

/** The fields hidden now, because what their show-if names does not hold. */
function hiddenItems(sections: QaSection[], state: FormState, context: Context, calc: Record<string, Computed>, libraries: Libraries): Set<string> {
  const items = sections.flatMap((s) => s.items);
  const byLabel = new Map(items.map((i) => [i.label.trim().toLowerCase(), i]));
  const memo = new Map<string, boolean>();
  const isHidden = (item: QaItem, depth = 0): boolean => {
    if (!item.showIf || !item.showIf.ref.trim()) return false;
    if (memo.has(item.id)) return memo.get(item.id)!;
    const ref = byLabel.get(item.showIf.ref.trim().toLowerCase());
    let hide: boolean;
    if (!ref || ref.id === item.id || depth > 20) hide = false;
    else {
      // A field hidden itself reads as empty.
      const text = isHidden(ref, depth + 1) ? "" : spoken(ref, state, context, calc, libraries).trim();
      const want = item.showIf.value.trim();
      switch (item.showIf.op) {
        case "eq":
          hide = text.toLowerCase() !== want.toLowerCase();
          break;
        case "ne":
          hide = text.toLowerCase() === want.toLowerCase();
          break;
        case "filled":
          hide = text === "";
          break;
        case "empty":
          hide = text !== "";
          break;
        case "gt":
        case "lt": {
          const n = asNumber(text);
          const w = asNumber(want);
          hide = n === null || w === null || (item.showIf.op === "gt" ? !(n > w) : !(n < w));
          break;
        }
      }
    }
    memo.set(item.id, hide);
    return hide;
  };
  return new Set(items.filter((i) => isHidden(i)).map((i) => i.id));
}

export interface FormModel {
  calc: Record<string, Computed>;
  /** Fields not shown now: not required, not checked, not saved. */
  hidden: Set<string>;
}

/** Everything about a form that depends on what is entered: its calculations and which fields show. */
export function formModel(sections: QaSection[], state: FormState, context: Context, libraries: Libraries): FormModel {
  // Twice: a calculation may decide what shows, and what shows feeds the calculations.
  const first = calculations(sections, state, context);
  const hiddenFirst = hiddenItems(sections, state, context, first, libraries);
  const calc = calculations(sections, state, context, hiddenFirst);
  return { calc, hidden: hiddenItems(sections, state, context, calc, libraries) };
}

/** Pass when the value is within whichever limits are set; blank when nothing can be judged. */
export function judge(value: string, lsl: string, usl: string): Result {
  const n = toNumber(value);
  const lo = toNumber(lsl);
  const hi = toNumber(usl);
  if (n === null || (lo === null && hi === null)) return "";
  if (lo !== null && n < lo) return "Fail";
  if (hi !== null && n > hi) return "Fail";
  return "Pass";
}

export function specText(lsl: string, usl: string): string {
  if (lsl && usl) return `${lsl} – ${usl}`;
  if (lsl) return `≥ ${lsl}`;
  if (usl) return `≤ ${usl}`;
  return "No limits";
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** The option an item currently has: picked, or pre-selected through its value. */
export function pickedOption(item: QaItem, state: FormState, context: Context, libraries: Libraries): LibOption | null {
  if (item.type !== "select" || !item.src || item.src === "custom") return null;
  const options = libraries[item.src] ?? [];
  const picked = state.values[item.id];
  if (picked !== undefined) return options.find((o) => o.id === picked) ?? null;
  const preset = resolve(item.value, context).trim();
  return preset && preset !== "—" ? (options.find((o) => o.label === preset) ?? null) : null;
}

/** The text an entry item shows: what was typed, or else its resolved pre-fill. */
export function enteredText(item: QaItem, state: FormState, context: Context): string {
  const typed = state.values[item.id];
  if (typed !== undefined) return typed;
  if (item.type === "check" || item.type === "yesno" || item.type === "grid" || item.type === "file") return "";
  // A signature kept for some roles is not signed in advance for anyone else,
  // and one given as an image is signed only by choosing to.
  if (item.type === "sign" && item.roles && !roleAllowed(item.roles, context["user.role"] ?? "")) return "";
  if (item.type === "sign" && item.style === "image") return "";
  // Signed on submit or approval, never filled in beforehand.
  if (autoSigner(item)) return "";
  const resolved = resolve(item.value, context);
  return resolved === "—" ? "" : resolved;
}

export interface BalloonRowView {
  rowId: string;
  balloon: string;
  cells: string[];
  lsl: string;
  usl: string;
  measured: string;
  result: Result;
}

/** The balloon table as an item shows it, with limits from the LSL / USL columns. */
export function balloonRows(item: QaItem, state: FormState, inspection: Inspection | null): BalloonRowView[] {
  if (!inspection) return [];
  const lslCol = inspection.columns.find((c) => c.label.trim().toLowerCase() === "lsl");
  const uslCol = inspection.columns.find((c) => c.label.trim().toLowerCase() === "usl");
  return inspection.rows.map((row) => {
    const measured = state.measured[`${item.id}:${row.id}`] ?? "";
    const lsl = lslCol ? (row.vals[lslCol.id] ?? "") : "";
    const usl = uslCol ? (row.vals[uslCol.id] ?? "") : "";
    return {
      rowId: row.id,
      balloon: row.balloon || "—",
      cells: inspection.columns.map((c) => row.vals[c.id] ?? ""),
      lsl,
      usl,
      measured,
      result: item.noMeasure ? "" : judge(measured, lsl, usl),
    };
  });
}

export interface Evaluation {
  /** Labels of required items still empty. */
  missing: string[];
  /** Labels of measurements and checks that failed. */
  fails: string[];
  /** Why a picked item may not be used: "{label}: {warning}". */
  blocked: string[];
  /** Fields not shown now. */
  hidden: Set<string>;
}

/**
 * Check a form. `alreadyUsed` is what this same form had already recorded
 * against each item before this edit — it is back in stock while the form is
 * being changed, so re-saving does not count it twice.
 */
export function evaluate(
  sections: QaSection[],
  state: FormState,
  context: Context,
  libraries: Libraries,
  inspection: Inspection | null,
  alreadyUsed: Record<string, number> = {},
): Evaluation {
  const missing: string[] = [];
  const fails: string[] = [];
  const blocked: string[] = [];
  const { calc, hidden } = formModel(sections, state, context, libraries);

  for (const item of sections.flatMap((s) => s.items)) {
    // A field not shown is neither required nor checked.
    if (hidden.has(item.id)) continue;
    switch (item.type) {
      case "grid": {
        const rows = readRows(state.values[item.id]);
        const columns = item.columns ?? [];
        if (item.req && rows.length === 0) missing.push(`${item.label} — add at least one row`);
        rows.forEach((row, n) => {
          const cells = computeRow(columns, row, context);
          for (const c of columns) {
            if (c.kind === "calc") {
              if (cells[c.id]?.error) blocked.push(`${item.label} row ${n + 1} → ${c.label}: ${cells[c.id].error}`);
              continue;
            }
            const text = (row.c[c.id] ?? "").trim();
            if (!text) {
              if (c.req) missing.push(`${item.label} row ${n + 1} — ${c.label}`);
            } else if (c.kind !== "text" && c.kind !== "select" && !readValue(c.kind, text)) {
              missing.push(`${item.label} row ${n + 1} — ${c.label} is not valid`);
            }
          }
        });
        break;
      }
      case "yesno": {
        const value = state.values[item.id] ?? "";
        if (item.req && !value) missing.push(item.label);
        if (value && item.expect && value !== item.expect) fails.push(item.label);
        break;
      }
      case "file": {
        if (item.req && readFiles(state.values[item.id]).length === 0) missing.push(`${item.label} — attach a file`);
        break;
      }
      case "date":
      case "datetime":
      case "time":
      case "duration": {
        const text = enteredText(item, state, context).trim();
        if (!text) {
          if (item.req) missing.push(item.label);
          break;
        }
        if (!readValue(item.type, text)) {
          missing.push(`${item.label} — not a valid ${item.type === "duration" ? "duration (h:mm)" : item.type === "datetime" ? "date & time" : item.type}`);
          break;
        }
        if (item.type === "duration" && judgeKind(item.type, text, resolve(item.lsl, context), resolve(item.usl, context)) === "Fail") fails.push(item.label);
        break;
      }
      case "calc": {
        const result = calc[item.id];
        if (result?.error) blocked.push(`${item.label}: ${result.error}`);
        else if (item.req && !result?.text) missing.push(item.label);
        else if (result?.value && judgeValue(result.value, resolve(item.lsl, context), resolve(item.usl, context)) === "Fail") fails.push(item.label);
        break;
      }
      case "text":
      case "sign": {
        // One signed on submit or approval is the app's to fill, at that moment.
        if (autoSigner(item)) break;
        if (item.req && !enteredText(item, state, context).trim()) missing.push(item.label);
        break;
      }
      case "number": {
        const value = state.values[item.id] ?? "";
        if (item.req && !value.trim()) missing.push(item.label);
        if (judge(value, resolve(item.lsl, context), resolve(item.usl, context)) === "Fail") fails.push(item.label);
        break;
      }
      case "check": {
        const value = state.values[item.id] ?? "";
        if (item.req && !value) missing.push(item.label);
        if (value === "Fail") fails.push(item.label);
        break;
      }
      case "select": {
        if (item.src === "custom") {
          const value = enteredText(item, state, context);
          if (item.req && !value) missing.push(item.label);
          // Several ticked: each must be one of the choices.
          const picked = item.multi ? value.split(",").map((v) => v.trim()).filter(Boolean) : value ? [value] : [];
          if (picked.some((v) => !customOptions(item.opts).includes(v))) missing.push(item.label);
          break;
        }
        const option = pickedOption(item, state, context, libraries);
        if (item.req && !option) missing.push(item.label);
        if (option?.warn) blocked.push(`${item.label}: ${option.warn}`);
        if (option && item.qty) {
          const qty = toNumber(state.quantities[item.id] ?? "");
          if (qty === null) {
            if (item.req) missing.push(`${item.label} — quantity used`);
          } else if (qty < 0) {
            blocked.push(`${item.label}: the quantity used cannot be negative`);
          } else if (option.avail !== null) {
            const available = round3(option.avail + (alreadyUsed[item.id] ?? 0));
            if (qty > available) blocked.push(`${item.label}: only ${available} ${option.unit ?? ""} available`.trim());
          }
        }
        break;
      }
      case "table": {
        if (item.noMeasure) break;
        for (const row of balloonRows(item, state, inspection)) {
          if (item.req && !row.measured.trim()) missing.push(`${item.label} — balloon ${row.balloon}`);
          if (row.result === "Fail") fails.push(`${item.label} — balloon ${row.balloon}`);
        }
        break;
      }
      default:
        break;
    }
  }
  return { missing, fails, blocked, hidden };
}

/** Quantities in a form, read as numbers. */
export function quantityOf(state: FormState, itemId: string): number | null {
  return toNumber(state.quantities[itemId] ?? "");
}
