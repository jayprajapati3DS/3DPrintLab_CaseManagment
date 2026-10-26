import "dotenv/config";

import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";

import { item, section, templateLabel, type QaItem, type QaSection } from "../src/lib/qa/template";
import type { WorkflowData, WorkflowStage } from "../src/lib/resources/config";

/**
 * Split BMR 1 of the in-house anatomical model forms into two, in one space:
 *
 *   npx tsx scripts/split-bmr1.ts <space-slug> --dry
 *   npx tsx scripts/split-bmr1.ts <space-slug> --backup <file.json> [--as <email>]
 *
 * BMR 1 keeps only its first section, Batch identification, and gets a
 * sign-off of its own: Prepared by (the person submitting) and Approved by
 * (chosen in the form). Its other sections — the file check, raw material and
 * their sign-off — become a new BMR 2. The BMR forms after it move up one:
 * BMR 2–8 become BMR 3–9 (JM-F-PRD-015/3 … /9).
 *
 * Every workflow with a "Design receipt & file check" stage gets a stage
 * "Batch identification" before it, for BMR 1; the design stage takes the new
 * BMR 2, and every stage's form list follows the new names.
 *
 * Works from what the space holds, edits included. Parts already requested
 * keep the forms they were given. The templates and workflows are written to
 * the backup file before anything changes, and nothing changes unless all of
 * it does. Run again, it finds the split done and stops.
 */

const slug = process.argv[2];
const arg = (name: string) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const dry = process.argv.includes("--dry");
const backup = arg("--backup");
const actorEmail = arg("--as");
if (!slug || slug.startsWith("-") || (!dry && !backup)) {
  console.error("Usage: npx tsx scripts/split-bmr1.ts <space-slug> (--dry | --backup <file.json>) [--as <email>]");
  process.exit(1);
}

const BMR = "JM-F-PRD-015";
const BATCH_STAGE = "Batch identification";
const DESIGN_STAGE = "Design receipt & file check";
const NEW_BMR1 = "BMR 1 — Batch identification";
const NEW_BMR2 = "BMR 2 — Design receipt & file verification";
const BY = "Split of BMR 1";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const space = await db.space.findUnique({ where: { slug } });
  if (!space) throw new Error(`No space "${slug}".`);
  const actor = actorEmail
    ? await db.user.findFirst({ where: { email: { equals: actorEmail, mode: "insensitive" }, OR: [{ spaceId: space.id }, { isSuperAdmin: true }] } })
    : null;
  if (actorEmail && !actor) throw new Error(`No account ${actorEmail} in ${slug}.`);
  const by = actor?.name ?? BY;

  const templates = await db.qaTemplate.findMany({ where: { spaceId: space.id } });
  const workflows = await db.resource.findMany({ where: { spaceId: space.id, kind: "workflows", archivedAt: null } });
  const byCode = (n: number) => templates.find((t) => t.code.toUpperCase() === `${BMR}/${n}`);
  const bmr1 = byCode(1);
  if (!bmr1) throw new Error(`${slug} has no ${BMR}/1.`);
  if (bmr1.name === NEW_BMR1) {
    console.log(`${space.name}: BMR 1 is already split — nothing to do.`);
    return;
  }
  const sections = (Array.isArray(bmr1.sections) ? bmr1.sections : []) as unknown as QaSection[];
  if (sections.length < 2 || sections[0].title.trim().toLowerCase() !== BATCH_STAGE.toLowerCase()) {
    throw new Error(`BMR 1 should start with "${BATCH_STAGE}" and have more sections; it has: ${sections.map((s) => s.title).join(", ")}`);
  }
  if (byCode(9)) throw new Error(`${BMR}/9 already exists — the numbering is not what this script expects.`);

  // BMR 1: its first section, then Prepared by and Approved by — styled like the sign-off it had.
  const signs = sections.flatMap((s) => s.items).filter((i) => i.type === "sign");
  const like = (signer: QaItem["signer"]) => signs.find((i) => i.signer === signer) ?? signs[0];
  const signItem = (label: string, signer: "submitter" | "approver"): QaItem => {
    const model = like(signer);
    return item("sign", label, { value: "", signer, req: true, ...(model?.style ? { style: model.style } : {}), ...(model?.roles ? { roles: model.roles } : {}) });
  };
  const bmr1Sections: QaSection[] = [sections[0], section("Sign-off", [signItem("Prepared by", "submitter"), signItem("Approved by", "approver")], 2)];
  const bmr2Sections: QaSection[] = sections.slice(1);

  // The forms after BMR 1, one number up: label before → after, for the workflows.
  const relabel = new Map<string, string>();
  const renumber: Array<{ id: string; from: string; code: string; name: string }> = [];
  for (let n = 8; n >= 2; n -= 1) {
    const t = byCode(n);
    if (!t) continue;
    const name = t.name.replace(new RegExp(`^BMR ${n}\\b`), `BMR ${n + 1}`);
    const code = `${BMR}/${n + 1}`;
    renumber.push({ id: t.id, from: templateLabel(t), code, name });
    relabel.set(templateLabel(t).toLowerCase(), templateLabel({ name, code }));
  }
  const bmr2Label = templateLabel({ name: NEW_BMR2, code: `${BMR}/2` });
  const bmr1Label = templateLabel({ name: NEW_BMR1, code: `${BMR}/1` });
  relabel.set(templateLabel(bmr1).toLowerCase(), bmr2Label);

  // Workflows: a Batch identification stage before the design stage; form lists renamed.
  const changedFlows: Array<{ id: string; name: string; data: WorkflowData; before: string; after: string }> = [];
  for (const wf of workflows) {
    const data = wf.data as unknown as WorkflowData;
    const stages = Array.isArray(data?.stages) ? data.stages : [];
    const at = stages.findIndex((s) => s.name.trim().toLowerCase() === DESIGN_STAGE.toLowerCase());
    const mentions = stages.some((s) => (s.forms ?? []).some((f) => relabel.has(f.trim().toLowerCase())));
    if (at < 0 && !mentions) continue;
    const renamed = stages.map((s) => ({ ...s, forms: (s.forms ?? []).map((f) => relabel.get(f.trim().toLowerCase()) ?? f) }));
    if (at >= 0 && !stages.some((s) => s.name.trim().toLowerCase() === BATCH_STAGE.toLowerCase())) {
      const design = renamed[at];
      const batch: WorkflowStage = { ...design, id: randomUUID(), name: BATCH_STAGE, forms: [bmr1Label], tasks: [], emailsNext: [], emailsBack: [] };
      renamed.splice(at, 0, batch);
    }
    changedFlows.push({
      id: wf.id,
      name: wf.name,
      data: { ...data, stages: renamed },
      before: stages.map((s) => s.name).join(" → "),
      after: renamed.map((s) => `${s.name}${s.forms?.length ? ` [${s.forms.map((f) => f.replace(/ \(.*\)$/, "")).join(", ")}]` : ""}`).join(" → "),
    });
  }

  console.log(`Space: ${space.name} (${slug})${dry ? " — DRY RUN, nothing changed" : ""}`);
  console.log(`BMR 1 → "${NEW_BMR1}": ${bmr1Sections.map((s) => s.title).join(", ")} (Prepared by, Approved by)`);
  console.log(`New "${NEW_BMR2}" (${BMR}/2): ${bmr2Sections.map((s) => s.title).join(", ")}`);
  for (const r of [...renumber].reverse()) console.log(`  ${r.from} → ${r.name} (${r.code})`);
  for (const f of changedFlows) console.log(`Workflow ${f.name}:\n  before: ${f.before}\n  after:  ${f.after}`);
  if (dry) return;

  writeFileSync(backup!, JSON.stringify({ space: slug, at: new Date().toISOString(), templates, workflows }, null, 2));
  console.log(`Backup written: ${backup}`);

  await db.$transaction(async (tx) => {
    // Highest first, so no two forms ever share a code on the way.
    for (const r of renumber) await tx.qaTemplate.update({ where: { id: r.id }, data: { code: r.code, name: r.name, updatedByName: by } });
    await tx.qaTemplate.update({
      where: { id: bmr1.id },
      data: { name: NEW_BMR1, attach: [BATCH_STAGE], sections: bmr1Sections as unknown as Prisma.InputJsonArray, updatedByName: by },
    });
    const created = await tx.qaTemplate.create({
      data: {
        spaceId: space.id,
        name: NEW_BMR2,
        code: `${BMR}/2`,
        clause: bmr1.clause,
        issue: bmr1.issue,
        effective: bmr1.effective,
        rev: bmr1.rev,
        docLayout: bmr1.docLayout,
        attach: [DESIGN_STAGE],
        sections: bmr2Sections as unknown as Prisma.InputJsonArray,
        updatedByName: by,
      },
    });
    for (const f of changedFlows) await tx.resource.update({ where: { id: f.id }, data: { data: f.data as unknown as Prisma.InputJsonObject } });
    const log = (action: string, entityType: string, entityId: string, entityName: string, summary: string) =>
      tx.auditLog.create({ data: { action, entityType, spaceId: space.id, entityId, entityName, summary, actorId: actor?.id ?? null, actorEmail: actor?.email ?? null } });
    await log("qa.template_save", "qa", bmr1.id, NEW_BMR1, `Split BMR 1: kept Batch identification with Prepared by / Approved by; the rest moved to ${BMR}/2`);
    await log("qa.template_create", "qa", created.id, NEW_BMR2, `Created QA form ${BMR}/2 from BMR 1's file check, raw material and sign-off`);
    for (const r of renumber) await log("qa.template_save", "qa", r.id, r.name, `Renumbered ${r.from} → ${r.name} (${r.code})`);
    for (const f of changedFlows) await log("resource.update", "workflows", f.id, f.name, `Added stage "${BATCH_STAGE}" for BMR 1; form lists follow the BMR renumbering`);
  });
  console.log("Done.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
