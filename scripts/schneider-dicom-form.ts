import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";

import { readCatalog } from "../src/lib/cases/catalog";
import { item, section, templateLabel, templateProblem, type GridColumn, type QaTemplateData } from "../src/lib/qa/template";

/**
 * The first case-stage QA form: "Incoming Medical File (DICOM)", form 820/009
 * Ver. E, as the customer's controlled form has it — banner header (effective ·
 * validity · form · ver.), the case and its doctor, the list of medical images
 * received, additional information and the filler's signed sign-off — and
 * attached to the "Customer requirement" stage of the space's products.
 *
 * Every other QA form of the space is removed — the forms already filled on
 * parts keep their own copies — and taken off the workflow and product stages
 * that listed it.
 *
 * Safe to run again: an existing form of that code is kept as edited.
 *
 *   npx tsx scripts/schneider-dicom-form.ts            (the schneider space)
 *   npx tsx scripts/schneider-dicom-form.ts <space>
 */

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const STAGE = "Customer requirement";

const column = (id: string, label: string, kind: GridColumn["kind"], opts = "", req = false): GridColumn => ({ id, label, kind, opts, formula: "", req });

export function dicomForm(): QaTemplateData {
  return {
    name: "Incoming Medical File (DICOM)",
    code: "820/009",
    clause: "",
    issue: "",
    effective: "Aug. 13th 2025",
    validity: "Aug. 13th 2028",
    rev: "E",
    docLayout: true,
    docStyle: "banner",
    // Filled on the case, at its Customer requirement stage — not on parts.
    attach: [],
    sections: [
      section(
        "",
        [
          item("info", "Case Number", { value: "{case.id}" }),
          item("text", "Project Manager", { value: "{user.name}" }),
          item("info", "MD Name", { value: "{case.surgeon}" }),
          item("date", "Last Date Updated", { value: "{today}" }),
        ],
        2,
      ),
      section("Medical Images List", [
        item("grid", "Medical images", {
          columns: [
            column("scanType", "Scan Type", "select", "CT, CBCT, MRI, X-ray, Surface scan, Other", true),
            column("scanDate", "Scan Date", "date", "", true),
            column("received", "Received Method", "select", "CD, USB, Upload, Download link, Email, PACS"),
            column("series", "Series", "text"),
            column("validation", "File Validation", "select", "Valid, Invalid, Partial", true),
            column("fileName", "File Name", "text"),
            column("comments", "Comments", "text"),
          ],
        }),
      ]),
      section("Additional information", [item("text", "Additional information", { req: false })]),
      section("", [item("sign", "Signed by", { value: "", signer: "approver", style: "image" })]),
    ],
  };
}

export async function setupDicomForm(db: PrismaClient, spaceId: string): Promise<string> {
  const form = dicomForm();
  const problem = templateProblem(form);
  if (problem) throw new Error(problem);

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
  const label = templateLabel(template);

  // Only the customer's own controlled forms (820/…): the others go, and leave the stages that listed them.
  const others = await db.qaTemplate.findMany({ where: { spaceId, NOT: [{ id: template.id }, { code: { startsWith: "820/" } }, { code: { startsWith: "830/" } }, { code: { startsWith: "QUO-" } }, { code: { startsWith: "SMP-" } }, { code: { startsWith: "PSI-" } }, { code: { startsWith: "850/" } }] }, select: { id: true, name: true, code: true } });
  const gone = new Set(others.map((t) => templateLabel(t)));
  if (others.length) {
    await db.qaTemplate.deleteMany({ where: { id: { in: others.map((t) => t.id) } } });
    const workflows = await db.resource.findMany({ where: { spaceId, kind: "workflows" } });
    for (const wf of workflows) {
      const data = (wf.data ?? {}) as { stages?: Array<{ forms?: string[] }> };
      if (!data.stages?.some((st) => st.forms?.some((f) => gone.has(f)))) continue;
      const stages = data.stages.map((st) => ({ ...st, forms: (st.forms ?? []).filter((f) => !gone.has(f)) }));
      await db.resource.update({ where: { id: wf.id }, data: { data: { ...data, stages } as unknown as Prisma.InputJsonObject } });
    }
  }

  // The Customer requirement stage of every active product lists it.
  const products = await db.resource.findMany({ where: { spaceId, kind: "products", archivedAt: null } });
  let attached = 0;
  for (const p of products) {
    const data = readCatalog(p.data);
    const add = (stages: typeof data.stages) =>
      stages
        .map((st) => ({ ...st, forms: st.forms.filter((f) => !gone.has(f)) }))
        .map((st) => (st.name === STAGE && !st.forms.includes(label) ? ((attached += 1), { ...st, forms: [...st.forms, label] }) : st));
    const next = { ...(p.data as object), stages: add(data.stages), scopes: data.scopes.map((sc) => ({ ...sc, stages: add(sc.stages) })) };
    await db.resource.update({ where: { id: p.id }, data: { data: next as unknown as Prisma.InputJsonObject } });
  }
  return `${label} — the only QA form (${others.length} removed); on the "${STAGE}" stage of ${attached} more product stage list${attached === 1 ? "" : "s"}`;
}

async function main() {
  const slug = process.argv[2] ?? "schneider";
  const space = await db.space.findUnique({ where: { slug } });
  if (!space) throw new Error(`No "${slug}" space.`);
  console.log(`${space.name}: ${await setupDicomForm(db, space.id)}.`);
}

if (process.argv[1] && /schneider-dicom-form\.ts$/.test(process.argv[1])) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
