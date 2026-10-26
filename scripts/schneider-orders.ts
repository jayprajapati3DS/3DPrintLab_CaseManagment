import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";

import { hashPassword } from "../src/lib/auth/password";
import { readCatalog } from "../src/lib/cases/catalog";
import { item, section, templateLabel, templateProblem, type GridColumn, type QaTemplateData } from "../src/lib/qa/template";

/**
 * Schneider's Order tab, as a sample: three order forms between the surgeon and
 * the team — the plan approval and the order confirmation added to every
 * Orthognathic and Cranial Plate case (the plan approval to a 3D PDF case),
 * the device selection offered to add — and Dr. A. Cohen signing in with
 * surgeon access to check, fill and sign them.
 *
 * Safe to run again.
 *
 *   npx tsx scripts/schneider-orders.ts            (the schneider space)
 */

/** The sample surgeon's sign-in: their own cases' Order tab only. */
export const SURGEON_LOGIN = { name: "Dr. A. Cohen", email: "a.cohen@scmc-3dlab.example", password: "Surgeon-Demo-2026" };

const column = (id: string, label: string, kind: GridColumn["kind"], opts = "", req = false): GridColumn => ({ id, label, kind, opts, formula: "", req });

/** An order form: the case at the top; the team's part, then the surgeon's; prepared by the team, approved by the surgeon. */
function orderForm(name: string, code: string, team: QaTemplateData["sections"][number]["items"], surgeon: QaTemplateData["sections"][number]["items"]): QaTemplateData {
  return {
    name,
    code,
    clause: "",
    issue: "1",
    effective: "Oct. 21st 2026",
    validity: "Oct. 21st 2029",
    rev: "A",
    docLayout: true,
    docStyle: "banner",
    usedFor: "order",
    attach: [],
    sections: [
      section(
        "",
        [
          item("info", "Case", { value: "{case.id}" }),
          item("info", "Product", { value: "{case.product}" }),
          item("info", "Surgeon", { value: "{case.surgeon}" }),
          item("info", "Surgery date", { value: "{case.surgeryDate}" }),
        ],
        2,
      ),
      section("Prepared by the team", team),
      // Not required: the team sends it before the surgeon has filled their part.
      section("For the surgeon", surgeon.map((i) => ({ ...i, req: false }))),
      section(
        "",
        [
          item("sign", "Prepared by", { value: "", signer: "submitter" }),
          // The surgeon is chosen as the approver when the team sends it.
          item("sign", "Approved by (surgeon)", { value: "", signer: "approver" }),
        ],
        2,
      ),
    ],
  };
}

export function orderTemplates(): QaTemplateData[] {
  return [
    orderForm(
      "Surgical Plan Approval",
      "ORD-001",
      [
        item("text", "Planned procedure"),
        item("text", "Plan summary — osteotomies, movements, devices", { req: false }),
        item("date", "Planning session date", { value: "{today}" }),
        item("select", "Planning software", { src: "custom", opts: "3D Surgical Platform, Materialise ProPlan CMF, Other" }),
        item("file", "Planning report (PDF)", { req: false, anyFile: true }),
      ],
      [
        item("yesno", "I approve the surgical plan as presented", { expect: "Yes" }),
        item("text", "Changes requested", { req: false }),
        item("text", "Surgeon's comments", { req: false, allowImages: true }),
      ],
    ),
    orderForm(
      "Order Confirmation",
      "ORD-002",
      [
        item("grid", "Devices ordered", {
          columns: [column("device", "Device", "text", "", true), column("qty", "Qty", "number", "", true), column("material", "Material", "select", "MED610, Ultem1010CG, Ti6Al4V, Other")],
        }),
        item("date", "Requested delivery date"),
        item("text", "Quotation reference", { req: false }),
      ],
      [
        item("yesno", "Order confirmed", { expect: "Yes" }),
        item("select", "Delivery to", { src: "custom", opts: "Operating theatre, CSSD, Surgeon's office" }),
        item("text", "Surgeon's comments", { req: false }),
      ],
    ),
    orderForm(
      "Implant & Device Selection",
      "ORD-003",
      [item("text", "Devices proposed by the team", { req: false })],
      [
        item("select", "Fixation system", { src: "custom", opts: "KLS Martin, DePuy Synthes, Stryker, Other" }),
        item("select", "Screw diameter", { src: "custom", opts: "1.5 mm, 2.0 mm, 2.3 mm" }),
        item("yesno", "Guides to be sterilised by the hospital", { req: false }),
        item("text", "Surgeon's notes", { req: false }),
      ],
    ),
  ];
}

export async function setupOrders(db: PrismaClient, spaceId: string): Promise<string> {
  // --- The forms ------------------------------------------------------------------------------------
  const label = new Map<string, string>();
  for (const form of orderTemplates()) {
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
          usedFor: "order",
          updatedByName: "Setup",
        },
      });
    }
    label.set(form.code, templateLabel(t));
  }
  const L = (code: string) => label.get(code)!;

  // --- The products: added to every case, and offered ---------------------------------------------------
  const plan: Record<string, { auto: string[]; offered: string[] }> = {
    Orthognathic: { auto: [L("ORD-001"), L("ORD-002")], offered: [L("ORD-003")] },
    "Cranial Plate": { auto: [L("ORD-001"), L("ORD-002")], offered: [L("ORD-003")] },
    "3D PDF": { auto: [L("ORD-001")], offered: [] },
  };
  for (const [name, orderForms] of Object.entries(plan)) {
    const product = await db.resource.findFirst({ where: { spaceId, kind: "products", name, archivedAt: null }, select: { id: true, data: true } });
    if (!product) continue;
    const current = readCatalog(product.data).orderForms;
    if (current && (current.auto.length || current.offered.length)) continue;
    await db.resource.update({ where: { id: product.id }, data: { data: { ...((product.data ?? {}) as object), orderForms } as Prisma.InputJsonObject } });
  }

  // --- The surgeon's sign-in -------------------------------------------------------------------------------
  const surgeon = await db.user.findFirst({ where: { spaceId, email: SURGEON_LOGIN.email } });
  if (surgeon && (!surgeon.passwordHash || !surgeon.surgeonOnly)) {
    await db.user.update({ where: { id: surgeon.id }, data: { surgeonOnly: true, ...(surgeon.passwordHash ? {} : { passwordHash: await hashPassword(SURGEON_LOGIN.password) }) } });
  }
  return `3 order forms (ORD-001…003) on Orthognathic, Cranial Plate and 3D PDF; surgeon login ${SURGEON_LOGIN.email}`;
}

async function main() {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const slug = process.argv[2] ?? "schneider";
    const space = await db.space.findUnique({ where: { slug } });
    if (!space) throw new Error(`No "${slug}" space.`);
    console.log(`${space.name}: ${await setupOrders(db, space.id)}.`);
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && /schneider-orders\.ts$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
