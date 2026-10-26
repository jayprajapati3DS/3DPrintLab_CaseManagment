import { fromZonedTime } from "date-fns-tz";

import { editPathFromActionButtons } from "@/lib/platform/case-detail";
import type { PlatformCase } from "@/lib/platform/client";

/**
 * Turns a raw `/api/cases` row into the shape this application stores.
 *
 * Two platform quirks drive most of this file:
 *
 *  1. Dates arrive preformatted with the tenant's `system_date_format`
 *     (`d-m-Y H:i:s` by default), not ISO-8601, so they must be parsed against
 *     the configured format and timezone.
 *  2. The surgeon, sales rep and product arrive as display-name strings with no
 *     ids, so they are stored as the platform wrote them.
 *
 * Privacy: the platform also returns `patient_name`, `patient_age` and
 * `patient_gender`. A device is made for one patient, so they are kept — but
 * as separate mapped fields the sync encrypts, never inside the retained raw
 * payload, which is stripped of them here.
 */

/** Which platform response key feeds each local field. Admin-overridable. */
export interface CaseFieldMap {
  platformCaseId: string;
  caseNumber: string;
  caseCode: string;
  productCode: string;
  caseStatus: string;
  caseState: string;
  scopeName: string;
  surgeonName: string;
  representativeName: string;
  productName: string;
  createdAt: string;
  surgeryDate: string;
  shipDate: string;
  archived: string;
  patientName: string;
  patientAge: string;
  patientGender: string;
  hospitalName: string;
  priority: string;
}

export const DEFAULT_FIELD_MAP: CaseFieldMap = {
  platformCaseId: "id",
  caseNumber: "case_number",
  caseCode: "case_code",
  productCode: "product_code",
  caseStatus: "case_status",
  caseState: "case_state",
  scopeName: "scope_name",
  surgeonName: "surgeon",
  representativeName: "representative_name",
  productName: "product",
  createdAt: "case_created_on",
  surgeryDate: "surgery_date",
  shipDate: "anticipated_ship_date",
  archived: "case_archive",
  patientName: "patient_name",
  patientAge: "patient_age",
  patientGender: "patient_gender",
  // The case list does not carry these today. The defaults are the obvious
  // names, so they start filling in if the platform adds them, and the keys
  // can be pointed elsewhere without a deploy.
  hospitalName: "hospital_name",
  priority: "priority",
};

export const FIELD_MAP_LABELS: Record<keyof CaseFieldMap, string> = {
  platformCaseId: "Case ID (sync key)",
  caseNumber: "Case number",
  caseCode: "Case code",
  productCode: "Product code",
  caseStatus: "Status",
  caseState: "Case state",
  scopeName: "Scope",
  surgeonName: "Surgeon name",
  representativeName: "Sales rep name",
  productName: "Product name",
  createdAt: "Created on",
  surgeryDate: "Surgery date",
  shipDate: "Anticipated ship date",
  archived: "Archived flag",
  patientName: "Patient name",
  patientAge: "Patient age",
  patientGender: "Patient gender",
  hospitalName: "Hospital",
  priority: "Priority",
};

/** The date formats the platform's tenant config offers. */
export const SUPPORTED_DATE_FORMATS = [
  "dd-mm-yyyy",
  "dd/mm/yyyy",
  "mm/dd/yyyy",
  "mm-dd-yyyy",
  "yyyy-mm-dd",
] as const;

export type PlatformDateFormat = (typeof SUPPORTED_DATE_FORMATS)[number];

/** Keys never kept in the retained raw payload. */
const PHI_KEYS = new Set([
  "patient_name",
  "patient_age",
  "patient_gender",
  "patient_dob",
  "patient_id",
  "additional_notes",
]);

/** Bulky or credential-bearing keys dropped from the retained raw payload. */
const BULKY_KEYS = new Set([
  "files",
  "stl_files",
  "3dsviewer_preop_planning",
  "action_buttons",
]);

export function parseFieldMap(value: unknown): CaseFieldMap {
  if (!value || typeof value !== "object") return { ...DEFAULT_FIELD_MAP };
  const source = value as Record<string, unknown>;
  const result = { ...DEFAULT_FIELD_MAP };
  for (const key of Object.keys(DEFAULT_FIELD_MAP) as (keyof CaseFieldMap)[]) {
    const override = source[key];
    if (typeof override === "string" && override.trim()) {
      result[key] = override.trim();
    }
  }
  return result;
}

export function normaliseDateFormat(value: string): PlatformDateFormat {
  return (SUPPORTED_DATE_FORMATS as readonly string[]).includes(value)
    ? (value as PlatformDateFormat)
    : "dd-mm-yyyy";
}

/**
 * Parse one of the platform's preformatted date strings into a UTC instant.
 * `withTime` handles `case_created_on`, which appends ` H:i:s`.
 */
export function parsePlatformDate(
  value: unknown,
  format: PlatformDateFormat,
  timeZone: string,
  withTime = false,
): Date | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const [datePart, timePart] = trimmed.split(/\s+/, 2);
  const separator = format.includes("/") ? "/" : "-";
  const pieces = datePart.split(separator);
  if (pieces.length !== 3) return null;

  let day: string;
  let month: string;
  let year: string;
  switch (format) {
    case "dd-mm-yyyy":
    case "dd/mm/yyyy":
      [day, month, year] = pieces;
      break;
    case "mm-dd-yyyy":
    case "mm/dd/yyyy":
      [month, day, year] = pieces;
      break;
    case "yyyy-mm-dd":
      [year, month, day] = pieces;
      break;
    default:
      return null;
  }

  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
    return null;
  }
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > 31) return null;

  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (withTime && timePart) {
    const [h, mi, s] = timePart.split(":");
    hours = Number(h) || 0;
    minutes = Number(mi) || 0;
    seconds = Number(s) || 0;
  }

  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  const wallClock = `${pad(y, 4)}-${pad(m)}-${pad(d)}T${pad(hours)}:${pad(
    minutes,
  )}:${pad(seconds)}`;

  try {
    // The platform formats with PHP's date() in the tenant's timezone, so the
    // string is a wall-clock time there, not UTC.
    const instant = fromZonedTime(wallClock, timeZone);
    return Number.isNaN(instant.getTime()) ? null : instant;
  } catch {
    return null;
  }
}

/**
 * Best-effort detection of which tenant date format a sample of
 * `case_created_on` values is using. Returns null when the sample is ambiguous
 * (e.g. every day-of-month is <= 12), so the admin is asked rather than guessed at.
 */
export function detectDateFormat(samples: string[]): PlatformDateFormat | null {
  const candidates = SUPPORTED_DATE_FORMATS.filter((format) => {
    const separator = format.includes("/") ? "/" : "-";
    return samples.every((sample) => {
      const datePart = sample.trim().split(/\s+/, 1)[0];
      const pieces = datePart.split(separator);
      if (pieces.length !== 3) return false;
      let d: number;
      let m: number;
      let y: number;
      if (format.startsWith("dd")) [d, m, y] = pieces.map(Number);
      else if (format.startsWith("mm")) [m, d, y] = pieces.map(Number);
      else [y, m, d] = pieces.map(Number);
      return (
        Number.isInteger(d) &&
        Number.isInteger(m) &&
        Number.isInteger(y) &&
        d >= 1 &&
        d <= 31 &&
        m >= 1 &&
        m <= 12 &&
        y >= 1900 &&
        y <= 2999
      );
    });
  });

  return candidates.length === 1 ? candidates[0] : null;
}

export interface MappedCase {
  platformCaseId: number;
  caseNumber: string | null;
  caseCode: string | null;
  productCode: string | null;
  caseStatus: string | null;
  caseState: string | null;
  scopeName: string | null;
  surgeonName: string | null;
  representativeName: string | null;
  productName: string | null;
  hospitalName: string | null;
  priority: string | null;
  patientName: string | null;
  patientAge: string | null;
  patientGender: string | null;
  surgeryDate: Date | null;
  anticipatedShipDate: Date | null;
  platformCreatedAt: Date;
  isArchived: boolean;
  /** Where this case's edit page lives on the platform, when the API says. */
  editPath: string | null;
  raw: Record<string, unknown>;
}

export class CaseMappingError extends Error {}

function readString(row: PlatformCase, key: string): string | null {
  const value = row[key];
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  return null;
}

/** Strip patient identifiers and bulk before a payload is retained for replay. */
export function sanitiseRawCase(row: PlatformCase): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (PHI_KEYS.has(key) || BULKY_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

export function mapCase(
  row: PlatformCase,
  fieldMap: CaseFieldMap,
  dateFormat: PlatformDateFormat,
  timeZone: string,
): MappedCase {
  const rawId = row[fieldMap.platformCaseId];
  const platformCaseId =
    typeof rawId === "number" ? rawId : Number.parseInt(String(rawId ?? ""), 10);
  if (!Number.isInteger(platformCaseId) || platformCaseId <= 0) {
    throw new CaseMappingError(
      `Case is missing a usable id at "${fieldMap.platformCaseId}".`,
    );
  }

  const platformCreatedAt = parsePlatformDate(
    row[fieldMap.createdAt],
    dateFormat,
    timeZone,
    true,
  );
  if (!platformCreatedAt) {
    throw new CaseMappingError(
      `Case ${platformCaseId} has an unparseable created date ` +
        `(${JSON.stringify(row[fieldMap.createdAt])}) for format "${dateFormat}".`,
    );
  }

  const archivedValue = row[fieldMap.archived];

  return {
    platformCaseId,
    caseNumber: readString(row, fieldMap.caseNumber),
    caseCode: readString(row, fieldMap.caseCode),
    productCode: readString(row, fieldMap.productCode),
    caseStatus: readString(row, fieldMap.caseStatus),
    caseState: readString(row, fieldMap.caseState),
    scopeName: readString(row, fieldMap.scopeName),
    surgeonName: readString(row, fieldMap.surgeonName),
    representativeName: readString(row, fieldMap.representativeName),
    productName: readString(row, fieldMap.productName),
    hospitalName: readString(row, fieldMap.hospitalName),
    priority: readString(row, fieldMap.priority),
    patientName: readString(row, fieldMap.patientName),
    patientAge: readString(row, fieldMap.patientAge),
    patientGender: readString(row, fieldMap.patientGender),
    surgeryDate: parsePlatformDate(
      row[fieldMap.surgeryDate],
      dateFormat,
      timeZone,
    ),
    anticipatedShipDate: parsePlatformDate(
      row[fieldMap.shipDate],
      dateFormat,
      timeZone,
    ),
    platformCreatedAt,
    isArchived:
      archivedValue === true ||
      archivedValue === 1 ||
      archivedValue === "1" ||
      archivedValue === "true",
    editPath: editPathFromActionButtons(row.action_buttons),
    raw: sanitiseRawCase(row),
  };
}
