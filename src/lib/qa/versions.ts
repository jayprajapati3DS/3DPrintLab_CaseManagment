import { readRows } from "@/lib/qa/calc";
import { readFiles } from "@/lib/qa/evaluate";
import type { QaItem, QaSection } from "@/lib/qa/template";

/**
 * Comparing a kept version of a quality form with another: which fields read
 * differently, as text — what a person compares, not the stored JSON.
 */

export interface FormRecord {
  sections: QaSection[];
  values: Record<string, string>;
  measured: Record<string, string>;
  snap: Record<string, { label: string } | undefined>;
}

export interface FieldChange {
  label: string;
  before: string;
  after: string;
}

const NO_VALUE: QaItem["type"][] = ["info", "criteria", "table", "image"];

function shown(item: QaItem, record: FormRecord): string {
  const value = record.values[item.id] ?? "";
  switch (item.type) {
    case "select":
      return record.snap[item.id]?.label ?? value;
    case "grid": {
      const rows = readRows(value);
      return rows.length ? `${rows.length} row${rows.length === 1 ? "" : "s"}: ${rows.map((r) => Object.values(r.c).join(" / ")).join("; ")}` : "";
    }
    case "file":
      return readFiles(value)
        .map((f) => f.name)
        .join(", ");
    default:
      return value;
  }
}

/** The fields that read differently in `after` than in `before`, in the order of `after`'s form. */
export function formChanges(before: FormRecord, after: FormRecord): FieldChange[] {
  const items = new Map<string, QaItem>();
  for (const item of [...after.sections, ...before.sections].flatMap((s) => s.items)) if (!items.has(item.id)) items.set(item.id, item);
  const changes: FieldChange[] = [];
  for (const item of items.values()) {
    if (NO_VALUE.includes(item.type)) continue;
    const a = shown(item, before).trim();
    const b = shown(item, after).trim();
    if (a !== b) changes.push({ label: item.label, before: a || "—", after: b || "—" });
  }
  const keys = new Set([...Object.keys(before.measured), ...Object.keys(after.measured)]);
  const measured = [...keys].filter((k) => (before.measured[k] ?? "") !== (after.measured[k] ?? "")).length;
  if (measured) changes.push({ label: "Balloon measurements", before: "", after: `${measured} value${measured === 1 ? "" : "s"} changed` });
  return changes;
}
