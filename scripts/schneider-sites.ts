import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";

import { hashPassword } from "../src/lib/auth/password";
import { setupProblem, type RequestField, type RequestSection } from "../src/lib/parts/request-form";
import { templateLabel, type QaTemplateData } from "../src/lib/qa/template";
import type { WorkflowStage } from "../src/lib/resources/config";

/**
 * Schneider's manufacturing sites, as a sample: its own 3D lab, the partner
 * site at Netanya (ULTEM specimens), and an outsourced vendor's site. Their
 * equipment is set to them (materials, parameters and software stay shared),
 * the lab's people are members, and the vendor's operator has a site-only
 * account. The part request asks the site; the production order shows it.
 * Parts already made are placed at their site.
 *
 * Safe to run again.
 *
 *   npx tsx scripts/schneider-sites.ts            (the schneider space)
 */

/** The vendor's operator: signs in at the space's address with this password, and sees only the vendor's parts. */
export const VENDOR_LOGIN = { email: "avi.peretz@stratasys-direct.example", password: "Vendor-Demo-2026" };

interface SiteDef {
  name: string;
  status: string;
  data: Record<string, string>;
}

export async function setupSites(db: PrismaClient, spaceId: string): Promise<string> {
  const byName = async (kind: string, name: string) => db.resource.findFirst({ where: { spaceId, kind, name, archivedAt: null }, select: { id: true, data: true } });
  const vendor = await byName("vendors", "Stratasys (via IL distributor)");

  // --- The sites ------------------------------------------------------------------------------
  const defs: SiteDef[] = [
    {
      name: "Schneider 3D Lab",
      status: "Approved",
      data: { code: "SCMC-3D", type: "In-house", vendorId: "", city: "Petah Tikva", address: "Schneider Children's Medical Center, 14 Kaplan St., Petah Tikva", contact: "Dr. Yael Ben-Ami — 3D Lab", certificate: "ISO 13485:2016 — hospital QMS", certExpiry: "2028-03-31" },
    },
    {
      name: "Netanya Production Site",
      status: "Approved",
      data: { code: "NTN-3D", type: "Partner hospital", vendorId: "", city: "Netanya", address: "Partner 3D printing centre, Netanya", contact: "Production lead — Netanya", certificate: "ISO 13485:2016", certExpiry: "2027-11-30" },
    },
    {
      name: "Stratasys Direct Israel",
      status: "Approved",
      data: { code: "SDI", type: "External vendor", vendorId: vendor?.id ?? "", city: "Rehovot", address: "Stratasys Direct, Rehovot Science Park", contact: "Avi Peretz — production", certificate: "ISO 13485:2016 — cert. SDI-4321", certExpiry: "2027-06-30" },
    },
  ];
  const sites: Record<string, string> = {};
  for (const d of defs) {
    const found = await byName("sites", d.name);
    const id = found
      ? found.id
      : (await db.resource.create({ data: { spaceId, kind: "sites", name: d.name, status: d.status, data: d.data as Prisma.InputJsonObject } })).id;
    sites[d.name] = id;
  }
  const LAB = sites["Schneider 3D Lab"];
  const NETANYA = sites["Netanya Production Site"];
  const VENDOR = sites["Stratasys Direct Israel"];

  // --- Equipment at its site; materials, parameters and software shared ----------------------------
  const setSite = async (kind: string, name: string, siteId: string) => {
    const r = await byName(kind, name);
    if (!r) return;
    const data = (r.data ?? {}) as Record<string, unknown>;
    if (data.siteId === siteId) return;
    await db.resource.update({ where: { id: r.id }, data: { data: { ...data, siteId } as Prisma.InputJsonObject } });
  };
  for (const [kind, name] of [
    ["printers", "Stratasys J5 Medijet"],
    ["postproc", "Support soak tank (2% NaOH)"],
    ["postproc", "Waterjet support removal station"],
    ["measuring", "Digital caliper 150 mm"],
    ["steril", "Steam 134 °C — hospital CSSD"],
    ["operators", "Dana Weiss"],
    ["operators", "Itai Rosen"],
    ["packaging", "Patient-specific device label"],
  ] as const) {
    await setSite(kind, name, LAB);
  }
  // Each other site's own: what is made there, and who makes it.
  const own = [
    { kind: "printers", name: "Stratasys F900 (ULTEM)", status: "Available", siteId: NETANYA, data: { assetId: "PR-FDM-02", maker: "Stratasys", model: "F900", tech: "FDM", location: "Netanya — production hall", volume: "914 × 610 × 914 mm" } },
    { kind: "printers", name: "Stratasys J850 Digital Anatomy", status: "Available", siteId: VENDOR, data: { assetId: "SDI-PJ-01", maker: "Stratasys", model: "J850 Digital Anatomy", tech: "PolyJet", location: "Stratasys Direct — print room" } },
    { kind: "postproc", name: "Vendor waterjet station", status: "Available", siteId: VENDOR, data: { location: "Stratasys Direct — finishing" } },
    { kind: "measuring", name: "Vendor CMM — Zeiss Contura", status: "Available", siteId: VENDOR, data: { location: "Stratasys Direct — QC lab" } },
    { kind: "operators", name: "Avi Peretz (Stratasys)", status: "", siteId: VENDOR, data: {} },
  ];
  for (const o of own) {
    if (await byName(o.kind, o.name)) continue;
    await db.resource.create({ data: { spaceId, kind: o.kind, name: o.name, status: o.status, data: { ...o.data, siteId: o.siteId } as Prisma.InputJsonObject } });
  }

  // --- People: the lab's team, and the vendor's operator with a site-only account -------------------
  for (const name of ["Dr. Yael Ben-Ami (3D Lab)", "Dr. Noa Shalev (QA)", "Dana Weiss"]) {
    const u = await db.user.findFirst({ where: { spaceId, name }, select: { id: true, siteIds: true } });
    if (u && !u.siteIds.includes(LAB)) await db.user.update({ where: { id: u.id }, data: { siteIds: [...u.siteIds, LAB] } });
  }
  if (!(await db.user.findFirst({ where: { spaceId, email: VENDOR_LOGIN.email }, select: { id: true } }))) {
    await db.user.create({
      data: {
        spaceId,
        email: VENDOR_LOGIN.email,
        name: "Avi Peretz (Stratasys)",
        role: "MEMBER",
        platformRoleName: "Site operator",
        passwordHash: await hashPassword(VENDOR_LOGIN.password),
        siteIds: [VENDOR],
        siteOnly: true,
      },
    });
  }

  // --- The request asks the site; the production order shows it ----------------------------------------
  const form = await db.partRequestForm.findFirst({ where: { spaceId, name: "Standard", archivedAt: null } });
  if (form) {
    const stored = (form.sections ?? []) as unknown as RequestSection[];
    if (!stored.some((s) => s.fields.some((f) => f.key === "site"))) {
      const siteField: RequestField = {
        id: "f-site", key: "site", var: "", def: "", label: "Manufacturing site", type: "site", show: true, req: true, locked: false,
        options: [], fileTypes: [], columns: [], allowLinks: false,
      };
      const next = stored.map((sec) => {
        // The old free choice of "Production Site" gives way to the site from the list.
        const fields = sec.fields.map((f) => (f.var === "productionSite" ? { ...f, show: false, req: false } : f));
        const at = fields.findIndex((f) => f.key === "vendor");
        return at < 0 ? { ...sec, fields } : { ...sec, fields: [...fields.slice(0, at + 1), siteField, ...fields.slice(at + 1)] };
      });
      const problem = setupProblem({ rule: { prefix: "SCMC", sep: "-", tokens: [] }, sections: next });
      if (problem) throw new Error(`Request form: ${problem}`);
      await db.partRequestForm.update({ where: { id: form.id }, data: { sections: next as unknown as Prisma.InputJsonValue } });
    }
  }
  // 830/009 reads the site where it read the old choice — the template, and copies on parts not yet filled.
  const order = await db.qaTemplate.findFirst({ where: { spaceId, code: "830/009" } });
  if (order && JSON.stringify(order.sections).includes("{request.productionSite}")) {
    const swap = (sections: unknown) => JSON.parse(JSON.stringify(sections).split("{request.productionSite}").join("{site.name}")) as QaTemplateData["sections"];
    await db.qaTemplate.update({ where: { id: order.id }, data: { sections: swap(order.sections) as unknown as Prisma.InputJsonArray } });
    for (const copy of await db.partForm.findMany({ where: { templateId: order.id, savedAt: null }, select: { id: true, sections: true } })) {
      await db.partForm.update({ where: { id: copy.id }, data: { sections: swap(copy.sections) as unknown as Prisma.InputJsonArray } });
    }
  }

  // --- The outsourced workflow runs at the vendor's site ----------------------------------------------------
  const outWf = await db.resource.findFirst({ where: { spaceId, kind: "workflows", name: "PSI (Jig / Implant) — Outsourced", archivedAt: null }, select: { id: true, data: true } });
  if (outWf) {
    const data = (outWf.data ?? {}) as Record<string, unknown>;
    await db.resource.update({
      where: { id: outWf.id },
      data: { data: { ...data, sourcing: "Outsourced", siteIds: [VENDOR], siteId: VENDOR, vendorId: vendor?.id ?? "", vendorIds: [] } as Prisma.InputJsonObject },
    });
  }

  // --- Parts already made: outsourced ones at the vendor's site, the rest at the lab -----------------------
  let placed = 0;
  for (const part of await db.part.findMany({ where: { spaceId, siteId: null }, select: { id: true, sourcing: true, vendor: true } })) {
    const at = part.sourcing === "Outsourced" ? { id: VENDOR, name: "Stratasys Direct Israel" } : { id: LAB, name: "Schneider 3D Lab" };
    await db.part.update({ where: { id: part.id }, data: { siteId: at.id, siteName: at.name } });
    placed += 1;
  }
  // The outsourced sample, on the workflow as it is now, at the vendor: its instructions sent, the vendor's
  // forms open there. (Rebuilt while none of its forms is filled.)
  const live = outWf ? ((((await db.resource.findUnique({ where: { id: outWf.id }, select: { data: true } }))?.data ?? {}) as { stages?: WorkflowStage[] }).stages ?? []) : [];
  const vendorStage = live.findIndex((st) => st.name === "Vendor manufacturing");
  const sample = outWf ? await db.part.findFirst({ where: { spaceId, siteId: VENDOR, workflowId: outWf.id }, select: { id: true, spaceId: true, stages: true } }) : null;
  const filled = sample ? await db.partForm.count({ where: { partId: sample.id, savedAt: { not: null } } }) : 0;
  const ownNames = sample && Array.isArray(sample.stages) ? (sample.stages as unknown as WorkflowStage[]).map((st) => st.name) : [];
  if (sample && vendorStage > 0 && !filled && ownNames.join("|") !== live.map((st) => st.name).join("|")) {
    await db.$transaction(async (tx) => {
      await tx.partForm.deleteMany({ where: { partId: sample.id } });
      const meta = live.map((_, i) => (i < vendorStage ? { by: "Dana Weiss", at: new Date(Date.now() - 86400000).toISOString() } : {}));
      const updated = await tx.part.update({
        where: { id: sample.id },
        data: { stages: live as unknown as Prisma.InputJsonArray, stageCount: live.length, stageIndex: vendorStage, stageMeta: meta as unknown as Prisma.InputJsonArray, assigneeId: null, assigneeName: null },
        select: { id: true, spaceId: true, stageIndex: true, stages: true },
      });
      // Its forms, stage by stage, copied from the templates the stages list.
      const templates = await tx.qaTemplate.findMany({ where: { spaceId } });
      const rows: Prisma.PartFormCreateManyInput[] = [];
      live.forEach((st, i) => {
        for (const t of templates.filter((x) => st.forms.includes(templateLabel(x)))) {
          rows.push({
            spaceId, partId: updated.id, templateId: t.id, stageIndex: i, stageName: st.name,
            name: t.name, code: t.code, clause: t.clause, issue: t.issue, effective: t.effective, rev: t.rev,
            docLayout: t.docLayout, validity: t.validity, docStyle: t.docStyle, sections: t.sections as Prisma.InputJsonValue,
            status: "Upcoming", values: {}, measured: {}, quantities: {}, snap: {},
          });
        }
      });
      if (rows.length) await tx.partForm.createMany({ data: rows });
      await tx.partForm.updateMany({ where: { partId: sample.id, stageIndex: { lte: vendorStage }, status: "Upcoming" }, data: { status: "In progress" } });
    });
  }

  return `3 sites (lab, Netanya, vendor), equipment set to them, ${placed} part${placed === 1 ? "" : "s"} placed; vendor login ${VENDOR_LOGIN.email}`;
}

async function main() {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const slug = process.argv[2] ?? "schneider";
    const space = await db.space.findUnique({ where: { slug } });
    if (!space) throw new Error(`No "${slug}" space.`);
    console.log(`${space.name}: ${await setupSites(db, space.id)}.`);
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && /schneider-sites\.ts$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
