import "dotenv/config";

import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";

import { item, section, templateLabel, templateProblem, type GridColumn, type QaTemplateData } from "../src/lib/qa/template";
import { DEFAULT_BALLOON_COLUMNS, setupProblem, type FieldType, type RequestField, type RequestFormDef, type RequestSection } from "../src/lib/parts/request-form";
import type { WorkflowData, WorkflowStage } from "../src/lib/resources/config";

/**
 * Schneider's production workflows, by what is made — PSI (jig / implant),
 * Practice PSI (Instructions, 3D Printing Control) and Anatomical Model (Model
 * Pre Production, Instructions, 3D Printing Control); with their quality forms
 * (names as the customer's design platform has them; fields not yet given by
 * the customer are a sample to refine).
 * The earlier three workflows are archived; parts made on them keep their own
 * copy of its stages. Products offer all workflows.
 *
 * Safe to run again.
 *
 *   npx tsx scripts/schneider-production.ts            (the schneider space)
 */

const column = (id: string, label: string, kind: GridColumn["kind"], opts = "", req = false, formula = ""): GridColumn => ({ id, label, kind, opts, formula, req });

/** A part's form: the part and its case at the top, the approver's sign-off at the end. */
function partForm(name: string, code: string, sections: QaTemplateData["sections"]): QaTemplateData {
  return {
    name,
    code,
    clause: "",
    issue: "",
    effective: "Oct. 17th 2026",
    validity: "Oct. 17th 2029",
    rev: "A",
    docLayout: true,
    docStyle: "banner",
    attach: [],
    sections: [
      section(
        "",
        [
          item("info", "Part ID", { value: "{part.id}" }),
          item("info", "Part name", { value: "{part.name}" }),
          item("info", "Case", { value: "{case.id}" }),
          item("info", "Surgeon", { value: "{case.surgeon}" }),
        ],
        2,
      ),
      ...sections,
      section("", [item("sign", "Signed by", { value: "", signer: "approver", style: "image" }), item("date", "Date", { value: "{today}" })], 2),
    ],
  };
}

/**
 * Production Order - PSI, 830/009 Ver. F — what the part request said, laid
 * out as the customer's form: the project, the ULTEM specimen when there is
 * one, the part (the parts list's row), and who signs the order.
 */
function productionOrder(): QaTemplateData {
  return {
    name: "Production Order PSI (Jig/Implant)",
    code: "830/009",
    clause: "",
    issue: "",
    effective: "Aug. 23rd 2026",
    validity: "Aug. 23rd 2029",
    rev: "F",
    docLayout: true,
    docStyle: "banner",
    attach: [],
    sections: [
      section(
        "Project Details",
        [
          item("info", "Project Number", { value: "{case.id}" }),
          item("info", "Type of Production Order", { value: "{request.orderType}" }),
          item("date", "Fill-In Date", { value: "{today}" }),
          item("info", "Latest Delivery Date", { value: "{part.due}" }),
          item("text", "Inspected By", { value: "{request.inspectedBy}" }),
        ],
        3,
      ),
      section(
        "Specimen For ULTEM production only",
        [
          item("info", "Specimen", { value: "{request.ultemSpecimen}" }),
          item("info", "Specimen part name", { value: "{request.specimenName}" }),
          item("info", "Specimen material", { value: "{request.specimenMaterial}" }),
          item("info", "Specimen production site", { value: "{request.specimenSite}" }),
        ],
        2,
      ),
      section(
        "Parts List",
        [
          item("info", "Part ID", { value: "{part.id}" }),
          item("info", "Part Name", { value: "{part.name}" }),
          item("info", "Qty.", { value: "{part.qty}" }),
          item("info", "Tech.", { value: "{request.tech}" }),
          item("info", "Material", { value: "{part.material}" }),
          item("info", "Production Site", { value: "{site.name}" }),
          item("info", "Remarks", { value: "{request.remarks}" }),
        ],
        3,
      ),
      section("Drawing", [item("image", "Drawing", { value: "{request.drawing}" })]),
      section("", [item("sign", "Signed by", { value: "", signer: "approver", style: "image" }), item("date", "Date", { value: "{today}" })], 2),
    ],
  };
}

/**
 * Custom Made Device Functional Requirements, 830/016 Ver. F — the project, the
 * instruction list (each PSI with its tool, size, comment and picture), and
 * who prepared and who signs it.
 */
function functionalRequirements(): QaTemplateData {
  return {
    name: "Custom Made Device Functional Requirements",
    code: "830/016",
    clause: "",
    issue: "",
    effective: "Aug. 23rd 2026",
    validity: "Aug. 23rd 2029",
    rev: "F",
    docLayout: true,
    docStyle: "banner",
    attach: [],
    sections: [
      section("", [item("info", "Project Number", { value: "{case.id}" }), item("info", "Surgery Date", { value: "{case.surgeryDate}" })], 2),
      section("Instruction list", [
        item("grid", "Instruction list", {
          columns: [
            column("psi", "PSI [i]", "text", "", true),
            column("tool", "Tool Name", "select", "Labeling, Drill guide, Cutting slot, Screw hole, Positioning, Other", true),
            column("size", "Tool Size", "text"),
            column("comment", "Comment", "text"),
            column("image", "PSI Image", "image"),
          ],
        }),
      ]),
      section(
        "",
        [
          item("sign", "Prepared by", { value: "", signer: "submitter" }),
          item("date", "Fill-In Date", { value: "{today}" }),
          item("sign", "Signee", { value: "", signer: "approver", style: "image" }),
        ],
        3,
      ),
    ],
  };
}

/**
 * PSI Production - Manufacturing Information, 850/Form/011 rev G — the tray,
 * the raw materials (material, serial and lot numbers), when it printed and
 * where; then what was taken from stock, on which printer, how, and by whom.
 */
function manufacturingInformation(): QaTemplateData {
  return {
    name: "PSI Production - Manufacturing Information",
    code: "850/Form/011",
    clause: "",
    issue: "",
    effective: "",
    validity: "",
    rev: "G",
    docLayout: true,
    docStyle: "banner",
    attach: [],
    sections: [
      section("", [item("text", "Tray Number")]),
      section("PSI Raw Materials List", [
        item("grid", "PSI raw materials", {
          columns: [
            column("material", "Material", "select", "Polyjet - Med610, Polyjet - SUP706 support, FDM - Ultem1010CG, Other", true),
            column("serial", "Serial number", "text"),
            column("lot", "Lot number", "text", "", true),
          ],
        }),
      ]),
      section(
        "Printing",
        [
          item("date", "Start Printing Date", { value: "{today}" }),
          item("time", "Start Printing Time"),
          item("date", "Finish Printing Date", { req: false }),
          item("time", "Finish Printing Time", { req: false }),
          item("select", "Printing site", { src: "custom", opts: "Schneider, Netanya, Other" }),
          item("text", "If other", { req: false, showIf: { ref: "Printing site", op: "eq", value: "Other" } }),
        ],
        2,
      ),
      section(
        "Printer and material from stock",
        [
          item("select", "Printer", { src: "printers" }),
          item("select", "Model material lot", { src: "lots", qty: true }),
          item("select", "Support material lot", { src: "lots", qty: true, req: false }),
          item("select", "Print parameter set", { src: "params" }),
          item("select", "Print preparation software", { src: "software" }),
          item("select", "Operator", { src: "operators" }),
        ],
        2,
      ),
    ],
  };
}

/** The PSIs of a production, as the customer's checklist columns them. */
const PSI_COLUMNS = "Ji, Jii, Jiii, Jiv, Jv";

/**
 * Custom made device post manufacturing checklist, 850/Form/002 rev F — the
 * PSIs it covers, and each post-printing check ticked for each PSI that
 * passed it; with the equipment used.
 */
function postManufacturingChecklist(): QaTemplateData {
  const check = (label: string) => item("select", label, { src: "custom", multi: true, opts: PSI_COLUMNS });
  return {
    name: "Custom made device post manufacturing checklist",
    code: "850/Form/002",
    clause: "",
    issue: "",
    effective: "",
    validity: "",
    rev: "F",
    docLayout: true,
    docStyle: "banner",
    attach: [],
    sections: [
      section("", [item("select", "Related PSI (A-Z)", { src: "custom", opts: "A, A-B, A-C, A-D, A-E, A-F, A-G, A-H, Other" })]),
      section("Post printing verification", [
        item("info", "How to fill", { value: "Tick, for each check, every PSI (Ji…Jv) that passed it." }),
        check("Verify that the quantity of printed PSI is according to the surgery plan and each PSI passed the manufacturing test"),
        check("No support material remaining's left on the PSI"),
        check("Check that the identifying number on the PSI is readable (J#)"),
        check("All the PSI holes are passing through and their diameter are bigger than 0.75 mm (Go\\No Go)"),
        check("Functional testing - verify the selected surgery tools fit the PSI"),
        check("Firmly attach an identification tag with a matching number to the PSI (according to 93-42-EEC)"),
        check(
          "Make sure there is enough time before the required delivery date to clean and pack the PSI by a subcontractor. Otherwise the PSI will be sent to the Hospital uncleaned and unpacked",
        ),
      ]),
      section(
        "Equipment",
        [
          item("select", "Post-processing equipment", { src: "postproc" }),
          item("select", "Measuring instrument (Go / No Go)", { src: "measuring", req: false }),
          item("text", "Notes", { req: false, allowImages: true }),
        ],
        2,
      ),
    ],
  };
}

/**
 * Production Order – Anatomical Model, 830/Form/003 rev F — the filling
 * instructions, whether the doctor approved the planning, the parts list (each
 * file with how it is printed, and the manufacturer's checks on it), defective
 * parts, and where it is assembled with what files.
 */
function modelProductionOrder(): QaTemplateData {
  const sites = "Schneider, Netanya";
  return {
    name: "Production Order – Anatomical Model",
    code: "830/Form/003",
    clause: "",
    issue: "",
    effective: "",
    validity: "",
    rev: "F",
    docLayout: true,
    docStyle: "banner",
    attach: [],
    sections: [
      section("", [
        item("info", "Filling Instructions", {
          value: [
            '"Parts List" Table – Manufacturer columns: filling instructions for columns with the "*" sign.',
            "",
            "Support Removal & Manufacturing Control:",
            "1. Verify there is no support remaining on the part.",
            "2. Check that the colors and materials of the part match the requirements.",
            '3. Look for defects in the part. If there are any, use the "Defective Parts" table to handle them.',
            "",
            "Project ID (Text Recognition):",
            "1. Compare the project identification number to the documentation.",
            "2. Check the perfection of all the logos and writings.",
            "",
            "Status: select the value that best describes the state of each part.",
            "Inspected by: the name of the person performing the tasks.",
            "",
            "NOTE: In case of production failure, please refer to Production Provision QAP 850/750.",
          ].join("\n"),
        }),
      ]),
      section(
        "",
        [
          item("info", "Project Number", { value: "{case.id}" }),
          item("info", "Part ID", { value: "{part.id}" }),
          item("yesno", "Did the doctor (client) approve the planning?", { expect: "Yes" }),
          item("date", "Delivery Due Date", { value: "{part.due}" }),
        ],
        2,
      ),
      section("Parts List", [
        item("grid", "Parts list", {
          columns: [
            column("img", "Part Image", "image"),
            column("file", "File Name", "text", "", true),
            column("qty", "Qty", "number", "", true),
            column("tech", "Tech.", "select", "Polyjet, FDM, SLA, SLS, Other", true),
            column("material", "Material", "select", "ABS (FDM), PLA (FDM), Ultem1010CG (FDM), VeroUltra (Polyjet), Agilus30 (Polyjet), Digital Anatomy (Polyjet), Other", true),
            column("color", "Color", "select", "Ivory, White, Clear, Red, Blue, Yellow, Multi-color, Other"),
            column("infill", "Infill", "select", "Sparse, Sparse - high density, Solid"),
            column("remarks", "Remarks", "text"),
            column("site", "Production Site", "select", sites, true),
            column("support", "Support Removal & Manufacturing Control *", "select", "Yes, No", true),
            column("text", "Text Recognition *", "select", "OK, Not OK", true),
            column("status", "Status *", "select", "Approved, Defective, Reprint, On hold", true),
            column("inspected", "Inspected by *", "text", "", true),
          ],
        }),
      ]),
      section("Defective Parts", [
        item("grid", "Defective parts", {
          req: false,
          columns: [
            column("file", "File Name", "text", "", true),
            column("defect", "Defect description", "text", "", true),
            column("action", "Action", "select", "Reprint, Repair, Use as is, Scrap", true),
            column("img", "Image", "image"),
          ],
        }),
      ]),
      section(
        "",
        [
          item("text", "Additional information", { req: false }),
          item("select", "Assembly Site", { src: "custom", opts: sites }),
          item("file", "Assembly Instructions", { req: false, anyFile: true }),
          item("file", "Files for Printing", { anyFile: true }),
        ],
        2,
      ),
      section("", [item("sign", "Signed by", { value: "", signer: "approver", style: "image" }), item("date", "Date", { value: "{today}" })], 2),
    ],
  };
}

export function psiForms(): QaTemplateData[] {
  return [
    productionOrder(),
    functionalRequirements(),
    manufacturingInformation(),
    partForm("Accuracy Test For Printer Axis", "PSI-04", [
      section("Accuracy test", [
        item("select", "Printer tested", { src: "printers" }),
        item("select", "Measuring instrument", { src: "measuring" }),
        item("number", "Tolerance (± mm)", { value: "0.2" }),
        item("grid", "Axis measurements", {
          columns: [
            column("axis", "Axis", "select", "X, Y, Z", true),
            column("nominal", "Nominal (mm)", "number", "", true),
            column("measured", "Measured (mm)", "number", "", true),
            column("dev", "Deviation (mm)", "calc", "", false, "[Measured (mm)] - [Nominal (mm)]"),
            column("result", "Result", "select", "Pass, Fail", true),
          ],
        }),
      ]),
    ]),
    partForm("Custom Made Device - Functional Results", "PSI-05", [
      section("Functional results", [
        item("grid", "Results", {
          columns: [column("req", "Requirement", "text", "", true), column("result", "Result", "select", "Pass, Fail, N/A", true), column("remarks", "Remarks", "text")],
        }),
        item("select", "Measuring instrument", { src: "measuring", req: false }),
        item("yesno", "Device meets its functional requirements", { expect: "Yes" }),
      ]),
    ]),
    partForm("Witness Piece verification Check", "PSI-07", [
      section("Witness piece", [
        item("text", "Witness piece", { value: "{request.specimenName}" }),
        item("text", "Material", { value: "{request.specimenMaterial}" }),
        item("select", "Printer used", { src: "printers" }),
        item("select", "Testing equipment", { src: "measuring" }),
        item("grid", "Tensile test", {
          columns: [
            column("sample", "Sample #", "text", "", true),
            column("strength", "Tensile strength (MPa)", "number", "", true),
            column("elong", "Elongation (%)", "number"),
            column("result", "Result", "select", "Pass, Fail", true),
          ],
        }),
        item("yesno", "Witness piece meets its specification", { expect: "Yes" }),
        item("text", "Remarks", { req: false, allowImages: true }),
      ]),
    ]),
    partForm("To-do list before cleaning and packing", "PSI-08", [
      section("Before cleaning and packing", [
        item("select", "Operator", { src: "operators" }),
        item("yesno", "All parts printed as on the production order", { expect: "Yes" }),
        item("yesno", "Supports removed and parts cured", { expect: "Yes" }),
        item("yesno", "Visual inspection done", { expect: "Yes" }),
        item("yesno", "Labels / part IDs verified", { expect: "Yes" }),
        item("yesno", "Witness piece check approved (ULTEM only)", { req: false }),
        item("yesno", "Production documentation complete", { expect: "Yes" }),
      ]),
    ]),
    partForm("Cleaning and packing checklist", "PSI-09", [
      section(
        "Cleaning",
        [
          item("select", "Cleaning method", { src: "custom", opts: "Ultrasonic bath, Manual cleaning, Washer-disinfector" }),
          item("select", "Cleaning equipment", { src: "postproc" }),
          item("datetime", "Cleaning start", { value: "{now}" }),
          item("datetime", "Cleaning end", { req: false }),
          item("yesno", "Cleaned per procedure", { expect: "Yes" }),
          item("yesno", "Dried completely", { expect: "Yes" }),
          item("yesno", "Visual inspection after cleaning", { expect: "Yes" }),
        ],
        2,
      ),
      section(
        "Packing",
        [
          item("select", "Sterilization pouch", { src: "packaging", qty: true }),
          item("select", "Label", { src: "packaging", qty: true, req: false }),
          item("yesno", "Packed in sterilization pouch", { expect: "Yes" }),
          item("yesno", "Pouch sealed and labelled", { expect: "Yes" }),
          item("text", "Pouch lot No."),
          item("text", "Remarks", { req: false, allowImages: true }),
        ],
        2,
      ),
    ]),
    partForm("C.O.C", "PSI-10", [
      section("Certificate of conformity", [
        item("info", "Statement", {
          value:
            "We hereby certify that the device(s) listed below were manufactured and inspected in accordance with the production order and the applicable procedures, and conform to the specified requirements.",
        }),
        item("info", "Production order", { value: "{part.id}" }),
        item("select", "Material lot", { src: "lots", req: false }),
        item("grid", "Devices", {
          columns: [column("device", "Device", "text", "", true), column("qty", "Qty.", "number", "", true), column("lot", "Lot / batch", "text")],
        }),
      ]),
    ]),
    postManufacturingChecklist(),
    // Practice PSI.
    partForm("Manufacturing Control For Practice PSI", "PSI-11", [
      section("Practice PSI", [
        item("info", "Note", { value: "Practice PSI — for surgical training only, not for use on a patient." }),
        item("number", "Quantity of practice PSI to print"),
        item("text", "Tray Number"),
      ]),
      section(
        "Printing",
        [
          item("select", "Printer", { src: "printers" }),
          item("select", "Model material lot", { src: "lots", qty: true }),
          item("select", "Support material lot", { src: "lots", qty: true, req: false }),
          item("select", "Print parameter set", { src: "params" }),
          item("select", "Print preparation software", { src: "software" }),
          item("select", "Operator", { src: "operators" }),
          item("date", "Start Printing Date", { value: "{today}" }),
          item("date", "Finish Printing Date", { req: false }),
        ],
        2,
      ),
    ]),
    partForm("Practice PSI post manufacturing checklist", "PSI-12", [
      section("Post printing verification", [
        item("yesno", "Quantity of practice PSI is according to the surgery plan", { expect: "Yes" }),
        item("yesno", "No support material left on the practice PSI", { expect: "Yes" }),
        item("yesno", "Identifying number on the practice PSI is readable", { expect: "Yes" }),
        item("yesno", "Marked / labelled as practice — not for surgical use", { expect: "Yes" }),
        item("select", "Post-processing equipment", { src: "postproc", req: false }),
        item("text", "Notes", { req: false, allowImages: true }),
      ]),
    ]),
    // Anatomical Model.
    partForm("Anatomical model - Design Review", "PSI-13", [
      section("Design review", [
        item("yesno", "Model matches the approved segmentation", { expect: "Yes" }),
        item("yesno", "Anatomy, side and region as requested", { expect: "Yes" }),
        item("yesno", "Model at scale 1:1", { expect: "Yes" }),
        item("number", "Minimum wall thickness (mm)", { req: false }),
        item("yesno", "Parts / colours separated as requested", { req: false }),
        item("yesno", "Print files (STL) checked and exported", { expect: "Yes" }),
        item("text", "Reviewer comments", { req: false, allowImages: true }),
      ]),
    ]),
    modelProductionOrder(),
    partForm("Anatomical model post printing verification", "PSI-15", [
      section("Post printing verification", [
        item("select", "Printer used", { src: "printers" }),
        item("select", "Model material lot", { src: "lots", qty: true, req: false }),
        item("yesno", "Quantity of models as on the production order", { expect: "Yes" }),
        item("yesno", "Support material removed", { expect: "Yes" }),
        item("yesno", "Visual inspection — no defects, breaks or missing parts", { expect: "Yes" }),
        item("yesno", "Model labelled with the part ID", { expect: "Yes" }),
        item("text", "Notes", { req: false, allowImages: true }),
      ]),
    ]),
  ];
}

/** A field of the request form: built in (key) or the lab's own (var). */
function ask(id: string, label: string, type: FieldType, extra: Partial<RequestField> = {}): RequestField {
  return { id, key: "", var: "", def: "", label, type, show: true, req: false, locked: false, options: [], fileTypes: [], columns: [], allowLinks: false, ...extra };
}
const built = (key: string, label: string, type: FieldType, extra: Partial<RequestField> = {}) => ask(`f-${key}`, label, type, { key, ...extra });

/**
 * The lab's one part request form, "Standard" — the fields of its production
 * order (830/009): the project, the part as a row of its parts list, the ULTEM
 * specimen, and the print files.
 */
export function standardRequestSections(): RequestSection[] {
  return [
    {
      id: "s-project",
      title: "Project Details",
      cols: 3,
      fields: [
        built("case", "Project Number (case)", "case", { req: true }),
        ask("f-orderType", "Type of Production Order", "select", { var: "orderType", req: true, options: ["PSI - Surgery Device(s)", "Practice PSI", "Anatomical Model"] }),
        built("due", "Latest Delivery Date", "date", { req: true }),
        ask("f-inspectedBy", "Inspected By", "text", { var: "inspectedBy" }),
        built("priority", "Priority", "priority"),
      ],
    },
    {
      id: "s-part",
      title: "Part",
      cols: 3,
      fields: [
        built("name", "Part Name", "text", { req: true, locked: true }),
        built("qty", "Qty.", "number", { req: true, locked: true }),
        built("sourcing", "Made", "sourcing", { req: true, def: "In-house" }),
        built("vendor", "Vendor", "vendor"),
        built("site", "Manufacturing site", "site", { req: true }),
        built("workflow", "Production workflow", "workflow", { req: true }),
        ask("f-tech", "Tech.", "select", { var: "tech", req: true, options: ["Polyjet", "FDM", "SLA", "SLS", "Other"], def: "Polyjet" }),
        built("material", "Material", "material"),
        ask("f-productionSite", "Production Site", "select", { var: "productionSite", req: false, show: false, options: ["Schneider", "Netanya"], def: "Schneider" }),
        built("type", "Part type", "parttype"),
        ask("f-drawing", "Drawing", "image", { var: "drawing" }),
        ask("f-remarks", "Remarks", "textarea", { var: "remarks" }),
      ],
    },
    {
      id: "s-ultem",
      title: "Specimen For ULTEM production only",
      cols: 2,
      fields: [
        ask("f-ultemSpecimen", "Witness specimen needed (ULTEM)", "checkbox", { var: "ultemSpecimen" }),
        ask("f-specimenName", "Specimen part name", "text", { var: "specimenName", def: "S3D_00120_Witness Piece (ASTM D638 Type 1)" }),
        ask("f-specimenMaterial", "Specimen material", "text", { var: "specimenMaterial", def: "Ultem1010CG" }),
        ask("f-specimenSite", "Specimen production site", "select", { var: "specimenSite", options: ["Netanya", "Schneider"], def: "Netanya" }),
      ],
    },
    {
      id: "s-production",
      title: "Production",
      cols: 2,
      fields: [
        built("printer", "Printer / resource", "printer", { show: false }),
        built("notes", "Notes for production", "textarea", { show: false }),
      ],
    },
    {
      id: "s-files",
      title: "Files",
      cols: 1,
      fields: [built("files", "Files for printing", "file", { fileTypes: ["STL", "3MF", "STEP", "PDF"], allowLinks: true })],
    },
    {
      id: "s-drawing",
      title: "Inspection Drawing",
      cols: 1,
      fields: [built("balloon", "Drawing with balloon characteristics", "balloon", { show: false, columns: DEFAULT_BALLOON_COLUMNS.map((c) => ({ ...c })) })],
    },
  ];
}

const stage = (name: string, days: number, forms: string[], extra: Partial<WorkflowStage> = {}): WorkflowStage => ({
  id: `pw-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  name,
  role: "",
  days,
  forms,
  formsRequired: true,
  emailsNext: [],
  emailsBack: [],
  tasks: [],
  ...extra,
});

const OLD = ["Anatomical Model — Stratasys PolyJet", "Patient-Specific Surgical Guide — PolyJet MED610", "Patient-Specific Splint — PolyJet MED610"];

export async function setupProductionWorkflows(db: PrismaClient, spaceId: string): Promise<string> {
  // The production order began as a sample (PSI-01): it becomes 830/009, and the stages listing it follow.
  const draft = await db.qaTemplate.findFirst({ where: { spaceId, code: "PSI-01" } });
  if (draft) {
    const order = productionOrder();
    const before = templateLabel(draft);
    const updated = await db.qaTemplate.update({
      where: { id: draft.id },
      data: { name: order.name, code: order.code, effective: order.effective, validity: order.validity ?? "", rev: order.rev, sections: order.sections as unknown as Prisma.InputJsonArray },
    });
    const after = templateLabel(updated);
    for (const wf of await db.resource.findMany({ where: { spaceId, kind: "workflows" }, select: { id: true, data: true } })) {
      const data = (wf.data ?? {}) as unknown as WorkflowData;
      if (!data.stages?.some((st) => st.forms?.includes(before))) continue;
      const stages = data.stages.map((st) => ({ ...st, forms: st.forms.map((f) => (f === before ? after : f)) }));
      await db.resource.update({ where: { id: wf.id }, data: { data: { ...data, stages } as unknown as Prisma.InputJsonObject } });
    }
  }

  for (const [oldCode, real] of [["PSI-03", manufacturingInformation()], ["PSI-06", postManufacturingChecklist()], ["PSI-14", modelProductionOrder()]] as const) {
    const draft03 = await db.qaTemplate.findFirst({ where: { spaceId, code: oldCode } });
    if (draft03) {
      const before = templateLabel(draft03);
      const updated = await db.qaTemplate.update({
        where: { id: draft03.id },
        data: { name: real.name, code: real.code, effective: real.effective, validity: real.validity ?? "", rev: real.rev, sections: real.sections as unknown as Prisma.InputJsonArray },
      });
      const after = templateLabel(updated);
      for (const wf of await db.resource.findMany({ where: { spaceId, kind: "workflows" }, select: { id: true, data: true } })) {
        const data = (wf.data ?? {}) as unknown as WorkflowData;
        if (!data.stages?.some((st) => st.forms?.includes(before))) continue;
        const stages = data.stages.map((st) => ({ ...st, forms: st.forms.map((f) => (f === before ? after : f)) }));
        await db.resource.update({ where: { id: wf.id }, data: { data: { ...data, stages } as unknown as Prisma.InputJsonObject } });
      }
      // Parts already given it: their stage copies list it by its new label, and unfilled copies take the new fields.
      for (const part of await db.part.findMany({ where: { spaceId }, select: { id: true, stages: true } })) {
        const own = (Array.isArray(part.stages) ? part.stages : []) as unknown as WorkflowStage[];
        if (!own.some((st) => st.forms?.includes(before))) continue;
        await db.part.update({ where: { id: part.id }, data: { stages: own.map((st) => ({ ...st, forms: st.forms.map((f) => (f === before ? after : f)) })) as unknown as Prisma.InputJsonArray } });
      }
      await db.partForm.updateMany({
        where: { templateId: draft03.id, savedAt: null, status: { in: ["Upcoming", "In progress"] } },
        data: { name: real.name, code: real.code, effective: real.effective, validity: real.validity ?? "", rev: real.rev, sections: real.sections as unknown as Prisma.InputJsonArray },
      });
    }
  }
  const firstDraft = await db.qaTemplate.findFirst({ where: { spaceId, code: "PSI-02" } });
  if (firstDraft) {
    const real = functionalRequirements();
    const before = templateLabel(firstDraft);
    const updated = await db.qaTemplate.update({
      where: { id: firstDraft.id },
      data: { name: real.name, code: real.code, effective: real.effective, validity: real.validity ?? "", rev: real.rev, sections: real.sections as unknown as Prisma.InputJsonArray },
    });
    const after = templateLabel(updated);
    for (const wf of await db.resource.findMany({ where: { spaceId, kind: "workflows" }, select: { id: true, data: true } })) {
      const data = (wf.data ?? {}) as unknown as WorkflowData;
      if (!data.stages?.some((st) => st.forms?.includes(before))) continue;
      const stages = data.stages.map((st) => ({ ...st, forms: st.forms.map((f) => (f === before ? after : f)) }));
      await db.resource.update({ where: { id: wf.id }, data: { data: { ...data, stages } as unknown as Prisma.InputJsonObject } });
    }
    // Parts already given the sample: their copy follows too, while not filled.
    await db.partForm.updateMany({
      where: { templateId: firstDraft.id, status: { in: ["Upcoming", "In progress"] }, savedAt: null },
      data: { name: real.name, code: real.code, effective: real.effective, validity: real.validity ?? "", rev: real.rev, sections: real.sections as unknown as Prisma.InputJsonArray },
    });
  }

  const LIBRARY = new Set(["printers", "lots", "measuring", "postproc", "operators", "params", "software", "packaging"]);
  for (const form of psiForms().filter((f) => f.code.startsWith("PSI-"))) {
    const stored = await db.qaTemplate.findFirst({ where: { spaceId, code: form.code } });
    const items = (stored?.sections as unknown as QaTemplateData["sections"] | undefined)?.flatMap((sec) => sec.items) ?? [];
    const wanted = form.sections.flatMap((sec) => sec.items).filter((i) => LIBRARY.has(i.src ?? ""));
    if (!stored || wanted.length === 0 || wanted.every((w) => items.some((i) => i.label === w.label && i.src === w.src))) continue;
    await db.qaTemplate.update({ where: { id: stored.id }, data: { sections: form.sections as unknown as Prisma.InputJsonArray } });
    await db.partForm.updateMany({ where: { templateId: stored.id, savedAt: null, status: { in: ["Upcoming", "In progress"] } }, data: { sections: form.sections as unknown as Prisma.InputJsonArray } });
  }

  // The forms.
  const label = new Map<string, string>();
  for (const form of psiForms()) {
    const problem = templateProblem(form);
    if (problem) throw new Error(`${form.code}: ${problem}`);
    let t = await db.qaTemplate.findFirst({ where: { spaceId, code: form.code } });
    if (!t) {
      t = await db.qaTemplate.create({
        data: {
          spaceId,
          name: form.name,
          code: form.code,
          clause: form.clause,
          issue: form.issue,
          effective: form.effective,
          validity: form.validity ?? "",
          rev: form.rev,
          docLayout: form.docLayout,
          docStyle: form.docStyle ?? "banner",
          attach: [],
          sections: form.sections as unknown as Prisma.InputJsonArray,
          usedFor: "manufacturing",
        updatedByName: "Setup",
        },
      });
    }
    label.set(form.code, templateLabel(t));
  }
  const L = (code: string) => label.get(code)!;

  // The workflows: PSI as given; Practice PSI and Anatomical Model with the forms that apply to them.
  const workflows: Array<{
    name: string;
    stages: WorkflowStage[];
    /** The stages are exactly these (parts keep their own copy). */
    exact?: boolean;
    /** Made outside, at a vendor's site (its sites are set in schneider-sites.ts). */
    outsourced?: boolean;
  }> = [
    {
      name: "PSI (Jig / Implant)",
      stages: [
        stage("Instructions", 1, [L("830/009"), L("830/016")]),
        stage("3D Printing Control", 2, [L("850/Form/011"), L("PSI-04")]),
        stage("Post Process", 1, [L("PSI-05"), L("850/Form/002")], { optionalForms: [L("PSI-05")] }),
        stage("Control Room", 1, [L("PSI-07"), L("PSI-08")]),
        stage("Clean Room", 1, [L("PSI-09"), L("PSI-10")]),
      ],
    },
    // Sample: a PSI printed by a vendor. The vendor's people fill its manufacturing record and certificate
    // of conformity, the hospital's QA approves them, and the vendor moves it on; "Shipped from vendor"
    // moves on only when it is received on a goods receipt.
    {
      name: "PSI (Jig / Implant) — Outsourced",
      outsourced: true,
      exact: true,
      stages: [
        stage("Instructions", 1, [L("830/009"), L("830/016")]),
        stage("Vendor manufacturing", 4, [L("850/Form/011"), L("PSI-10")], { role: "Site operator" }),
        stage("Shipped from vendor", 2, []),
        stage("Incoming inspection", 1, [L("850/Form/002")]),
        stage("Clean Room", 1, [L("PSI-09")]),
      ],
    },
    // As the customer's design platform has them; only the design review must be approved to move on.
    {
      name: "Practice PSI",
      exact: true,
      stages: [
        stage("Instructions", 1, [L("PSI-11")], { optionalForms: [L("PSI-11")] }),
        stage("3D Printing Control", 2, [L("PSI-12")], { optionalForms: [L("PSI-12")] }),
      ],
    },
    {
      name: "Anatomical Model",
      exact: true,
      stages: [
        stage("Model Pre Production", 1, [L("PSI-13")]),
        stage("Instructions", 1, [L("830/Form/003")], { optionalForms: [L("830/Form/003")] }),
        stage("3D Printing Control", 2, [L("PSI-15")], { optionalForms: [L("PSI-15")] }),
      ],
    },
  ];
  for (const wf of workflows) {
    const found = await db.resource.findFirst({ where: { spaceId, kind: "workflows", name: wf.name, archivedAt: null }, select: { id: true, data: true } });
    if (found && wf.exact) {
      const data = (found.data ?? {}) as unknown as WorkflowData;
      const want = wf.stages.map((st) => ({ name: st.name, forms: st.forms, optionalForms: st.optionalForms ?? [] }));
      const have = (data.stages ?? []).map((st) => ({ name: st.name, forms: st.forms, optionalForms: st.optionalForms ?? [] }));
      if (JSON.stringify(want) !== JSON.stringify(have)) {
        const stages = wf.stages.map((st) => ({ ...st, id: data.stages?.find((o) => o.name === st.name)?.id ?? `${st.id}-${randomUUID().slice(0, 8)}` }));
        await db.resource.update({ where: { id: found.id }, data: { data: { ...data, stages } as unknown as Prisma.InputJsonObject } });
      }
      continue;
    }
    if (found) {
      // Stages added since it was made: appended, the existing ones as edited.
      const data = (found.data ?? {}) as unknown as WorkflowData;
      const have = new Set((data.stages ?? []).map((st) => st.name));
      const extra = wf.stages.filter((st) => !have.has(st.name)).map((st) => ({ ...st, id: `${st.id}-${randomUUID().slice(0, 8)}` }));
      if (extra.length) await db.resource.update({ where: { id: found.id }, data: { data: { ...data, stages: [...(data.stages ?? []), ...extra] } as unknown as Prisma.InputJsonObject } });
      continue;
    }
    const data: WorkflowData = {
      method: "3D Printing",
      sourcing: wf.outsourced ? "Outsourced" : "In-house",
      vendorId: "",
      stages: wf.stages.map((s) => ({ ...s, id: `${s.id}-${randomUUID().slice(0, 8)}` })),
    };
    await db.resource.create({ data: { spaceId, kind: "workflows", name: wf.name, status: "Active", data: data as unknown as Prisma.InputJsonObject } });
  }

  const psi = await db.resource.findFirst({ where: { spaceId, kind: "workflows", name: "PSI (Jig / Implant)", archivedAt: null }, select: { id: true, data: true } });
  if (psi) {
    const live = ((psi.data ?? {}) as unknown as WorkflowData).stages ?? [];
    const templates = await db.qaTemplate.findMany({ where: { spaceId } });
    for (const part of await db.part.findMany({ where: { spaceId, workflowId: psi.id }, select: { id: true, stages: true } })) {
      const own = (Array.isArray(part.stages) ? part.stages : []) as unknown as WorkflowStage[];
      if (own.length >= live.length) continue;
      const added = live.slice(own.length);
      await db.part.update({ where: { id: part.id }, data: { stages: [...own, ...added] as unknown as Prisma.InputJsonArray, stageCount: live.length } });
      const data: Prisma.PartFormCreateManyInput[] = [];
      added.forEach((st, k) => {
        for (const t of templates.filter((t) => st.forms.includes(templateLabel(t)))) {
          data.push({
            spaceId, partId: part.id, templateId: t.id, stageIndex: own.length + k, stageName: st.name,
            name: t.name, code: t.code, clause: t.clause, issue: t.issue, effective: t.effective, rev: t.rev,
            docLayout: t.docLayout, validity: t.validity, docStyle: t.docStyle, sections: t.sections as Prisma.InputJsonValue,
            status: "Upcoming", values: {}, measured: {}, quantities: {}, snap: {},
          });
        }
      });
      if (data.length) await db.partForm.createMany({ data });
    }
  }

  // One part request form, "Standard"; the earlier ones are archived.
  const sections = standardRequestSections();
  const standardForm: RequestFormDef = { id: `std-po-${spaceId}`.slice(0, 80), name: "Standard", description: "Production order: the project, the part, the ULTEM specimen and the print files.", isDefault: true, sections };
  const problem = setupProblem({ rule: { prefix: "SCMC", sep: "-", tokens: [] }, sections });
  if (problem) throw new Error(`Request form: ${problem}`);
  const existing = await db.partRequestForm.findFirst({ where: { id: standardForm.id } });
  if (existing) {
    // Made and Vendor asked first, above the workflow (they began lower down, the vendor hidden).
    const stored = (existing.sections ?? []) as unknown as RequestSection[];
    const wanted = sections.flatMap((sec) => sec.fields).filter((f) => f.key === "sourcing" || f.key === "vendor");
    const flat = stored.flatMap((sec) => sec.fields);
    const wfAt = flat.findIndex((f) => f.key === "workflow");
    const madeAt = flat.findIndex((f) => f.key === "sourcing");
    if (wfAt >= 0 && (madeAt < 0 || madeAt > wfAt)) {
      const next = stored
        .map((sec) => ({ ...sec, fields: sec.fields.filter((f) => f.key !== "sourcing" && f.key !== "vendor") }))
        .map((sec) => {
          const at = sec.fields.findIndex((f) => f.key === "workflow");
          return at < 0 ? sec : { ...sec, fields: [...sec.fields.slice(0, at), ...wanted, ...sec.fields.slice(at)] };
        });
      const problem = setupProblem({ rule: { prefix: "SCMC", sep: "-", tokens: [] }, sections: next });
      if (problem) throw new Error(`Request form: ${problem}`);
      await db.partRequestForm.update({ where: { id: existing.id }, data: { sections: next as unknown as Prisma.InputJsonValue } });
    }
  }

  if (!existing) {
    await db.partRequestForm.updateMany({ where: { spaceId, archivedAt: null }, data: { archivedAt: new Date(), isDefault: false } });
    await db.partRequestForm.create({
      data: { id: standardForm.id, spaceId, name: standardForm.name, description: standardForm.description, isDefault: true, position: 0, sections: sections as unknown as Prisma.InputJsonValue, updatedByName: "Setup" },
    });
  }

  // The earlier ones go; products offer every workflow.
  const archived = await db.resource.updateMany({ where: { spaceId, kind: "workflows", name: { in: OLD }, archivedAt: null }, data: { archivedAt: new Date() } });
  const products = await db.resource.findMany({ where: { spaceId, kind: "products", archivedAt: null }, select: { id: true, data: true } });
  for (const p of products) {
    await db.resource.update({ where: { id: p.id }, data: { data: { ...((p.data ?? {}) as object), workflowIds: [] } as Prisma.InputJsonObject } });
  }
  return `${workflows.map((w) => w.name).join(", ")} — ${psiForms().length} PSI forms; ${archived.count} earlier workflow${archived.count === 1 ? "" : "s"} archived; products offer all workflows`;
}

async function main() {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const slug = process.argv[2] ?? "schneider";
    const space = await db.space.findUnique({ where: { slug } });
    if (!space) throw new Error(`No "${slug}" space.`);
    console.log(`${space.name}: ${await setupProductionWorkflows(db, space.id)}.`);
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && /schneider-production\.ts$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
