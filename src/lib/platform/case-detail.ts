import { parse, type HTMLElement } from "node-html-parser";

/**
 * Reads the platform's case edit page into data.
 *
 * Everything that knows about the platform's markup is in this file. Each
 * field is looked up by the form control's `name` or the table's `id`, which
 * are the most stable handles that page offers; a field that cannot be found
 * comes back empty rather than failing the whole read, so a small change on
 * the platform costs one field, not the page.
 *
 * No server-only import: the types are used by client components.
 */

export interface CaseScope {
  name: string;
  selected: boolean;
}

export interface CaseStatusRow {
  index: number;
  internalStatus: string;
  externalStatus: string;
  checklist: string | null;
  checklistStatus: string | null;
  assignee: string | null;
  dueDate: string | null;
  completedBy: string | null;
  completedOn: string | null;
  /** The platform's per-status switch in the table's last column. */
  enabled: boolean;
  state: "completed" | "current" | "upcoming";
}

export interface CaseScanFile {
  name: string;
  size: string;
  uploadedBy: string;
  uploadedOn: string;
}

export interface CaseFile extends CaseScanFile {
  type: string;
  version: string;
  locked: boolean;
}

export interface CaseSharedLink {
  email: string;
  access: string;
  createdBy: string;
  createdOn: string;
  expiresInDays: string;
}

/** Patient identifiers, kept apart so they can be withheld until asked for. */
export interface CasePatient {
  name: string;
  /** True when the platform holds a date of birth rather than an age. */
  usesDateOfBirth: boolean;
  age: string;
  dateOfBirth: string;
  gender: string;
}

export interface CaseDetail {
  caseNumber: string;
  surgeon: string;
  caseCode: string;
  productCode: string;
  representative: string;
  scanType: string;
  /** Dates are kept as the platform writes them (dd-mm-yyyy by default). */
  surgeryDate: string;
  anticipatedShipDate: string;
  product: string;
  scopes: CaseScope[];
  notes: string;
  shippingAddress: string;
  priority: string;
  createdBy: string;
  preferenceTemplate: string;
  additionalNote: string;

  currentStatus: string;
  progressPercent: number;
  statuses: CaseStatusRow[];

  scanFiles: CaseScanFile[];
  caseFiles: CaseFile[];
  sharedLinks: CaseSharedLink[];

  patient: CasePatient;
}

const clean = (value: string | undefined | null): string =>
  (value ?? "").replace(/\s+/g, " ").trim();

/** Placeholder options the platform's selects start on. */
const PLACEHOLDER = /^select\b|^select$/i;

export class CaseDetailParseError extends Error {}

export function parseCaseEditPage(html: string): CaseDetail {
  const doc = parse(html);

  // If the one field every case has is missing, this is not the edit page —
  // most likely a sign-in page or an error page served with a 200.
  if (!doc.querySelector('[name="case-id"], #case-id')) {
    throw new CaseDetailParseError("The platform's case page was not recognised.");
  }

  const field = (name: string): HTMLElement | null =>
    doc.querySelector(`[name="${name}"]`) ?? doc.querySelector(`#${name}`);

  const input = (name: string): string => clean(field(name)?.getAttribute("value"));

  const textarea = (name: string): string => (field(name)?.text ?? "").trim();

  /**
   * The chosen option of a select. The platform marks its placeholder option
   * `selected` as well as the real one, so the last marked option wins.
   */
  const select = (name: string): string => {
    const el = field(name);
    if (!el) return "";
    const chosen = el
      .querySelectorAll("option")
      .filter((o) => o.hasAttribute("selected") && clean(o.getAttribute("value")) !== "");
    const text = clean(chosen.at(-1)?.text);
    return PLACEHOLDER.test(text) ? "" : text;
  };

  const cells = (row: HTMLElement): HTMLElement[] => row.querySelectorAll("td");
  const rowsOf = (tableId: string): HTMLElement[] =>
    doc.querySelector(`#${tableId}`)?.querySelectorAll("tbody tr") ?? [];

  // --- Scopes ---------------------------------------------------------------
  const scopes: CaseScope[] = doc.querySelectorAll('input[name="scope_uuid"]').map((radio) => {
    const id = radio.getAttribute("id");
    const label = id ? doc.querySelector(`label[for="${id}"]`) : null;
    return { name: clean(label?.text), selected: radio.hasAttribute("checked") };
  });

  // --- Statuses ---------------------------------------------------------------
  // The progress stepper says which steps are done; the table has the detail.
  const stepStates = doc.querySelectorAll(".pc-step").map((step): CaseStatusRow["state"] => {
    const cls = step.getAttribute("class") ?? "";
    return cls.includes("completed") ? "completed" : cls.includes("current") ? "current" : "upcoming";
  });

  const statuses: CaseStatusRow[] = rowsOf("case-statuses-table").map((row, i) => {
    const td = cells(row);
    const assignee = td[5]
      ?.querySelectorAll("option")
      .filter((o) => o.hasAttribute("selected") && clean(o.getAttribute("value")) !== "")
      .at(-1);
    const isCurrent = (row.getAttribute("class") ?? "").includes("table-primary");
    return {
      index: Number(clean(td[0]?.text)) || i + 1,
      internalStatus: clean(td[1]?.text),
      externalStatus: clean(td[2]?.text),
      checklist: clean(td[3]?.text) || null,
      checklistStatus: clean(td[4]?.text) || null,
      // "Name (email)" — the name is enough on screen.
      assignee: clean(assignee?.text).replace(/\s*\([^)]*\)\s*$/, "") || null,
      dueDate: clean(td[6]?.querySelector("input")?.getAttribute("value")) || null,
      completedBy: clean(td[7]?.text) || null,
      completedOn: clean(td[8]?.text) || null,
      enabled: Boolean(td[9]?.querySelector("input")?.hasAttribute("checked")),
      state: stepStates[i] ?? (isCurrent ? "current" : clean(td[8]?.text) ? "completed" : "upcoming"),
    };
  });

  const current =
    statuses.find((s) => s.state === "current")?.internalStatus ??
    clean(doc.querySelector(".case-status-badge")?.text);

  const ring = Number.parseInt(clean(doc.querySelector(".pc-ring-text")?.text), 10);
  const done = statuses.filter((s) => s.state === "completed").length;
  const progressPercent = Number.isFinite(ring)
    ? ring
    : statuses.length
      ? Math.round((done / statuses.length) * 100)
      : 0;

  // --- Documents --------------------------------------------------------------
  const scanFiles: CaseScanFile[] = rowsOf("scan-files-table")
    .map(cells)
    .filter((td) => td.length >= 5)
    .map((td) => ({
      name: clean(td[1].text),
      size: clean(td[2].text),
      uploadedBy: clean(td[3].text),
      uploadedOn: clean(td[4].text),
    }));

  const caseFiles: CaseFile[] = rowsOf("case-files-table")
    .map(cells)
    .filter((td) => td.length >= 8)
    .map((td) => ({
      name: clean(td[1].text),
      type: clean(td[2].text),
      size: clean(td[3].text),
      version: clean(td[4].text),
      uploadedBy: clean(td[5].text),
      uploadedOn: clean(td[6].text),
      locked: Boolean(td[7].querySelector("input")?.hasAttribute("checked")),
    }));

  // The link itself is a bearer credential for the 3D viewer, so it is left on
  // the platform; only who it was shared with is read.
  const sharedLinks: CaseSharedLink[] = rowsOf("case-shared-links-table")
    .map(cells)
    .filter((td) => td.length >= 6)
    .map((td) => ({
      email: clean(td[0].text),
      access: clean(td[1].text),
      createdBy: clean(td[3].text),
      createdOn: clean(td[4].text),
      expiresInDays: clean(td[5].text),
    }));

  return {
    caseNumber: input("case-id"),
    surgeon: input("surgeon"),
    caseCode: input("case_code"),
    productCode: input("product_code"),
    representative: select("representative_id"),
    scanType: select("scan_type_id"),
    surgeryDate: input("surgery_date"),
    anticipatedShipDate: input("anticipated_ship_date"),
    product: input("product"),
    scopes,
    notes: textarea("notes"),
    shippingAddress: select("shipping_address_id"),
    priority: select("priority_id"),
    createdBy: input("case_created_by_created_on"),
    preferenceTemplate: select("surgeon_template"),
    additionalNote: textarea("additional_notes"),

    currentStatus: current,
    progressPercent,
    statuses,

    scanFiles,
    caseFiles,
    sharedLinks,

    patient: {
      name: input("patient_name"),
      usesDateOfBirth: Boolean(field("patien_dob_age_switch")?.hasAttribute("checked")),
      age: input("patient_age"),
      dateOfBirth: input("patient_dob"),
      gender: select("patient_gender"),
    },
  };
}

/**
 * The edit page's address, from one row of the API's case list. The API gives
 * each case an "Edit" button whose link carries the real address base64-encoded
 * in a `callback` parameter.
 */
export function editPathFromActionButtons(buttons: unknown): string | null {
  if (!Array.isArray(buttons)) return null;
  for (const button of buttons) {
    if (!button || typeof button !== "object") continue;
    const { btn_name: name, btn_link: link } = button as { btn_name?: unknown; btn_link?: unknown };
    if (typeof name !== "string" || typeof link !== "string" || !/edit/i.test(name)) continue;
    try {
      const callback = new URL(link).searchParams.get("callback");
      if (!callback) continue;
      const decoded = Buffer.from(callback, "base64").toString("utf8");
      const path = /^https?:/i.test(decoded) ? new URL(decoded).pathname : decoded;
      // Only ever a case edit page: this path is fetched with the service
      // account's session, so it must not be steerable anywhere else.
      if (/^\/case-models\/[A-Za-z0-9-]+\/edit$/.test(path)) return path;
    } catch {
      continue;
    }
  }
  return null;
}
