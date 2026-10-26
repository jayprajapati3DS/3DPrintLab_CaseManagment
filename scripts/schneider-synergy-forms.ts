import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";

import { readCatalog } from "../src/lib/cases/catalog";
import { item, section, templateLabel, templateProblem, type GridColumn, type QaTemplateData } from "../src/lib/qa/template";

/** The status each form is filled at. */
const STATUS: Record<string, string | string[]> = {
  "820/005": "Case received",
  "820/010": "Customer requirement",
  "QUO-001": "Quotation",
  "SMP-WT": "Quotation confirmed",
  "SMP-PU": ["Quotation confirmed", "Sterilization & autoclave", "Case completed"],
  "SMP-ORD": "Quotation confirmed",
  "SMP-PRE": "Quotation confirmed",
  "SMP-IFU": "Quotation confirmed",
  "830/Form/001": "Segmentation",
  "830/008": "Design",
  "SMP-CMD": "Production",
  "SMP-AUTO": "Sterilization & autoclave",
  "SMP-SCMD": "Sterilization & autoclave",
  "SMP-DEL": "Delivery",
  "SMP-PSIE": "Case completed",
  "SMP-SSQ": "Case completed",
};
const statusesOf = (code: string): string[] => [STATUS[code] ?? []].flat();

/** A status tried and dropped (user, 2026-10-17): its forms are filled at "Case completed" instead. */
const DROPPED = "Project Summary";

/**
 * Two more of the customer's controlled case forms, as QA forms — banner
 * header (effective · validity · form · ver.), filled on the case:
 *
 *   820/010 Ver. D  First Meeting Summary
 *   820/005 Ver. E  Incoming Order Information
 *
 * What the case already knows (case ID, surgeon, hospital, department,
 * project manager, dates, patient initials, diagnosis) is filled in from it.
 * The document-control page of 820/005 — authorization, revision history,
 * distribution — comes first, filled in from the controlled document and
 * read-only on every record. Incoming Order Information goes on the "Case
 * received" status of the space's products, First Meeting Summary on
 * "Customer requirement" (beside the DICOM form).
 *
 * Safe to run again: a form of the same code is kept as edited.
 *
 *   npx tsx scripts/schneider-synergy-forms.ts            (the schneider space)
 *   npx tsx scripts/schneider-synergy-forms.ts <space>
 */

const column = (id: string, label: string, kind: GridColumn["kind"], opts = "", req = false): GridColumn => ({ id, label, kind, opts, formula: "", req });
const optional = { req: false };

export function firstMeetingSummary(): QaTemplateData {
  return {
    name: "First Meeting Summary",
    code: "820/010",
    clause: "",
    issue: "",
    effective: "Aug. 13th 2025",
    validity: "Aug. 13th 2028",
    rev: "D",
    docLayout: true,
    docStyle: "banner",
    attach: [],
    sections: [
      section(
        "",
        [
          item("info", "Project Number", { value: "{case.id}" }),
          item("date", "Meeting date", { value: "{today}" }),
          item("text", "Project manager", { value: "{case.projectManager}" }),
          item("info", "MD name", { value: "{case.surgeon}" }),
        ],
        2,
      ),
      section("Parts to Segment", [
        item("grid", "Parts to segment", {
          columns: [column("description", "Segmentation Description", "text", "", true), column("comments", "Comments", "text")],
        }),
      ]),
      section("Detailed Surgical Planning", [item("text", "Detailed surgical planning", { value: "{case.procedure}" })]),
      section("Additional information", [item("text", "Additional information", optional)]),
      section("Products Requested", [
        item("grid", "Products requested", {
          columns: [
            column("item", "Item", "select", "Model / Anatomical Model, PSI, Mold, Other", true),
            column("info", "Additional Information", "text"),
            column("catalogue", "Catalogue No.", "select", "M0NAMa0 - (1006) FDM Model, J1SUIa0 - (1010) Sterile cutting PSI, J2SUIa0 - (1011) Sterile Guiding PSI, Other"),
          ],
        }),
      ]),
      section("Open Issues", [
        item("grid", "Open issues", {
          req: false,
          columns: [column("item", "Item", "text", "", true), column("info", "Additional Information", "text"), column("status", "Status", "select", "Open, In progress, Closed")],
        }),
      ]),
      section(
        "",
        [item("sign", "Signed by", { value: "", signer: "approver", style: "image" }), item("date", "Fill-in date", { value: "{today}" })],
        2,
      ),
    ],
  };
}

/** 820/005's first page: who reviewed and approved the document, its revisions, who it goes to. */
export function incomingOrderControl() {
  return [
    section(
      "Authorization",
      [
        item("info", "Reviewed by", { value: "Sharon Shapira · QA Manager · Aug 26th 2025" }),
        item("info", "Approved by", { value: "Michael Librus · C.E.O · Aug 26th 2025" }),
      ],
      2,
    ),
    section("Revision History", [
      item("info", "Rev. A", { value: "Sharon Shapira · Original · Jul. 8th 2018" }),
      item("info", "Rev. B", { value: "Sharon Shapira · Update to comply with 3DHUB · Aug. 20th 2020" }),
      item("info", "Rev. C", {
        value: "Zohar Tzipor · Minor · 1. Update general note 2. Change “Patient ID” column to “Order ID” 3. Adding “Surgical Plan” value · Nov. 25th 2020",
      }),
      item("info", "Rev. D", { value: "Zohar Tzipor · Minor · 1. Add confirmation table 2. Add special requirements table · Jun 22nd 2022" }),
      item("info", "Rev. E", { value: "Zohar Tzipor · Minor · Change form header and update office new address · Aug 26th 2025" }),
    ]),
    section(
      "Distribution List",
      [item("info", "Company", { value: "All employees" }), item("info", "Interested parties", { value: "—" })],
      2,
    ),
  ];
}

export function incomingOrderInformation(): QaTemplateData {
  return {
    name: "Incoming Order Information",
    code: "820/005",
    clause: "",
    issue: "",
    effective: "Aug. 26th 2025",
    validity: "Aug. 26th 2028",
    rev: "E",
    docLayout: true,
    docStyle: "banner",
    attach: [],
    sections: [
      ...incomingOrderControl(),
      section("", [
        item("info", "Dear Doctor", {
          value:
            "Thank you for contacting us. Please verify the details of this form and make sure that relevant DICOM files, of your patient, are attached. " +
            "By signing the form, you are confirming the case details. The information will then be, automatically and confidentially forwarded to Synergy. " +
            "A medical designer will review your application and the DICOM files you have attached and will get back to you to coordinate an agreed schedule for further processing of the application. " +
            "Looking forwards to working with you. Sincerely, Synergy's team",
        }),
        item("select", "Reported by", { src: "custom", opts: "Designer, Doctor, Project manager" }),
      ]),
      section("Confirmation", [
        item("yesno", "Doctor: Please confirm the contents of the comment above"),
        item("yesno", "Designer: Get the doctor's approval regarding the contents of the comment above"),
        item("select", "Method of reporting", { src: "custom", opts: "By phone, By email, In person, Video call" }),
      ]),
      section(
        "General Information",
        [
          item("info", "Doctor Name", { value: "{case.surgeon}" }),
          item("info", "Hospital", { value: "{case.hospital}" }),
          item("info", "Department", { value: "{case.department}" }),
          item("info", "Surgery Date", { value: "{case.surgeryDate}" }),
          item("info", "Requested Delivery Date", { value: "{case.deliveryDate}" }),
          item("info", "Project Number", { value: "{case.id}" }),
        ],
        3,
      ),
      section(
        "Patient Details",
        [
          item("info", "Initials", { value: "{case.patientInitials}" }),
          item("select", "Gender", { src: "custom", opts: "Female, Male, Other" }),
          item("number", "Age", optional),
          item("date", "Date of Birth", optional),
        ],
        4,
      ),
      section("Project Specification", [
        item("text", "Diagnosis", { value: "{case.diagnosis}" }),
        item("text", "Surgical Plan", { value: "{case.procedure}", req: false }),
      ]),
      section("Special Requirements", [
        item("grid", "Special requirements", {
          req: false,
          columns: [
            column("description", "Description", "text", "", true),
            column("file", "File Related", "text"),
            column("compliance", "Compliance", "select", "Complies, Does not comply, N/A"),
            column("remarks", "Remarks", "text"),
          ],
        }),
      ]),
      section("", [item("sign", "Signed by", { value: "", signer: "approver", style: "image" }), item("date", "Date", { value: "{today}" })], 2),
    ],
  };
}

/**
 * A sample quotation — the customer has no quotation form yet: what is quoted
 * for the case, line by line with totals, its terms and who signs it off.
 * Edit it in QA Form Setup, or replace it with their own when they have one.
 */
export function quotationForm(): QaTemplateData {
  return {
    name: "Quotation (sample)",
    code: "QUO-001",
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
          item("text", "Quotation No.", { value: "Q-{case.id}" }),
          item("date", "Quotation date", { value: "{today}" }),
          item("info", "Project Number", { value: "{case.id}" }),
          item("info", "Product", { value: "{case.product}" }),
        ],
        2,
      ),
      section(
        "Customer",
        [
          item("info", "Hospital", { value: "{case.hospital}" }),
          item("info", "Department", { value: "{case.department}" }),
          item("info", "Surgeon", { value: "{case.surgeon}" }),
          item("text", "Contact person / purchasing", { req: false }),
        ],
        2,
      ),
      section("Quoted items", [
        item("grid", "Quoted items", {
          columns: [
            column("item", "Item", "select", "Segmentation & planning, Anatomical model, Cutting guide (PSI), Guiding PSI, Mold, Plate, Sterilization, Delivery, Other", true),
            column("catalogue", "Catalogue No.", "text"),
            column("description", "Description", "text"),
            column("qty", "Qty", "number", "", true),
            column("price", "Unit price", "number", "", true),
            { ...column("total", "Line total", "calc"), formula: "[Qty] * [Unit price]" },
          ],
        }),
        item("number", "Discount (%)", { req: false, value: "0" }),
        item("calc", "Subtotal", { req: false, formula: 'sum([Quoted items], "Line total")' }),
        item("calc", "Total after discount", { req: false, formula: "round([Subtotal] * (1 - [Discount (%)] / 100), 2)" }),
        item("select", "Currency", { src: "custom", opts: "ILS, USD, EUR" }),
      ]),
      section(
        "Terms",
        [
          item("select", "Valid for", { src: "custom", opts: "14 days, 30 days, 60 days, 90 days" }),
          item("select", "Payment terms", { src: "custom", opts: "Advance payment, Net 30, Net 60, Net 90, Per hospital agreement" }),
          item("number", "Delivery (working days)", { req: false }),
          item("text", "Notes", { req: false }),
        ],
        2,
      ),
      section("Customer response", [
        item("text", "Purchase order No.", { req: false }),
      ]),
      section("", [item("sign", "Signed by", { value: "", signer: "approver", style: "image" }), item("date", "Date", { value: "{today}" })], 2),
    ],
  };
}

/**
 * Segmentation Description, 830/Form/001 rev F — as the customer's design
 * platform has it: who segmented the study, in which software, the parts
 * segmented and the files that came of it.
 */
export function segmentationDescription(): QaTemplateData {
  return {
    name: "Segmentation Description",
    code: "830/Form/001",
    clause: "",
    issue: "",
    effective: "",
    validity: "",
    rev: "F",
    docLayout: true,
    docStyle: "banner",
    attach: [],
    sections: [
      section("Segmentation result", [
        item("info", "Note", { value: 'If the segmentation is made by a physician, specify it in the "Segmentation by" field.' }),
        item("text", "Study information", { req: false }),
      ]),
      section(
        "",
        [
          item("text", "Working file name"),
          item("text", "Segmentation by", { value: "{user.name}" }),
          item("select", "Software", { src: "custom", opts: "Mimics, 3-matic, 3D Slicer, Materialise Innovation Suite, Other" }),
          item("date", "Date", { value: "{today}" }),
        ],
        2,
      ),
      section("Segmentation result", [
        item("grid", "Segmentation result", {
          columns: [
            column("part", "Part name", "text", "", true),
            column("image", "Image", "image"),
            column("scan", "Scan type", "select", "CT, CBCT, MRI, X-ray, Surface scan, Other", true),
            column("fusion", "Resource for fusion", "check"),
          ],
        }),
        item("file", "Fusion Image", { req: false }),
        item("text", "Additional information", { req: false }),
      ]),
      section(
        "Files",
        [
          item("file", "Segmentation working files", { req: false, anyFile: true }),
          item("file", "V1 working files", { req: false, anyFile: true }),
          item("file", "Segmentation video", { req: false, anyFile: true }),
        ],
        3,
      ),
      section("", [item("sign", "Signed by", { value: "", signer: "approver", style: "image" }), item("date", "Signed date", { value: "{today}" })], 2),
    ],
  };
}

/**
 * Design Freeze, 830/008 Ver. F — page by page as the customer's form: the
 * project, the design log (a picture per step), the project scope, general
 * information, the doctor's statement and its sign-off.
 */
export function designFreeze(): QaTemplateData {
  return {
    name: "Design Freeze",
    code: "830/008",
    clause: "",
    issue: "",
    effective: "Aug. 20th 2026",
    validity: "Aug. 20th 2029",
    rev: "F",
    docLayout: true,
    docStyle: "banner",
    attach: [],
    sections: [
      // Page 1: the project, and the design log.
      section(
        "",
        [
          item("info", "Project Number", { value: "{case.id}" }),
          item("info", "M.D. Name", { value: "{case.surgeon}" }),
          item("info", "Project Manager", { value: "{case.projectManager}" }),
        ],
        3,
      ),
      section("Design Log", [
        item("grid", "Design log", {
          columns: [
            column("image", "Image", "image"),
            column(
              "stage",
              "Stage",
              "select",
              "Segmentation, V1- Segmentation Processing, V2- Preoperative Planning, V3- PSI Prototyping, V4- PSI DFM (Design For Manufacturing), IFU- Documentation, Other",
              true,
            ),
            column("date", "Date", "date", "", true),
            column("software", "Software", "select", "Mimics, 3Matic, Other"),
            column("file", "Working File Name", "text"),
            column("tree", "Tree Location", "text"),
            column("designer", "Designer", "text"),
            column("qty", "Qty.", "number"),
            column("remarks", "Remarks", "text"),
          ],
        }),
      ]),
      // Page 2: scope, general information, the doctor's statement.
      section(
        "Project Scope",
        [
          item("select", "Segmentation", { src: "custom", multi: true, opts: "Hard Tissue, Soft Tissue, N/A" }),
          item("select", "Preoperative Planning", { src: "custom", multi: true, opts: "Surgery, Reconstruction Design, Prosthesis design, N/A" }),
          item("select", "Model", { src: "custom", multi: true, opts: "Monochromatic, Multicolor, Agilus, N/A" }),
          item("number", "Model Qty.", { req: false }),
          item("number", "P. PSI Qty.", { req: false }),
          item("number", "S. PSI Qty.", { req: false }),
        ],
        3,
      ),
      section("General Information", [item("text", "General information", { req: false, allowImages: true })]),
      section("Doctor's Statement", [
        item("info", "Statement", {
          value:
            "All PSIs for this project were designed based on medical images of my patient, which I or my organization provided. As the physician overseeing the pre-operative planning, I have reviewed the segmented medical images of the patient and confirm the PSI structure and its intended use. I approve finalizing the planning stage and authorize the submission of the PSI's files for production.",
        }),
        item("text", "Doctor's remarks", { req: false }),
      ]),
      // Page 3: name, date, signature.
      section("", [item("sign", "Signed by", { value: "", signer: "approver", style: "image" }), item("date", "Date", { value: "{today}" })], 2),
    ],
  };
}

/**
 * A sample check before a custom-made device is printed: the approved design
 * and the file printed from it, checked against each other, on which printer
 * and material — and whether it may go to print.
 */
export function cmdVerification(): QaTemplateData {
  return sample("Custom Made Device – verification test before printing", "SMP-CMD", [
    section(
      "Case",
      [
        item("info", "Surgeon", { value: "{case.surgeon}" }),
        item("info", "Hospital", { value: "{case.hospital}" }),
        item("info", "Surgery date", { value: "{case.surgeryDate}" }),
        item("info", "Delivery date", { value: "{case.deliveryDate}" }),
      ],
      2,
    ),
    section(
      "Design to print",
      [
        item("text", "Print file name"),
        item("text", "Design version", { value: "V4" }),
        item("select", "Device type", { src: "custom", multi: true, opts: "Cutting guide (PSI), Guiding PSI, Anatomical model, Mold, Plate, Other" }),
        item("number", "Quantity to print"),
      ],
      2,
    ),
    section("Verification", [
      item("yesno", "Print file matches the approved Design Freeze", { expect: "Yes" }),
      item("yesno", "Part ID / labeling correct on the device", { expect: "Yes" }),
      item("yesno", "Minimum wall thickness and feature size checked", { expect: "Yes" }),
      item("yesno", "Orientation and supports checked", { expect: "Yes" }),
      item("yesno", "Sterilization compatibility confirmed for the material", { expect: "Yes" }),
      item("text", "Measured critical dimension (mm)", { req: false, allowImages: true }),
    ]),
    section(
      "Printing",
      [
        item("select", "Printer", { src: "printers" }),
        item("select", "Material", { src: "materials" }),
        item("select", "Result", { src: "custom", opts: "Approved for printing, Back to design" }),
        item("text", "Remarks", { req: false }),
      ],
      2,
    ),
  ]);
}

/** The forms of a case's last statuses: sterilization, delivery, and its project summary (samples). */
export function closingForms(): QaTemplateData[] {
  const rate = (label: string) => item("select", label, { src: "custom", opts: "5 — Excellent, 4 — Good, 3 — Acceptable, 2 — Poor, 1 — Very poor" });
  return [
    sample("Autoclave", "SMP-AUTO", [
      section(
        "Sterilization cycle",
        [
          item("select", "Autoclave", { src: "custom", opts: "Autoclave 1, Autoclave 2, Hospital CSSD" }),
          item("select", "Sterilization cycle", { src: "steril" }),
          item("text", "Cycle No."),
          item("select", "Program", { src: "custom", opts: "134 °C · 4 min, 134 °C · 18 min, 121 °C · 20 min" }),
          item("datetime", "Cycle start", { value: "{now}" }),
          item("datetime", "Cycle end", { req: false }),
          item("yesno", "Chemical indicator passed", { expect: "Yes" }),
          item("select", "Biological indicator", { src: "custom", opts: "Pass, Fail, N/A" }),
        ],
        2,
      ),
      section("Load", [
        item("grid", "Load contents", { columns: [column("item", "Item", "text", "", true), column("qty", "Qty.", "number", "", true)] }),
        item("file", "Cycle printout", { req: false }),
      ]),
    ]),
    sample("Statement of Custom Made Device Manufacturer", "SMP-SCMD", [
      section("Statement", [
        item("info", "Statement", {
          value:
            "This device is a custom-made device, intended for the sole use of the patient named below, made to the written prescription of the medical practitioner below. It conforms to the general safety and performance requirements, except where stated below with the reasons.",
        }),
        item("info", "Patient", { value: "{case.patientInitials}" }),
        item("info", "Prescribing surgeon", { value: "{case.surgeon}" }),
        item("info", "Hospital", { value: "{case.hospital}" }),
        item("text", "Device description", { value: "{case.product}" }),
        item("yesno", "Device conforms to the general safety and performance requirements", { expect: "Yes" }),
        item("text", "Requirements not fully met, and why", { req: false }),
      ]),
    ]),
    sample("Checklist Before Delivering To Hospital", "SMP-DEL", [
      section("Before delivery", [
        item("yesno", "All devices sterilized and released", { expect: "Yes" }),
        item("yesno", "Packaging intact and labelled", { expect: "Yes" }),
        item("yesno", "IFU included", { expect: "Yes" }),
        item("yesno", "Statement of custom made device included", { expect: "Yes" }),
        item("yesno", "Delivery note prepared", { expect: "Yes" }),
      ]),
      section(
        "Delivery",
        [
          item("select", "Delivery method", { src: "custom", opts: "Courier, Hand delivery, Picked up by the hospital" }),
          item("datetime", "Delivered at", { req: false }),
          item("text", "Received by", { req: false }),
          item("info", "Hospital", { value: "{case.hospital}" }),
        ],
        2,
      ),
    ]),
    sample("Designer - PSI performance evaluation", "SMP-PSIE", [
      section("Performance in surgery", [
        item("select", "Fit during surgery", { src: "custom", opts: "Excellent, Good, Acceptable, Poor" }),
        item("yesno", "Guides used as planned"),
        item("number", "Deviation from the plan (mm)", { req: false }),
        item("select", "Overall evaluation", { src: "custom", opts: "Successful, Successful with remarks, Not successful" }),
        item("text", "Issues and lessons learned", { req: false, allowImages: true }),
      ]),
    ]),
    sample("Surgeon satisfaction questionnaire", "SMP-SSQ", [
      section(
        "Satisfaction",
        [rate("Communication"), rate("Planning quality"), rate("Device fit"), rate("Delivery time"), rate("Overall satisfaction"), item("yesno", "Would use the service again")],
        2,
      ),
      section("Comments", [item("text", "Comments", { req: false })]),
    ]),
  ];
}

/** A simple sample form: the case it is for, what it asks, and who signs it off. */
function sample(name: string, code: string, sections: QaTemplateData["sections"]): QaTemplateData {
  return {
    name: `${name} (sample)`,
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
      section("", [item("info", "Project Number", { value: "{case.id}" }), item("info", "Product", { value: "{case.product}" })], 2),
      ...sections,
      section("", [item("sign", "Signed by", { value: "", signer: "approver", style: "image" }), item("date", "Date", { value: "{today}" })], 2),
    ],
  };
}

/** Five sample forms for "Quotation confirmed" — the customer has none of them yet. */
export function quotationConfirmedForms(): QaTemplateData[] {
  return [
    sample("Work Time", "SMP-WT", [
      section("Work log", [
        item("grid", "Work log", {
          columns: [
            column("date", "Date", "date", "", true),
            column("person", "Person", "text", "", true),
            column("activity", "Activity", "select", "Segmentation, Planning, Design, Meeting, Printing, Other", true),
            column("duration", "Duration", "duration", "", true),
            column("notes", "Notes", "text"),
          ],
        }),
        item("calc", "Total time", { req: false, formula: 'sum([Work log], "Duration")' }),
      ]),
    ]),
    sample("Pending to Update", "SMP-PU", [
      section("Pending updates", [
        item("grid", "Pending updates", {
          columns: [
            column("item", "Item", "text", "", true),
            column("details", "Details", "text"),
            column("owner", "Owner", "text"),
            column("due", "Due", "date"),
            column("status", "Status", "select", "Open, In progress, Done"),
          ],
        }),
        item("text", "Notes", { req: false }),
      ]),
    ]),
    sample("Order", "SMP-ORD", [
      section(
        "Order",
        [
          item("text", "Order No.", { value: "ORD-{case.id}" }),
          item("date", "Order date", { value: "{today}" }),
          item("text", "Purchase order No.", { req: false }),
          item("select", "Order confirmed by", { src: "custom", opts: "Signed PO, Email, Phone" }),
          item("info", "Hospital", { value: "{case.hospital}" }),
          item("info", "Delivery date", { value: "{case.deliveryDate}" }),
        ],
        2,
      ),
      section("Ordered items", [
        item("grid", "Ordered items", {
          columns: [column("item", "Item", "text", "", true), column("catalogue", "Catalogue No.", "text"), column("qty", "Qty", "number", "", true)],
        }),
      ]),
    ]),
    sample("Pre-Order", "SMP-PRE", [
      section(
        "Pre-order",
        [
          item("text", "Pre-order No.", { value: "PRE-{case.id}" }),
          item("date", "Pre-order date", { value: "{today}" }),
          item("yesno", "Quotation approved by the customer"),
          item("yesno", "Budget approval received"),
          item("date", "Expected purchase order date", { req: false }),
          item("text", "Notes", { req: false }),
        ],
        2,
      ),
    ]),
    sample("Instruction For Use (IFU)", "SMP-IFU", [
      section(
        "Instruction For Use",
        [
          item("select", "IFU document", { src: "custom", opts: "IFU — Orthognathic, IFU — Cranial Plate, Other" }),
          item("text", "IFU revision", { value: "A" }),
          item("yesno", "IFU matches the product delivered"),
          item("yesno", "IFU language checked"),
          item("yesno", "IFU included with the delivery"),
          item("file", "IFU file", { req: false }),
        ],
        2,
      ),
    ]),
  ];
}

export async function setupSynergyForms(db: PrismaClient, spaceId: string): Promise<string> {
  // No "Project Summary" status: its forms are on "Case completed" (below); case records follow the status they are now on.
  for (const p of await db.resource.findMany({ where: { spaceId, kind: "products", archivedAt: null } })) {
    const data = readCatalog(p.data);
    const without = (stages: typeof data.stages) => stages.filter((st) => st.name !== DROPPED);
    if (!data.stages.some((st) => st.name === DROPPED) && !data.scopes.some((sc) => sc.stages.some((st) => st.name === DROPPED))) continue;
    const next = { ...(p.data as object), stages: without(data.stages), scopes: data.scopes.map((sc) => ({ ...sc, stages: without(sc.stages) })) };
    await db.resource.update({ where: { id: p.id }, data: { data: next as unknown as Prisma.InputJsonObject } });
  }
  await db.partForm.updateMany({ where: { spaceId, caseId: { not: null }, stageName: DROPPED }, data: { stageName: "Case completed" } });

  const made: string[] = [];
  for (const form of [incomingOrderInformation(), firstMeetingSummary(), quotationForm(), ...quotationConfirmedForms(), segmentationDescription(), designFreeze(), cmdVerification(), ...closingForms()]) {
    const problem = templateProblem(form);
    if (problem) throw new Error(`${form.code}: ${problem}`);
    let template = await db.qaTemplate.findFirst({ where: { spaceId, code: form.code } });
    if (!template) {
      template = await db.qaTemplate.create({
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
          attach: form.attach,
          sections: form.sections as unknown as Prisma.InputJsonArray,
          usedFor: "product",
        updatedByName: "Setup",
        },
      });
    }
    // Made before its first page was part of it: added in front, the rest as edited.
    const kept = (template.sections ?? []) as unknown as Array<{ title: string }>;
    if (form.code === "820/005" && !kept.some((sec) => sec.title === "Authorization")) {
      template = await db.qaTemplate.update({
        where: { id: template.id },
        data: { sections: [...incomingOrderControl(), ...kept] as unknown as Prisma.InputJsonArray, updatedByName: "Setup" },
      });
    }
    made.push(templateLabel(template));
    // On its status, in every active product (and sub-scope) that has it.
    const label = templateLabel(template);
    const products = await db.resource.findMany({ where: { spaceId, kind: "products", archivedAt: null } });
    for (const p of products) {
      const data = readCatalog(p.data);
      const add = (stages: typeof data.stages) => stages.map((st) => (statusesOf(form.code).includes(st.name) && !st.forms.includes(label) ? { ...st, forms: [...st.forms, label] } : st));
      const next = { ...(p.data as object), stages: add(data.stages), scopes: data.scopes.map((sc) => ({ ...sc, stages: add(sc.stages) })) };
      await db.resource.update({ where: { id: p.id }, data: { data: next as unknown as Prisma.InputJsonObject } });
    }
  }
  // Two sample forms made before they used the libraries: brought up to date, with unfilled copies on cases.
  for (const form of [cmdVerification(), ...closingForms().filter((f) => f.code === "SMP-AUTO")]) {
    const stored = await db.qaTemplate.findFirst({ where: { spaceId, code: form.code } });
    const items = (stored?.sections as unknown as QaTemplateData["sections"] | undefined)?.flatMap((sec) => sec.items) ?? [];
    if (!stored || items.some((i) => ["printers", "materials", "steril"].includes(i.src ?? ""))) continue;
    await db.qaTemplate.update({ where: { id: stored.id }, data: { sections: form.sections as unknown as Prisma.InputJsonArray } });
    await db.partForm.updateMany({ where: { templateId: stored.id, savedAt: null, status: { in: ["Upcoming", "In progress"] } }, data: { sections: form.sections as unknown as Prisma.InputJsonArray } });
  }
  return `${made.join(", ")} — on ${[...new Set(Object.values(STATUS).flat())].map((x) => `"${x}"`).join(", ")}`;
}

async function main() {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const slug = process.argv[2] ?? "schneider";
    const space = await db.space.findUnique({ where: { slug } });
    if (!space) throw new Error(`No "${slug}" space.`);
    console.log(`${space.name}: ${await setupSynergyForms(db, space.id)}.`);
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && /schneider-synergy-forms\.ts$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
