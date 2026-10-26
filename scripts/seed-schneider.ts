import "dotenv/config";

import { createCipheriv, randomBytes, randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";

import { hashPassword } from "../src/lib/auth/password";
import { classifyCase } from "../src/lib/cases/classify";
import { caseSortKey } from "../src/lib/cases/sort-key";
import {
  buildPartNumber,
  defaultSections,
  formsProblem,
  formsSchema,
  type FieldType,
  type IdRule,
  type RequestField,
  type RequestFormDef,
  type RequestSection,
} from "../src/lib/parts/request-form";
import { item, section, standardTemplates, templateLabel, templateProblem, templateSchema, type QaItem, type QaTemplateData, type Source } from "../src/lib/qa/template";
import type { ResourceKind, Track, WorkflowStage } from "../src/lib/resources/config";
import { addMonths } from "../src/lib/resources/status";
import { replaceSampleCases, setupSchneiderCases } from "./schneider-case-setup";
import { setupDicomForm } from "./schneider-dicom-form";
import { setupSynergyForms } from "./schneider-synergy-forms";
import { setupProductionWorkflows } from "./schneider-production";
import { setupProductsFromOrthognathic } from "./schneider-3dpdf";
import { setupSites } from "./schneider-sites";
import { setupOrders } from "./schneider-orders";

/**
 * A sample space for a children's hospital 3D printing lab running one
 * Stratasys PolyJet printer — anatomical models, patient-specific surgical
 * guides and patient-specific splints — filled with dummy records:
 *
 *   npx tsx scripts/seed-schneider.ts
 *
 * Creates the space `schneider` ("Schneider Children's Medical Center of
 * Israel") if missing and replaces its contents on every run; no other space
 * is read or written. Every person, case, patient, lot and supplier in it is
 * invented. Sign in at http://schneider.localhost:3100 as
 * admin@scmc-3dlab.example (or qa@scmc-3dlab.example), with the
 * SUPER_ADMIN_PASSWORD from .env.
 *
 * Refuses to run in production.
 */

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed sample data with NODE_ENV=production.");
  process.exit(1);
}

const SLUG = "schneider";
const SPACE_NAME = "Schneider Children's Medical Center of Israel";
const ADMIN_EMAIL = "admin@scmc-3dlab.example";
const QA_EMAIL = "qa@scmc-3dlab.example";
const ADMIN = "Dr. Yael Ben-Ami (3D Lab)";
const QA = "Dr. Noa Shalev (QA)";
const TECH = "Itai Rosen";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

// Same format as src/lib/crypto.ts, which cannot be imported here.
const KEY = Buffer.from(process.env.ENCRYPTION_KEY ?? "", "base64");
function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// QA forms
// ---------------------------------------------------------------------------

const info = (label: string, value: string, extra: Partial<QaItem> = {}) => item("info", label, { value, ...extra });
const text = (label: string, extra: Partial<QaItem> = {}) => item("text", label, extra);
const count = (label: string, extra: Partial<QaItem> = {}) => item("number", label, extra);
const check = (label: string, extra: Partial<QaItem> = {}) => item("check", label, extra);
const yesno = (label: string, extra: Partial<QaItem> = {}) => item("yesno", label, extra);
const pick = (label: string, src: Source, extra: Partial<QaItem> = {}) => item("select", label, { src, ...extra });
const choose = (label: string, options: string[], extra: Partial<QaItem> = {}) => item("select", label, { src: "custom", opts: options.join(", "), ...extra });
const photo = (label: string) => item("file", label, { req: false });
const calc = (label: string, formula: string) => item("calc", label, { formula, req: false });
const optional = { req: false } as const;

const STAGE = {
  request: "Request received",
  segmentation: "Segmentation & design check",
  guideDesign: "Design & surgeon approval",
  splintDesign: "Design & fit plan",
  prep: "Print preparation",
  print: "Printing (Stratasys J5)",
  cleaning: "Support removal & cleaning",
  qc: "QC inspection",
  fit: "QC & fit check",
  release: "Packaging & release",
  sterile: "Sterilization & release",
} as const;

const DOC = { clause: "ISO 13485:2016 · MOH Israel point-of-care", issue: "01", effective: "01-09-2026", rev: "00", docLayout: true };
const batch = () =>
  section("Identification", [
    info("Part ID", "{part.id}"),
    info("Case ID", "{case.id}"),
    info("Item", "{part.name}"),
    info("Quantity", "{part.qty}"),
    info("Material", "{part.material}"),
  ], 2);
const doneChecked = () =>
  section("Sign-off", [item("sign", "Done by", { value: "", signer: "submitter" }), item("sign", "Checked by", { value: "", signer: "approver" })], 2);

function forms(): QaTemplateData[] {
  // The quality plan, from the standard one, with this lab's document code.
  const qac = standardTemplates().find((t) => t.code === "JM-F-DND-004")!;
  return [
    {
      ...qac,
      code: "SCMC-QP-001",
      ...DOC,
      attach: [STAGE.request],
      // The request's clinical and regulatory inputs, first: what the device is for and how it is used.
      sections: [
        section("Clinical & regulatory inputs (ISO 13485 §7.2.1, §7.3.3)", [
          info("Ordering clinician", "{request.orderingClinician}"),
          info("Department", "{request.department}"),
          info("Clinical indication", "{request.clinicalIndication}"),
          info("Intended use", "{request.intendedUse}"),
          info("Anatomy / laterality", "{request.anatomicalRegion} · {request.laterality}"),
          info("Imaging", "{request.imagingModality} · {request.scanDate} · {request.sliceThickness} mm"),
          info("Patient contact", "{request.patientContact} · {request.contactDuration}"),
          info("Sterility", "{request.sterility}"),
          info("Design approval", "{request.designApproval} — {request.designApprover}"),
        ], 2),
        ...qac.sections,
      ],
    },
    {
      name: "PolyJet Print Record",
      code: "SCMC-PR-002",
      ...DOC,
      attach: [STAGE.print],
      sections: [
        batch(),
        section("Print set-up", [
          pick("Printer", "printers", { value: "{part.printer}" }),
          choose("Print mode", ["High Quality", "High Speed", "Digital Anatomy"]),
          pick("Model material — lot", "lots", { qty: true }),
          pick("Support material (SUP706B) — lot", "lots", { qty: true }),
          text("GrabCAD Print tray file"),
          pick("Process parameter set", "params", optional),
        ], 2),
        section("Print run", [
          item("datetime", "Print start", { value: "{now}" }),
          item("duration", "Print time"),
          calc("Print end", "[Print start] + [Print time]"),
          count("No. of parts printed"),
          count("No. of parts rejected"),
          calc("No. of parts accepted", "[No. of parts printed] - [No. of parts rejected]"),
          text("Reason for rejection", { showIf: { ref: "No. of parts rejected", op: "gt", value: "0" } }),
          photo("Build tray photo"),
        ], 2),
        doneChecked(),
      ],
    },
    {
      name: "Support Removal & Cleaning Record",
      code: "SCMC-PP-003",
      ...DOC,
      attach: [STAGE.cleaning],
      sections: [
        batch(),
        section("Support removal", [
          pick("Equipment", "postproc"),
          choose("Method", ["Waterjet", "Soak — 2% NaOH (SUP706B)", "Waterjet + soak"]),
          item("duration", "Soak time", { req: false }),
          check("Rinsed with water — no support residue"),
          check("Dried at room temperature (no heat on MED610)"),
          yesno("Any damage or deformation?", { expect: "No" }),
        ], 2),
        doneChecked(),
      ],
    },
    {
      name: "Dimensional & Visual QC Report",
      code: "SCMC-QC-004",
      ...DOC,
      attach: [STAGE.qc, STAGE.fit],
      sections: [
        batch(),
        section("Visual inspection", [
          check("Surface free of support residue"),
          check("No cracks, voids or delamination"),
          check("Colour / transparency as specified"),
          check("Anatomy matches the approved design (overlay on screen)"),
        ], 2),
        section("Dimensions", [
          pick("Measuring instrument", "measuring"),
          count("Critical dimension (mm) — deviation from design", { lsl: "-0.2", usl: "0.2" }),
          item("table", "Balloon characteristics", { req: false }),
        ]),
        section("Fit check (guides and splints)", [
          yesno("Fit verified on the anatomical model", { expect: "Yes", req: false }),
          text("Fit remarks", optional),
        ]),
        doneChecked(),
      ],
    },
    {
      name: "Packaging, Labelling & Release",
      code: "SCMC-RL-005",
      ...DOC,
      attach: [STAGE.release, STAGE.sterile],
      sections: [
        batch(),
        section("Packaging & label", [
          pick("Packaging", "packaging", { qty: true }),
          check("Label: patient-specific ID, part ID, material, date"),
          check("Instructions for use enclosed"),
        ], 2),
        section("Sterilization (when the part goes to theatre)", [
          yesno("Sterilization required"),
          pick("Sterilization cycle", "steril", { req: false, showIf: { ref: "Sterilization required", op: "eq", value: "Yes" } }),
          text("CSSD load / cycle no.", { req: false, showIf: { ref: "Sterilization required", op: "eq", value: "Yes" } }),
        ], 2),
        section("Release", [
          choose("Release decision", ["Released", "On hold", "Rejected"]),
          item("sign", "Prepared by", { value: "", signer: "submitter" }),
          item("sign", "Released by", { value: "", signer: "approver" }),
        ], 3),
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Part request forms — what an ISO 13485 point-of-care lab records on an order
// ---------------------------------------------------------------------------

/** A field of this lab's own, answering {request.<var>} in QA forms. */
function ask(variable: string, label: string, type: FieldType, extra: Partial<RequestField> = {}): RequestField {
  return {
    id: `f-${variable}`,
    key: "",
    var: variable,
    def: "",
    label,
    type,
    show: true,
    req: true,
    locked: false,
    options: [],
    fileTypes: [],
    columns: [],
    allowLinks: false,
    ...extra,
  };
}
const needed = (title: string, cols: RequestSection["cols"], fields: RequestField[]): RequestSection => ({ id: `s-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`, title, cols, fields });

const DEPARTMENTS = ["Cardiac surgery & cardiology", "Orthopaedics", "Maxillofacial & plastic surgery", "Neurosurgery", "ENT", "Other"];

/** Who asks and why — §7.2.1 customer requirements, and the intended use. */
const clinical = (uses: string[]) =>
  needed("Request & clinical need (ISO 13485 §7.2.1)", 2, [
    ask("orderingClinician", "Ordering clinician", "text"),
    ask("department", "Department", "select", { options: DEPARTMENTS }),
    ask("clinicianContact", "Clinician contact (phone / e-mail)", "text"),
    ask("intendedUse", "Intended use", "select", { options: uses }),
    ask("clinicalIndication", "Clinical indication / diagnosis", "textarea"),
    ask("anatomicalRegion", "Anatomical region", "text"),
    ask("laterality", "Laterality", "select", { options: ["Left", "Right", "Bilateral", "Midline / not applicable"] }),
  ]);

/** The design input: the imaging the part is made from — §7.3.3. */
const imaging = needed("Imaging data — design input (ISO 13485 §7.3.3)", 2, [
  ask("imagingModality", "Imaging modality", "select", { options: ["CT", "MRI", "CBCT", "3D echocardiography", "Surface scan"] }),
  ask("scanDate", "Scan date", "date"),
  ask("sliceThickness", "Slice thickness (mm)", "number"),
  ask("pacsStudy", "PACS accession / study ID", "text"),
  ask("scanProtocol", "Scan acquired to the lab's imaging protocol (≤ 1 mm slices, no motion artefact)", "checkbox"),
]);

/** Who approves the design before it is printed — §7.3.5 review, §7.3.6 verification. */
const approval = (required: boolean) =>
  needed("Design review & approval (ISO 13485 §7.3.5–7.3.6)", 2, [
    ask("designApproval", "Design approval before printing", "select", {
      options: required
        ? ["Required — surgeon signs off the design"]
        : ["Required — surgeon signs off the design", "Not required — printed from the approved segmentation"],
      def: required ? "Required — surgeon signs off the design" : "",
    }),
    ask("designApprover", "Approving surgeon", "text"),
  ]);

const delivery = needed("Delivery & consent", 2, [
  ask("deliverTo", "Deliver to (OR / ward / clinic)", "text"),
  ask("useDate", "Date needed in theatre / clinic", "date", { req: false }),
  ask("guardianConsent", "Parent / guardian consent for use of the imaging data on file", "checkbox"),
]);

/** Patient contact and sterility — ISO 10993-1 categorisation, §7.5.7 sterilization. */
const contact = needed("Patient contact & sterility (ISO 10993-1, ISO 13485 §7.5.7)", 2, [
  ask("patientContact", "Patient contact", "select", {
    options: ["Surface device — intact skin", "Surface device — mucosal membrane", "External communicating — tissue / bone (intra-operative)"],
  }),
  ask("contactDuration", "Contact duration", "select", { options: ["Limited (≤ 24 h)", "Prolonged (> 24 h to 30 days)"] }),
  ask("sterility", "Sterility", "select", { options: ["Sterile — hospital CSSD steam", "Non-sterile — clean, single patient"] }),
  ask("allergies", "Known allergies / sensitivities", "textarea", { req: false }),
  ask("singlePatient", "Patient-specific: for this patient only, not to be reused", "checkbox"),
]);

const modelUse = needed("Use of the model", 2, [
  ask("patientContact", "Patient contact", "select", { options: ["None — not for use in the operating field", "Intra-operative reference — sterilized"] }),
  ask("sterility", "Sterility", "select", { options: ["Non-sterile", "Sterile — hospital CSSD steam"], def: "Non-sterile" }),
  ask("scale", "Scale", "select", { options: ["1:1", "Enlarged (state in notes)"], def: "1:1" }),
  ask("modelColours", "Colours / transparency (e.g. vessels red, bone white)", "text", { req: false }),
]);

/** The standard sections, with this in-house lab's choices: sourcing in-house, no outsourcing vendor. */
function standard(): RequestSection[] {
  return defaultSections().map((sec) => ({
    ...sec,
    fields: sec.fields.map((f) =>
      f.key === "sourcing" ? { ...f, def: "In-house" } : f.key === "vendor" ? { ...f, show: false, req: false } : f.key === "type" ? { ...f, req: true } : f,
    ),
  }));
}

function requestForms(spaceId: string): RequestFormDef[] {
  const [ident, production, scheduling, ...rest] = standard();
  return [
    {
      id: `std-${spaceId}`,
      name: "Anatomical model request",
      description: "Planning, counselling and training models — no patient contact unless sterilized for theatre.",
      isDefault: true,
      sections: [ident, clinical(["Surgical planning", "Patient / family communication", "Training & education", "Intra-operative reference (sterilized)"]), imaging, modelUse, approval(false), production, scheduling, delivery, ...rest],
    },
    {
      id: `psd-${spaceId}`,
      name: "Patient-specific device request (guide / splint)",
      description: "Surgical guides and splints in MED610 — patient contact, sterility and surgeon design sign-off.",
      isDefault: false,
      sections: [
        ident,
        clinical(["Intra-operative cutting / drilling guide", "Positioning / fixation splint", "Post-operative immobilisation splint"]),
        imaging,
        contact,
        approval(true),
        production,
        scheduling,
        delivery,
        ...rest,
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

function stage(name: string, role: string, days: number, all: QaTemplateData[], extra: Partial<WorkflowStage> = {}): WorkflowStage {
  return {
    id: randomUUID(),
    name,
    role,
    days,
    forms: all.filter((f) => f.attach.includes(name)).map(templateLabel),
    emailsNext: [],
    emailsBack: [],
    tasks: [],
    ...extra,
  };
}
const START = { emailsNext: ["Stage started — notify owner"] };
const QC = { emailsNext: ["Part ready for QC"], emailsBack: ["Rework required — notify engineer"] };

const MODEL_WF = "Anatomical Model — Stratasys PolyJet";
const GUIDE_WF = "Patient-Specific Surgical Guide — PolyJet MED610";
const SPLINT_WF = "Patient-Specific Splint — PolyJet MED610";

function workflows(all: QaTemplateData[]): Array<{ name: string; stages: WorkflowStage[] }> {
  return [
    {
      name: MODEL_WF,
      stages: [
        stage(STAGE.request, "Engineer", 1, all, START),
        stage(STAGE.segmentation, "Engineer", 2, all, { tasks: [{ name: "Segment in MySegmenter and check against the scan", days: 1 }] }),
        stage(STAGE.prep, "Engineer", 1, all),
        stage(STAGE.print, "Manufacturing", 1, all),
        stage(STAGE.cleaning, "Manufacturing", 1, all),
        stage(STAGE.qc, "Quality", 1, all, QC),
        stage(STAGE.release, "Quality", 1, all),
      ],
    },
    {
      name: GUIDE_WF,
      stages: [
        stage(STAGE.request, "Engineer", 1, all, START),
        stage(STAGE.guideDesign, "Engineer", 3, all, {
          tasks: [
            { name: "Design guide on the 3D Surgical Platform", days: 2 },
            { name: "Surgeon review and sign-off", days: 3 },
          ],
        }),
        stage(STAGE.prep, "Engineer", 1, all),
        stage(STAGE.print, "Manufacturing", 1, all),
        stage(STAGE.cleaning, "Manufacturing", 1, all),
        stage(STAGE.qc, "Quality", 1, all, QC),
        stage(STAGE.sterile, "Quality", 2, all),
      ],
    },
    {
      name: SPLINT_WF,
      stages: [
        stage(STAGE.request, "Engineer", 1, all, START),
        stage(STAGE.splintDesign, "Engineer", 2, all),
        stage(STAGE.prep, "Engineer", 1, all),
        stage(STAGE.print, "Manufacturing", 1, all),
        stage(STAGE.cleaning, "Manufacturing", 1, all),
        stage(STAGE.fit, "Quality", 1, all, QC),
        stage(STAGE.release, "Quality", 1, all),
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Master data
// ---------------------------------------------------------------------------

interface Item {
  track: Track;
  name: string;
  last?: string;
  months?: number;
  due?: string;
  who?: string;
  ref?: string;
  result?: string;
}

interface Seed {
  kind: ResourceKind;
  name: string;
  status?: string;
  data: Record<string, unknown>;
  items?: Item[];
  lots?: Array<[lot: string, remaining: number, received: number, date: string, supplier: string, coa: string, expiry: string | null]>;
}

const qual = (name: string, last: string | undefined, months: number, ref?: string, who = QA): Item => ({
  track: "qualification",
  name,
  last,
  months,
  who,
  ref,
  result: last ? "Pass" : undefined,
});
const maint = (name: string, last: string, months: number, who: string, ref?: string): Item => ({ track: "maintenance", name, last, months, who, ref });
const row = (kind: ResourceKind, name: string, status: string, data: Record<string, unknown>, items: Item[] = []): Seed => ({ kind, name, status, data, items });

const VENDORS: Seed[] = [
  row("vendors", "Stratasys (via IL distributor)", "Approved", { kind: "Raw material supplier", specialty: "PolyJet materials — MED610, VeroUltra, Agilus30, SUP706B", location: "Rehovot, Israel", contact: "orders@polyjet-dist.example", lead: "7" }, [
    qual("Supplier re-evaluation (ISO 13485 §7.4.1)", "2026-03-10", 12, "SE-2026-STRA"),
    qual("Quality agreement / ISO 13485 certificate check", "2026-03-10", 12, "SE-2026-STRA"),
  ]),
  row("vendors", "Stratasys Service Israel", "Approved", { kind: "Service provider", specialty: "J5 printer service, preventive maintenance", location: "Rehovot, Israel", contact: "service@polyjet-dist.example", lead: "3" }, [
    qual("Supplier re-evaluation (ISO 13485 §7.4.1)", "2026-03-10", 12, "SE-2026-SSVC"),
  ]),
  row("vendors", "MedPack Israel Ltd.", "Approved", { kind: "Packaging supplier", specialty: "Sterile barrier pouches, labels", location: "Petah Tikva, Israel", contact: "sales@medpack-il.example", lead: "10" }, [
    qual("Supplier re-evaluation (ISO 13485 §7.4.1)", "2026-02-01", 12, "SE-2026-MPIL"),
  ]),
  row("vendors", "Precision Calibration Lab IL", "Approved", { kind: "Calibration lab", specialty: "Dimensional calibration (ISO/IEC 17025)", location: "Holon, Israel", contact: "lab@precal-il.example", lead: "5" }, [
    qual("Supplier re-evaluation (ISO 13485 §7.4.1)", "2026-01-15", 12, "SE-2026-PCAL"),
  ]),
];

function material(name: string, grade: string, use: string, unit: string, threshold: number, color: string, lots: Seed["lots"]): Seed {
  const id = name.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase();
  const contact = /10993/.test(use);
  return {
    kind: "materials",
    name,
    data: { process: "3D Printing", tech: "PolyJet", grade, use, unit, threshold: String(threshold), color },
    lots,
    items: [
      qual(contact ? "Material qualification & biocompatibility (ISO 10993-1)" : "Material qualification (datasheet, CoA, fitness for use)", "2026-02-20", 36, `MQ-POL-2026-${id}`),
      ...(contact ? [qual("Cleaning & sterilization compatibility (per lot family)", "2026-03-05", 12, `MQ-STE-2026-${id}`)] : []),
    ],
  };
}

const SUPPLIER = "Stratasys (via IL distributor)";
const MATERIALS: Seed[] = [
  material("MED610 (Biocompatible Clear)", "Resin", "Surgical guides & splints — short-term contact (ISO 10993)", "kg", 2, "#2A9D8F", [
    ["MED610-2607-14", 3.4, 4, "2026-07-22", SUPPLIER, "CoA-MED610-77120", "2027-07-31"],
    ["MED610-2609-02", 0.6, 1, "2026-09-08", SUPPLIER, "CoA-MED610-78002", "2027-09-30"],
  ]),
  material("VeroUltra WhiteS", "Resin", "Anatomical models (no patient contact)", "kg", 2, "#E5E7EB", [
    ["VUW-2606-31", 2.2, 4, "2026-06-18", SUPPLIER, "CoA-VUW-55410", "2027-06-30"],
  ]),
  material("Agilus30 Clear", "Resin", "Flexible anatomy — vessels, soft tissue (models)", "kg", 1, "#9B59B6", [
    ["AG30-2605-09", 1.1, 2, "2026-05-12", SUPPLIER, "CoA-AG30-41190", "2027-05-31"],
  ]),
  material("SUP706B Support", "Resin", "Soluble support material", "kg", 4, "#C98A2E", [
    ["SUP706-2608-21", 5.5, 8, "2026-08-04", SUPPLIER, "CoA-SUP-90231", "2027-08-31"],
  ]),
];

const PRINTERS: Seed[] = [
  {
    kind: "printers",
    name: "Stratasys J5 Medijet",
    status: "Available",
    data: {
      assetId: "PR-PJ-01",
      serial: "J5M-24-1187",
      maker: "Stratasys",
      model: "J5 Medijet",
      location: "3D Printing Lab — Pediatric Surgery wing",
      tech: "PolyJet",
      process: "3D Printing",
      materialId: "MED610 (Biocompatible Clear)",
      volume: "490 × 390 × 200 mm (rotary tray)",
      commissioned: "2025-11-04",
    },
    items: [
      qual("IQ — Installation qualification", "2025-11-04", 0, "IQ-PJ-2025-01"),
      qual("OQ — Operational qualification", "2025-11-20", 12, "OQ-PJ-2025-01"),
      qual("PQ — Performance qualification (MED610 guides)", "2026-01-12", 12, "PQ-PJ-2026-01"),
      maint("Preventive maintenance", "2026-08-14", 6, "Stratasys Service Israel", "PM-J5-2608"),
      maint("Print-head pattern test & alignment", "2026-09-28", 1, TECH),
      maint("UV lamp intensity check", "2026-09-01", 3, TECH),
    ],
  },
];

const REGISTRIES: Seed[] = [
  row("postproc", "Waterjet support removal station", "Available", { assetId: "PP-WJ-01", kind: "Waterjet", usedFor: "PolyJet support removal", capacity: "Cabinet 600 mm", usedStages: STAGE.cleaning }, [
    maint("Preventive maintenance", "2026-07-20", 6, "In-house"),
    qual("Qualification (IQ / OQ / PQ)", "2025-11-25", 24, "VAL-WJ-001"),
  ]),
  row("postproc", "Support soak tank (2% NaOH)", "Available", { assetId: "PP-SK-01", kind: "Soak tank", usedFor: "SUP706B dissolution", capacity: "20 L", usedStages: STAGE.cleaning }, [
    maint("Solution change & level check", "2026-09-30", 1, TECH),
    qual("Qualification (IQ / OQ / PQ)", "2025-11-25", 24, "VAL-SK-001"),
  ]),
  row("measuring", "Digital caliper 150 mm", "In service", { assetId: "QC-CAL-01", kind: "Caliper", location: "3D Printing Lab", range: "0–150 mm", resolution: "0.01 mm" }, [
    { ...maint("Calibration", "2026-04-02", 12, "Precision Calibration Lab IL"), ref: "PCL-26-0402" },
  ]),
  row("measuring", "Structured-light 3D scanner", "In service", { assetId: "QC-SCN-01", kind: "3D scanner", location: "3D Printing Lab", range: "0.03–0.5 m", resolution: "0.05 mm" }, [
    { ...maint("Calibration", "2026-02-15", 12, "OEM calibration service"), ref: "SCN-26-0215" },
  ]),
  row("steril", "Steam 134 °C — hospital CSSD", "In validation", { code: "STE-CSSD-134", method: "Steam — prevacuum", provider: "In-house", equipment: "Hospital CSSD", params: "134 °C · 4 min", sal: "10⁻⁶", standard: "ISO 17665", bi: "G. stearothermophilus BI" }, [
    qual("Cycle validation for MED610 guides", undefined, 12),
  ]),
  row("software", "MySegmenter", "Validated", { vendor: "3D Surgical", purpose: "Segmentation", version: "3.2.0", installed: "3.2.0", licence: "2 seats" }, [qual("Software validation / periodic review", "2026-01-20", 12, "SV-SEG-2026-01")]),
  row("software", "3D Surgical Platform", "Validated", { vendor: "3D Surgical", purpose: "Case management, guide & splint design", version: "Cloud — current release", installed: "Cloud — current release", licence: "Site" }, [qual("Software validation / periodic review", "2026-01-20", 12, "SV-CAD-2026-01")]),
  row("software", "GrabCAD Print", "Validated", { vendor: "Stratasys", purpose: "Build preparation / tray layout", version: "1.84", installed: "1.84", licence: "Site" }, [qual("Software validation / periodic review", "2026-02-02", 12, "SV-BP-2026-01")]),
  row("params", "MED610 — guides & splints", "Validated", { code: "PPS-PJ-MED610-01 rev A", process: "PolyJet", machine: "Stratasys J5 Medijet", material: "MED610 (Biocompatible Clear)", layer: "18 µm", keyParams: "High Quality mode · glossy · SUP706B support" }, [qual("Process validation / revalidation (IQ/OQ/PQ)", "2026-01-12", 12, "PQ-PJ-2026-01")]),
  row("params", "VeroUltra / Agilus — anatomical models", "Validated", { code: "PPS-PJ-MODEL-01 rev A", process: "PolyJet", machine: "Stratasys J5 Medijet", material: "VeroUltra WhiteS", layer: "18 µm", keyParams: "High Speed mode · matte · Agilus30 for soft tissue" }, [qual("Process validation / revalidation (IQ/OQ/PQ)", "2025-12-08", 24, "OQ-PJ-2025-02")]),
  row("operators", TECH, "Qualified", { empId: "SC-T014", role: "3D printing technician", qualifiedFor: "J5 Medijet, waterjet, soak tank" }, [qual("Operator qualification", "2025-12-01", 12, "TR-2025-SC01", ADMIN)]),
  row("operators", "Maya Klein", "Qualified", { empId: "SC-E021", role: "Biomedical engineer", qualifiedFor: "MySegmenter, 3D Surgical Platform, GrabCAD Print" }, [qual("Operator qualification", "2026-01-10", 24, "TR-2026-SC02", ADMIN)]),
  row("operators", "Dana Weiss", "In training", { empId: "SC-T030", role: "Lab assistant", qualifiedFor: "Support removal, packaging" }, [qual("Operator qualification", undefined, 12, "TR-2026-SC05", ADMIN)]),
  row("packaging", "Tyvek/film pouch 200 × 300", "Approved", { code: "PKG-PCH-200", kind: "Sterile barrier pouch", spec: "200 × 300 mm, steam compatible", supplier: "MedPack Israel Ltd.", lot: "MP-26-0712", expiry: "2029-06-30", stock: "400", reorder: "150" }, [
    { track: "qualification", name: "Packaging validation (ISO 11607-1/-2)", ref: "PV-PCH-2026-01" },
  ]),
  row("packaging", "Patient-specific device label", "Approved", { code: "LBL-PSD-01", kind: "Label", spec: "70 × 40 mm, autoclavable", supplier: "MedPack Israel Ltd.", lot: "MP-26-0801", expiry: "", stock: "1200", reorder: "300" }),
];

// ---------------------------------------------------------------------------
// Cases and parts — all invented
// ---------------------------------------------------------------------------

const FIRST: Record<string, string> = { N: "Noa", Y: "Yonatan", L: "Liel", E: "Eitan", T: "Tamar", R: "Roni", D: "Daniel", O: "Omer" };

// id, product, scope, surgeon, patient, age, surgery date, priority, status, state
const CASES: Array<[string, string, string, string, string, number, string, string, string, string]> = [
  ["SC-1001", "Anatomical Model", "Congenital heart — tetralogy of Fallot", "Dr. N. Levi", "N. Ben-David", 2, "2026-10-14", "High", "Manufacturing", "Active"],
  ["SC-1002", "Surgical Guide", "Tibial derotation osteotomy", "Dr. A. Cohen", "Y. Shapiro", 11, "2026-10-20", "High", "Design Approval", "Active"],
  ["SC-1003", "Splint", "Mandibular positioning splint", "Dr. M. Katz", "L. Friedman", 6, "2026-10-12", "Critical", "Manufacturing", "Active"],
  ["SC-1004", "Anatomical Model", "Craniosynostosis — skull model", "Dr. S. Mizrahi", "E. Peretz", 1, "2026-10-28", "Medium", "Segmentation", "Active"],
  ["SC-1005", "Surgical Guide", "Mandibular distraction osteotomy", "Dr. M. Katz", "T. Goldberg", 4, "2026-11-03", "Medium", "Scan Review", "Active"],
  ["SC-1006", "Splint", "Post-operative wrist splint", "Dr. A. Cohen", "R. Azoulay", 13, "2026-09-24", "Low", "Shipped", "Active"],
  ["SC-0998", "Surgical Guide", "Pelvic (Dega) osteotomy", "Dr. A. Cohen", "O. Katzir", 8, "2026-10-09", "High", "QA & Sterilization", "Active"],
  ["SC-0991", "Anatomical Model", "Scoliosis — spine model", "Dr. A. Cohen", "D. Levy", 15, "2026-09-02", "Medium", "Completed", "Archived"],
];

const ROUTE: Record<string, { material: string }> = {
  [MODEL_WF]: { material: "VeroUltra WhiteS" },
  [GUIDE_WF]: { material: "MED610 (Biocompatible Clear)" },
  [SPLINT_WF]: { material: "MED610 (Biocompatible Clear)" },
};

/** Sample answers to the request form, by case: clinician, department, indication, region, side, approver. */
const ANSWERS: Record<string, [clinician: string, department: string, indication: string, region: string, side: string, approver: string]> = {
  "SC-1001": ["Dr. N. Levi", "Cardiac surgery & cardiology", "Tetralogy of Fallot — planning of complete repair", "Heart and great vessels", "Midline / not applicable", "Dr. N. Levi"],
  "SC-1002": ["Dr. A. Cohen", "Orthopaedics", "Excessive internal tibial torsion with in-toeing gait", "Tibia", "Right", "Dr. A. Cohen"],
  "SC-1003": ["Dr. M. Katz", "Maxillofacial & plastic surgery", "Pierre Robin sequence — mandibular positioning", "Mandible", "Midline / not applicable", "Dr. M. Katz"],
  "SC-1004": ["Dr. S. Mizrahi", "Neurosurgery", "Sagittal craniosynostosis — vault remodelling planning", "Skull", "Midline / not applicable", "Dr. S. Mizrahi"],
  "SC-1005": ["Dr. M. Katz", "Maxillofacial & plastic surgery", "Micrognathia — mandibular distraction osteogenesis", "Mandible", "Bilateral", "Dr. M. Katz"],
  "SC-1006": ["Dr. A. Cohen", "Orthopaedics", "Distal radius fracture — post-operative immobilisation", "Wrist and forearm", "Left", "Dr. A. Cohen"],
  "SC-0998": ["Dr. A. Cohen", "Orthopaedics", "Developmental dysplasia of the hip — Dega osteotomy", "Pelvis / acetabulum", "Left", "Dr. A. Cohen"],
  "SC-0991": ["Dr. A. Cohen", "Orthopaedics", "Adolescent idiopathic scoliosis — fusion planning", "Thoracolumbar spine", "Midline / not applicable", "Dr. A. Cohen"],
};

const PARTS: Record<string, Array<[name: string, workflow: string, type: string]>> = {
  "Anatomical Model": [["Patient-specific anatomical model", MODEL_WF, "Anatomical model"]],
  "Surgical Guide": [
    ["Patient-specific osteotomy guide", GUIDE_WF, "Surgical guide"],
    ["Bone reference model for guide fit", MODEL_WF, "Anatomical model"],
  ],
  Splint: [["Patient-specific splint", SPLINT_WF, "Splint"]],
};

/** How far along a part is, from where its case is. */
function stageFor(caseStatus: string, stageCount: number): number {
  if (/scan|segment/i.test(caseStatus)) return 0;
  if (/design/i.test(caseStatus)) return 1;
  if (/manufactur/i.test(caseStatus)) return 3;
  if (/qa|steril/i.test(caseStatus)) return stageCount - 1;
  return stageCount - 1;
}

// Part IDs: SCMC-<case>-<type>-<seq>, numbered per case and part type.
const RULE: IdRule = { prefix: "SCMC", sep: "-", tokens: ["CASE_ID", "PART_TYPE", "PART_SEQ"], scope: "case-type", width: 2 };
const TYPES: Array<[string, string]> = [
  ["Anatomical model", "MDL"],
  ["Surgical guide", "GDE"],
  ["Splint", "SPL"],
  ["Test coupon", "TST"],
];

// ---------------------------------------------------------------------------

/** A part's answers to its request form, stored as the request stores them. */
function requestAnswers(caseId: string, partType: string, product: string, surgeryDate: Date): Array<{ label: string; var: string; value: string }> {
  const [clinician, department, indication, region, side, approver] = ANSWERS[caseId] ?? ["Dr. A. Cohen", "Orthopaedics", "", "", "Midline / not applicable", "Dr. A. Cohen"];
  const model = partType === "Anatomical model";
  const scan = new Date(surgeryDate.getTime() - 30 * DAY_MS).toISOString().slice(0, 10);
  const a = (label: string, variable: string, value: string) => ({ label, var: `request.${variable}`, value });
  return [
    a("Ordering clinician", "orderingClinician", clinician),
    a("Department", "department", department),
    a("Clinician contact (phone / e-mail)", "clinicianContact", "3D lab extension 4471"),
    a("Intended use", "intendedUse", model ? "Surgical planning" : product === "Splint" ? "Positioning / fixation splint" : "Intra-operative cutting / drilling guide"),
    a("Clinical indication / diagnosis", "clinicalIndication", indication),
    a("Anatomical region", "anatomicalRegion", region),
    a("Laterality", "laterality", side),
    a("Imaging modality", "imagingModality", /wrist/i.test(region) ? "Surface scan" : "CT"),
    a("Scan date", "scanDate", scan),
    a("Slice thickness (mm)", "sliceThickness", "0.6"),
    a("PACS accession / study ID", "pacsStudy", `ACC-${caseId.replace("SC-", "")}-${scan.replace(/-/g, "").slice(2)}`),
    a("Scan acquired to the lab's imaging protocol (≤ 1 mm slices, no motion artefact)", "scanProtocol", "Yes"),
    ...(model
      ? [
          a("Patient contact", "patientContact", "None — not for use in the operating field"),
          a("Sterility", "sterility", "Non-sterile"),
          a("Scale", "scale", "1:1"),
          a("Design approval before printing", "designApproval", "Not required — printed from the approved segmentation"),
        ]
      : [
          a("Patient contact", "patientContact", product === "Splint" ? "Surface device — intact skin" : "External communicating — tissue / bone (intra-operative)"),
          a("Contact duration", "contactDuration", product === "Splint" ? "Prolonged (> 24 h to 30 days)" : "Limited (≤ 24 h)"),
          a("Sterility", "sterility", product === "Splint" ? "Non-sterile — clean, single patient" : "Sterile — hospital CSSD steam"),
          a("Patient-specific: for this patient only, not to be reused", "singlePatient", "Yes"),
          a("Design approval before printing", "designApproval", "Required — surgeon signs off the design"),
        ]),
    a("Approving surgeon", "designApprover", approver),
    a("Deliver to (OR / ward / clinic)", "deliverTo", model ? "Pre-operative clinic" : "Operating theatre"),
    a("Parent / guardian consent for use of the imaging data on file", "guardianConsent", "Yes"),
  ];
}

async function createResource(spaceId: string, seed: Seed): Promise<string> {
  const data = { ...seed.data };
  let opening: { lot: string; qty: number; supplier: string; expiry: string } | null = null;
  if (seed.kind === "packaging" || seed.kind === "components") {
    opening = { lot: String(data.lot || "OPENING"), qty: Number(data.stock ?? 0) || 0, supplier: String(data.supplier ?? ""), expiry: String(data.expiry ?? "") };
    for (const k of ["stock", "lot", "expiry", "supplier"]) delete data[k];
  }
  const resource = await db.resource.create({
    data: { spaceId, kind: seed.kind, name: seed.name, status: seed.status ?? "", data: data as Prisma.InputJsonObject },
  });
  for (const it of seed.items ?? []) {
    const due = it.due ?? (it.last && it.months ? addMonths(it.last, it.months) : undefined);
    const created = await db.scheduleItem.create({
      data: {
        resourceId: resource.id,
        track: it.track,
        name: it.name,
        dueOn: due ? day(due) : null,
        repeatMonths: it.months || null,
        lastDoneOn: it.last ? day(it.last) : null,
        lastResult: it.last ? (it.result ?? null) : null,
      },
    });
    if (it.last) {
      await db.scheduleRecord.create({
        data: {
          resourceId: resource.id,
          itemId: created.id,
          track: it.track,
          itemName: it.name,
          doneOn: day(it.last),
          doneBy: it.who ?? QA,
          result: it.result ?? null,
          ref: it.ref ?? null,
          recordedByName: "Sample data",
        },
      });
    }
  }
  if (opening) {
    await db.materialLot.create({
      data: {
        resourceId: resource.id,
        lotNumber: opening.lot,
        remaining: opening.qty,
        received: opening.qty,
        receivedOn: day("2026-08-01"),
        supplier: opening.supplier || null,
        expiresOn: /^\d{4}-\d{2}-\d{2}$/.test(opening.expiry) ? day(opening.expiry) : null,
      },
    });
  }
  for (const [lot, remaining, received, date, supplier, coa, expiry] of seed.lots ?? []) {
    await db.materialLot.create({
      data: { resourceId: resource.id, lotNumber: lot, remaining, received, receivedOn: day(date), supplier, coa, expiresOn: expiry ? day(expiry) : null },
    });
  }
  return resource.id;
}

async function main() {
  if (KEY.length !== 32) throw new Error("ENCRYPTION_KEY is missing or not 32 bytes. Fill in .env first.");
  const password = process.env.SUPER_ADMIN_PASSWORD ?? "";
  if (password.length < 10) throw new Error("Set SUPER_ADMIN_PASSWORD in .env first.");

  const space = await db.space.upsert({
    where: { slug: SLUG },
    update: { name: SPACE_NAME },
    create: { name: SPACE_NAME, slug: SLUG, adminEmail: ADMIN_EMAIL, roleMappings: { create: { platformRoleName: "Admin", role: "SPACE_ADMIN" } } },
  });
  const spaceId = space.id;
  const passwordHash = await hashPassword(password);
  await db.user.upsert({
    where: { spaceId_email: { spaceId, email: ADMIN_EMAIL } },
    update: { passwordHash, isActive: true, role: "SPACE_ADMIN", name: ADMIN },
    create: { spaceId, email: ADMIN_EMAIL, name: ADMIN, role: "SPACE_ADMIN", passwordHash },
  });
  await db.user.upsert({
    where: { spaceId_email: { spaceId, email: QA_EMAIL } },
    update: { passwordHash, isActive: true, name: QA },
    create: { spaceId, email: QA_EMAIL, name: QA, role: "MEMBER", passwordHash },
  });

  // Start from empty, so every run gives the same space.
  await db.part.deleteMany({ where: { spaceId } });
  await db.caseRecord.deleteMany({ where: { spaceId } });
  await db.grn.deleteMany({ where: { spaceId } });
  await db.resource.deleteMany({ where: { spaceId } });
  await db.technology.deleteMany({ where: { spaceId } });
  await db.partType.deleteMany({ where: { spaceId } });
  await db.partRequestSetup.deleteMany({ where: { spaceId } });
  await db.partRequestForm.deleteMany({ where: { spaceId } });
  await db.qaTemplate.deleteMany({ where: { spaceId } });
  await db.spaceSetting.deleteMany({ where: { spaceId } });

  const all = forms();
  // Checked as the app checks a form when it is saved.
  for (const form of all) {
    const parsed = templateSchema.safeParse(form);
    if (!parsed.success) throw new Error(`${form.name}: ${parsed.error.issues[0]?.message}`);
    const problem = templateProblem(form);
    if (problem) throw new Error(`${form.name}: ${problem}`);
  }
  await db.qaTemplate.createMany({
    data: all.map((t) => ({
      spaceId,
      name: t.name,
      code: t.code,
      clause: t.clause,
      issue: t.issue,
      effective: t.effective,
      rev: t.rev,
      docLayout: t.docLayout,
      attach: t.attach,
      sections: t.sections as unknown as Prisma.InputJsonValue,
      updatedByName: ADMIN,
    })),
  });
  await db.technology.create({ data: { spaceId, name: "3D Printing" } });
  await db.partType.createMany({ data: TYPES.map(([name, code]) => ({ spaceId, name, code })) });
  const requestFormDefs = requestForms(spaceId);
  {
    const parsed = formsSchema.safeParse({ rule: RULE, forms: requestFormDefs });
    if (!parsed.success) throw new Error(`Request forms: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
    const problem = formsProblem({ rule: RULE, forms: requestFormDefs });
    if (problem) throw new Error(`Request forms: ${problem}`);
  }
  for (const [position, form] of requestFormDefs.entries()) {
    await db.partRequestForm.create({
      data: { id: form.id, spaceId, name: form.name, description: form.description, isDefault: form.isDefault, position, sections: form.sections as unknown as Prisma.InputJsonValue, updatedByName: ADMIN },
    });
  }
  await db.partRequestSetup.create({
    data: { spaceId, idPrefix: RULE.prefix, idSeparator: RULE.sep, idTokens: RULE.tokens, idScope: "case-type", idWidth: 2, sections: defaultSections() as unknown as Prisma.InputJsonValue, updatedByName: ADMIN },
  });

  const ids = new Map<string, string>();
  for (const seed of [...VENDORS, ...MATERIALS]) ids.set(`${seed.kind}:${seed.name}`, await createResource(spaceId, seed));
  for (const seed of PRINTERS) {
    seed.data.materialId = ids.get(`materials:${String(seed.data.materialId)}`) ?? "";
    await createResource(spaceId, seed);
  }
  const flows = workflows(all);
  for (const wf of flows) {
    ids.set(
      `workflows:${wf.name}`,
      await createResource(spaceId, { kind: "workflows", name: wf.name, data: { method: "3D Printing", sourcing: "In-house", vendorId: "", stages: wf.stages } }),
    );
  }
  for (const seed of REGISTRIES) await createResource(spaceId, seed);
  for (const [key, vendorId] of ids) {
    if (!key.startsWith("vendors:")) continue;
    await db.materialLot.updateMany({ where: { resource: { spaceId }, supplier: key.slice("vendors:".length) }, data: { supplierId: vendorId } });
  }

  // --- Cases and their parts --------------------------------------------------------------------
  const typeCode = (name: string) => TYPES.find(([n]) => n === name)?.[1] ?? null;
  const seq = new Map<string, number>();
  let partCount = 0;
  for (const [id, product, scope, surgeon, patient, age, date, priority, status, state] of CASES) {
    const number = Number(id.slice(3));
    const [initial, ...rest] = patient.split(". ");
    const surgeryDate = new Date(`${date}T00:00:00+03:00`);
    const isArchived = state === "Archived";
    const record = await db.caseRecord.create({
      data: {
        spaceId,
        platformCaseId: number,
        caseNumber: id,
        caseNumberSort: caseSortKey(id),
        caseCode: `CASE-${number}`,
        productName: product,
        productCode: product.split(" ")[0].toUpperCase().slice(0, 6),
        scopeName: scope,
        caseStatus: status,
        caseState: state,
        isArchived,
        bucket: classifyCase({ caseStatus: status, caseState: state, isArchived }),
        surgeonName: surgeon,
        representativeName: "Maya Klein",
        hospitalName: SPACE_NAME,
        priority,
        patientNameEncrypted: encrypt(`${FIRST[initial] ?? initial} ${rest.join(". ")}`),
        patientAge: String(age),
        patientGender: number % 2 === 0 ? "Female" : "Male",
        surgeryDate,
        anticipatedShipDate: new Date(surgeryDate.getTime() - 3 * DAY_MS),
        platformCreatedAt: new Date(surgeryDate.getTime() - 21 * DAY_MS),
      },
    });

    for (const [name, workflowName, partType] of PARTS[product] ?? []) {
      const wf = flows.find((w) => w.name === workflowName)!;
      const stages = wf.stages;
      const at = Math.min(stageFor(status, stages.length), stages.length - 1);
      const requestedAt = new Date(surgeryDate.getTime() - 14 * DAY_MS);
      const key = `${id}|${partType}`;
      const sequence = (seq.get(key) ?? 0) + 1;
      seq.set(key, sequence);
      const partNumber = buildPartNumber(RULE, { caseNumber: id, partTypeCode: typeCode(partType), sequence, spaceName: SPACE_NAME, now: requestedAt });
      const mat = ROUTE[workflowName].material;
      await db.part.create({
        data: {
          spaceId,
          caseId: record.id,
          partNumber,
          sequence,
          name,
          quantity: 1,
          dueOn: new Date(surgeryDate.getTime() - 3 * DAY_MS),
          partType,
          priority,
          notes: partType === "Anatomical model" ? "For surgical planning and family counselling — not for use in the operating field." : "Patient-contact device — MED610, full traceability.",
          workflowId: ids.get(`workflows:${workflowName}`) ?? null,
          workflowName,
          stages: stages as unknown as Prisma.InputJsonValue,
          stageCount: stages.length,
          stageIndex: at,
          stageMeta: stages.map((_, i) =>
            i < at
              ? { assigneeId: null, assignee: TECH, due: null, by: TECH, at: new Date(requestedAt.getTime() + (i + 1) * DAY_MS).toISOString() }
              : { assigneeId: null, assignee: null, due: null, by: null, at: null },
          ),
          technology: "3D Printing",
          material: mat,
          printer: "Stratasys J5 Medijet",
          sourcing: "In-house",
          requestFormId: partType === "Anatomical model" ? `std-${spaceId}` : `psd-${spaceId}`,
          requestFormName: partType === "Anatomical model" ? "Anatomical model request" : "Patient-specific device request (guide / splint)",
          details: [
            ...requestAnswers(id, partType, product, surgeryDate),
            { label: "Feature", var: "request.dimensionalFeature", value: "Anatomy and fit" },
            { label: "Specification", var: "request.dimensionalSpecification", value: "As per approved design, ±0.2 mm" },
            { label: "Feature", var: "request.materialFeature", value: "Material" },
            { label: "Specification", var: "request.materialSpecification", value: mat },
          ],
          links: [],
          requestedByName: "Maya Klein",
          createdAt: requestedAt,
          activity: {
            create: [
              { title: "Part requested", detail: `${partNumber} · ${name} via ${workflowName}`, byName: "Maya Klein", createdAt: requestedAt },
              ...stages.slice(0, at).map((s, i) => ({
                title: "Advanced stage",
                detail: `${s.name} → ${stages[i + 1].name}`,
                byName: TECH,
                createdAt: new Date(requestedAt.getTime() + (i + 1) * DAY_MS),
              })),
            ],
          },
        },
      });
      partCount += 1;
    }
  }

  // Parts of no case: a training model and a print-validation coupon.
  const standalone: Array<[name: string, workflow: string, type: string, stage: number, due: string, qty: number, note: string]> = [
    ["Training heart model — residents' workshop", MODEL_WF, "Anatomical model", 2, "2026-10-21", 2, "Teaching use only."],
    ["MED610 test coupons — print validation", GUIDE_WF, "Test coupon", 3, "2026-10-15", 6, "Not for clinical use — process validation only."],
  ];
  for (const [name, workflowName, partType, at, due, qty, note] of standalone) {
    const stages = flows.find((w) => w.name === workflowName)!.stages;
    const requestedAt = new Date(day(due).getTime() - 7 * DAY_MS);
    const key = `none|${partType}`;
    const sequence = (seq.get(key) ?? 0) + 1;
    seq.set(key, sequence);
    const partNumber = buildPartNumber(RULE, { noCase: true, partTypeCode: typeCode(partType), sequence, spaceName: SPACE_NAME, now: requestedAt });
    await db.part.create({
      data: {
        spaceId,
        caseId: null,
        partNumber,
        sequence,
        name,
        quantity: qty,
        dueOn: day(due),
        partType,
        priority: "Low",
        notes: note,
        workflowId: ids.get(`workflows:${workflowName}`) ?? null,
        workflowName,
        stages: stages as unknown as Prisma.InputJsonValue,
        stageCount: stages.length,
        stageIndex: at,
        stageMeta: stages.map(() => ({ assigneeId: null, assignee: null, due: null, by: null, at: null })),
        technology: "3D Printing",
        material: ROUTE[workflowName].material,
        printer: "Stratasys J5 Medijet",
        sourcing: "In-house",
        details: [],
        links: [],
        requestedByName: ADMIN,
        createdAt: requestedAt,
        activity: { create: { title: "Part requested", detail: `${partNumber} · ${name} via ${workflowName}`, byName: ADMIN, createdAt: requestedAt } },
      },
    });
    partCount += 1;
  }

  // --- Goods receipts: closed, awaiting inspection, draft -------------------------------------------
  const vendor = (name: string) => ids.get(`vendors:${name}`) ?? null;
  const materialId = (name: string) => ids.get(`materials:${name}`) ?? null;
  const allPass = (n: number) => ({ n, res: Array(n).fill("Pass") });
  const medLot = await db.materialLot.findFirst({ where: { lotNumber: "MED610-2609-02", resource: { spaceId } } });
  const closed = await db.grn.create({
    data: {
      spaceId,
      number: "GRN-2026-0001",
      receivedOn: day("2026-09-08"),
      supplierId: vendor(SUPPLIER),
      supplierName: SUPPLIER,
      header: { po: "PO-SC-2026-044", invoice: "INV-PJ-31877", dn: "DN-PJ-0908", receivedBy: TECH, condition: "Packaging intact" },
      received: true,
      receivedAt: day("2026-09-08"),
      confirmedByName: TECH,
      createdByName: TECH,
      createdAt: day("2026-09-08"),
      lines: {
        create: {
          spaceId,
          position: 1,
          type: "material",
          itemId: materialId("MED610 (Biocompatible Clear)"),
          itemName: "MED610 (Biocompatible Clear)",
          lotNumber: "MED610-2609-02",
          quantity: 1,
          unit: "kg",
          expiresOn: day("2027-09-30"),
          coa: "CoA-MED610-78002",
          extra: {},
          tests: { m1: allPass(1), m2: allPass(1), m3: allPass(1), m4: allPass(1) },
          decision: "Accepted",
          inspectedByName: QA,
          inspectedAt: day("2026-09-09"),
          testSummary: "CoA review PASS (1/1) | Quantity check PASS (1/1) | Packaging & seals PASS (1/1) | Label check PASS (1/1)",
          resultId: medLot?.id ?? null,
          createdAt: day("2026-09-08"),
        },
      },
      log: {
        create: [
          { byName: TECH, text: "Receipt confirmed — 1 line sent to incoming inspection", createdAt: day("2026-09-08") },
          { byName: QA, text: "Line 1 accepted · MED610 (Biocompatible Clear) · released 1 kg to stock", createdAt: day("2026-09-09") },
        ],
      },
    },
  });
  if (medLot) await db.materialLot.update({ where: { id: medLot.id }, data: { grnId: closed.id, grnNumber: closed.number } });

  await db.grn.create({
    data: {
      spaceId,
      number: "GRN-2026-0002",
      receivedOn: day("2026-10-02"),
      supplierId: vendor(SUPPLIER),
      supplierName: SUPPLIER,
      header: { po: "PO-SC-2026-051", invoice: "INV-PJ-32210", dn: "DN-PJ-1002", receivedBy: TECH, condition: "Packaging intact" },
      received: true,
      receivedAt: day("2026-10-02"),
      confirmedByName: TECH,
      createdByName: TECH,
      createdAt: day("2026-10-02"),
      lines: {
        create: [
          { spaceId, position: 1, type: "material", itemId: materialId("VeroUltra WhiteS"), itemName: "VeroUltra WhiteS", lotNumber: "RM-2026-0001", supplierBatch: "VUW-2609-12", quantity: 4, unit: "kg", expiresOn: day("2027-09-30"), coa: "CoA-VUW-56002", extra: {}, tests: {} },
          { spaceId, position: 2, type: "material", itemId: materialId("SUP706B Support"), itemName: "SUP706B Support", lotNumber: "RM-2026-0002", supplierBatch: "SUP706-2609-30", quantity: 8, unit: "kg", expiresOn: day("2027-09-30"), coa: "CoA-SUP-90877", extra: {}, tests: {} },
        ],
      },
      log: { create: { byName: TECH, text: "Receipt confirmed — 2 lines sent to incoming inspection", createdAt: day("2026-10-02") } },
    },
  });

  await db.grn.create({
    data: {
      spaceId,
      number: "GRN-2026-0003",
      receivedOn: day("2026-10-05"),
      supplierId: vendor("MedPack Israel Ltd."),
      supplierName: "MedPack Israel Ltd.",
      header: { po: "PO-SC-2026-053", dn: "DN-MP-1005", receivedBy: "Dana Weiss", condition: "Packaging intact" },
      createdByName: "Dana Weiss",
      createdAt: day("2026-10-05"),
      log: { create: { byName: "Dana Weiss", text: "Draft receipt started", createdAt: day("2026-10-05") } },
    },
  });

  // Cases are managed here, not synced: products, case forms, and the cases above as opened here.
  console.log(`Cases: ${await setupSchneiderCases(db, spaceId)}.`);
  console.log(`Sample cases: ${await replaceSampleCases(db, spaceId)}.`);
  // Its one QA form for now: the incoming medical file (DICOM), on the Customer requirement stage.
  console.log(`QA: ${await setupDicomForm(db, spaceId)}.`);
  console.log(`QA: ${await setupSynergyForms(db, spaceId)}.`);
  console.log(`Production: ${await setupProductionWorkflows(db, spaceId)}.`);
  console.log(`Products: ${await setupProductsFromOrthognathic(db, spaceId)}.`);
  console.log(`Sites: ${await setupSites(db, spaceId)}.`);
  console.log(`Orders: ${await setupOrders(db, spaceId)}.`);

  const base = process.env.BASE_DOMAIN || "localhost";
  console.log(`${SPACE_NAME}: ${all.length} QA forms, ${flows.length} workflows, ${VENDORS.length + MATERIALS.length + PRINTERS.length + REGISTRIES.length} master-data records, ${CASES.length} cases, ${partCount} parts, 3 goods receipts.`);
  console.log(`Sign in at http://${SLUG}.${base}:3100 as ${ADMIN_EMAIL} (admin) or ${QA_EMAIL} (QA), with the SUPER_ADMIN_PASSWORD from .env.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
