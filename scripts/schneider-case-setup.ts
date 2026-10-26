import "dotenv/config";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";

import { caseFieldVar, caseSetupProblem, defaultCaseForm, defaultCaseSections, FIRST_CASE_FORM, type CaseDetail, type CaseSection, type CaseSetup } from "../src/lib/cases/case-form";
import { caseStagesFor, readCatalog, type CatalogData } from "../src/lib/cases/catalog";
import { classifyCase } from "../src/lib/cases/classify";
import { caseSortKey } from "../src/lib/cases/sort-key";
import { idDate, initialsOf, nextId } from "../src/lib/resources/ids";
import { readDepartments } from "../src/lib/cases/hospitals";
import type { WorkflowStage } from "../src/lib/resources/config";
import { seedViewers } from "./seed-viewers";

/**
 * Schneider's cases are managed in the app, not synced: its products —
 * Orthognathic and Cranial Plate — each with one workflow (its case stages)
 * and its viewers, the first three products archived; one generic case form; the case ID continuing from SC-1006, and the sample cases
 * turned into cases opened here, with their form's answers.
 *
 * Safe to run again. The Schneider seed (scripts/seed-schneider.ts) runs it last.
 *
 *   npx tsx scripts/schneider-case-setup.ts
 */

const SLUG = "schneider";
const ADMIN = "Dr. Yael Ben-Ami (3D Lab)";
const MODEL_WF = "Anatomical Model — Stratasys PolyJet";
const GUIDE_WF = "Patient-Specific Surgical Guide — PolyJet MED610";
const SPLINT_WF = "Patient-Specific Splint — PolyJet MED610";

/** A case stage: name, expected days, owner roles, QA forms; emails and tasks are set up in the app. */
const stage = (name: string, days: number | null, role = "", forms: string[] = []): WorkflowStage => ({
  id: `cs-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  name,
  role,
  days,
  forms,
  formsRequired: false,
  emailsNext: [],
  emailsBack: [],
  tasks: [],
});

/** The products the lab started with — archived now; the sample cases were opened for them and keep them. */
const LEGACY_PRODUCTS: Array<{ name: string; code: string; category: string; workflow: string; description: string; stages: WorkflowStage[] }> = [
  {
    name: "Anatomical Model",
    code: "AM",
    category: "Anatomical model",
    workflow: MODEL_WF,
    description: "Pre-surgical planning and teaching model, printed in VeroUltra / Agilus.",
    stages: [
      stage("Case received", 1, "Space Admin"),
      stage("Scan review", 1, "Member"),
      stage("Segmentation", 2, "Member"),
      stage("Surgeon feedback", 2),
      stage("Production", 3, "Member"),
      stage("Delivery", 1),
      stage("Case completed", null),
    ],
  },
  {
    name: "Surgical Guide",
    code: "SG",
    category: "Patient-specific instrument",
    workflow: GUIDE_WF,
    description: "Patient-specific cutting / drilling guide in MED610, steam sterilized at the hospital.",
    stages: [
      stage("Case received", 1, "Space Admin"),
      stage("Scan review", 1, "Member"),
      stage("Segmentation", 2, "Member"),
      stage("Design", 3, "Member"),
      stage("Surgeon feedback", 2),
      stage("Production", 3, "Member"),
      stage("Sterilization", 2),
      stage("Delivery", 1),
      stage("Case completed", null),
    ],
  },
  {
    name: "Splint",
    code: "SP",
    category: "Other",
    workflow: SPLINT_WF,
    description: "Patient-specific splint in MED610.",
    stages: [
      stage("Case received", 1, "Space Admin"),
      stage("Scan review", 1, "Member"),
      stage("Design", 2, "Member"),
      stage("Surgeon feedback", 2),
      stage("Production", 2, "Member"),
      stage("Delivery", 1),
      stage("Case completed", null),
    ],
  },
];

/** The case stages of a surgical patient-specific device, as agreed (PSI / mold). */
const PSI_STAGES = (): WorkflowStage[] => [
  stage("Case received", 1, "Space Admin"),
  stage("Customer requirement", 1),
  stage("Quotation", 1),
  stage("Quotation confirmed", 1),
  stage("Segmentation", 2, "Member"),
  stage("Design", 3, "Member"),
  stage("Surgeon feedback", 2),
  stage("Production", 3, "Member"),
  stage("Sterilization & autoclave", 2),
  stage("Delivery", 1),
  stage("Case completed", null),
];

/** The products cases are opened for now — each with one workflow, and the viewers its cases are seen in. */
const PRODUCTS: Array<{ name: string; code: string; category: string; workflow: string; description: string; stages: WorkflowStage[]; viewers: string[]; tags: string[] }> = [
  {
    name: "Orthognathic",
    code: "ORTHO",
    category: "Patient-specific instrument",
    workflow: GUIDE_WF,
    description: "Orthognathic surgery: virtual surgical planning, then occlusal splints and cutting guides printed in MED610.",
    stages: PSI_STAGES(),
    viewers: ["3D Viewer"],
    tags: ["Maxillofacial", "Guide", "Splint"],
  },
  {
    name: "Cranial Plate",
    code: "CP",
    category: "Implant",
    workflow: "",
    description: "Patient-specific cranial plate (PEEK or titanium): designed here, made by an approved supplier.",
    stages: PSI_STAGES(),
    viewers: ["3D Viewer"],
    tags: ["Cranial", "Implant"],
  },
];

/** Each sample case: its sub-scope, and the answers its form was filled with. */
const CASES: Record<string, { bodyPart: string; department: string; mrn: string; extra?: Record<string, string> }> = {
  "SC-1001": { bodyPart: "Heart", department: "Pediatric Cardiac Surgery", mrn: "SCMC-4471020", extra: { side: "Not applicable" } },
  "SC-1002": { bodyPart: "Tibia / Fibula", department: "Pediatric Orthopaedics", mrn: "SCMC-4471388", extra: { side: "Right", sterilization: "Steam sterilized at the hospital (CSSD)", designApproval: "Yes" } },
  "SC-1003": { bodyPart: "Mandible", department: "Oral & Maxillofacial Surgery", mrn: "SCMC-4470915", extra: { side: "Midline", sterilization: "Non-sterile — cleaned and disinfected", designApproval: "Yes" } },
  "SC-1004": { bodyPart: "Skull / Cranium", department: "Pediatric Neurosurgery", mrn: "SCMC-4472104", extra: { side: "Not applicable" } },
  "SC-1005": { bodyPart: "Mandible", department: "Oral & Maxillofacial Surgery", mrn: "SCMC-4472230", extra: { side: "Bilateral", sterilization: "Steam sterilized at the hospital (CSSD)", designApproval: "Yes" } },
  "SC-1006": { bodyPart: "Forearm / Wrist / Hand", department: "Pediatric Orthopaedics", mrn: "SCMC-4469802", extra: { side: "Left", sterilization: "Non-sterile — cleaned and disinfected", designApproval: "" } },
  "SC-0998": { bodyPart: "Pelvis / Hip", department: "Pediatric Orthopaedics", mrn: "SCMC-4468311", extra: { side: "Left", sterilization: "Steam sterilized at the hospital (CSSD)", designApproval: "Yes" } },
  "SC-0991": { bodyPart: "Spine", department: "Pediatric Orthopaedics", mrn: "SCMC-4461197", extra: { side: "Midline" } },
};


/** Schneider's products have no sub-scopes: the field is hidden. */
function withoutSubscope(sections: CaseSection[]): CaseSection[] {
  return sections.map((sec) => ({
    ...sec,
    fields: sec.fields.flatMap((f) => (f.key === "product" ? [f, PLANNER_BONUS] : [f])).map((f) => {
      if (f.key === "subscope") return { ...f, show: false, req: false };
      // Products as cards, as the lab chose in Case Form Setup.
      if (f.key === "product") return { ...f, display: "cards" as const };
      // Surgeons and sales people by role; the hospital offered is one of the surgeon's.
      if (f.key === "surgeon" || f.key === "secondarySurgeons") return { ...f, roles: ["Surgeon"] };
      if (f.key === "salesPeople") return { ...f, roles: ["Sales"] };
      if (f.key === "projectManager") return { ...f, roles: ["Project Manager"] };
      if (f.key === "hospital") return { ...f, hospitalSource: "surgeon" as const };
      return f;
    }),
  }));
}

/** The planner a case is planned in — a custom field of the lab's case form. */
const PLANNER_BONUS: CaseSection["fields"][number] = {
  id: "c-plannerBonus",
  key: "",
  var: "plannerBonus",
  label: "Planner Bonus",
  type: "select",
  show: true,
  req: false,
  locked: false,
  def: "",
  options: ["Orthognathic", "Fibula Flap", "None"],
  fileTypes: [],
  allowLinks: false,
};

/** Hospitals the sample cases come from, their departments, and the people who work there. */
const SCMC_NAME = "Schneider Children's Medical Center";
const HOSPITALS: Array<{ name: string; code: string; city: string; departments: string[] }> = [
  { name: SCMC_NAME, code: "SCMC", city: "Petah Tikva", departments: ["Pediatric Orthopaedics", "Oral & Maxillofacial Surgery", "Pediatric Neurosurgery", "Pediatric Cardiac Surgery"] },
  { name: "Rabin Medical Center", code: "RMC", city: "Petah Tikva", departments: ["Orthopaedics", "Oral & Maxillofacial Surgery"] },
  { name: "Sheba Medical Center", code: "SHEBA", city: "Ramat Gan", departments: ["Oral & Maxillofacial Surgery", "Plastic & Reconstructive Surgery"] },
];
/** People, their hospitals, and — "CODE:Department" — their departments there. */
const PEOPLE: Array<{ name: string; email: string; role: string; hospitals: string[]; departments?: string[] }> = [
  { name: "Dr. N. Levi", email: "n.levi@scmc-3dlab.example", role: "Surgeon", hospitals: ["SCMC"], departments: ["SCMC:Pediatric Cardiac Surgery"] },
  { name: "Dr. A. Cohen", email: "a.cohen@scmc-3dlab.example", role: "Surgeon", hospitals: ["SCMC", "RMC"], departments: ["SCMC:Pediatric Orthopaedics", "RMC:Orthopaedics"] },
  { name: "Dr. M. Katz", email: "m.katz@scmc-3dlab.example", role: "Surgeon", hospitals: ["SCMC", "SHEBA"], departments: ["SCMC:Oral & Maxillofacial Surgery", "SHEBA:Oral & Maxillofacial Surgery"] },
  { name: "Dr. S. Mizrahi", email: "s.mizrahi@scmc-3dlab.example", role: "Surgeon", hospitals: ["SCMC"], departments: ["SCMC:Pediatric Neurosurgery"] },
  { name: "Maya Klein", email: "maya.klein@scmc-3dlab.example", role: "Sales", hospitals: ["SCMC", "RMC", "SHEBA"] },
  { name: "Dana Weiss", email: "dana.weiss@scmc-3dlab.example", role: "Project Manager", hospitals: ["SCMC", "RMC", "SHEBA"] },
];

const KEY = Buffer.from(process.env.ENCRYPTION_KEY ?? "", "base64");
// Same format as src/lib/crypto.ts, which cannot be imported here.
function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function decrypt(value: string): string {
  const [, iv, tag, data] = value.split(".");
  const decipher = createDecipheriv("aes-256-gcm", KEY, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** Initials from a patient name ("Noa Ben-David" → N.B.) — the name itself is never printed. */
function initials(encrypted: string | null): string {
  if (!encrypted) return "";
  return decrypt(encrypted)
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `${w[0].toUpperCase()}.`)
    .join("");
}

export async function setupSchneiderCases(db: PrismaClient, spaceId: string): Promise<string> {
  if (KEY.length !== 32) throw new Error("ENCRYPTION_KEY is missing or not 32 bytes.");

  // --- The standard Viewer list ------------------------------------------------------------------
  await seedViewers(db, spaceId);

  // --- Products: Orthognathic and Cranial Plate, each with one workflow ------------------------------
  const workflows = await db.resource.findMany({ where: { spaceId, kind: "workflows", archivedAt: null }, select: { id: true, name: true } });
  const workflowId = (name: string) => workflows.find((w) => w.name === name)?.id ?? "";
  const viewerRows = await db.resource.findMany({ where: { spaceId, kind: "viewers", archivedAt: null }, select: { id: true, name: true } });
  const productIds = new Map<string, string>();
  // The first products stay — archived — for the sample cases opened for them.
  for (const p of LEGACY_PRODUCTS) {
    const found = await db.resource.findFirst({ where: { spaceId, kind: "products", name: p.name }, orderBy: { createdAt: "asc" }, select: { id: true, archivedAt: true } });
    const data: CatalogData = { code: p.code, category: p.category, tags: [], workflowIds: [workflowId(p.workflow)].filter(Boolean), description: p.description, mode: "single", stages: p.stages, scopes: [], imageId: "", viewerIds: [], protocols: [] };
    const id = found ? found.id : (await db.resource.create({ data: { spaceId, kind: "products", name: p.name, status: "Active", data: data as unknown as Prisma.InputJsonObject } })).id;
    if (!found?.archivedAt) {
      await db.resource.update({
        where: { id },
        data: { archivedAt: new Date(), archivedByName: ADMIN, archiveReason: "Replaced by the Orthognathic and Cranial Plate products; kept for the cases opened for it." },
      });
    }
    productIds.set(p.name, id);
  }
  for (const p of PRODUCTS) {
    const found = await db.resource.findFirst({ where: { spaceId, kind: "products", name: p.name, archivedAt: null }, select: { id: true, data: true } });
    const before = readCatalog(found?.data);
    const viewerIds = before.viewerIds.length ? before.viewerIds : p.viewers.map((n) => viewerRows.find((v) => v.name === n)?.id).filter((v): v is string => Boolean(v));
    // Stages edited in the app are kept; new ones show each viewer at every stage, to everyone.
    const stages = before.mode === "single" && before.stages.length ? before.stages : p.stages.map((st) => ({ ...st, viewers: viewerIds.map((viewerId) => ({ viewerId, roles: "" })) }));
    const data: CatalogData = { code: p.code, category: p.category, tags: before.tags.length ? before.tags : p.tags, workflowIds: before.workflowIds.length ? before.workflowIds : [workflowId(p.workflow)].filter(Boolean), description: p.description, mode: "single", stages, scopes: [], imageId: before.imageId, viewerIds, protocols: before.protocols };
    const id = found
      ? (await db.resource.update({ where: { id: found.id }, data: { status: "Active", data: data as unknown as Prisma.InputJsonObject } })).id
      : (await db.resource.create({ data: { spaceId, kind: "products", name: p.name, status: "Active", data: data as unknown as Prisma.InputJsonObject } })).id;
    productIds.set(p.name, id);
  }


  // --- Hospitals, and the surgeons and sales person who work at them -------------------------------
  const hospitalIds = new Map<string, string>();
  for (const h of HOSPITALS) {
    const found = await db.resource.findFirst({ where: { spaceId, kind: "hospitals", name: h.name, archivedAt: null }, select: { id: true } });
    hospitalIds.set(
      h.code,
      found ? found.id : (await db.resource.create({ data: { spaceId, kind: "hospitals", name: h.name, status: "Active", data: { code: h.code, city: h.city, address: "", contact: "" } } })).id,
    );
  }
  const personIds = new Map<string, string>();
  for (const person of PEOPLE) {
    const ids = person.hospitals.map((c) => hospitalIds.get(c)!).filter(Boolean);
    const user = await db.user.upsert({
      where: { spaceId_email: { spaceId, email: person.email } },
      update: { name: person.name, platformRoleName: person.role, hospitalIds: ids, isActive: true },
      create: { spaceId, email: person.email, name: person.name, role: "MEMBER", platformRoleName: person.role, hospitalIds: ids },
    });
    personIds.set(person.email, user.id);
  }
  // Departments, and who works in each — those set on a hospital in the app are kept.
  for (const h of HOSPITALS) {
    const id = hospitalIds.get(h.code)!;
    const row = await db.resource.findUniqueOrThrow({ where: { id }, select: { data: true } });
    if (readDepartments(row.data).length) continue;
    const departments = h.departments.map((name, i) => ({
      id: `dep-${h.code.toLowerCase()}-${i + 1}`,
      name,
      personIds: PEOPLE.filter((x) => x.departments?.includes(`${h.code}:${name}`)).map((x) => personIds.get(x.email)!),
    }));
    await db.resource.update({ where: { id }, data: { data: { ...((row.data ?? {}) as object), departments } as Prisma.InputJsonObject } });
  }

  // --- Case forms and the case ID --------------------------------------------------------------
  const setup: CaseSetup = {
    source: "local",
    idPattern: "SC-{####}",
    // One generic form for every product, for now.
    forms: [{ ...defaultCaseForm(FIRST_CASE_FORM, "Standard", true), sections: withoutSubscope(defaultCaseSections()) }],
  };
  const problem = caseSetupProblem(setup);
  if (problem) throw new Error(`Case setup: ${problem}`);
  await db.spaceSetting.upsert({
    where: { spaceId_key: { spaceId, key: "caseSetup" } },
    create: { spaceId, key: "caseSetup", value: setup as unknown as Prisma.InputJsonObject, updatedByName: ADMIN },
    update: { value: setup as unknown as Prisma.InputJsonObject, updatedByName: ADMIN },
  });

  // --- The sample cases, as cases opened here ---------------------------------------------------
  const label = new Map(setup.forms.flatMap((f) => f.sections.flatMap((s) => s.fields)).map((f) => [caseFieldVar(f), f.label]));
  // Device answers the generic form does not ask: kept with their own labels, shown as other answers.
  const extraLabel: Record<string, string> = { side: "Side", sterilization: "Sterilization", designApproval: "Surgeon approves the design before printing" };
  const detail = (variable: string, value: string): CaseDetail[] =>
    value ? [{ label: label.get(`case.${variable}`) ?? extraLabel[variable] ?? variable, var: `case.${variable}`, value }] : [];
  const cases = await db.caseRecord.findMany({ where: { spaceId }, select: { id: true, caseNumber: true, productName: true, scopeName: true, patientNameEncrypted: true, details: true } });
  let converted = 0;
  for (const c of cases) {
    const info = c.caseNumber ? CASES[c.caseNumber] : undefined;
    const productId = c.productName ? productIds.get(c.productName) : undefined;
    if (!info || !productId) continue;
    // The seed's scope is the procedure; on a second run it is already among the answers.
    const procedure = (Array.isArray(c.details) ? (c.details as unknown as CaseDetail[]) : []).find((d) => d.var === "case.procedure")?.value ?? c.scopeName ?? "";
    await db.caseRecord.update({
      where: { id: c.id },
      data: {
        origin: "local",
        platformCaseId: null,
        productId,
        productCode: LEGACY_PRODUCTS.find((p) => p.name === c.productName)?.code ?? null,
        subscopeId: null,
        scopeName: null,
        caseFormId: FIRST_CASE_FORM,
        hospitalName: SCMC_NAME,
        patientIdEncrypted: encrypt(info.mrn),
        createdByName: ADMIN,
        details: [
          ...detail("patientInitials", initials(c.patientNameEncrypted)),
          ...detail("bodyPart", info.bodyPart),
          ...detail("procedure", procedure),
          ...detail("department", info.department),
          ...detail("modality", "CT"),
          ...Object.entries(info.extra ?? {}).flatMap(([k, v]) => detail(k, v)),
        ] as unknown as Prisma.InputJsonArray,
      },
    });
    converted += 1;
  }
  return `${PRODUCTS.length} products with one workflow each, 1 generic case form, ${converted} cases managed here (IDs continue as SC-{####})`;
}

/**
 * The sample cases: every earlier one removed (with the parts made for them),
 * and one case opened from the space's case form as it is now — every field
 * it asks answered, numbered by its ID pattern, at its product's first stage.
 */
export async function replaceSampleCases(db: PrismaClient, spaceId: string): Promise<string> {
  const removed = await db.caseRecord.deleteMany({ where: { spaceId } });

  const row = await db.spaceSetting.findUnique({ where: { spaceId_key: { spaceId, key: "caseSetup" } } });
  const setup = row?.value as unknown as CaseSetup | undefined;
  if (!setup) throw new Error("No case setup — run setupSchneiderCases first.");
  const form = setup.forms.find((f) => f.isDefault) ?? setup.forms[0];
  const product = await db.resource.findFirst({ where: { spaceId, kind: "products", name: "Orthognathic", archivedAt: null }, select: { id: true, name: true, data: true } });
  if (!product) throw new Error("No Orthognathic product.");
  const catalog = readCatalog(product.data);
  const person = async (email: string) => db.user.findUniqueOrThrow({ where: { spaceId_email: { spaceId, email } }, select: { id: true, name: true } });
  const surgeon = await person("m.katz@scmc-3dlab.example");
  const second = await person("a.cohen@scmc-3dlab.example");
  const pm = await person("dana.weiss@scmc-3dlab.example");
  const sales = await person("maya.klein@scmc-3dlab.example");

  const now = new Date();
  const day = (n: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + n));
  const surgeryDate = day(35);
  const deliveryDate = day(21);
  const patientId = "SCMC-482193";

  // The answers, by the form's fields: built-in ones by key, its own ones by variable.
  const byKey: Record<string, { value: string; ids?: string[] }> = {
    projectManager: { value: pm.name, ids: [pm.id] },
    secondarySurgeons: { value: second.name, ids: [second.id] },
    salesPeople: { value: sales.name, ids: [sales.id] },
    department: { value: "Oral & Maxillofacial Surgery" },
  };
  const byVar: Record<string, string> = {
    "case.plannerBonus": "Orthognathic",
    "case.patientInitials": "R.L.",
    "case.bodyPart": "Mandible",
    "case.procedure": "Bimaxillary orthognathic surgery — Le Fort I and BSSO",
    "case.diagnosis": "Class III skeletal malocclusion with mandibular asymmetry",
    "case.notes": "Sample case opened with the Standard case form. CBCT to follow from the hospital.",
  };
  const details: CaseDetail[] = [];
  for (const f of form.sections.flatMap((s) => s.fields).filter((x) => x.show)) {
    const v = caseFieldVar(f);
    const answer = byKey[f.key] ?? (byVar[v] ? { value: byVar[v] } : null);
    if (!answer) continue;
    if (f.type === "select" && !f.options.includes(answer.value)) throw new Error(`"${answer.value}" is not an option of ${f.label}.`);
    details.push({ label: f.label, var: v, value: answer.value, ...(answer.ids ? { ids: answer.ids } : {}) });
  }

  const caseNumber = nextId(
    setup.idPattern,
    { type: catalog.code || product.name, now, fields: { SURGEON: initialsOf(surgeon.name), PATIENT: "RL", PID: patientId, SURGERY: idDate(surgeryDate), DELIVERY: idDate(deliveryDate) } },
    [],
  );
  if (!caseNumber) throw new Error("The case ID pattern gave no number.");
  const caseStatus = caseStagesFor(catalog, null)[0]?.name ?? "Case received";
  const created = await db.caseRecord.create({
    data: {
      spaceId,
      origin: "local",
      platformCaseId: null,
      caseNumber,
      caseNumberSort: caseSortKey(caseNumber),
      productId: product.id,
      productName: product.name,
      productCode: catalog.code || null,
      caseStatus,
      stageIndex: 0,
      caseState: "Active",
      isArchived: false,
      bucket: classifyCase({ caseStatus, caseState: "Active", isArchived: false }),
      priority: "High",
      surgeryDate,
      anticipatedShipDate: deliveryDate,
      surgeonName: surgeon.name,
      hospitalName: SCMC_NAME,
      representativeName: sales.name,
      patientIdEncrypted: encrypt(patientId),
      details: details as unknown as Prisma.InputJsonArray,
      caseFormId: form.id,
      createdByName: ADMIN,
      platformCreatedAt: now,
    },
    select: { id: true },
  });
  await db.auditLog.create({
    data: {
      spaceId,
      actorEmail: "admin@scmc-3dlab.example",
      action: "case.create",
      entityType: "case",
      entityId: created.id,
      entityName: caseNumber,
      summary: `Opened case ${caseNumber} — ${product.name} (sample, ${form.name} form)`,
    },
  });
  return `${removed.count} earlier sample case${removed.count === 1 ? "" : "s"} removed; 1 sample case ${caseNumber} opened with the ${form.name} form`;
}

async function main() {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const space = await db.space.findUnique({ where: { slug: SLUG } });
    if (!space) throw new Error(`No "${SLUG}" space — run scripts/seed-schneider.ts first.`);
    console.log(`${space.name}: ${await setupSchneiderCases(db, space.id)}.`);
    console.log(`Sample cases: ${await replaceSampleCases(db, space.id)}.`);
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && /schneider-case-setup\.ts$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
