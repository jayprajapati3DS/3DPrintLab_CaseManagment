import { z } from "zod";

import { FILE_TYPE_NAMES, PRIORITIES, spaceCode } from "@/lib/parts/request-form";
import { patternProblem } from "@/lib/resources/ids";

/**
 * Case management: the form a case is opened with in a space that manages its
 * own cases (no platform sync), how its case ID is made, and the variables its
 * answers give QA forms — {case.<var>}.
 *
 * Built like part request forms: a space can keep several case forms — one
 * for 3D PDF cases, one for guides… — sharing one case ID pattern. Each is
 * sections of fields, each shown or hidden, required or not. A few fields are built in — the case ID, the product and
 * sub-scope, priority, the patient — because the app reads them; the rest are
 * the space's own and only answer their variable.
 *
 * Pure: the setup page, the new-case dialog and the server all read it.
 */

export const CASE_FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "date",
  "select",
  "checkbox",
  "file",
  // Built in: their choices or values come from the app.
  "caseid",
  "product",
  "subscope",
  "priority",
  // People of the space (by role), and the Hospitals list.
  "person",
  "people",
  "hospital",
  "department",
] as const;
export type CaseFieldType = (typeof CASE_FIELD_TYPES)[number];

/** The types a person can add. */
export const CASE_CUSTOM_TYPES: Array<{ type: CaseFieldType; label: string }> = [
  { type: "text", label: "Short text" },
  { type: "textarea", label: "Long text" },
  { type: "number", label: "Number" },
  { type: "date", label: "Date" },
  { type: "select", label: "Dropdown" },
  { type: "checkbox", label: "Checkbox" },
  { type: "file", label: "File upload" },
];

export interface CaseField {
  id: string;
  /** A built-in field's key — `product`, `patientId`… — or "" for the space's own. */
  key: string;
  /** The variable name, {case.<var>}. */
  var: string;
  label: string;
  type: CaseFieldType;
  show: boolean;
  req: boolean;
  /** The app needs it: always shown, cannot be removed. */
  locked: boolean;
  /** Pre-filled in every new case. */
  def: string;
  options: string[];
  fileTypes: string[];
  /** A file field also takes download links (PACS, cloud drive…). */
  allowLinks: boolean;
  /** The product field: a dropdown ("list", the default) or cards to pick from. */
  display?: "list" | "cards";
  /** A person / people field: the roles whose people it lists — none: everyone. */
  roles?: string[];
  /** The hospital field: every hospital, or only those of the surgeon chosen. */
  hospitalSource?: "all" | "surgeon";
  /** Asked when a case is opened — off: filled in later, on the case's edit page. Absent: on. */
  onCreate?: boolean;
}

export interface CaseSection {
  id: string;
  title: string;
  cols: 1 | 2 | 3;
  fields: CaseField[];
}

/**
 * "platform" — cases come from the 3D Surgical Platform sync; "local" — cases
 * are opened here, from this form.
 */
export type CaseSource = "platform" | "local";

export interface CaseFormDef {
  id: string;
  name: string;
  /** One line shown when choosing a form. */
  description: string;
  /** Offered first, and used for cases from before forms could be chosen. */
  isDefault: boolean;
  /** The products it opens cases for — none means any product. */
  productIds: string[];
  sections: CaseSection[];
}

export interface CaseSetup {
  source: CaseSource;
  /** The case ID pattern: SYN-{YYYY}-{####}; {TYPE} is the product's code. */
  idPattern: string;
  /** The running part starts no lower than this (to carry on from the platform's numbers); absent = 1. */
  idStart?: number;
  forms: CaseFormDef[];
}

/** The id of a space's first case form — also before anything is saved. */
export const FIRST_CASE_FORM = "case-std";
/** The id a form being added has until it is saved. */
export const NEW_CASE_FORM = "new";

/**
 * Built-in fields: the key, the type it must keep, and the variable it answers.
 * Patient fields are stored encrypted; the rest in their own columns.
 */
export const CASE_BUILT_INS: Record<string, { type: CaseFieldType; var: string }> = {
  caseId: { type: "caseid", var: "id" },
  product: { type: "product", var: "product" },
  subscope: { type: "subscope", var: "scope" },
  priority: { type: "priority", var: "priority" },
  surgeryDate: { type: "date", var: "surgeryDate" },
  deliveryDate: { type: "date", var: "deliveryDate" },
  projectManager: { type: "person", var: "projectManager" },
  surgeon: { type: "person", var: "surgeon" },
  secondarySurgeons: { type: "people", var: "secondarySurgeons" },
  // {case.salesRep}, as a synced case has it.
  salesPeople: { type: "people", var: "salesRep" },
  hospital: { type: "hospital", var: "hospital" },
  // The chosen hospital's departments — the surgeon's own when linked to some.
  department: { type: "department", var: "department" },
  patientId: { type: "text", var: "patientId" },
  patientInitials: { type: "text", var: "patientInitials" },
};
/** Built-ins the form cannot do without. */
const REQUIRED_KEYS = ["caseId", "product"];

/** The variable a field answers: {case.<var>}. */
export const caseFieldVar = (field: Pick<CaseField, "key" | "var">) => `case.${field.key ? (CASE_BUILT_INS[field.key]?.var ?? field.var) : field.var}`;

function field(id: string, label: string, type: CaseFieldType, extra: Partial<CaseField> = {}): CaseField {
  return { id, key: "", var: "", label, type, show: true, req: false, locked: false, def: "", options: [], fileTypes: [], allowLinks: false, ...extra };
}
const builtIn = (key: string, label: string, extra: Partial<CaseField> = {}) =>
  field(`c-${key}`, label, CASE_BUILT_INS[key].type, { key, var: CASE_BUILT_INS[key].var, ...extra });
const own = (variable: string, label: string, type: CaseFieldType, extra: Partial<CaseField> = {}) => field(`c-${variable}`, label, type, { var: variable, ...extra });

/** The default form's answer lists — a space changes them on its own form. */
export const BODY_PARTS = [
  "Skull / Cranium",
  "Face / Maxilla",
  "Mandible",
  "Spine",
  "Thorax / Ribs",
  "Heart",
  "Pelvis / Hip",
  "Femur",
  "Knee",
  "Tibia / Fibula",
  "Ankle / Foot",
  "Shoulder",
  "Humerus / Elbow",
  "Forearm / Wrist / Hand",
  "Other",
];
export const SIDES = ["Left", "Right", "Bilateral", "Midline", "Not applicable"];
export const DEPARTMENTS = [
  "Orthopaedics",
  "Oral & Maxillofacial Surgery",
  "Neurosurgery",
  "Cardiac Surgery",
  "ENT",
  "Plastic & Reconstructive Surgery",
  "Oncology",
  "Dentistry",
  "Radiology",
  "Other",
];

export function defaultCaseSections(): CaseSection[] {
  // In the order a case is usually told: what it is, who it is for, where, who works on it, when, why.
  return [
    {
      id: "cs-case",
      title: "Case",
      cols: 2,
      fields: [
        builtIn("caseId", "Case ID", { locked: true, req: true }),
        builtIn("product", "Project type (product)", { locked: true, req: true }),
        builtIn("subscope", "Sub-scope"),
      ],
    },
    {
      id: "cs-patient",
      title: "Patient",
      cols: 2,
      fields: [
        builtIn("patientId", "Patient ID", { req: true }),
        builtIn("patientInitials", "Patient initials", { req: true }),
        own("bodyPart", "Body part", "select", { req: true, options: BODY_PARTS }),
        own("procedure", "Procedure", "text", { req: true }),
      ],
    },
    {
      id: "cs-hospital",
      title: "Hospital",
      cols: 2,
      fields: [
        // The surgeon first: the hospital, and its department, can follow from them.
        builtIn("surgeon", "Surgeon", { roles: [] }),
        builtIn("hospital", "Hospital", { req: true, hospitalSource: "all" }),
        builtIn("department", "Hospital department"),
      ],
    },
    {
      id: "cs-team",
      title: "Team",
      cols: 2,
      fields: [
        builtIn("priority", "Priority", { def: "Medium" }),
        builtIn("projectManager", "Assigned project manager", { roles: [] }),
        builtIn("secondarySurgeons", "Secondary surgeons", { roles: [] }),
        builtIn("salesPeople", "Sales person(s)", { roles: [] }),
      ],
    },
    {
      id: "cs-dates",
      title: "Dates",
      cols: 2,
      fields: [builtIn("deliveryDate", "Delivery date"), builtIn("surgeryDate", "Surgery date")],
    },
    {
      id: "cs-notes",
      title: "Diagnosis & comments",
      cols: 1,
      fields: [own("diagnosis", "Diagnosis", "textarea"), own("notes", "Comments", "textarea")],
    },
    {
      id: "cs-dicom",
      title: "Imaging (DICOM)",
      cols: 1,
      fields: [
        own("dicom", "DICOM files", "file", { fileTypes: ["DICOM", "ZIP"], allowLinks: true }),
      ],
    },
  ];
}

export function defaultCaseForm(id: string, name: string, isDefault: boolean): CaseFormDef {
  return { id, name, description: "", isDefault, productIds: [], sections: defaultCaseSections() };
}

export function defaultCaseSetup(spaceName: string): CaseSetup {
  return { source: "platform", idPattern: `${spaceCode(spaceName)}-{YYYY}-{####}`, forms: [defaultCaseForm(FIRST_CASE_FORM, "Standard", true)] };
}

/** The form a case was opened with — or the default, for one opened before forms could be chosen. */
export function caseFormFor(setup: CaseSetup, formId: string | null | undefined): CaseFormDef {
  return setup.forms.find((f) => f.id === formId) ?? setup.forms.find((f) => f.isDefault) ?? setup.forms[0];
}

/** The forms a new case can be opened with: the default first. */
export const formsInOrder = (setup: CaseSetup) => [...setup.forms].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));

// --- Checking -------------------------------------------------------------------------------

const fieldSchema = z.object({
  id: z.string().min(1).max(60),
  key: z.string().max(30),
  var: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, "A variable name starts with a letter and has only letters, digits and _.").max(60),
  label: z.string().trim().min(1, "Every field needs a label.").max(80),
  type: z.enum(CASE_FIELD_TYPES),
  show: z.boolean(),
  req: z.boolean(),
  locked: z.boolean(),
  def: z.string().max(500),
  options: z.array(z.string().trim().min(1).max(80)).max(60),
  fileTypes: z.array(z.enum(FILE_TYPE_NAMES as [string, ...string[]])).max(FILE_TYPE_NAMES.length),
  allowLinks: z.boolean(),
  display: z.enum(["list", "cards"]).optional(),
  roles: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
  hospitalSource: z.enum(["all", "surgeon"]).optional(),
  onCreate: z.boolean().optional(),
});

const sectionsSchema = z
  .array(
    z.object({
      id: z.string().min(1).max(60),
      title: z.string().trim().min(1, "Every section needs a title.").max(80),
      cols: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      fields: z.array(fieldSchema).max(60),
    }),
  )
  .min(1, "Keep at least one section.")
  .max(30);

export const caseFormSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{3,80}$/),
  name: z.string().trim().min(1, "Every case form needs a name.").max(80),
  description: z.string().trim().max(200),
  isDefault: z.boolean(),
  productIds: z.array(z.string().min(1).max(60)).max(100),
  sections: sectionsSchema,
});

export const caseSetupSchema = z.object({
  source: z.enum(["platform", "local"]),
  idPattern: z.string().trim().max(60),
  idStart: z.number().int().min(1).max(99_999_999).optional(),
  forms: z.array(caseFormSchema).min(1, "Keep at least one case form.").max(30, "A space can keep at most 30 case forms."),
});

/** What is wrong with a setup, in words — naming the form — or null when it can be saved. */
export function caseSetupProblem(setup: CaseSetup): string | null {
  const pattern = patternProblem(setup.idPattern);
  if (pattern) return `Case ID: ${pattern}`;
  const names = setup.forms.map((f) => f.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) return "Two case forms have the same name.";
  if (setup.forms.filter((f) => f.isDefault).length !== 1) return "Choose one case form as the default.";
  if (new Set(setup.forms.map((f) => f.id)).size !== setup.forms.length) return "Two case forms share an id — reload the page and try again.";
  for (const form of setup.forms) {
    const problem = caseFormProblem(form);
    if (problem) return setup.forms.length > 1 ? `${form.name}: ${problem}` : problem;
  }
  // A variable on two forms must be the same kind of answer, or a QA form
  // reading it would get a date from one and text from the other.
  const kinds = new Map<string, { type: CaseFieldType; form: string }>();
  for (const form of setup.forms) {
    for (const f of form.sections.flatMap((x) => x.fields)) {
      const name = caseFieldVar(f);
      const seen = kinds.get(name);
      if (seen && seen.type !== f.type) return `{${name}} is "${seen.type}" on "${seen.form}" but "${f.type}" on "${form.name}" — give one of them another variable name.`;
      if (!seen) kinds.set(name, { type: f.type, form: form.name });
    }
  }
  return null;
}

/** What is wrong with one form's fields, in words — or null. */
export function caseFormProblem(form: Pick<CaseFormDef, "sections">): string | null {
  const fields = form.sections.flatMap((s) => s.fields);
  for (const key of REQUIRED_KEYS) {
    const found = fields.filter((f) => f.key === key);
    if (found.length !== 1 || !found[0].show) return `The "${CASE_BUILT_INS[key] ? found[0]?.label ?? key : key}" field must stay on the form.`;
  }
  const ids = new Set<string>();
  const vars = new Set<string>();
  for (const f of fields) {
    if (ids.has(f.id)) return "Two fields share an id — reload the page and try again.";
    ids.add(f.id);
    if (f.key) {
      const builtIn = CASE_BUILT_INS[f.key];
      if (!builtIn) return `"${f.label}" is not a field this form knows.`;
      if (builtIn.type !== f.type) return `"${f.label}" is a built-in field and cannot change type.`;
    } else if (!CASE_CUSTOM_TYPES.some((t) => t.type === f.type)) {
      return `"${f.label}" has a type that cannot be added.`;
    }
    const name = caseFieldVar(f);
    if (vars.has(name)) return `Two fields answer {${name}} — give one another variable name.`;
    vars.add(name);
    if (f.req && !f.show) return `"${f.label}" is required but hidden.`;
    if (f.type === "select" && f.show && f.options.length === 0) return `Give "${f.label}" at least one option.`;
    if (f.type === "file" && f.fileTypes.length === 0 && !f.allowLinks) return `"${f.label}" takes no files and no links.`;
  }
  return null;
}

/**
 * Forms saved when the surgeon and hospital were typed in: they become the
 * people and Hospitals-list fields they are now, answers and all — and get the
 * secondary surgeons and sales person fields added since.
 */
function upgradeFields(value: unknown): unknown {
  if (!value || typeof value !== "object" || !Array.isArray((value as { forms?: unknown }).forms)) return value;
  const forms = (value as { forms: Array<{ sections?: Array<{ fields?: Array<Record<string, unknown>> }> }> }).forms;
  return {
    ...(value as object),
    forms: forms.map((form) => ({
      ...form,
      sections: (form.sections ?? []).map((section) => ({
        ...section,
        fields: (section.fields ?? []).flatMap((f) => {
          const upgraded =
            f.key === "surgeon" && f.type === "text"
              ? { ...f, type: "person", roles: [] }
              : f.key === "hospital" && f.type === "text"
                ? { ...f, type: "hospital", hospitalSource: "all" }
                : // The department once typed or picked from a fixed list: now the hospital's.
                  !f.key && f.var === "department"
                  ? { ...f, key: "department", type: "department", options: [] }
                  : f;
          // The people fields added since: right after the surgeon, on a form that has none.
          if (f.key !== "surgeon") return [upgraded];
          const all = (form.sections ?? []).flatMap((x) => x.fields ?? []);
          const labels = { projectManager: "Assigned project manager", secondarySurgeons: "Secondary surgeons", salesPeople: "Sales person(s)" } as const;
          const extra = (["projectManager", "secondarySurgeons", "salesPeople"] as const)
            .filter((key) => !all.some((x) => x.key === key))
            .map((key) => ({ ...builtIn(key, labels[key], { roles: [] }) }));
          return [upgraded, ...extra];
        }),
      })),
    })),
  };
}

/** A stored setup, or the default when there is none or it no longer reads. */
export function readCaseSetup(value: unknown, spaceName: string): CaseSetup {
  // Saved before a space could keep several forms: its one form becomes "Standard".
  if (value && typeof value === "object" && "sections" in value && !("forms" in value)) {
    const { sections, ...rest } = value as { sections: unknown };
    value = { ...rest, forms: [{ ...defaultCaseForm(FIRST_CASE_FORM, "Standard", true), sections }] };
  }
  value = upgradeFields(value);
  const parsed = caseSetupSchema.safeParse(value);
  if (!parsed.success) return defaultCaseSetup(spaceName);
  const setup = parsed.data as CaseSetup;
  return caseSetupProblem(setup) ? { ...defaultCaseSetup(spaceName), source: setup.source } : setup;
}

/** Every field on any of the space's forms, once per variable — what QA forms can read. */
export function allCaseFields(setup: CaseSetup): CaseField[] {
  const seen = new Set<string>();
  return setup.forms
    .flatMap((f) => f.sections.flatMap((s) => s.fields))
    .filter((f) => {
      const name = caseFieldVar(f);
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    });
}

/** Priorities a case can have — the same as a part's. */
export const CASE_PRIORITIES = PRIORITIES;

/** A label turned into a variable name: "Hospital department" → hospitalDepartment. */
export function caseVarFromLabel(label: string, taken: string[]): string {
  const words = label.match(/[A-Za-z0-9]+/g) ?? ["field"];
  const base = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join("").replace(/^[0-9]+/, "") || "field";
  let name = base;
  for (let n = 2; taken.includes(name); n += 1) name = `${base}${n}`;
  return name;
}

/** One answer kept with the case: what the field asked, its variable, the value. */
export interface CaseDetail {
  label: string;
  var: string;
  value: string;
  /** A people field's choices, by id — so the edit page shows them chosen. */
  ids?: string[];
}

/** A field is asked when the case is opened unless the form leaves it for the case's edit page. */
export const askedOnCreate = (f: CaseField) => f.show && (f.onCreate !== false || f.locked);

export function caseDetails(record: { details: unknown }): CaseDetail[] {
  return Array.isArray(record.details) ? (record.details as CaseDetail[]) : [];
}

/** Fields the space's other case forms have, once per variable — to add to this one as they are. */
export function sharedCaseFields(forms: CaseFormDef[], exceptFormId: string): Array<{ field: CaseField; forms: string[] }> {
  const byVar = new Map<string, { field: CaseField; forms: string[] }>();
  for (const form of forms) {
    if (form.id === exceptFormId) continue;
    for (const f of form.sections.flatMap((s) => s.fields)) {
      if (f.key) continue;
      const entry = byVar.get(caseFieldVar(f));
      if (entry) entry.forms.push(form.name);
      else byVar.set(caseFieldVar(f), { field: f, forms: [form.name] });
    }
  }
  return [...byVar.values()];
}
