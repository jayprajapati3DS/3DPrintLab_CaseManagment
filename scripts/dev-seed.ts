import "dotenv/config";

import { createCipheriv, randomBytes, randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";

import { hashPassword } from "../src/lib/auth/password";
import { classifyCase } from "../src/lib/cases/classify";
import { caseSortKey } from "../src/lib/cases/sort-key";
import { buildPartNumber, defaultRule, DEFAULT_BALLOON_COLUMNS } from "../src/lib/parts/request-form";
import { standardTemplates } from "../src/lib/qa/template";
import type { ResourceKind, Track, WorkflowStage } from "../src/lib/resources/config";
import { addMonths } from "../src/lib/resources/status";

/**
 * A demo space filled with the design's sample data: cases and their parts,
 * workflows, machines, materials, suppliers and the equipment registries — so every
 * screen can be seen with something in it, without a platform connection.
 *
 *   npm run seed:dev
 *
 * It creates a space of its own (`demo`) and only ever touches that space,
 * replacing its contents on each run. Real company spaces are never read or
 * written. Sign in at http://demo.localhost:3100 as demo@3dsurgical.example,
 * with the same password as the super admin in .env.
 *
 * Refuses to run in production.
 */

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed sample data with NODE_ENV=production.");
  process.exit(1);
}

const SLUG = "demo";
const ADMIN_EMAIL = "demo@3dsurgical.example";
const QA = "Dr. Meera Iyer (QA)";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

// Same format as src/lib/crypto.ts, which cannot be imported here because it
// pulls in the full environment contract.
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
// Master data
// ---------------------------------------------------------------------------

interface Item {
  track: Track;
  name: string;
  last?: string;
  months?: number;
  /** Set explicitly when it is not simply last + months. */
  due?: string;
  who?: string;
  ref?: string;
  note?: string;
  result?: string;
}

interface Extra {
  track: Track;
  name: string;
  on: string;
  who: string;
  note: string;
  /** Opens a change-control review. */
  review?: boolean;
}

interface Seed {
  kind: ResourceKind;
  name: string;
  status?: string;
  data: Record<string, unknown>;
  items?: Item[];
  /** Records that belong to no scheduled item: a breakdown, a software update. */
  extras?: Extra[];
  lots?: Array<[lot: string, remaining: number, received: number, date: string, supplier: string, coa: string, expiry: string | null]>;
  archived?: { on: string; by: string; reason: string; deletion?: { on: string; by: string; reason: string } };
}

const maint = (name: string, last: string | undefined, months: number | undefined, who?: string, note?: string): Item => ({
  track: "maintenance",
  name,
  last,
  months,
  who,
  note,
});
const qual = (name: string, last: string | undefined, months: number | undefined, who = QA, ref?: string): Item => ({
  track: "qualification",
  name,
  last,
  months,
  who,
  ref,
  result: last ? "Pass" : undefined,
});

const stage = (
  name: string,
  role: string,
  days: number,
  forms: string[] = [],
  extra: Partial<WorkflowStage> = {},
): WorkflowStage => ({
  id: randomUUID(),
  name,
  role,
  days,
  forms,
  emailsNext: [],
  emailsBack: [],
  tasks: [],
  ...extra,
});
const QC = { emailsNext: ["Part ready for QC"], emailsBack: ["Rework required — notify engineer"] };
const START = { emailsNext: ["Stage started — notify owner"] };
const DISPATCH = { emailsNext: ["Part dispatched — notify customer"] };
const QAC = ["QAC (JM-F-DND-004)"];

const workflow = (name: string, method: string, stages: WorkflowStage[], outsourced = false): Seed => ({
  kind: "workflows",
  name,
  data: { method, sourcing: outsourced ? "Outsourced" : "In-house", vendorId: "", stages },
});

const WORKFLOWS: Seed[] = [
  workflow("Titanium Implant — DMLS", "3D Printing", [
    stage("Request received", "Manufacturing", 1, QAC, START),
    stage("Design prep & nesting", "Engineer", 2, [], {
      tasks: [
        { name: "Verify design sign-off", days: 1 },
        { name: "Prepare build file", days: 2 },
      ],
    }),
    stage("Build queued", "Manufacturing", 1),
    stage("Printing (DMLS)", "Manufacturing", 2, ["Build inspection checklist"]),
    stage("Heat treatment & depowdering", "Manufacturing", 1),
    stage("Support removal & finishing", "Manufacturing", 1, ["Post-processing record"]),
    stage("Inspection & QC", "Quality", 1, ["Dimensional QC report"], QC),
    stage("Cleaning & sterilization", "Quality", 1, ["Cleaning & sterilization record"]),
    stage("Packaging & dispatch", "Logistics", 1, ["Labelling & packaging check"], DISPATCH),
  ]),
  workflow("Surgical Guide / Jig — SLA Resin", "3D Printing", [
    stage("Request received", "Manufacturing", 1, QAC, START),
    stage("Design prep", "Engineer", 2),
    stage("Build queued", "Manufacturing", 1),
    stage("Printing (SLA)", "Manufacturing", 2, ["Build inspection checklist"]),
    stage("Washing & post-cure", "Manufacturing", 1),
    stage("Support removal", "Manufacturing", 1),
    stage("QC inspection", "Quality", 1, ["Dimensional QC report"], QC),
    stage("Packaging & dispatch", "Logistics", 1, ["Labelling & packaging check"], DISPATCH),
  ]),
  workflow("Model / Prototype — SLS (PA12)", "3D Printing", [
    stage("Request received", "Manufacturing", 1, QAC, START),
    stage("Segmentation check", "Engineer", 2),
    stage("Build queued", "Manufacturing", 1),
    stage("Printing (SLS)", "Manufacturing", 2),
    stage("Depowdering & cleaning", "Manufacturing", 1),
    stage("Visual QC", "Quality", 1, ["Final release record"], QC),
    stage("Packaging & dispatch", "Logistics", 1, [], DISPATCH),
  ]),
  workflow("Model / Prototype — FDM", "3D Printing", [
    stage("Request received", "Manufacturing", 1, QAC, START),
    stage("Slicing & build prep", "Engineer", 2, [], { tasks: [{ name: "Slice with PPS-FDM-PETG-01", days: 1 }] }),
    stage("Printing (FDM)", "Manufacturing", 2, ["Polymer build record"]),
    stage("Support removal & cleanup", "Manufacturing", 1),
    stage("Visual QC", "Quality", 1, ["Final inspection"], QC),
    stage("Packaging & dispatch", "Logistics", 1, [], DISPATCH),
  ]),
  workflow(
    "PEEK Implant — CNC",
    "CNC Machining",
    [
      stage("Request received", "Manufacturing", 1, QAC, START),
      stage("CAM programming", "Engineer", 2),
      stage("Sent to vendor", "Logistics", 1),
      stage("Machining at vendor", "Manufacturing", 2),
      stage("Incoming inspection", "Quality", 1, ["Dimensional QC report"], QC),
      stage("Cleaning & sterilization", "Quality", 1, ["Cleaning & sterilization record"]),
      stage("Packaging & dispatch", "Logistics", 1, [], DISPATCH),
    ],
    true,
  ),
];

/** A machine: identity, then its qualification and maintenance history. */
function printer(
  name: string,
  tech: string,
  process: string,
  material: string,
  volume: string,
  status: string,
  assetId: string,
  maker: string,
  model: string,
  serial: string,
  location: string,
  commissioned: string,
  q: { iq: string; oq: string; pq: string | null; qualified: string | null; requal: number; pmLast: string; pm: number; service: string },
  cals: Array<[name: string, last: string, months: number]>,
  extras: Extra[] = [],
): Seed {
  return {
    kind: "printers",
    name,
    status,
    // `material` is a name here; it is turned into the material's id once the
    // materials exist.
    data: { assetId, serial, maker, model, location, tech, process, materialId: material, volume, commissioned },
    items: [
      { ...qual("IQ — Installation qualification", commissioned, undefined, QA, q.iq) },
      // Without a qualification date there is nothing to count the next one from.
      q.qualified
        ? qual("OQ — Operational qualification", q.qualified, q.requal, QA, q.oq)
        : qual("OQ — Operational qualification", undefined, q.requal),
      q.pq && q.qualified
        ? qual("PQ — Performance qualification", q.qualified, q.requal, QA, q.pq)
        : qual("PQ — Performance qualification", undefined, q.requal),
      maint("Preventive maintenance", q.pmLast, q.pm, q.service),
      ...cals.map(([calName, last, months]) => maint(calName, last, months, q.service)),
    ],
    extras,
  };
}

const PRINTERS: Seed[] = [
  printer(
    "EOS M 290", "DMLS", "3D Printing", "Ti-6Al-4V ELI", "250 × 250 × 325 mm", "Available", "PR-DMLS-01", "EOS GmbH", "EOS M 290", "M290-2140", "Metal AM room", "2023-04-12",
    { iq: "IQ-DMLS-2023-01", oq: "OQ-DMLS-2023-01", pq: "PQ-DMLS-2025-03", qualified: "2025-10-01", requal: 12, pmLast: "2026-07-15", pm: 3, service: "EOS India service" },
    [
      ["Laser power calibration", "2026-04-10", 6],
      ["Recoater blade inspection", "2026-09-01", 1],
      ["Inert gas filter replacement", "2026-07-15", 3],
      ["Scanner / optics alignment", "2025-10-05", 12],
      ["O₂ sensor calibration", "2026-06-01", 6],
    ],
    [
      { track: "maintenance", name: "Software update", on: "2026-09-02", who: "EOS India service", note: "EOSPRINT 2.14 → 2.16 and machine firmware update", review: true },
      { track: "maintenance", name: "Breakdown / repair", on: "2026-05-22", who: "Ravi Patel", note: "Recoater blade crash during build — blade replaced (TL-RB-07); test coupon build and visual check passed, verified by Neha Shah (QC)" },
    ],
  ),
  printer(
    "Formlabs Form 3B+", "SLA", "3D Printing", "BioMed Clear Resin", "145 × 145 × 185 mm", "Available", "PR-SLA-01", "Formlabs", "Form 3B+", "F3B-88421", "Polymer lab", "2024-01-20",
    { iq: "IQ-SLA-2024-01", oq: "OQ-SLA-2024-01", pq: "PQ-SLA-2025-01", qualified: "2025-11-12", requal: 12, pmLast: "2026-06-01", pm: 6, service: "In-house" },
    [["Galvo / laser calibration", "2026-03-15", 12]],
  ),
  printer(
    "HP Jet Fusion 5200", "MJF", "3D Printing", "PA12 Nylon", "380 × 284 × 380 mm", "Maintenance", "PR-MJF-01", "HP", "Jet Fusion 5200", "HP5200-3319", "Polymer lab", "2024-06-05",
    { iq: "IQ-MJF-2024-01", oq: "OQ-MJF-2026-01", pq: null, qualified: null, requal: 12, pmLast: "2026-03-10", pm: 6, service: "HP service partner" },
    [["Thermal camera calibration", "2025-08-20", 12]],
    [{ track: "maintenance", name: "Breakdown / repair", on: "2026-09-20", who: "HP service partner", note: "Printhead failure — replacement ordered, machine on hold" }],
  ),
  printer(
    "EOS Formiga P 110", "SLS", "3D Printing", "PA12 Nylon", "200 × 250 × 330 mm", "Available", "PR-SLS-01", "EOS GmbH", "Formiga P 110", "P110-7765", "Polymer lab", "2024-09-10",
    { iq: "IQ-SLS-2024-01", oq: "OQ-SLS-2025-02", pq: "PQ-SLS-2025-02", qualified: "2025-12-02", requal: 24, pmLast: "2026-08-05", pm: 6, service: "EOS India service" },
    [
      ["Laser power calibration", "2026-02-10", 12],
      ["Bed temperature sensor", "2026-02-01", 12],
    ],
  ),
  printer(
    "Ultimaker S5", "FDM", "3D Printing", "PLA / PETG", "330 × 240 × 300 mm", "In use", "PR-FDM-01", "UltiMaker", "S5", "S5-102938", "Model lab", "2025-01-15",
    { iq: "IQ-FDM-2025-01", oq: "OQ-FDM-2026-01", pq: null, qualified: "2026-01-15", requal: 24, pmLast: "2026-06-20", pm: 3, service: "In-house" },
    [["Bed levelling / XY calibration", "2026-08-01", 3]],
  ),
  printer(
    "Haas VF-2 CNC", "Billet", "CNC Machining", "PEEK-OPTIMA", "760 × 410 × 510 mm", "Available", "MC-CNC-01", "Haas", "VF-2", "VF2-55120", "Machine shop", "2022-11-01",
    { iq: "IQ-CNC-2022-01", oq: "OQ-CNC-2023-01", pq: "PQ-CNC-2023-02", qualified: "2024-11-01", requal: 24, pmLast: "2026-05-10", pm: 6, service: "Haas Factory Outlet" },
    [["Ballbar / axis accuracy", "2025-11-10", 12]],
  ),
  {
    kind: "printers",
    name: "Formlabs Form 2",
    status: "Out of service",
    data: { assetId: "PR-SLA-00", serial: "F2-11873", maker: "Formlabs", model: "Form 2", location: "Polymer lab (removed)", tech: "SLA", process: "3D Printing", materialId: "", volume: "", commissioned: "2021-06-10" },
    items: [qual("OQ — Operational qualification", "2021-07-02", 12)],
    archived: { on: "2026-03-15", by: "Ravi Patel", reason: "Decommissioned — replaced by Form 3B+" },
  },
];

/** A material, with the qualification every one has and the extra ones by grade. */
function material(
  name: string,
  process: string,
  tech: string,
  grade: string,
  use: string,
  unit: string,
  threshold: number,
  color: string,
  lots: Seed["lots"],
  powderLast = "2026-04-02",
): Seed {
  const id = name.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase();
  const implant = /implant|10993/i.test(use);
  return {
    kind: "materials",
    name,
    data: { process, tech, grade, use, unit, threshold: String(threshold), color },
    lots,
    items: [
      qual(
        implant ? "Material qualification & biocompatibility (ISO 10993-1)" : "Material qualification (datasheet, CoA, fitness for use)",
        "2025-11-10",
        36,
        QA,
        `MQ-${grade === "Metal" ? "MET" : "POL"}-2025-${id}`,
      ),
      ...(grade === "Metal" ? [qual("Powder chemistry & reuse testing (ASTM F3001 / F2924)", powderLast, 6, QA, `MQ-MET-2026-${id}`)] : []),
      ...(grade === "Resin" ? [qual("Post-cure verification (per resin lot)", "2026-08-05", 12, QA, `MQ-POL-2026-${id}`)] : []),
    ],
  };
}

const MATERIALS: Seed[] = [
  material("Ti-6Al-4V ELI", "3D Printing", "DMLS", "Metal", "Implantable (ISO 10993)", "kg", 2, "#6B7785", [
    ["TI64-2406-A", 2.4, 5, "2026-06-08", "Precision AddCorp", "CoA-TI-88213", "2028-06-30"],
    ["TI64-2407-B", 0.3, 5, "2026-07-14", "Precision AddCorp", "CoA-TI-88540", "2028-07-31"],
  ]),
  material("BioMed Clear Resin", "3D Printing", "SLA", "Resin", "Surgical guides (short contact)", "L", 1, "#2A9D8F", [
    ["BMC-2408-01", 3.2, 4, "2026-08-02", "BioForm Labs", "CoA-BMC-1172", "2027-08-31"],
  ]),
  material("PA12 Nylon", "3D Printing", "SLS", "Polymer", "Anatomical models", "kg", 3, "#9B59B6", [
    ["PA12-2407-11", 6.8, 10, "2026-07-20", "BioForm Labs", "CoA-PA-5530", "2027-12-31"],
  ]),
  material("PLA / PETG", "3D Printing", "FDM", "Polymer", "Anatomical models, jigs (non-sterile)", "spool", 2, "#C98A2E", [
    ["PLA-2409-03", 3.7, 6, "2026-09-01", "Local distributor", "CoA-PLA-0903", null],
    ["PETG-2408-01", 2, 3, "2026-08-12", "Local distributor", "CoA-PETG-0812", null],
  ]),
  material(
    "CoCr (ASTM F75)", "3D Printing", "DMLS", "Metal", "Dental frameworks (ISO 10993)", "kg", 1, "#98A2B3",
    [["COCR-2605-02", 1.6, 3, "2026-05-04", "TitanPowder Metals", "CoA-CC-4410", "2028-05-31"]],
    "2026-02-20",
  ),
  material("PEEK-OPTIMA", "CNC Machining", "Billet", "Polymer", "Implantable (ISO 10993)", "kg", 1, "#C98A2E", [
    ["PEEK-2405-7", 0.8, 2, "2026-05-18", "MedMill CNC", "CoA-PK-2210", "2029-05-31"],
  ]),
  {
    kind: "materials",
    name: "Vero PureWhite (trial)",
    data: { process: "3D Printing", tech: "PolyJet", grade: "Resin", use: "Evaluation", unit: "kg", threshold: "1", color: "#98A2B3" },
    lots: [["VPW-2507-T", 0.4, 1, "2025-07-10", "Local distributor", "CoA-VPW-001", "2026-07-31"]],
    archived: {
      on: "2025-12-01",
      by: "Ravi Patel",
      reason: "Trial only — never qualified",
      deletion: { on: "2026-09-20", by: "Ravi Patel", reason: "Trial material, no parts produced — no record retention needed" },
    },
  },
];

function vendor(
  kind: string,
  name: string,
  contact: string,
  specialty: string,
  location: string,
  lead: number,
  status: string,
  evaluated: string | null,
  audited?: string,
): Seed {
  const ref = (year: string) => `SE-${year}-${name.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase()}`;
  return {
    kind: "vendors",
    name,
    status,
    data: { kind, specialty, location, contact, lead: String(lead) },
    items: evaluated
      ? [
          qual("Supplier re-evaluation (ISO 13485 §7.4.1)", evaluated, 12, QA, ref(evaluated.slice(0, 4))),
          ...(audited ? [qual("On-site supplier audit", audited, 24, QA, ref(audited.slice(0, 4)))] : []),
          qual("Quality agreement / ISO 13485 certificate check", evaluated, 12, QA, ref(evaluated.slice(0, 4))),
        ]
      : [{ track: "qualification", name: "Initial supplier evaluation (ISO 13485 §7.4.1)", due: "2026-10-20", months: 12 }],
  };
}

const VENDORS: Seed[] = [
  vendor("Outsourced manufacturing", "Precision AddCorp", "orders@precisionadd.example", "Metal DMLS · Ti / CoCr", "Pune, MH", 8, "Approved", "2025-10-15", "2025-06-10"),
  vendor("Outsourced manufacturing", "BioForm Labs", "production@bioform.example", "SLA / SLS polymers", "Bengaluru, KA", 5, "Approved", "2026-02-12", "2025-06-10"),
  vendor("Outsourced manufacturing", "MedMill CNC", "jobs@medmill.example", "CNC · PEEK / 316L", "Ahmedabad, GJ", 6, "Approved", "2025-08-20", "2024-06-12"),
  vendor("Outsourced manufacturing", "RapidCast Inc", "hello@rapidcast.example", "Cast urethane · models", "Chennai, TN", 4, "Trial", null),
  vendor("Raw material supplier", "TitanPowder Metals", "sales@titanpowder.example", "Ti-6Al-4V ELI powder (ASTM F3001)", "Hyderabad, TS", 21, "Approved", "2025-09-05"),
  vendor("Component supplier", "Orthomed Components", "orders@orthomed.example", "Bone screws, K-wires", "Rajkot, GJ", 10, "Approved", "2026-03-18"),
  vendor("Calibration lab", "NABL lab — Vadodara", "cal@nabllab.example", "Dimensional calibration (NABL)", "Vadodara, GJ", 7, "Approved", "2026-01-09"),
  vendor("Sterilization contractor", "SteriCare Services", "ops@stericare.example", "EtO sterilization (ISO 11135)", "Ahmedabad, GJ", 5, "Approved", "2026-01-15"),
  vendor("Packaging supplier", "FlexiPack Medical", "orders@flexipack.example", "Sterile barrier pouches (ISO 11607)", "Mumbai, MH", 14, "Approved", "2026-01-15"),
];

const row = (kind: ResourceKind, name: string, status: string, data: Record<string, unknown>, items: Item[] = []): Seed => ({
  kind,
  name,
  status,
  data,
  items,
});

const REGISTRIES: Seed[] = [
  // --- Measuring equipment ------------------------------------------------------
  ...(
    [
      ["Zeiss Contura CMM", "QC-CMM-01", "CMM", "QC lab", "700 × 700 × 600 mm", "±1.8 µm", "2025-11-12", 12, "OEM calibration service", "ZM-25-11871", "In service"],
      ["Creaform HandySCAN", "QC-SCN-01", "3D scanner", "QC lab", "0.05–4 m", "0.025 mm", "2025-10-08", 12, "OEM calibration service", "CF-5540", "In service"],
      ["Mitutoyo digital caliper 150 mm", "QC-CAL-04", "Caliper", "Finishing bay", "0–150 mm", "0.01 mm", "2026-03-20", 6, "NABL lab — Vadodara", "NB-26-0312", "In service"],
      ["Mitutoyo outside micrometer", "QC-MIC-02", "Micrometer", "QC lab", "0–25 mm", "0.001 mm", "2026-04-15", 12, "NABL lab — Vadodara", "NB-26-0444", "In service"],
      ["Surface roughness tester SJ-210", "QC-RA-01", "Surface roughness tester", "QC lab", "Ra 0.02–100 µm", "0.001 µm", "2025-09-01", 12, "OEM calibration service", "MT-25-2201", "Quarantined"],
    ] as const
  ).map(([name, assetId, kind, location, range, resolution, last, months, calLab, certNo, status]) =>
    row("measuring", name, status, { assetId, kind, location, range, resolution }, [
      // The lab and certificate live on the calibration record, not the item.
      { ...maint("Calibration", last, months, calLab), ref: certNo },
    ]),
  ),

  // --- Post-processing equipment --------------------------------------------------
  ...(
    [
      ["Nabertherm vacuum furnace", "PP-FUR-01", "Heat treatment furnace", "Ti-6Al-4V stress relief", "250 × 250 × 400 mm", "VAL-HT-003", "2026-06-10", 6, "2025-07-20", 24, "Available", "Heat treatment & depowdering"],
      ["Sodick wire EDM", "PP-EDM-01", "Wire EDM", "Part removal from build plate", "400 × 300 × 250 mm", "VAL-EDM-001", "2026-03-02", 6, "2025-02-10", 24, "In use", "Support removal & finishing"],
      ["Glass bead blaster", "PP-BLS-01", "Bead / sand blaster", "Metal surface finishing", "Cabinet 900 mm", "VAL-BB-002", "2026-08-01", 3, "2024-11-05", 24, "Available", "Support removal & finishing; Depowdering & cleaning"],
      ["Elmasonic ultrasonic cleaner", "PP-USC-01", "Ultrasonic cleaner", "Final cleaning before packaging", "28 L", "VAL-CLN-004", "2026-05-15", 6, "2025-09-01", 12, "Available", "Cleaning & sterilization; Depowdering & cleaning"],
      ["Form Cure UV station", "PP-UV-01", "UV post-cure", "SLA resin guides & models", "Ø 140 × 185 mm", "VAL-UV-001", "2026-01-20", 12, "2025-04-15", 24, "Available", "Washing & post-cure"],
    ] as const
  ).map(([name, assetId, kind, usedFor, capacity, validation, pmLast, pm, valDate, reval, status, usedStages]) =>
    row("postproc", name, status, { assetId, kind, usedFor, capacity, usedStages }, [
      maint("Preventive maintenance", pmLast, pm, "In-house"),
      qual("Qualification (IQ / OQ / PQ)", valDate, reval, QA, validation),
    ]),
  ),

  // --- Sterilization cycles ---------------------------------------------------------
  ...(
    [
      ["Steam prevacuum 134 °C", "STE-PV-134", "Steam — prevacuum", "In-house", "Tuttnauer 3870 ELV", "134 °C · 4 min · 3 pulses · 20 min dry", "ISO 17665:2024", "G. stearothermophilus BI + Class 5 CI", "VR-STE-2025-02", "2025-10-20", 12, "Validated"],
      ["Steam prevacuum 121 °C (polymer guides)", "STE-PV-121", "Steam — prevacuum", "In-house", "Tuttnauer 3870 ELV", "121 °C · 20 min · 3 pulses", "ISO 17665:2024", "G. stearothermophilus BI", "VR-STE-2025-03", "2025-11-05", 12, "Validated"],
      ["EtO — contract", "STE-ETO-01", "Ethylene oxide (EtO)", "Contract sterilizer", "SteriCare Services, Ahmedabad", "55 °C · 60% RH · 4 h exposure · 12 h aeration", "ISO 11135:2014", "B. atrophaeus BI", "VR-ETO-2024-01", "2024-12-01", 24, "Validated"],
      ["Gamma 25 kGy — contract", "STE-GAM-25", "Gamma irradiation", "Contract sterilizer", "Contract gamma facility — Mumbai", "25 kGy minimum dose", "ISO 11137-2", "Dosimeters", "", "", 12, "In validation"],
    ] as const
  ).map(([name, code, method, provider, equipment, params, standard, bi, validation, last, months, status]) =>
    row("steril", name, status, { code, method, provider, equipment, params, sal: "10⁻⁶", standard, bi }, [
      qual("Cycle revalidation (ISO 17665 / 11135)", last || undefined, months, QA, validation || undefined),
    ]),
  ),

  // --- Standard components ----------------------------------------------------------
  ...(
    [
      ["Cortical screw Ø2.0 mm self-tapping", "SCR-20-06", "Bone screw", "Ø2.0 × 6 mm", "Ti-6Al-4V ELI", "Orthomed Components", "OM-2608-114", "Non-sterile", 240, 100],
      ["Cortical screw Ø2.0 mm self-tapping", "SCR-20-08", "Bone screw", "Ø2.0 × 8 mm", "Ti-6Al-4V ELI", "Orthomed Components", "OM-2608-115", "Non-sterile", 64, 100],
      ["Locking screw Ø2.3 mm", "LSC-23-10", "Locking screw", "Ø2.3 × 10 mm", "Ti-6Al-4V ELI", "Orthomed Components", "OM-2607-092", "Non-sterile", 180, 80],
      ["Metal drill sleeve Ø2.0", "DSL-20-12", "Drill sleeve", "ID 2.05 × 12 mm", "SS 316L", "Precision Sleeves Pvt Ltd", "PS-2605-031", "Non-sterile", 35, 40],
      ["K-wire Ø1.2 mm", "KW-12-150", "Guide pin / K-wire", "Ø1.2 × 150 mm", "SS 316L", "Orthomed Components", "OM-2606-077", "Sterile", 90, 50],
    ] as const
  ).map(([name, partNo, category, size, mat, supplier, lot, sterile, stock, reorder]) =>
    row("components", name, "Active", { partNo, category, size, material: mat, supplier, lot, sterile, stock: String(stock), reorder: String(reorder), udi: "" }),
  ),

  // --- Tooling & fixtures -------------------------------------------------------------
  ...(
    [
      ["Ti build plate 250 mm #1", "TL-BP-01", "Build plate", "EOS M 290", "Ti-6Al-4V", "Printer room rack A", "builds", "40", "31", "In use"],
      ["Ti build plate 250 mm #2", "TL-BP-02", "Build plate", "EOS M 290", "Ti-6Al-4V", "Printer room rack A", "builds", "40", "40", "Needs regrind / resurface"],
      ["HSS recoater blade", "TL-RB-07", "Recoater blade", "EOS M 290", "HSS", "Consumables cabinet", "builds", "15", "6", "In use"],
      ["Carbide end mill Ø6 — PEEK", "TL-EM-06", "CNC cutter / end mill", "Haas VF-2 CNC", "Carbide", "CNC tool crib", "hours", "30", "12", "Available"],
      ["Cranial plate CMM fixture", "TL-FX-03", "Inspection fixture", "Zeiss Contura CMM", "Aluminium", "QC lab", "cycles", "", "", "Available"],
    ] as const
  ).map(([name, toolId, kind, usedOn, mat, location, lifeUnit, lifeLimit, used, status]) =>
    row("tooling", name, status, { toolId, kind, usedOn, material: mat, location, lifeUnit, lifeLimit, used }),
  ),

  // --- Software -------------------------------------------------------------------------
  ...(
    [
      ["MySegmenter", "MySegmenter Technology", "Segmentation", "3.2.0", "3.2.0", "SV-SEG-2026-01", "2026-02-10", 12, "6 seats", "Validated"],
      ["3-matic", "Materialise", "Implant / guide design", "18.0", "18.0", "SV-CAD-2025-04", "2025-09-15", 12, "3 seats", "Validated"],
      ["Magics", "Materialise", "Build preparation / slicer", "27.0", "28.0", "SV-BP-2025-02", "2025-06-01", 12, "2 seats", "Validation pending"],
      ["Fusion CAM", "Autodesk", "CAM programming", "2.0.19", "2.0.19", "SV-CAM-2026-01", "2026-01-12", 12, "1 seat", "Validated"],
      ["Calypso", "Zeiss", "Inspection / metrology", "2024", "2024", "SV-MET-2025-01", "2025-11-20", 24, "1 seat", "Validated"],
    ] as const
  ).map(([name, vendorName, purpose, version, installed, validation, on, months, licence, status]) =>
    row("software", name, status, { vendor: vendorName, purpose, version, installed, licence }, [
      qual("Software validation / periodic review", on, months, QA, validation),
    ]),
  ),

  // --- Process parameter sets -----------------------------------------------------------
  ...(
    [
      ["Ti-6Al-4V ELI — implants 30 µm", "PPS-DMLS-TI-01 rev B", "DMLS / LPBF", "EOS M 290", "Ti-6Al-4V ELI", "30 µm", "280 W · 1200 mm/s · 140 µm hatch", "PQ-DMLS-2025-03", "2025-10-01", 12, "Validated"],
      ["BioMed Clear — surgical guides", "PPS-SLA-BMC-01 rev A", "SLA", "Formlabs Form 3B+", "BioMed Clear Resin", "100 µm", "Default BMC profile · 60 min UV cure @ 60 °C", "PQ-SLA-2025-01", "2025-08-12", 12, "Validated"],
      ["PETG / PLA — anatomical models", "PPS-FDM-PETG-01 rev A", "FDM", "Ultimaker S5", "PLA / PETG", "180 µm", "0.4 mm nozzle · 240 °C · bed 80 °C · 20% gyroid", "OQ-FDM-2026-01", "2026-01-15", 24, "Validated"],
      ["PA12 — SLS prototypes", "PPS-SLS-PA12-01 rev A", "SLS", "EOS Formiga P 110", "PA12 Nylon", "100 µm", "Balanced · 50% refresh · 172 °C bed", "OQ-SLS-2025-02", "2025-12-02", 24, "Validated"],
      ["PA12 — anatomical models", "PPS-MJF-PA12-01", "MJF", "HP Jet Fusion 5200", "PA12 Nylon", "80 µm", "Balanced mode · 20% refresh", "OQ-MJF-2026-01", "", 12, "In validation"],
      ["CoCr — dental frameworks 20 µm", "PPS-DMLS-COCR-01 rev A", "DMLS / LPBF", "EOS M 290", "CoCr (ASTM F75)", "20 µm", "195 W · 800 mm/s · 100 µm hatch", "OQ-DMLS-2023-02", "2023-09-14", 24, "Validated"],
      ["PEEK-OPTIMA — implant milling", "PPS-CNC-PEEK-01 rev A", "CNC milling", "Haas VF-2 CNC", "PEEK-OPTIMA", "", "12 000 rpm · 0.05 mm finishing step · dry cut", "PQ-CNC-2024-03", "2024-06-20", 36, "Validated"],
      ["Stress relief Ti-6Al-4V", "PPS-HT-TI-01", "Heat treatment", "Nabertherm vacuum furnace", "Ti-6Al-4V ELI", "", "800 °C · 2 h · vacuum · furnace cool", "VAL-HT-003", "2025-07-20", 24, "Validated"],
    ] as const
  ).map(([name, code, process, machine, mat, layer, keyParams, validation, on, months, status]) =>
    row("params", name, status, { code, process, machine, material: mat, layer, keyParams }, [
      qual("Process validation / revalidation (IQ/OQ/PQ)", on || undefined, months, QA, validation),
    ]),
  ),

  // --- Operator qualifications -------------------------------------------------------------
  ...(
    [
      ["Ravi Patel", "JM-E014", "Manufacturing operator", "EOS M 290, wire EDM, heat treatment", "TR-2025-031", "Production manager", "2025-11-02", 12, "Qualified"],
      ["Neha Shah", "JM-E022", "QC inspector", "CMM, 3D scanner, final inspection", "TR-2025-044", "Quality manager", "2025-10-10", 12, "Qualified"],
      ["Arjun Mehta", "JM-E031", "Design engineer", "MySegmenter, 3-matic, Magics", "TR-2026-007", "Engineering lead", "2026-02-18", 24, "Qualified"],
      ["Pooja Desai", "JM-E037", "Packaging operator", "Pouch sealing, labelling, autoclave loading", "TR-2026-015", "Quality manager", "", 12, "In training"],
    ] as const
  ).map(([name, empId, role, qualifiedFor, trainingRef, trainer, on, months, status]) =>
    row("operators", name, status, { empId, role, qualifiedFor }, [
      qual("Operator qualification", on || undefined, months, trainer, trainingRef),
    ]),
  ),

  // --- Packaging & labelling ---------------------------------------------------------------
  ...(
    [
      ["Tyvek/film pouch 150 × 250", "PKG-PCH-150", "Sterile barrier pouch", "150 × 250 mm, steam & EtO", "FlexiPack Medical", "AM-26-4410", "2029-03-31", "PV-PCH-2025-01", 1200, 500, "Approved"],
      ["PETG thermoformed tray — cranial", "PKG-TRY-CR", "Thermoformed tray", "220 × 180 × 40 mm", "TrayForm Plastics", "NP-26-0922", "", "PV-TRY-2025-02", 140, 100, "Approved"],
      ["Device label 70 × 40 (UDI)", "LBL-DEV-7040", "UDI label", "70 × 40 mm, autoclavable", "LabelTech Consumables", "ZB-26-118", "2027-12-31", "LV-LBL-2025-01", 3000, 1000, "Approved"],
      ["IFU — patient-specific implants rev C", "IFU-PSI-C", "IFU", "A5 folded, EN/HI", "In-house print", "IFU-2609", "", "", 220, 100, "Approved"],
      ["Tyvek header bag 300 × 400", "PKG-HB-300", "Tyvek header bag", "300 × 400 mm", "FlexiPack Medical", "AM-26-3921", "2026-11-30", "PV-HB-2024-02", 80, 150, "Quarantine"],
    ] as const
  ).map(([name, code, kind, spec, supplier, lot, expiry, validation, stock, reorder, status]) =>
    row("packaging", name, status, { code, kind, spec, supplier, lot, expiry, stock: String(stock), reorder: String(reorder) }, validation ? [
      { track: "qualification", name: "Packaging validation (ISO 11607-1/-2)", ref: validation },
    ] : []),
  ),
];

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

const FIRST_NAMES: Record<string, string> = {
  A: "Anita", B: "Bilal", D: "Deepak", E: "Esha", F: "Farhan", H: "Harsh", K: "Kavya",
  L: "Lata", M: "Mohan", P: "Pooja", R: "Rahul", S: "Sneha", T: "Tanvi",
};

const SCOPES: Record<string, string> = {
  "Cranial Plate": "Plate + Cutting Guide",
  "Mandible Implant": "Implant + Cutting Guide",
  "Anatomical Model": "Model only",
  "Orthognathic Splint": "Splint set",
  "Knee Cutting Guide": "Guide set",
};

// id, product, surgeon, hospital, patient, surgery date, priority, status, state
const CASES: Array<[string, string, string, string, string, string, string, string, string]> = [
  ["JM-0430", "Cranial Plate", "Dr. R. Mehta", "Sunrise Dental Hospital", "R. Kulkarni", "2026-10-09", "High", "Manufacturing", "Active"],
  ["JM-0414", "Subperiosteal Implant", "Dr. R. Mehta", "Sunrise Dental Hospital", "K. Shah", "2026-10-06", "Medium", "Design Approval", "Active"],
  ["JM-0407", "Anatomical Model", "Dr. A. Iyer", "City Care Hospital", "P. Nair", "2026-10-08", "Low", "Segmentation", "Active"],
  ["JM-0412", "Spinal Fusion Cage", "Dr. S. Kapoor", "Lakeview Ortho Centre", "F. Qureshi", "2026-10-11", "High", "Design", "Cancelled"],
  ["JM-0413", "Anatomical Model", "Dr. A. Iyer", "City Care Hospital", "L. Desai", "2026-10-19", "Critical", "Scan Review", "Active"],
  ["JM-0405", "Orthognathic Splint", "Dr. A. Iyer", "City Care Hospital", "T. Rao", "2026-09-17", "Low", "Shipped", "Active"],
  ["JM-0403", "Hip Implant", "Dr. N. Patel", "Westside Multispecialty", "S. Joshi", "2026-09-20", "High", "QA & Sterilization", "Active"],
  ["JM-0401", "Cranial Plate", "Dr. R. Mehta", "Sunrise Dental Hospital", "A. Verma", "2026-10-02", "Critical", "Design Approval", "Active"],
  ["JM-0410", "Cranial Plate", "Dr. A. Iyer", "City Care Hospital", "E. Pillai", "2026-09-27", "High", "QA & Sterilization", "On hold"],
  ["JM-0402", "Mandible Implant", "Dr. S. Kapoor", "Lakeview Ortho Centre", "M. Khan", "2026-09-29", "High", "Segmentation", "Active"],
  ["JM-0404", "Shoulder Implant", "Dr. R. Mehta", "Westside Multispecialty", "K. Bose", "2026-09-30", "Medium", "Scan Review", "On hold"],
  ["JM-0406", "Anatomical Model", "Dr. S. Kapoor", "Lakeview Ortho Centre", "B. Ahmed", "2026-10-03", "Medium", "Design", "Cancelled"],
  ["JM-0409", "Knee Cutting Guide", "Dr. S. Kapoor", "Lakeview Ortho Centre", "H. Menon", "2026-10-05", "Critical", "Manufacturing", "Active"],
  ["JM-0398", "Cranial Plate", "Dr. N. Patel", "Westside Multispecialty", "R. Gupta", "2026-08-28", "Medium", "Completed", "Archived"],
  ["JM-0396", "Mandible Implant", "Dr. R. Mehta", "Sunrise Dental Hospital", "D. Kulkarni", "2026-08-21", "Low", "Completed", "Archived"],
];

// --- Parts ------------------------------------------------------------------
// What each product is made of, and on which workflow: [part name, workflow,
// part type]. The workflow decides the material and the machine.

const ROUTES: Record<string, { material: string; printer: string }> = {
  "Titanium Implant — DMLS": { material: "Ti-6Al-4V ELI", printer: "EOS M 290" },
  "Surgical Guide / Jig — SLA Resin": { material: "BioMed Clear Resin", printer: "Formlabs Form 3B+" },
  "Model / Prototype — SLS (PA12)": { material: "PA12 Nylon", printer: "EOS Formiga P 110" },
  "Model / Prototype — FDM": { material: "PLA / PETG", printer: "Ultimaker S5" },
  "PEEK Implant — CNC": { material: "PEEK-OPTIMA", printer: "Haas VF-2 CNC" },
};
const DMLS = "Titanium Implant — DMLS";
const SLA = "Surgical Guide / Jig — SLA Resin";

const PARTS: Record<string, Array<[name: string, workflow: string, type: string]>> = {
  "Cranial Plate": [["Patient-specific cranial plate", DMLS, "Implant"], ["Cranial cutting guide", SLA, "Surgical guide"]],
  "Mandible Implant": [["Patient-specific mandible implant", DMLS, "Implant"], ["Mandible cutting guide", SLA, "Surgical guide"]],
  "Subperiosteal Implant": [["Subperiosteal implant framework", DMLS, "Implant"]],
  "Hip Implant": [["Patient-specific acetabular component", DMLS, "Implant"]],
  "Shoulder Implant": [["Patient-specific glenoid component", DMLS, "Implant"]],
  "Spinal Fusion Cage": [["PEEK fusion cage", "PEEK Implant — CNC", "Implant"]],
  "Anatomical Model": [["Anatomical model", "Model / Prototype — SLS (PA12)", "Anatomical model"]],
  "Orthognathic Splint": [["Occlusal splint set", SLA, "Surgical guide"]],
  "Knee Cutting Guide": [["Tibial cutting guide", SLA, "Surgical guide"], ["Femoral cutting guide", SLA, "Surgical guide"]],
};

/** How far along a part is, from where its case is on the platform. */
function stageFor(caseStatus: string, stageCount: number): number {
  if (/creat|scan|segment/i.test(caseStatus)) return 0;
  if (/design/i.test(caseStatus)) return 1;
  if (/manufactur/i.test(caseStatus)) return Math.floor(stageCount / 2);
  return stageCount - 1;
}

// ---------------------------------------------------------------------------

async function createResource(spaceId: string, seed: Seed): Promise<string> {
  // Components and packaging keep their stock in lots: the stock on the seed
  // row becomes an opening-stock lot.
  const data = { ...seed.data };
  let opening: { lot: string; qty: number; supplier: string; expiry: string } | null = null;
  if (seed.kind === "components" || seed.kind === "packaging") {
    if (data.stock !== undefined || data.lot) {
      opening = { lot: String(data.lot || "OPENING"), qty: Number(data.stock ?? 0) || 0, supplier: String(data.supplier ?? ""), expiry: String(data.expiry ?? "") };
    }
    delete data.stock;
    delete data.lot;
    delete data.expiry;
    delete data.supplier;
  }
  const resource = await db.resource.create({
    data: {
      spaceId,
      kind: seed.kind,
      name: seed.name,
      status: seed.status ?? "",
      data: data as Prisma.InputJsonObject,
      ...(seed.archived
        ? {
            archivedAt: day(seed.archived.on),
            archivedByName: seed.archived.by,
            archiveReason: seed.archived.reason,
            ...(seed.archived.deletion
              ? {
                  deletionRequestedAt: day(seed.archived.deletion.on),
                  deletionRequestedByName: seed.archived.deletion.by,
                  deletionReason: seed.archived.deletion.reason,
                }
              : {}),
          }
        : {}),
    },
  });

  for (const item of seed.items ?? []) {
    const due = item.due ?? (item.last && item.months ? addMonths(item.last, item.months) : undefined);
    const created = await db.scheduleItem.create({
      data: {
        resourceId: resource.id,
        track: item.track,
        name: item.name,
        dueOn: due ? day(due) : null,
        repeatMonths: item.months ?? null,
        lastDoneOn: item.last ? day(item.last) : null,
        lastResult: item.last ? (item.result ?? null) : null,
      },
    });
    // A last date means it was done once: keep the record of that.
    if (item.last) {
      await db.scheduleRecord.create({
        data: {
          resourceId: resource.id,
          itemId: created.id,
          track: item.track,
          itemName: item.name,
          doneOn: day(item.last),
          doneBy: item.who ?? QA,
          result: item.result ?? null,
          ref: item.ref ?? null,
          note: item.note ?? null,
          recordedByName: "Sample data",
        },
      });
    }
  }

  for (const extra of seed.extras ?? []) {
    await db.scheduleRecord.create({
      data: {
        resourceId: resource.id,
        track: extra.track,
        itemName: extra.name,
        doneOn: day(extra.on),
        doneBy: extra.who,
        note: extra.note,
        affectsValidation: Boolean(extra.review),
        recordedByName: "Sample data",
      },
    });
  }

  if (opening) {
    await db.materialLot.create({
      data: {
        resourceId: resource.id,
        lotNumber: opening.lot,
        remaining: opening.qty,
        received: opening.qty,
        receivedOn: day("2026-06-01"),
        supplier: opening.supplier || null,
        expiresOn: /^d{4}-d{2}-d{2}$/.test(opening.expiry) ? day(opening.expiry) : null,
      },
    });
  }

  for (const [lot, remaining, received, date, supplier, coa, expiry] of seed.lots ?? []) {
    await db.materialLot.create({
      data: {
        resourceId: resource.id,
        lotNumber: lot,
        remaining,
        received,
        receivedOn: day(date),
        supplier,
        coa,
        expiresOn: expiry ? day(expiry) : null,
      },
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
    update: {},
    create: {
      name: "Demo Medical",
      slug: SLUG,
      adminEmail: ADMIN_EMAIL,
      roleMappings: { create: { platformRoleName: "Admin", role: "SPACE_ADMIN" } },
    },
  });

  const passwordHash = await hashPassword(password);
  await db.user.upsert({
    where: { spaceId_email: { spaceId: space.id, email: ADMIN_EMAIL } },
    update: { passwordHash, isActive: true, role: "SPACE_ADMIN" },
    create: { spaceId: space.id, email: ADMIN_EMAIL, name: "Demo Admin", role: "SPACE_ADMIN", passwordHash },
  });

  // Start from empty, so a second run gives the same result as the first.
  await db.resource.deleteMany({ where: { spaceId: space.id } });
  await db.technology.deleteMany({ where: { spaceId: space.id } });
  await db.partType.deleteMany({ where: { spaceId: space.id } });
  // Parts first — those without a case would otherwise be left behind — then
  // the cases.
  await db.part.deleteMany({ where: { spaceId: space.id } });
  await db.caseRecord.deleteMany({ where: { spaceId: space.id } });
  await db.partRequestSetup.deleteMany({ where: { spaceId: space.id } });
  await db.partRequestForm.deleteMany({ where: { spaceId: space.id } });
  await db.qaTemplate.deleteMany({ where: { spaceId: space.id } });
  await db.spaceSetting.deleteMany({ where: { spaceId: space.id } });
  await db.grn.deleteMany({ where: { spaceId: space.id } });

  // The six standard QA forms; parts get theirs the first time they are opened.
  await db.qaTemplate.createMany({
    data: standardTemplates().map((t) => ({
      spaceId: space.id,
      name: t.name,
      code: t.code,
      clause: t.clause,
      issue: t.issue,
      effective: t.effective,
      rev: t.rev,
      docLayout: t.docLayout,
      attach: t.attach,
      sections: t.sections as unknown as Prisma.InputJsonValue,
      updatedByName: "Demo Admin",
    })),
  });

  await db.technology.createMany({
    data: ["3D Printing", "CNC Machining", "Cast Urethane"].map((name) => ({ spaceId: space.id, name })),
  });
  await db.partType.createMany({
    data: [
      ["Implant", "IMP"],
      ["Surgical guide", "GDE"],
      ["Jig", "JIG"],
      ["Anatomical model", "MDL"],
      ["Instrument", "INS"],
      ["Prototype", "PRT"],
    ].map(([name, code]) => ({ spaceId: space.id, name, code })),
  });

  // Order matters: suppliers and materials first, since machines and workflows
  // point at them.
  const ids = new Map<string, string>();
  for (const seed of [...VENDORS, ...MATERIALS]) {
    ids.set(`${seed.kind}:${seed.name}`, await createResource(space.id, seed));
  }
  for (const seed of PRINTERS) {
    const material = String(seed.data.materialId ?? "");
    seed.data.materialId = ids.get(`materials:${material}`) ?? "";
    await createResource(space.id, seed);
  }
  for (const seed of WORKFLOWS) {
    if (seed.data.sourcing === "Outsourced") seed.data.vendorId = ids.get("vendors:MedMill CNC") ?? "";
    ids.set(`workflows:${seed.name}`, await createResource(space.id, seed));
  }
  for (const seed of REGISTRIES) await createResource(space.id, seed);

  // Lots point at the supplier record they came from.
  for (const [key, vendorId] of ids) {
    if (!key.startsWith("vendors:")) continue;
    await db.materialLot.updateMany({
      where: { resource: { spaceId: space.id }, supplier: key.slice("vendors:".length) },
      data: { supplierId: vendorId },
    });
  }

  let partCount = 0;
  for (const [id, product, surgeon, hospital, patient, date, priority, status, state] of CASES) {
    const number = Number(id.slice(3));
    const [initial, ...rest] = patient.split(". ");
    const surgeryDate = new Date(`${date}T00:00:00+05:30`);
    const isArchived = state === "Archived";

    const record = await db.caseRecord.create({
      data: {
        spaceId: space.id,
        platformCaseId: number,
        caseNumber: id,
        caseNumberSort: caseSortKey(id),
        caseCode: `CASE-${number}`,
        productName: product,
        productCode: product.split(" ")[0].toUpperCase().slice(0, 6),
        scopeName: SCOPES[product] ?? "Implant only",
        caseStatus: status,
        caseState: state,
        isArchived,
        bucket: classifyCase({ caseStatus: status, caseState: state, isArchived }),
        surgeonName: surgeon,
        representativeName: "Rohan Shah",
        hospitalName: hospital,
        priority,
        patientNameEncrypted: encrypt(`${FIRST_NAMES[initial] ?? initial} ${rest.join(". ")}`),
        patientAge: String(24 + (number % 45)),
        patientGender: number % 2 === 0 ? "Female" : "Male",
        surgeryDate,
        anticipatedShipDate: new Date(surgeryDate.getTime() - 5 * DAY_MS),
        platformCreatedAt: new Date(surgeryDate.getTime() - 24 * DAY_MS),
      },
    });

    // The parts this product is made of, each as far along as its case.
    for (const [index, [name, workflowName, partType]] of (PARTS[product] ?? []).entries()) {
      const workflow = WORKFLOWS.find((w) => w.name === workflowName);
      if (!workflow) continue;
      const stages = workflow.data.stages as WorkflowStage[];
      const at = stageFor(status, stages.length);
      const requestedAt = new Date(surgeryDate.getTime() - 18 * DAY_MS);
      const outsourced = workflow.data.sourcing === "Outsourced";
      const partNumber = buildPartNumber(defaultRule("Demo Medical"), {
        product,
        caseNumber: id,
        sequence: index + 1,
        spaceName: "Demo Medical",
        now: requestedAt,
      });
      // One part carries a characteristics table typed in without a drawing.
      const withTable = id === "JM-0401" && index === 0;

      await db.part.create({
        data: {
          spaceId: space.id,
          caseId: record.id,
          partNumber,
          sequence: index + 1,
          name,
          quantity: 1,
          dueOn: new Date(surgeryDate.getTime() - (6 - index) * DAY_MS),
          partType,
          priority,
          notes: partType === "Implant" ? "Implantable — full traceability required." : null,
          workflowId: ids.get(`workflows:${workflowName}`) ?? null,
          workflowName,
          stages: stages as unknown as Prisma.InputJsonValue,
          stageCount: stages.length,
          stageIndex: at,
          stageMeta: stages.map((_, i) =>
            i < at
              ? { assigneeId: null, assignee: "Priya Nair", due: null, by: "Priya Nair", at: new Date(requestedAt.getTime() + (i + 1) * DAY_MS).toISOString() }
              : { assigneeId: null, assignee: null, due: null, by: null, at: null },
          ),
          technology: String(workflow.data.method),
          material: ROUTES[workflowName]?.material ?? null,
          printer: ROUTES[workflowName]?.printer ?? null,
          sourcing: outsourced ? "Outsourced" : "In-house",
          vendor: outsourced ? "MedMill CNC" : null,
          details: [
            { label: "Feature", var: "request.dimensionalFeature", value: "Size and shape" },
            { label: "Specification", var: "request.dimensionalSpecification", value: "As per approved design, ±0.2 mm" },
            { label: "Feature", var: "request.materialFeature", value: "Material" },
            { label: "Specification", var: "request.materialSpecification", value: ROUTES[workflowName]?.material ?? "" },
          ],
          inspection: withTable
            ? {
                images: [],
                points: [],
                columns: DEFAULT_BALLOON_COLUMNS.map((c) => ({ id: c.id, label: c.label })),
                rows: [
                  { id: "m1", imgId: "", balloon: "1", vals: { "c-char": "Plate thickness", "c-spec": "0.60 mm", "c-lsl": "0.55", "c-usl": "0.65" } },
                  { id: "m2", imgId: "", balloon: "2", vals: { "c-char": "Screw hole diameter", "c-spec": "Ø2.00 mm", "c-lsl": "1.95", "c-usl": "2.05" } },
                  { id: "m3", imgId: "", balloon: "3", vals: { "c-char": "Overall length", "c-spec": "96.0 mm", "c-lsl": "95.7", "c-usl": "96.3" } },
                ],
              }
            : Prisma.JsonNull,
          links: [],
          requestedByName: "Rohan Shah",
          createdAt: requestedAt,
          activity: {
            create: [
              { title: "Part requested", detail: `${partNumber} · ${name} via ${workflowName}`, byName: "Rohan Shah", createdAt: requestedAt },
              ...stages.slice(0, at).map((stage, i) => ({
                title: "Advanced stage",
                detail: `${stage.name} → ${stages[i + 1].name}`,
                byName: "Priya Nair",
                createdAt: new Date(requestedAt.getTime() + (i + 1) * DAY_MS),
              })),
            ],
          },
        },
      });
      partCount += 1;
    }
  }

  // Parts that belong to no case: a test coupon and a demonstration model.
  const standalone: Array<[name: string, workflow: string, type: string, stage: number, due: string]> = [
    ["Tensile test coupons — Ti-6Al-4V lot check", DMLS, "Prototype", 3, "2026-10-12"],
    ["Demonstration skull model", "Model / Prototype — FDM", "Anatomical model", 0, "2026-10-25"],
  ];
  for (const [index, [name, workflowName, partType, at, due]] of standalone.entries()) {
    const workflow = WORKFLOWS.find((w) => w.name === workflowName)!;
    const stages = workflow.data.stages as WorkflowStage[];
    const requestedAt = new Date(day(due).getTime() - 10 * DAY_MS);
    const partNumber = buildPartNumber(defaultRule("Demo Medical"), {
      noCase: true,
      sequence: index + 1,
      spaceName: "Demo Medical",
      now: requestedAt,
    });
    await db.part.create({
      data: {
        spaceId: space.id,
        caseId: null,
        partNumber,
        sequence: index + 1,
        name,
        quantity: index === 0 ? 6 : 1,
        dueOn: day(due),
        partType,
        priority: "Low",
        notes: index === 0 ? "Not for clinical use — material qualification only." : null,
        workflowId: ids.get(`workflows:${workflowName}`) ?? null,
        workflowName,
        stages: stages as unknown as Prisma.InputJsonValue,
        stageCount: stages.length,
        stageIndex: at,
        stageMeta: stages.map(() => ({ assigneeId: null, assignee: null, due: null, by: null, at: null })),
        technology: String(workflow.data.method),
        material: ROUTES[workflowName]?.material ?? null,
        printer: ROUTES[workflowName]?.printer ?? null,
        sourcing: "In-house",
        details: [],
        links: [],
        requestedByName: "Rohan Shah",
        createdAt: requestedAt,
        activity: {
          create: { title: "Part requested", detail: `${partNumber} · ${name} via ${workflowName}`, byName: "Rohan Shah", createdAt: requestedAt },
        },
      },
    });
    partCount += 1;
  }

  // Goods receipts: one closed, one awaiting inspection, one draft.
  const spaceId = space.id;
  const vendor = (name: string) => ids.get(`vendors:${name}`) ?? null;
  const material = (name: string) => ids.get(`materials:${name}`) ?? null;
  const tiLot = await db.materialLot.findFirst({ where: { lotNumber: "TI64-2407-B", resource: { spaceId } } });
  const allPass = (n: number) => ({ n, res: Array(n).fill("Pass") });
  const closed = await db.grn.create({
    data: {
      spaceId,
      number: "GRN-2026-0031",
      receivedOn: day("2026-07-14"),
      supplierId: vendor("Precision AddCorp"),
      supplierName: "Precision AddCorp",
      header: { po: "PO-2026-118", invoice: "INV-PA-7781", dn: "DN-44120", receivedBy: "Ravi Patel", condition: "Packaging intact" },
      received: true,
      receivedAt: day("2026-07-14"),
      confirmedByName: "Ravi Patel",
      createdByName: "Ravi Patel",
      createdAt: day("2026-07-14"),
      lines: {
        create: {
          spaceId,
          position: 1,
          type: "material",
          itemId: material("Ti-6Al-4V ELI"),
          itemName: "Ti-6Al-4V ELI",
          lotNumber: "TI64-2407-B",
          quantity: 5,
          unit: "kg",
          expiresOn: day("2028-07-31"),
          coa: "CoA-TI-88540",
          extra: {},
          tests: { m1: allPass(1), m2: allPass(1), m3: allPass(1), m4: allPass(1) },
          decision: "Accepted",
          inspectedByName: QA,
          inspectedAt: day("2026-07-15"),
          testSummary: "CoA review PASS (1/1) | Quantity check PASS (1/1) | Packaging & seals PASS (1/1) | Label check PASS (1/1)",
          resultId: tiLot?.id ?? null,
          createdAt: day("2026-07-14"),
        },
      },
      log: {
        create: [
          { byName: "Ravi Patel", text: "Receipt confirmed — 1 line sent to incoming inspection", createdAt: day("2026-07-14") },
          { byName: QA, text: "Line 1 accepted · Ti-6Al-4V ELI · released 5 kg to stock", createdAt: day("2026-07-15") },
        ],
      },
    },
  });
  if (tiLot) await db.materialLot.update({ where: { id: tiLot.id }, data: { grnId: closed.id, grnNumber: closed.number } });

  await db.grn.create({
    data: {
      spaceId,
      number: "GRN-2026-0041",
      receivedOn: day("2026-09-28"),
      supplierId: vendor("TitanPowder Metals"),
      supplierName: "TitanPowder Metals",
      header: { po: "PO-2026-162", poDate: "2026-09-02", invoice: "INV-TP-2231", invoiceDate: "2026-09-25", dn: "DN-TP-0928", dnDate: "2026-09-26", receivedBy: "Ravi Patel", condition: "Packaging intact" },
      received: true,
      receivedAt: day("2026-09-28"),
      confirmedByName: "Ravi Patel",
      createdByName: "Ravi Patel",
      createdAt: day("2026-09-28"),
      lines: {
        create: [
          { spaceId, position: 1, type: "material", itemId: material("Ti-6Al-4V ELI"), itemName: "Ti-6Al-4V ELI", lotNumber: "RM-2026-0001", supplierBatch: "TI64-2609-C", quantity: 10, unit: "kg", expiresOn: day("2028-09-30"), coa: "CoA-TI-90112", extra: {}, tests: {} },
          { spaceId, position: 2, type: "material", itemId: material("PA12 Nylon"), itemName: "PA12 Nylon", lotNumber: "RM-2026-0002", supplierBatch: "PA12-2609-04", quantity: 3, unit: "kg", expiresOn: day("2028-09-30"), coa: "CoA-PA-4602", extra: {}, tests: {} },
        ],
      },
      log: { create: { byName: "Ravi Patel", text: "Receipt confirmed — 2 lines sent to incoming inspection", createdAt: day("2026-09-28") } },
    },
  });

  await db.grn.create({
    data: {
      spaceId,
      number: "GRN-2026-0043",
      receivedOn: day("2026-09-30"),
      supplierId: vendor("NABL lab — Vadodara"),
      supplierName: vendor("NABL lab — Vadodara") ? "NABL lab — Vadodara" : null,
      header: { po: "PO-2026-170", dn: "DN-NB-771", receivedBy: "Pooja Desai", condition: "Packaging intact" },
      createdByName: "Pooja Desai",
      createdAt: day("2026-09-30"),
      log: { create: { byName: "Pooja Desai", text: "Draft receipt started", createdAt: day("2026-09-30") } },
    },
  });

  const count = VENDORS.length + MATERIALS.length + PRINTERS.length + WORKFLOWS.length + REGISTRIES.length;
  const base = process.env.BASE_DOMAIN || "localhost";
  console.log(`Demo space ready: ${count} master-data records, ${CASES.length} cases and ${partCount} parts.`);
  console.log(`Sign in at http://${SLUG}.${base}:3100 as ${ADMIN_EMAIL}`);
  console.log("with the SUPER_ADMIN_PASSWORD from .env.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
