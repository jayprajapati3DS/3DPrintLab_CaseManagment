import "dotenv/config";

import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";

import {
  item,
  REQUIREMENTS,
  section,
  standardTemplates,
  templateLabel,
  templateProblem,
  templateSchema,
  newColumn,
  type GridColumn,
  type QaItem,
  type QaTemplateData,
  type Source,
} from "../src/lib/qa/template";
import type { WorkflowData, WorkflowStage } from "../src/lib/resources/config";

/**
 * In-house anatomical model manufacturing, set up in one company space:
 *
 *   npx tsx scripts/setup-anatomical-model.ts <space-slug> [--as <email>] [--upgrade]
 *
 * The QAC (JM-F-DND-004) is filled from the part request and approved first;
 * the Batch Manufacturing Record for 3D Model — Inhouse (JM-F-PRD-015, issue
 * 02, rev 03) then follows the part stage by stage, one form per BMR section
 * group, each approved before the part moves on.
 *
 * Creates, when missing: the technology "3D Printing", the part type
 * "Anatomical model" (MDL), the QAC and the ten BMR forms, the SLA and FDM
 * workflows, and the six packaging & labelling items the BMR names. Anything
 * that already exists (by name or document code) is left exactly as it is, so
 * the script can be run again. Machines, materials, suppliers and people are
 * not invented — they are the company's own records to add.
 *
 * --upgrade replaces the BMR forms this script made earlier with the current
 * ones (dates, durations and calculated end times, accepted counts and yield),
 * unless someone has edited them since. Parts already requested keep the copy
 * they were given.
 *
 * BMR 1 is Batch identification on its own, and BMR 2 the design receipt and
 * file check; BMR 3 the print setup and BMR 4 the print run (both splits on
 * 2026-10-02). A space set up before that is split with scripts/split-bmr1.ts
 * and then scripts/split-bmr3.ts first; this script stops until it is.
 */

const slug = process.argv[2];
const asIndex = process.argv.indexOf("--as");
const actorEmail = asIndex > 0 ? process.argv[asIndex + 1] : undefined;
const upgrade = process.argv.includes("--upgrade");
if (!slug || slug.startsWith("-")) {
  console.error("Usage: npx tsx scripts/setup-anatomical-model.ts <space-slug> [--as <email>]");
  process.exit(1);
}

/** Who the forms are saved by when no account is named. */
const SETUP_NAME = "Setup: anatomical model (in-house)";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

// --- The forms ----------------------------------------------------------------------------

const info = (label: string, value: string) => item("info", label, { value });
const text = (label: string, extra: Partial<QaItem> = {}) => item("text", label, extra);
const count = (label: string, extra: Partial<QaItem> = {}) => item("number", label, extra);
const check = (label: string, extra: Partial<QaItem> = {}) => item("check", label, extra);
const sign = (label: string, value = "{user.name}", extra: Partial<QaItem> = {}) => item("sign", label, { value, ...extra });
const pick = (label: string, src: Source, extra: Partial<QaItem> = {}) => item("select", label, { src, ...extra });
const choose = (label: string, options: string[], extra: Partial<QaItem> = {}) =>
  item("select", label, { src: "custom", opts: options.join(", "), ...extra });
const optional = { req: false } as const;
const date = (label: string, extra: Partial<QaItem> = {}) => item("date", label, extra);
const yesno = (label: string, extra: Partial<QaItem> = {}) => item("yesno", label, extra);
const photo = (label: string) => item("file", label, { req: false });
const column = (label: string, kind: GridColumn["kind"], extra: Partial<GridColumn> = {}): GridColumn => ({
  ...newColumn(label),
  kind,
  ...extra,
});
/** Shown only when the named field is more than zero — a reason, when something was rejected. */
const whenAny = (ref: string) => ({ showIf: { ref, op: "gt" as const, value: "0" } });
const duration = (label: string, extra: Partial<QaItem> = {}) => item("duration", label, extra);
const calc = (label: string, formula: string, extra: Partial<QaItem> = {}) => item("calc", label, { formula, req: false, ...extra });

/** A timed step: when it started, how long it takes, and the end worked out from both. */
const timed = (step: string, time = "Time taken") => [
  item("datetime", `${step} start`, { value: "{now}" }),
  duration(time),
  calc(`${step} end`, `[${step} start] + [${time}]`),
];

const SATISFACTORY = ["Satisfactory", "Not satisfactory"];
const PROCESS = ["SLA", "FDM"];

/** The BMR's controlled header, the same on every part of it. */
const BMR = { clause: "ISO 13485:2016 & India MDR 2017", issue: "02", effective: "28-07-2025", rev: "03", docLayout: true };
const BMR_CODE = "JM-F-PRD-015";

/** What every BMR page starts with: which batch this is. */
const batch = (extra: QaItem[] = []) =>
  section("Batch identification", [
    info("BMR No.", "{part.id}"),
    info("Case ID", "{case.id}"),
    info("Item description", "{part.name}"),
    info("Quantity", "{part.qty}"),
    ...extra,
  ], 2);

const doneChecked = () => section("Sign-off", [sign("Done by"), sign("Checked by", "")], 2);
/** Done by the person submitting; Checked by the person chosen to approve. */
const doneCheckedSigned = () =>
  section("Sign-off", [sign("Done by", "", { signer: "submitter" }), sign("Checked by", "", { signer: "approver" })], 2);

const STAGE = {
  request: "Request received",
  batch: "Batch identification",
  design: "Design receipt & file check",
  printSla: "3D printing (SLA)",
  printFdm: "3D printing (FDM)",
  printRun: "3D printing run",
  washing: "Washing",
  curing: "Curing",
  supports: "Support removal",
  qc: "Quality check",
  packing: "Packaging & labelling",
  release: "Batch review & release",
} as const;

function bmrForms(): QaTemplateData[] {
  const form = (n: number, name: string, attach: string[], sections: QaTemplateData["sections"]): QaTemplateData => ({
    name: `BMR ${n} — ${name}`,
    code: `${BMR_CODE}/${n}`,
    ...BMR,
    attach,
    sections,
  });

  return [
    form(1, "Batch identification", [STAGE.batch], [
      batch([
        info("Components", "{part.component}"),
        info("Material", "{part.material}"),
        date("Design receive date", { value: "{today}" }),
        date("Mfd. date", { value: "{today}" }),
        info("Mfg. Lic. / Reg. No.", "{company.licence}"),
        date("Expiry", optional),
      ]),
      section("Sign-off", [sign("Prepared by", "", { signer: "submitter" }), sign("Approved by", "", { signer: "approver" })], 2),
    ]),

    form(2, "Design receipt & file verification", [STAGE.design], [
      section("1. Manufacturing done — file check", [
        info("Files in the request", "{part.files}"),
        item("grid", "Files received", {
          columns: [
            column("File name", "text", { req: true }),
            column("Status", "select", { opts: "Accepted, Rejected", req: true }),
            column("Reason, if rejected", "text"),
          ],
        }),
        calc("No. of files", "count([Files received])"),
        text("Observation"),
      ]),
      section("Raw material", [
        info("QAC material requirement", "{request.materialSpecification}"),
        pick("Raw material — Batch No. / IIR No.", "lots"),
        choose("Material grade", ["Medical", "Non-medical"]),
        check("Material lot verified against its IIR / CoA"),
      ], 2),
      section("Sign-off", [sign("Received by"), sign("Approved by", "")], 2),
    ]),

    form(3, "3D printing setup", [STAGE.printSla, STAGE.printFdm], [
      batch(),
      section("2. 3D printing — setup", [
        info("QAC process requirement", "{request.processCapabilitySpecification}"),
        choose("Printing process", PROCESS),
        pick("Printer (Equipment ID)", "printers", { value: "{part.printer}" }),
        pick("Process parameter set", "params", optional),
        pick("Material — Batch No. / IIR No.", "lots", { qty: true }),
        count("Layer thickness (mm)"),
        yesno("Support optimisation"),
      ], 2),
      doneCheckedSigned(),
    ]),

    form(4, "3D printing run", [STAGE.printRun], [
      batch(),
      section("2. 3D printing — run", [
        ...timed("Print", "Print time"),
        count("No. of parts printed"),
        count("No. of parts rejected"),
        calc("No. of parts accepted", "[No. of parts printed] - [No. of parts rejected]"),
        text("Reason for rejection", whenAny("No. of parts rejected")),
        photo("Build plate photo"),
      ], 2),
      doneCheckedSigned(),
    ]),

    form(5, "Washing record", [STAGE.washing], [
      batch(),
      section("3. Washing", [
        pick("Washing equipment (Equipment ID)", "postproc"),
        count("No. of parts"),
        ...timed("Washing", "Washing time"),
        text("Remarks", optional),
      ], 2),
      doneChecked(),
    ]),

    form(6, "Curing record", [STAGE.curing], [
      batch(),
      section("4. Curing", [
        pick("Curing equipment (Equipment ID)", "postproc"),
        count("No. of parts"),
        ...timed("Curing", "Curing time"),
        count("Curing temperature (°C)"),
        text("Remarks", optional),
      ], 2),
      doneChecked(),
    ]),

    form(7, "Support removal record", [STAGE.supports], [
      batch(),
      section("5. Support removal", [
        info("QAC workmanship requirement", "{request.workmanshipSpecification}"),
        count("No. of parts"),
        ...timed("Support removal"),
        check("Supports removed without damage to the anatomy"),
        text("Remarks", optional),
      ], 2),
      doneChecked(),
    ]),

    form(8, "Quality check & final yield", [STAGE.qc], [
      batch(),
      // Each requirement the QAC set, checked here; a category the QAC left
      // empty is marked N/A.
      ...REQUIREMENTS.map(([title, prefix]) =>
        section(`QAC — ${title}`, [
          info("Specification", `{request.${prefix}Specification}`),
          info("Testing / acceptance method", `{request.${prefix}TestMethod}`),
          check(`Meets the ${title.toLowerCase()} requirement`),
        ], 3),
      ),
      section("Dimensional inspection (drawing balloons)", [
        pick("Measuring equipment used", "measuring", optional),
        item("table", "Balloon inspection", { value: "{balloon.table}" }),
      ]),
      section("6. Quality checking", [
        text("Observation"),
        count("Total parts printed"),
        count("Total parts rejected"),
        calc("Total parts accepted", "[Total parts printed] - [Total parts rejected]"),
        text("Reason for rejection", whenAny("Total parts rejected")),
        photo("Photo of the finished model"),
      ], 2),
      section("7. Final yield", [
        info("Target quantity", "{part.qty}"),
        count("Quantity produced"),
        count("Quantity rejected"),
        calc("Quantity accepted", "[Quantity produced] - [Quantity rejected]"),
        calc("Yield (%)", "round([Quantity accepted] / {part.qty} * 100, 1)"),
      ], 2),
      section("Sign-off", [sign("Quality in-charge")]),
    ]),

    form(9, "Packaging & label check", [STAGE.packing], [
      batch(),
      section("8. Primary & secondary packaging", [
        info("QAC packaging & labelling requirement", "{request.packagingLabellingSpecification}"),
        pick("Zip locking bag — lot", "packaging", { qty: true }),
        pick("Primary label — lot", "packaging", { qty: true }),
        pick("IFU — lot", "packaging", { qty: true }),
        pick("Secondary label — lot", "packaging", { qty: true }),
        pick("Bubble wrap — lot", "packaging", { qty: true }),
        pick("Master carton — lot", "packaging", { qty: true }),
      ], 2),
      section("9. Label QC", [
        count("No. of primary labels"),
        count("No. of secondary labels"),
        check("Labels show BMR No. {part.id} and Case ID {case.id}"),
        text("Observation"),
      ], 2),
      doneChecked(),
    ]),

    form(10, "Batch review & release", [STAGE.release], [
      batch([info("QAC", "JM-F-DND-004 for {part.id}")]),
      section("10. Batch review — Production", [
        check("Batch manufactured as per the approved procedure; this BMR is complete"),
        sign("Production"),
      ]),
      section("10. Batch review — QC", [choose("QC review", SATISFACTORY), sign("QC", "")], 2),
      section("10. Batch review — QA", [choose("QA review", SATISFACTORY), sign("QA", "")], 2),
      section("11. Batch release", [
        choose("Batch release", SATISFACTORY),
        count("Quantity approved"),
        sign("Released by (Quality)", ""),
      ], 3),
    ]),
  ];
}

// --- The workflows ------------------------------------------------------------------------

const START = { emailsNext: ["Stage started — notify owner"] };
const QC = { emailsNext: ["Part ready for QC"], emailsBack: ["Rework required — notify engineer"] };

function stage(name: string, role: string, forms: QaTemplateData[], extra: Partial<WorkflowStage> = {}): WorkflowStage {
  return {
    id: randomUUID(),
    name,
    role,
    days: 1,
    forms: forms.filter((f) => f.attach.includes(name)).map(templateLabel),
    emailsNext: [],
    emailsBack: [],
    tasks: [],
    ...extra,
  };
}

function workflows(forms: QaTemplateData[]): Array<{ name: string; data: WorkflowData }> {
  const build = (process: "SLA" | "FDM"): WorkflowStage[] => [
    stage(STAGE.request, "Engineer", forms, START),
    stage(STAGE.batch, "Manufacturing", forms),
    stage(STAGE.design, "Manufacturing", forms),
    stage(process === "SLA" ? STAGE.printSla : STAGE.printFdm, "Manufacturing", forms),
    stage(STAGE.printRun, "Manufacturing", forms),
    ...(process === "SLA" ? [stage(STAGE.washing, "Manufacturing", forms), stage(STAGE.curing, "Manufacturing", forms)] : []),
    stage(STAGE.supports, "Manufacturing", forms),
    stage(STAGE.qc, "Quality", forms, QC),
    stage(STAGE.packing, "Manufacturing", forms),
    stage(STAGE.release, "Quality", forms),
  ];
  return (["SLA", "FDM"] as const).map((process) => ({
    name: `Anatomical Model — ${process} (In-house)`,
    data: { method: "3D Printing", sourcing: "In-house", vendorId: "", stages: build(process) },
  }));
}

// --- Packaging & labelling the BMR names (section 8) ------------------------------------

const PACKAGING: Array<[name: string, kind: string]> = [
  ["Zip locking bag", "Other"],
  ["Primary label", "Device label"],
  ["IFU — anatomical model", "IFU"],
  ["Secondary label", "Device label"],
  ["Bubble wrap", "Other"],
  ["Master carton", "Inner box / carton"],
];

// --- Run ------------------------------------------------------------------------------------

async function main() {
  const space = await db.space.findUnique({ where: { slug } });
  if (!space) throw new Error(`No space "${slug}".`);
  const actor = actorEmail
    ? await db.user.findFirst({ where: { email: { equals: actorEmail, mode: "insensitive" }, OR: [{ spaceId: space.id }, { isSuperAdmin: true }] } })
    : null;
  if (actorEmail && !actor) throw new Error(`No account ${actorEmail} in ${slug}.`);
  const by = actor?.name ?? SETUP_NAME;

  const done: string[] = [];
  const skipped: string[] = [];
  const log = (action: string, entityType: string, entity: { id: string | null; name: string }, summary: string) =>
    db.auditLog.create({
      data: {
        action,
        entityType,
        spaceId: space.id,
        entityId: entity.id,
        entityName: entity.name,
        summary,
        actorId: actor?.id ?? null,
        actorEmail: actor?.email ?? null,
      },
    });

  // Technology and part type.
  if (await db.technology.findFirst({ where: { spaceId: space.id, name: "3D Printing" } })) skipped.push("technology 3D Printing");
  else {
    await db.technology.create({ data: { spaceId: space.id, name: "3D Printing" } });
    await log("setup.technology_add", "tech", { id: null, name: "3D Printing" }, `Added technology "3D Printing".`);
    done.push("technology 3D Printing");
  }
  const typeTaken = await db.partType.findFirst({
    where: { spaceId: space.id, OR: [{ name: { equals: "Anatomical model", mode: "insensitive" } }, { code: "MDL" }] },
  });
  if (typeTaken) skipped.push(`part type ${typeTaken.name} (${typeTaken.code})`);
  else {
    await db.partType.create({ data: { spaceId: space.id, name: "Anatomical model", code: "MDL" } });
    await log("setup.part_type_add", "parttypes", { id: null, name: "Anatomical model" }, `Added part type "Anatomical model" (MDL).`);
    done.push("part type Anatomical model (MDL)");
  }

  // QA forms: the QAC first, then the BMR.
  const qac = standardTemplates().find((t) => t.code === "JM-F-DND-004")!;
  const forms = [qac, ...bmrForms()];
  const existing = await db.qaTemplate.findMany({ where: { spaceId: space.id }, select: { id: true, code: true, name: true, updatedByName: true } });
  const firstBmr = existing.find((t) => t.code.toUpperCase() === `${BMR_CODE}/1`);
  if (firstBmr && !firstBmr.name.startsWith("BMR 1 — Batch identification")) {
    throw new Error(`${slug} still has the BMR 1 from before the split — run scripts/split-bmr1.ts ${slug} first.`);
  }
  const thirdBmr = existing.find((t) => t.code.toUpperCase() === `${BMR_CODE}/3`);
  if (thirdBmr && !thirdBmr.name.startsWith("BMR 3 — 3D printing setup")) {
    throw new Error(`${slug} still has the BMR 3 from before the split — run scripts/split-bmr3.ts ${slug} first.`);
  }
  const codes = new Set(existing.map((t) => t.code.toUpperCase()));
  const names = new Set(existing.map((t) => t.name.toLowerCase()));
  for (const form of forms) {
    const parsed = templateSchema.safeParse(form);
    if (!parsed.success) throw new Error(`${form.name}: ${parsed.error.issues[0]?.message}`);
    const problem = templateProblem(form);
    if (problem) throw new Error(`${form.name}: ${problem}`);
    if (codes.has(form.code.toUpperCase()) || names.has(form.name.toLowerCase())) {
      const mine = existing.find((t) => t.code.toUpperCase() === form.code.toUpperCase());
      // Upgrade only a BMR form this script made and nobody has edited since.
      if (upgrade && mine && form.code.startsWith(BMR_CODE) && mine.updatedByName === SETUP_NAME) {
        await db.qaTemplate.update({
          where: { id: mine.id },
          data: { sections: form.sections as unknown as Prisma.InputJsonArray, attach: form.attach, updatedByName: SETUP_NAME },
        });
        await log("qa.template_save", "qa", { id: mine.id, name: form.name }, `Saved QA form ${form.code} — dates, durations and calculated fields`);
        done.push(`QA form ${templateLabel(form)} (upgraded)`);
      } else if (upgrade && mine && form.code.startsWith(BMR_CODE)) {
        skipped.push(`QA form ${templateLabel(form)} — edited by ${mine.updatedByName ?? "someone"}, not upgraded`);
      } else {
        skipped.push(`QA form ${templateLabel(form)}`);
      }
      continue;
    }
    const created = await db.qaTemplate.create({
      data: {
        spaceId: space.id,
        name: form.name,
        code: form.code.toUpperCase(),
        clause: form.clause,
        issue: form.issue,
        effective: form.effective,
        rev: form.rev,
        docLayout: form.docLayout,
        attach: form.attach,
        sections: form.sections as unknown as Prisma.InputJsonArray,
        updatedByName: by,
      },
    });
    await log("qa.template_create", "qa", { id: created.id, name: created.name }, `Created QA form ${created.code}`);
    done.push(`QA form ${templateLabel(form)}`);
  }

  // Workflows.
  for (const workflow of workflows(forms)) {
    const taken = await db.resource.findFirst({ where: { spaceId: space.id, kind: "workflows", name: workflow.name, archivedAt: null } });
    if (taken) {
      skipped.push(`workflow ${workflow.name}`);
      continue;
    }
    const created = await db.resource.create({
      data: { spaceId: space.id, kind: "workflows", name: workflow.name, status: "", data: workflow.data as unknown as Prisma.InputJsonObject },
    });
    await log("resource.create", "workflows", { id: created.id, name: created.name }, `Added a workflow (${workflow.data.stages.length} stages).`);
    done.push(`workflow ${workflow.name} (${workflow.data.stages.length} stages)`);
  }

  // Packaging & labelling items.
  for (const [name, kind] of PACKAGING) {
    const taken = await db.resource.findFirst({
      where: { spaceId: space.id, kind: "packaging", name: { equals: name, mode: "insensitive" }, archivedAt: null },
    });
    if (taken) {
      skipped.push(`packaging ${name}`);
      continue;
    }
    const created = await db.resource.create({
      data: { spaceId: space.id, kind: "packaging", name, status: "Approved", data: { code: "", kind, spec: "", reorder: "" } },
    });
    await log("resource.create", "packaging", { id: created.id, name }, `Added an item.`);
    done.push(`packaging ${name}`);
  }

  console.log(`Space: ${space.name} (${slug})${actor ? ` — recorded as ${actor.email}` : ""}`);
  console.log(`Created (${done.length}):\n  ${done.join("\n  ") || "—"}`);
  console.log(`Already there, left as is (${skipped.length}):\n  ${skipped.join("\n  ") || "—"}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
