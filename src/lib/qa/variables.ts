import { allCaseFields, caseFieldVar, type CaseSetup } from "@/lib/cases/case-form";
import type { RequestSection } from "@/lib/parts/request-form";
import { fieldVar } from "@/lib/parts/request-form";

/**
 * Variables: tokens such as {part.id} or {request.dimensions} typed into a QA
 * form's labels, values and limits, and filled in from the part, its case and
 * its request when the form is opened.
 *
 * Pure. The values themselves are gathered on the server (context.ts) and
 * handed to the form as a flat map, so the browser never needs anything but
 * that map to resolve a token.
 */

export type VarGroup = "request" | "case" | "part" | "equipment" | "general";

export const GROUP_LABELS: Record<VarGroup, string> = {
  request: "Part request setup",
  case: "Case",
  part: "Part & production",
  equipment: "Equipment, material & people",
  general: "General",
};

export const GROUP_COLOURS: Record<VarGroup, string> = {
  request: "#C4320A",
  case: "#175CD3",
  part: "#067647",
  equipment: "#5925DC",
  general: "#475467",
};

export type VarKind = "Text" | "Number" | "Date" | "Choice" | "Image" | "Balloon table";

export interface VarDef {
  /** Without braces: part.id */
  token: string;
  label: string;
  group: VarGroup;
  kind: VarKind;
  description: string;
}

const v = (token: string, label: string, group: VarGroup, kind: VarKind, description: string): VarDef => ({
  token,
  label,
  group,
  kind,
  description,
});

/** The company details kept in QA Form Setup, as {company.…} variables. */
export const COMPANY_FIELDS: Array<{ key: string; label: string; placeholder: string }> = [
  { key: "name", label: "Registered company name", placeholder: "e.g. Jajal Medical Pvt. Ltd." },
  { key: "licence", label: "Mfg. licence / registration no.", placeholder: "e.g. MFG/MD/2023/000123" },
  { key: "address", label: "Address", placeholder: "Plant address, as printed on records" },
  { key: "phone", label: "Phone", placeholder: "" },
  { key: "email", label: "Email", placeholder: "" },
  { key: "website", label: "Website", placeholder: "" },
];

/** Everything except the request form's own fields, which depend on the space's setup. */
const FIXED: VarDef[] = [
  v("balloon.table", "Balloon table", "request", "Balloon table", "The drawing balloons and characteristics table from the part request"),

  v("case.id", "Case ID", "case", "Text", "The case ID (project number)"),
  v("case.product", "Product", "case", "Text", "The case's product"),
  v("case.scope", "Scope / application", "case", "Text", "The case's scope"),
  v("case.status", "Case status", "case", "Choice", "The status the case is at now"),
  v("case.owner", "Case owner", "case", "Text", "Who the case is assigned to"),
  v("case.startDate", "Case start date", "case", "Date", "When the case was opened"),
  v("case.endDate", "Case end date", "case", "Date", "When the case was completed — empty while open"),
  v("case.productCode", "Product code", "case", "Text", "The product's code"),
  v("case.state", "Case state", "case", "Choice", "Active, on hold, cancelled…"),
  v("case.priority", "Case priority", "case", "Choice", "The case's priority"),
  v("case.surgeon", "Surgeon", "case", "Text", "The case's surgeon"),
  v("case.salesRep", "Sales rep", "case", "Text", "The case's sales representative"),
  v("case.hospital", "Hospital", "case", "Text", "The case's hospital"),
  v("case.patient", "Patient (masked)", "case", "Text", "The patient's initial and surname — never the full name"),
  v("case.age", "Patient age", "case", "Number", "The patient's age"),
  v("case.surgeryDate", "Surgery date", "case", "Date", "The planned surgery date"),
  v("case.shipDate", "Anticipated ship date", "case", "Date", "When the case is due to ship"),

  v("part.component", "Component no.", "part", "Number", "The part's number within its case"),
  v("part.files", "Files for printing", "part", "Text", "File names and links attached to the request"),
  v("part.stage", "Current stage", "part", "Text", "The stage the part is on now"),
  v("part.technology", "Manufacturing tech", "part", "Text", "From the part's workflow"),
  v("part.assignee", "Part owner", "part", "Text", "Who the part is assigned to"),
  v("part.requestedBy", "Requested by", "part", "Text", "Who requested the part"),
  v("part.requestedOn", "Requested date", "part", "Date", "The date the part was requested"),
  v("part.requestedAt", "Requested date & time", "part", "Text", "When the part was requested, to the minute"),
  v("material.lot", "Material lot", "part", "Text", "The lot picked in this part's forms"),
  v("material.drawn", "Material drawn", "part", "Number", "Quantity of material recorded as used on this part"),

  v("site.name", "Manufacturing site", "part", "Text", "Where the part is made (Manufacturing Sites)"),
  v("site.type", "Site type", "part", "Choice", "In-house, partner hospital or external vendor"),
  v("site.code", "Site code", "part", "Text", "The site's code"),
  v("site.city", "Site city", "part", "Text", "The site's city"),
  v("site.address", "Site address", "part", "Text", "The site's address"),
  v("site.certificate", "Site certification", "part", "Text", "e.g. ISO 13485 — of the site the part is made at"),

  v("printer.assetId", "Machine asset ID", "equipment", "Text", "Of the part's machine"),
  v("printer.serial", "Machine serial no.", "equipment", "Text", "Of the part's machine"),
  v("printer.status", "Machine status", "equipment", "Choice", "Of the part's machine, as worked out from its schedule"),
  v("printer.nextMaintenance", "Machine next maintenance", "equipment", "Date", "Of the part's machine"),
  v("material.grade", "Material grade", "equipment", "Text", "Of the part's material"),
  v("material.stock", "Material in stock", "equipment", "Number", "Of the part's material"),
  v("lot.number", "Lot number", "equipment", "Text", "Of the lot picked in this part's forms"),
  v("lot.coa", "Lot CoA", "equipment", "Text", "Certificate of analysis of the picked lot"),
  v("lot.supplier", "Lot supplier", "equipment", "Text", "Supplier of the picked lot"),
  v("lot.received", "Lot received on", "equipment", "Date", "When the picked lot was received"),
  v("lot.expiry", "Lot expiry", "equipment", "Date", "Expiry of the picked lot"),
  v("lot.grn", "Lot GRN", "equipment", "Text", "The goods receipt the picked lot came in on"),
  v("params.name", "Parameter set", "equipment", "Text", "The parameter set picked in this part's forms"),
  v("params.code", "Parameter set code", "equipment", "Text", "Its code / revision"),
  v("params.keyParams", "Key parameters", "equipment", "Text", "Its key parameters"),
  v("owner.name", "Owner name", "equipment", "Text", "The part's owner"),

  v("user.name", "Your name", "general", "Text", "The person filling the form"),
  v("user.role", "Your roles", "general", "Text", "The roles of the person filling the form"),
  ...COMPANY_FIELDS.map((f) => v(`company.${f.key}`, f.label, "general", "Text", "From Company details on QA Form Setup")),
  v("today", "Today", "general", "Date", "Today's date"),
  v("now", "Now", "general", "Date", "The date and time the form is opened — to pre-fill a start"),
  v("space.name", "Company", "general", "Text", "This company space's name"),
];

/**
 * The full catalogue: the request form's fields first (they change with Part
 * Request Setup), then the fixed ones.
 */
export function catalogue(requestSections: RequestSection[]): VarDef[] {
  const fromRequest: VarDef[] = [];
  const seen = new Set<string>();
  for (const section of requestSections) {
    for (const field of section.fields) {
      const token = fieldVar(field);
      if (!token || seen.has(token) || token === "balloon.count") continue;
      seen.add(token);
      const kind: VarKind =
        field.type === "image" ? "Image" : field.type === "number" ? "Number" : field.type === "date" ? "Date" : field.type === "text" || field.type === "textarea" ? "Text" : "Choice";
      fromRequest.push(v(token, field.label, "request", kind, `${section.title} · request form`));
    }
  }
  if (!seen.has("part.id")) fromRequest.unshift(v("part.id", "Part ID", "request", "Text", "The generated part ID"));
  fromRequest.push(v("balloon.count", "No. of balloon characteristics", "request", "Number", "Rows in the request's balloon table"));
  return [...fromRequest, ...FIXED.filter((d) => !seen.has(d.token))];
}

/**
 * The catalogue across every request form of a space. A variable asked on
 * only some forms says so — parts from the others show "—" for it.
 */
export function catalogueForForms(forms: Array<{ name: string; sections: RequestSection[] }>): VarDef[] {
  const all = catalogue(forms.flatMap((f) => f.sections));
  if (forms.length <= 1) return all;
  const askedOn = new Map<string, string[]>();
  for (const form of forms) {
    for (const field of form.sections.flatMap((s) => s.fields)) {
      const token = fieldVar(field);
      if (!token) continue;
      const list = askedOn.get(token) ?? [];
      if (!list.includes(form.name)) askedOn.set(token, [...list, form.name]);
    }
  }
  return all.map((d) => {
    const on = askedOn.get(d.token);
    if (!on) return d;
    const missing = forms.map((f) => f.name).filter((n) => !on.includes(n));
    return {
      ...d,
      description: missing.length ? `Asked on ${on.join(", ")} — not on ${missing.join(", ")}, whose parts show —` : `Asked on every request form`,
    };
  });
}

/**
 * The variables a space's own case forms add — {case.bodyPart}, {case.patientId}… —
 * after the standard case ones, which it does not repeat. None when cases come
 * from the platform.
 */
export function withCaseForm(vars: VarDef[], setup: CaseSetup | null): VarDef[] {
  if (!setup || setup.source !== "local") return vars;
  const known = new Set(vars.map((d) => d.token));
  const kind = (type: string): VarKind => (type === "number" ? "Number" : type === "date" ? "Date" : type === "select" || type === "checkbox" ? "Choice" : "Text");
  const added = allCaseFields(setup)
    .filter((f) => f.show && f.type !== "caseid")
    .map((f) => ({ token: caseFieldVar(f), field: f }))
    .filter(({ token }) => !known.has(token))
    .map(({ token, field }) => v(token, field.label, "case", kind(field.type), "From the case form (Case Form Setup)"));
  return [...vars, ...added];
}

// --- Resolving ---------------------------------------------------------------------------

const TOKEN = /\{([A-Za-z][\w]*(?:\.[\w]+)?)\}/g;

export function tokensIn(text: string): string[] {
  return [...new Set([...text.matchAll(TOKEN)].map((m) => m[1]))];
}

/** Context keys that map a request file's name to where it opens: `file:<name>`. */
export const FILE_PREFIX = "file:";

export type Context = Record<string, string>;

/**
 * Fill a text's tokens from the context. A known token with no value, and any
 * dotted token the context does not know, shows as "—"; a bare word in braces
 * that is not a variable is left as typed.
 */
export function resolve(text: string, context: Context): string {
  if (!text) return "";
  return text.replace(TOKEN, (whole, token: string) => {
    if (token in context) return context[token] || "—";
    return token.includes(".") || token === "today" ? "—" : whole;
  });
}

/** True when the text is nothing but one token. */
export function singleToken(text: string): string | null {
  const m = /^\s*\{([A-Za-z][\w]*(?:\.[\w]+)?)\}\s*$/.exec(text);
  return m ? m[1] : null;
}

export type MappingState =
  | { tone: "green"; text: string }
  | { tone: "amber"; text: string }
  | { tone: "red"; text: string }
  | { tone: "grey"; text: string };

/** The chip shown under a value in the editor: does it map, and to what. */
export function mapping(value: string, known: Set<string>, context: Context, operatorInput: boolean): MappingState {
  const tokens = tokensIn(value);
  if (tokens.length === 0) {
    if (operatorInput) return { tone: "grey", text: value.trim() ? "Operator input · pre-filled with fixed text" : "Operator input · starts blank" };
    return { tone: "grey", text: value.trim() ? "No variable — shows fixed text" : "No variable — will show blank" };
  }
  const unknown = tokens.filter((t) => !known.has(t));
  if (unknown.length) return { tone: "red", text: `Unknown variable ${unknown.map((t) => `{${t}}`).join(", ")} — not in the variable library` };
  const blank = tokens.filter((t) => !context[t]);
  if (blank.length) {
    return { tone: "amber", text: `Mapped, but ${blank.map((t) => `{${t}}`).join(", ")} ${blank.length === 1 ? "is" : "are"} blank for the preview part` };
  }
  return { tone: "green", text: `Mapped · ${tokens.length} variable${tokens.length === 1 ? "" : "s"}` };
}

/** Rewrite one token everywhere in a text — used when a request variable is renamed. */
export function renameToken(text: string, from: string, to: string): string {
  return text.split(`{${from}}`).join(`{${to}}`);
}
