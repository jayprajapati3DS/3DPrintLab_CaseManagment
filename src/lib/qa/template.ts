import { z } from "zod";

import { formulaProblem, formulaRefs } from "@/lib/qa/calc";

/**
 * QA form templates: what a quality form is made of.
 *
 * A template is sections of items. Some items are filled in for the operator
 * from the part, its case and its request ("Auto field", "Image", the balloon
 * table); the rest are entered — a measurement against limits, a pass / fail
 * check, a pick from a library such as the machines or the material lots, a
 * signature. Values can carry variables like {part.id}; see variables.ts.
 *
 * Pure: the setup page, the form on a part and the server all read it.
 */

export const ITEM_TYPES = [
  "info",
  "image",
  "text",
  "number",
  "check",
  "table",
  "sign",
  "select",
  "criteria",
  "date",
  "datetime",
  "time",
  "duration",
  "calc",
  "grid",
  "yesno",
  "file",
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

/** The palette: what can be added, as the design names it. ("criteria" is render-only.) */
export const PALETTE: Array<{ type: ItemType; name: string; description: string; icon: string }> = [
  { type: "info", name: "Auto field", description: "Fetched from part, case or request — read-only", icon: "M12 16v-4M12 8h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z" },
  { type: "image", name: "Image", description: "Picture from the part request", icon: "M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15 9h.01" },
  { type: "text", name: "Text entry", description: "Operator types a value — can be pre-filled", icon: "M4 7V5h16v2M9 19h6M12 5v14" },
  { type: "number", name: "Measurement", description: "Measured value with LSL / USL — auto Pass / Fail", icon: "M2 17 17 2l5 5L7 22zM7.5 11.5l2 2M10.5 8.5l2 2M13.5 5.5l2 2" },
  { type: "check", name: "Pass / Fail check", description: "Pass · Fail · N/A buttons", icon: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" },
  { type: "table", name: "Balloon table", description: "Drawing balloons with measured values", icon: "M3 3h18v18H3zM3 9h18M3 15h18M9 3v18" },
  { type: "sign", name: "Signature", description: "Name and date sign-off", icon: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" },
  { type: "select", name: "Dropdown", description: "Pick from a library (printers, lots, operators…) or a custom list", icon: "M6 9l6 6 6-6" },
  { type: "date", name: "Date", description: "A calendar date — can be pre-filled with {today}", icon: "M3 5h18v16H3zM3 10h18M8 3v4M16 3v4" },
  { type: "datetime", name: "Date & time", description: "Date and time — e.g. a start; pre-fill with {now}", icon: "M3 5h18v16H3zM3 10h18M8 3v4M16 3v4M12 13v3l2 1" },
  { type: "time", name: "Time", description: "A time of day", icon: "M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z" },
  { type: "duration", name: "Duration", description: "How long — h:mm, with optional min / max", icon: "M6 2h12M6 22h12M7 2c0 6 10 6 10 10S7 16 7 22M17 2c0 6-10 6-10 10s10 4 10 10" },
  { type: "calc", name: "Calculated", description: "Worked out from other fields — end time, total, yield %", icon: "M4 3h16v18H4zM8 7h8M8 12h2M14 12h2M8 16h2M14 16h2" },
  { type: "grid", name: "Data table", description: "Rows the operator adds — files, print runs — with your columns", icon: "M3 3h18v18H3zM3 9h18M3 15h18M9 9v12M15 9v12" },
  { type: "yesno", name: "Yes / No", description: "Two buttons — optionally the answer expected", icon: "M5 12l4 4L19 6" },
  { type: "file", name: "Photo / attachment", description: "Operator attaches a photo or PDF as evidence", icon: "M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" },
];

/** What a data table's column holds. "calc" is worked out within the row. */
export const COLUMN_KINDS = ["text", "number", "date", "datetime", "time", "duration", "yesno", "check", "select", "image", "calc"] as const;
export type ColumnKind = (typeof COLUMN_KINDS)[number];

export const COLUMN_KIND_LABELS: Record<ColumnKind, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  datetime: "Date & time",
  time: "Time",
  duration: "Duration (h:mm)",
  yesno: "Yes / No",
  check: "Checkbox",
  select: "Choice",
  image: "Image (uploaded per row)",
  calc: "Calculated (in the row)",
};

export interface GridColumn {
  id: string;
  label: string;
  kind: ColumnKind;
  /** A choice column's choices, comma separated. */
  opts: string;
  /** A calculated column's formula, over the row's other columns by [label]. */
  formula: string;
  req: boolean;
}

export const SIGN_STYLES = ["name", "role", "image"] as const;
export type SignStyle = (typeof SIGN_STYLES)[number];
export const SIGN_STYLE_LABELS: Record<SignStyle, string> = {
  name: "Name",
  role: "Name and role",
  image: "Signature image (from My account)",
};

/**
 * Who a signature belongs to. "Prepared by": the person filling the form,
 * signed for them as they submit it. "Reviewed by" / "Approved by": one or
 * more people chosen in the form, who sign in turn (see signoff.ts). Or typed
 * by anyone, as fields were before.
 */
export const SIGNERS = ["submitter", "reviewer", "approver", "anyone"] as const;
export type Signer = (typeof SIGNERS)[number];
export const SIGNER_LABELS: Record<Signer, string> = {
  submitter: "Prepared by — the person filling it",
  reviewer: "Reviewed by — people chosen in the form",
  approver: "Approved by — people chosen in the form",
  anyone: "Typed — anyone filling the form",
};
/** The label a signature field takes for each signer. */
export const SIGNER_TAGS: Record<Exclude<Signer, "anyone">, string> = {
  submitter: "Prepared by",
  reviewer: "Reviewed by",
  approver: "Approved by",
};

/** A signature the app signs — on submit, or as a chosen person signs — never typed. */
export function autoSigner(item: Pick<QaItem, "type" | "signer">): Exclude<Signer, "anyone"> | null {
  return item.type === "sign" && item.signer && item.signer !== "anyone" ? item.signer : null;
}

export const SHOW_OPS = ["eq", "ne", "gt", "lt", "filled", "empty"] as const;
export type ShowOp = (typeof SHOW_OPS)[number];
export const SHOW_OP_LABELS: Record<ShowOp, string> = {
  eq: "is",
  ne: "is not",
  gt: "is more than",
  lt: "is less than",
  filled: "is filled in",
  empty: "is empty",
};

/** Show a field only when another field of the form — named by its label — meets a condition. */
export interface ShowIf {
  ref: string;
  op: ShowOp;
  value: string;
}

/** Does a person with these roles ("Space Admin, QA Manager") hold one of the allowed roles ("QA, Quality")? */
export function roleAllowed(allowed: string, roles: string): boolean {
  const want = allowed.split(",").map((r) => r.trim().toLowerCase()).filter(Boolean);
  if (want.length === 0) return true;
  const have = roles.split(",").map((r) => r.trim().toLowerCase()).filter(Boolean);
  return want.some((w) => have.some((h) => h === w || h.includes(w)));
}

export function typeName(type: ItemType): string {
  return PALETTE.find((p) => p.type === type)?.name ?? (type === "criteria" ? "Acceptance criteria" : type);
}

/** Where a dropdown's choices come from. All but "custom" are live lists of master data. */
export const SOURCES = [
  "printers",
  "postproc",
  "measuring",
  "tooling",
  "steril",
  "materials",
  "lots",
  "components",
  "packaging",
  "vendors",
  "operators",
  "params",
  "software",
  "techs",
  "partTypes",
  "custom",
] as const;
export type Source = (typeof SOURCES)[number];

export const SOURCE_LABELS: Record<Source, string> = {
  printers: "Printers & machines",
  postproc: "Post-processing equipment",
  measuring: "Measuring equipment",
  tooling: "Tooling & fixtures",
  steril: "Sterilization cycles",
  materials: "Materials",
  lots: "Material lots",
  components: "Standard components",
  packaging: "Packaging & labelling",
  vendors: "Suppliers & vendors",
  operators: "Operators (qualified people)",
  params: "Process parameter sets",
  software: "Software & versions",
  techs: "Manufacturing technologies",
  partTypes: "Part types",
  custom: "Custom list (type choices)",
};

/** The page each library is kept on. */
export const SOURCE_PAGES: Record<Exclude<Source, "custom">, { title: string; href: string }> = {
  printers: { title: "Printers & Machines", href: "/printers" },
  postproc: { title: "Post-processing Equipment", href: "/postproc" },
  measuring: { title: "Measuring Equipment", href: "/measuring" },
  tooling: { title: "Tooling & Fixtures", href: "/tooling" },
  steril: { title: "Sterilization", href: "/steril" },
  materials: { title: "Materials", href: "/materials" },
  lots: { title: "Materials → Lots", href: "/materials" },
  components: { title: "Standard Components", href: "/components" },
  packaging: { title: "Packaging & Labelling", href: "/packaging" },
  vendors: { title: "Suppliers & Vendors", href: "/vendors" },
  operators: { title: "Operator Qualifications", href: "/operators" },
  params: { title: "Process Parameters", href: "/params" },
  software: { title: "Software & Versions", href: "/software" },
  techs: { title: "Manufacturing Tech", href: "/tech" },
  partTypes: { title: "Part Types", href: "/parttypes" },
};

/** Libraries whose picks can also record a quantity used, taken off stock. */
export const QTY_SOURCES: Source[] = ["lots", "components", "packaging"];

export interface QaItem {
  id: string;
  type: ItemType;
  label: string;
  /** Pre-fill, or the value of an Auto field — may contain {variables}. */
  value: string;
  req: boolean;
  /** Measurement limits; may contain variables. */
  lsl: string;
  usl: string;
  /** Dropdown: where the choices come from, and a custom list's choices. */
  src: Source | "";
  opts: string;
  /** Dropdown on lots / components / packaging: also record the quantity used. */
  qty: boolean;
  /** Balloon table without Measured / Result columns. */
  noMeasure: boolean;
  /**
   * A calculated field's formula: other fields by [label], variables by
   * {token} — see calc.ts. Absent on fields saved before calculations existed.
   */
  formula?: string;
  /** A data table's columns. */
  columns?: GridColumn[];
  /** Shown only when this holds; null or absent: always shown. */
  showIf?: ShowIf | null;
  /** A signature only these roles may sign, comma separated; "" for anyone. */
  roles?: string;
  /**
   * How a signature is given: the name ("name", the default), the name with
   * the signer's role ("role"), or the signature image kept on the signer's
   * My account ("image", which also shows name and role).
   */
  style?: SignStyle;
  /** Who signs it; "anyone" (typed) when absent. */
  signer?: Signer;
  /** Yes / No: the answer that passes; "" when either is fine. */
  expect?: "" | "Yes" | "No";
  /** Photo / attachment: any kind of file (design files, videos…), not only pictures and PDFs. */
  anyFile?: boolean;
  /** Pictures may be added beside the field's value (kept under "img:<id>"). */
  allowImages?: boolean;
  /** A custom dropdown where several choices can be ticked; kept as "A, B". */
  multi?: boolean;
}

/** Fields that can take pictures beside their value. */
export const IMAGE_ABLE: ItemType[] = ["text", "number", "check", "select", "date", "datetime", "time", "duration", "yesno"];

export interface QaSection {
  id: string;
  title: string;
  cols: 1 | 2 | 3 | 4;
  items: QaItem[];
}

export interface QaTemplateData {
  name: string;
  code: string;
  clause: string;
  issue: string;
  effective: string;
  rev: string;
  docLayout: boolean;
  /** Valid until, for a controlled form's header. */
  validity?: string;
  /** The controlled-document header: reference standards (default) or a banner — effective · validity · form · ver. */
  docStyle?: DocStyle;
  /** What it is filled for; generic when absent. */
  usedFor?: UsedFor;
  attach: string[];
  sections: QaSection[];
}

/** What a form is filled for — and so which stage pickers offer it. */
export const USED_FOR = ["product", "manufacturing", "order", "generic"] as const;
export type UsedFor = (typeof USED_FOR)[number];
export const USED_FOR_LABELS: Record<UsedFor, string> = {
  product: "Product — a case's stages",
  manufacturing: "Manufacturing — a part's workflow",
  order: "Order — a case's Order tab (surgeon & team)",
  generic: "Generic — any",
};
/** Whether a form may be offered for a product's stages, or a workflow's. */
export function offeredFor(usedFor: string | null | undefined, where: "product" | "manufacturing" | "order"): boolean {
  return !usedFor || usedFor === "generic" || usedFor === where;
}

/** The designs every space has; a space's own are "layout-…" (src/lib/qa/layouts.ts). */
export const DOC_STYLES = ["reference", "banner"] as const;
/** The header/footer design a controlled form uses — by its id. */
export type DocStyle = string;
const DOC_STYLE = /^(reference|banner|layout-[a-z0-9-]{4,40})$/;

// --- Building blocks --------------------------------------------------------------------

let counter = 0;
/** An id unique within a template. Seeds use readable ones; new ones are random. */
export function newItemId(prefix = "i"): string {
  counter += 1;
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : `${Date.now().toString(36)}${counter}`;
  return `${prefix}-${random}`;
}

export function item(type: ItemType, label: string, extra: Partial<QaItem> = {}): QaItem {
  return {
    id: newItemId(),
    type,
    label,
    value: "",
    req: type !== "info" && type !== "image" && type !== "criteria",
    lsl: "",
    usl: "",
    src: "",
    opts: "",
    qty: false,
    noMeasure: false,
    formula: "",
    ...extra,
  };
}

/** What a new item of a type starts as, per the palette. */
export function paletteItem(type: ItemType): QaItem {
  switch (type) {
    case "info":
      return item("info", "Part name", { value: "{part.name}" });
    case "image":
      return item("image", "Product image", { value: "{request.productImage}" });
    case "text":
      return item("text", "New entry");
    case "number":
      return item("number", "Measurement");
    case "check":
      return item("check", "Check item");
    case "table":
      return item("table", "Balloon inspection", { value: "{balloon.table}" });
    case "sign":
      return item("sign", "Prepared by", { value: "", signer: "submitter" });
    case "select":
      return item("select", "Printer used", { src: "printers" });
    case "criteria":
      return item("criteria", "Acceptance criteria");
    case "date":
      return item("date", "Date", { value: "{today}" });
    case "datetime":
      return item("datetime", "Start (date & time)", { value: "{now}" });
    case "time":
      return item("time", "Time");
    case "duration":
      return item("duration", "Duration (h:mm)");
    case "calc":
      return item("calc", "Calculated", { req: false });
    case "grid":
      return item("grid", "Data table", {
        columns: [
          { id: newItemId("c"), label: "Item", kind: "text", opts: "", formula: "", req: true },
          { id: newItemId("c"), label: "Remarks", kind: "text", opts: "", formula: "", req: false },
        ],
      });
    case "yesno":
      return item("yesno", "Done?");
    case "file":
      return item("file", "Photo / attachment");
  }
}

export function newColumn(label = "New column"): GridColumn {
  return { id: newItemId("c"), label, kind: "text", opts: "", formula: "", req: false };
}

export function section(title: string, items: QaItem[], cols: QaSection["cols"] = 1): QaSection {
  return { id: newItemId("s"), title, cols, items };
}

const info = (label: string, value: string, extra: Partial<QaItem> = {}) => item("info", label, { value, ...extra });
const check = (label: string) => item("check", label);
const sign = (label: string, value = "{user.name}", signer?: Signer) => item("sign", label, { value, ...(signer ? { signer } : {}) });
const measure = (label: string, lsl: string, usl: string) => item("number", label, { lsl, usl });
const pick = (label: string, src: Source, extra: Partial<QaItem> = {}) => item("select", label, { src, ...extra });

/** The ten requirement categories of the QAC, as the request form names them. */
export const REQUIREMENTS: Array<[title: string, prefix: string]> = [
  ["Dimensional", "dimensional"],
  ["Material", "material"],
  ["Workmanship", "workmanship"],
  ["Process Capability", "processCapability"],
  ["Aesthetic", "aesthetic"],
  ["Performance", "performance"],
  ["Documentation", "documentation"],
  ["Packaging & Labelling", "packagingLabelling"],
  ["Lab Test", "labTest"],
  ["Other", "other"],
];

/** The six forms the design ships with. */
export function standardTemplates(): QaTemplateData[] {
  const identification = (extra: QaItem[] = []) =>
    section("Identification", [
      info("Part ID", "{part.id}"),
      info("Part name", "{part.name}"),
      info("Machine", "{part.printer}"),
      info("Material & lot", "{part.material} · lot {material.lot}"),
      info("Quantity", "{part.qty}"),
      ...extra,
    ], 2);

  return [
    {
      name: "Quality Plan & Acceptance Criteria (QAC)",
      code: "JM-F-DND-004",
      clause: "ISO 13485:2016 & India MDR 2017",
      issue: "02",
      effective: "06-03-2023",
      rev: "02",
      docLayout: true,
      attach: ["Request received"],
      sections: [
        section("Product details", [
          info("Case ID", "{case.id}"),
          info("Product name", "{part.name} (Component: {part.component})"),
          info("Category", "{part.type}"),
          info("STL file / link", "{part.files}"),
          item("image", "Product image", { value: "{request.productImage}", req: false }),
          info("Dimensions", "{request.dimensions}"),
          info("Polishing requirement", "{request.polishingRequirement}"),
        ], 2),
        ...REQUIREMENTS.map(([title, prefix]) =>
          section(`${title} Requirements`, [
            info("Feature", `{request.${prefix}Feature}`),
            info("Specification", `{request.${prefix}Specification}`),
            info("Testing / acceptance method", `{request.${prefix}TestMethod}`),
          ], 3),
        ),
        section("Drawing & balloon characteristics", [
          info("No. of balloon characteristics", "{balloon.count}"),
          item("table", "Balloon characteristics", { value: "{balloon.table}", req: false, noMeasure: true }),
        ]),
        section("Sign-off", [sign("Prepared by", "", "submitter"), sign("Approved by", "", "approver")], 2),
      ],
    },
    {
      name: "Batch Manufacturing Record (BMR)",
      code: "QMS-BMR-01",
      clause: "ISO 13485 §7.5.1",
      issue: "",
      effective: "",
      rev: "",
      docLayout: false,
      attach: ["Printing (DMLS)", "Machining at vendor"],
      sections: [
        section("Part & build identification", [
          info("Part ID", "{part.id}"),
          info("Part name", "{part.name}"),
          info("Part type", "{part.type}"),
          info("Case", "{case.id} · {case.product}"),
          info("Workflow", "{part.workflow}"),
          info("Machine", "{part.printer}"),
          info("Material & lot", "{part.material} · lot {material.lot}"),
          info("Quantity", "{part.qty}"),
        ], 2),
        section("Build parameters", [
          info("QAC process requirement", "{request.processCapabilitySpecification}"),
          item("text", "Build job number", { value: "{part.id}-B1" }),
          pick("Printer used", "printers", { value: "{part.printer}" }),
          pick("Process parameter set", "params"),
          pick("Powder lot", "lots", { qty: true }),
          pick("Build operator", "operators"),
          measure("Layer thickness (µm)", "20", "60"),
          measure("Chamber O₂ (%)", "0", "0.13"),
          check("Powder lot verified against CoA"),
          check("Build plate inspected and cleaned"),
        ]),
        section("Sign-off", [sign("Operator")]),
      ],
    },
    {
      name: "Polymer Build Record",
      code: "QMS-PBR-02",
      clause: "ISO 13485 §7.5.1",
      issue: "",
      effective: "",
      rev: "",
      docLayout: false,
      attach: ["Printing (FDM)", "Printing (SLS)", "Printing (SLA)"],
      sections: [
        identification(),
        section("Build parameters", [
          info("QAC process requirement", "{request.processCapabilitySpecification}"),
          item("text", "Build job number", { value: "{part.id}-B1" }),
          pick("Printer used", "printers", { value: "{part.printer}" }),
          pick("Process parameter set", "params"),
          pick("Material lot", "lots", { qty: true }),
          pick("Operator", "operators"),
          measure("Layer thickness (µm)", "50", "300"),
          check("Material lot verified"),
          check("Build completed without errors"),
        ]),
        section("Sign-off", [sign("Operator")]),
      ],
    },
    {
      name: "Final Inspection",
      code: "QMS-FI-03",
      clause: "ISO 13485 §8.2.6",
      issue: "",
      effective: "",
      rev: "",
      docLayout: false,
      attach: ["Inspection & QC", "QC inspection", "Visual QC", "Incoming inspection"],
      sections: [
        section("Identification", [
          info("Part ID", "{part.id}"),
          info("Part name / type", "{part.name} · {part.type}"),
          info("Patient", "{case.patient}"),
          info("Surgeon / hospital", "{case.surgeon} · {case.hospital}"),
          info("Priority", "{request.priority}"),
          info("Balloon characteristics", "{balloon.count}"),
        ], 2),
        section("Acceptance criteria (from QAC)", [
          info("Dimensional", "{request.dimensionalSpecification}"),
          info("Material", "{request.materialSpecification}"),
          info("Workmanship", "{request.workmanshipSpecification}"),
          info("Aesthetic", "{request.aestheticSpecification}"),
          info("Performance", "{request.performanceSpecification}"),
          check("Part meets all QAC acceptance criteria"),
        ]),
        section("Dimensional inspection (from drawing balloons)", [
          pick("Measuring equipment used", "measuring"),
          pick("Inspector", "operators"),
          item("table", "Balloon inspection", { value: "{balloon.table}" }),
        ]),
        section("Visual inspection", [
          check("No visible defects, burrs or residue"),
          check("Surface finish acceptable"),
          item("text", "Remarks", { req: false }),
        ]),
        section("Sign-off", [sign("Inspector")]),
      ],
    },
    {
      name: "Sterilization Checklist",
      code: "QMS-STE-02",
      clause: "ISO 13485 §7.5.7",
      issue: "",
      effective: "",
      rev: "",
      docLayout: false,
      attach: ["Cleaning & sterilization"],
      sections: [
        section("Identification", [info("Part ID", "{part.id}"), info("Part name", "{part.name}"), info("Quantity", "{part.qty}")], 2),
        section("Cycle record", [
          pick("Sterilization cycle", "steril"),
          pick("Packaging", "packaging", { qty: true }),
          item("text", "Cycle ID"),
          measure("Temperature (°C)", "132", "137"),
          measure("Exposure time (min)", "4", "10"),
          check("Chemical / biological indicator passed"),
        ]),
        section("Sign-off", [sign("Operator")]),
      ],
    },
    {
      name: "Device History Record",
      code: "QMS-DHR-01",
      clause: "ISO 13485 §4.2.5",
      issue: "",
      effective: "",
      rev: "",
      docLayout: false,
      attach: ["Packaging & dispatch"],
      sections: [
        section("Device identification", [
          info("Part ID / UDI", "{part.id}"),
          info("Part name / type", "{part.name} · {part.type}"),
          info("Case / patient", "{case.id} · {case.patient}"),
          info("Workflow", "{part.workflow}"),
          info("Material drawn", "{material.drawn} (lot {material.lot})"),
          info("Characteristics inspected", "{balloon.count}"),
        ], 2),
        section("Release checks", [
          check("All stage quality forms approved"),
          check("Label verified against part ID {part.id}"),
          check("IFU and packaging complete"),
        ]),
        section("Release", [sign("QA release")]),
      ],
    },
  ];
}

/** A blank form, for "+ New QA form". */
export function newTemplate(n: number): QaTemplateData {
  return {
    name: "New QA form",
    code: `QMS-NEW-${String(n).padStart(2, "0")}`,
    clause: "",
    issue: "",
    effective: "",
    rev: "",
    docLayout: false,
    attach: [],
    sections: [section("Identification", [info("Part name", "{part.name}"), info("Part ID", "{part.id}")], 2)],
  };
}

/** How a form is named where a workflow stage lists it: "Final Inspection (QMS-FI-03)". */
export function templateLabel(t: { name: string; code: string }): string {
  return t.code ? `${t.name} (${t.code})` : t.name;
}

// --- Figures for the list --------------------------------------------------------------

export function templateStats(sections: QaSection[]) {
  const items = sections.flatMap((s) => s.items);
  const tokens = new Set<string>();
  for (const i of items) for (const t of `${i.label} ${i.value} ${i.lsl} ${i.usl} ${i.formula ?? ""}`.match(/\{[^{}\s]+\}/g) ?? []) tokens.add(t);
  return {
    sections: sections.length,
    items: items.length,
    required: items.filter((i) => i.req && i.type !== "info" && i.type !== "image").length,
    measurements: items.filter((i) => i.type === "number" || (i.type === "table" && !i.noMeasure) || ((i.type === "duration" || i.type === "calc") && Boolean(i.lsl || i.usl))).length,
    variables: tokens.size,
  };
}

// --- Validation of a saved template ------------------------------------------------------

const itemSchema = z.object({
  id: z.string().min(1).max(60),
  type: z.enum(ITEM_TYPES),
  label: z.string().trim().min(1, "Every field needs a label.").max(160),
  value: z.string().max(1000),
  req: z.boolean(),
  lsl: z.string().max(60),
  usl: z.string().max(60),
  src: z.union([z.enum(SOURCES), z.literal("")]),
  opts: z.string().max(1000),
  qty: z.boolean(),
  noMeasure: z.boolean(),
  formula: z.string().max(400).optional(),
  columns: z
    .array(
      z.object({
        id: z.string().min(1).max(60),
        label: z.string().trim().min(1, "Every table column needs a name.").max(80),
        kind: z.enum(COLUMN_KINDS),
        opts: z.string().max(500),
        formula: z.string().max(400),
        req: z.boolean(),
      }),
    )
    .max(20, "A table can have at most 20 columns.")
    .optional(),
  showIf: z
    .object({ ref: z.string().trim().max(160), op: z.enum(SHOW_OPS), value: z.string().max(160) })
    .nullable()
    .optional(),
  roles: z.string().max(300).optional(),
  style: z.enum(SIGN_STYLES).optional(),
  signer: z.enum(SIGNERS).optional(),
  expect: z.enum(["", "Yes", "No"]).optional(),
  anyFile: z.boolean().optional(),
  allowImages: z.boolean().optional(),
  multi: z.boolean().optional(),
});

const sectionSchema = z.object({
  id: z.string().min(1).max(60),
  title: z.string().max(120),
  cols: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  items: z.array(itemSchema).max(80),
});

export const templateSchema = z.object({
  name: z.string().trim().min(1, "Give the form a name.").max(160),
  code: z.string().trim().max(40),
  clause: z.string().trim().max(120),
  issue: z.string().trim().max(20),
  effective: z.string().trim().max(30),
  rev: z.string().trim().max(20),
  docLayout: z.boolean(),
  validity: z.string().trim().max(30).optional(),
  docStyle: z.string().regex(DOC_STYLE, "Choose a header & footer design.").optional(),
  usedFor: z.enum(USED_FOR).optional(),
  attach: z.array(z.string().trim().min(1).max(120)).max(60),
  sections: z.array(sectionSchema).min(1, "A form needs at least one section.").max(60),
});

/** What is wrong with a template, in words — or null. */
export function templateProblem(t: QaTemplateData): string | null {
  for (const s of t.sections) {
    for (const i of s.items) {
      if (i.type === "select" && !i.src) return `Choose where the options of "${i.label}" come from.`;
      if (i.type === "select" && i.src === "custom" && !i.opts.split(",").some((o) => o.trim())) {
        return `Give "${i.label}" at least one choice.`;
      }
      if (i.type === "calc") {
        const formula = (i.formula ?? "").trim();
        if (!formula) return `Write the formula of "${i.label}".`;
        const problem = formulaProblem(formula);
        if (problem) return `"${i.label}": ${problem}`;
        for (const ref of formulaRefs(formula)) {
          const named = t.sections.flatMap((s) => s.items).filter((o) => o.label.trim().toLowerCase() === ref.toLowerCase());
          if (named.length === 0) return `"${i.label}" uses [${ref}], but no field on this form has that label.`;
          if (named.length > 1) return `"${i.label}" uses [${ref}], and two fields have that label — rename one.`;
          if (named[0].id === i.id) return `"${i.label}" cannot use itself.`;
        }
      }
      if (i.type === "grid") {
        const columns = i.columns ?? [];
        if (columns.length === 0) return `Give the table "${i.label}" at least one column.`;
        const names = columns.map((c) => c.label.trim().toLowerCase());
        if (new Set(names).size !== names.length) return `Two columns of "${i.label}" have the same name.`;
        for (const c of columns) {
          if (c.kind === "select" && !c.opts.split(",").some((o) => o.trim())) return `Give the "${c.label}" column of "${i.label}" its choices.`;
          if (c.kind === "calc") {
            if (!c.formula.trim()) return `Write the formula of the "${c.label}" column of "${i.label}".`;
            const problem = formulaProblem(c.formula);
            if (problem) return `"${i.label}" → "${c.label}": ${problem}`;
            for (const ref of formulaRefs(c.formula)) {
              if (!names.includes(ref.toLowerCase())) return `"${i.label}" → "${c.label}" uses [${ref}], which is not a column of the table.`;
              if (ref.toLowerCase() === c.label.trim().toLowerCase()) return `"${i.label}" → "${c.label}" cannot use itself.`;
            }
          }
        }
      }
      if (i.showIf && i.showIf.ref.trim()) {
        const named = t.sections.flatMap((s) => s.items).filter((o) => o.label.trim().toLowerCase() === i.showIf!.ref.trim().toLowerCase());
        if (named.length === 0) return `"${i.label}" is shown depending on [${i.showIf.ref}], but no field has that label.`;
        if (named.length > 1) return `"${i.label}" is shown depending on [${i.showIf.ref}], and two fields have that label — rename one.`;
        if (named[0].id === i.id) return `"${i.label}" cannot be shown depending on itself.`;
        if ((i.showIf.op === "gt" || i.showIf.op === "lt") && Number.isNaN(Number(i.showIf.value.trim()))) {
          return `"${i.label}": "more than" and "less than" need a number to compare with.`;
        }
      }
    }
  }
  return null;
}

export function readTemplate(row: {
  name: string;
  code: string;
  clause: string;
  issue: string;
  effective: string;
  rev: string;
  docLayout: boolean;
  validity?: string;
  docStyle?: string;
  usedFor?: string;
  attach: string[];
  sections: unknown;
}): QaTemplateData {
  return {
    name: row.name,
    code: row.code,
    clause: row.clause,
    issue: row.issue,
    effective: row.effective,
    rev: row.rev,
    docLayout: row.docLayout,
    validity: row.validity ?? "",
    docStyle: DOC_STYLE.test(row.docStyle ?? "") ? row.docStyle! : "reference",
    usedFor: (USED_FOR as readonly string[]).includes(row.usedFor ?? "") ? (row.usedFor as UsedFor) : "generic",
    attach: row.attach,
    sections: Array.isArray(row.sections) ? (row.sections as QaSection[]) : [],
  };
}

/** Choices of a custom dropdown. */
export function customOptions(opts: string): string[] {
  return [...new Set(opts.split(",").map((o) => o.trim()).filter(Boolean))];
}
