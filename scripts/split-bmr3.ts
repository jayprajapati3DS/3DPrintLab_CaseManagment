import "dotenv/config";

import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";

import { item, newItemId, section, templateLabel, type QaItem, type QaSection } from "../src/lib/qa/template";
import type { WorkflowData, WorkflowStage } from "../src/lib/resources/config";

/**
 * Split BMR 3 (3D printing record) into setup and run, in one space:
 *
 *   npx tsx scripts/split-bmr3.ts <space-slug> --dry
 *   npx tsx scripts/split-bmr3.ts <space-slug> --backup <file.json> [--as <email>]
 *
 * BMR 3 keeps Batch identification and "2. 3D printing — setup"; a new BMR 4
 * takes Batch identification and "2. 3D printing — run". Each signs off with
 * Done by (the person submitting) and Checked by (chosen in the form), styled
 * like the sign-off BMR 3 had. BMR 4–9 become BMR 5–10.
 *
 * Every workflow with a 3D printing stage gets a stage "3D printing run" after
 * it, for BMR 4; every stage's form list follows the new names. Run after
 * scripts/split-bmr1.ts. Works from what the space holds, edits included;
 * parts already requested keep their forms. The templates and workflows are
 * written to the backup file first, and nothing changes unless all of it does.
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
  console.error("Usage: npx tsx scripts/split-bmr3.ts <space-slug> (--dry | --backup <file.json>) [--as <email>]");
  process.exit(1);
}

const BMR = "JM-F-PRD-015";
const RUN_STAGE = "3D printing run";
const NEW_BMR3 = "BMR 3 — 3D printing setup";
const NEW_BMR4 = "BMR 4 — 3D printing run";
const BY = "Split of BMR 3";
const isPrintStage = (name: string) => /^3d printing \(/i.test(name.trim());

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

/** A copy with fresh ids, for the second form. */
const fresh = (s: QaSection): QaSection => ({ ...s, id: newItemId("s"), items: s.items.map((i) => ({ ...i, id: newItemId() })) });

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
  if (!byCode(1)?.name.startsWith("BMR 1 — Batch identification")) throw new Error("Run scripts/split-bmr1.ts first.");
  const bmr3 = byCode(3);
  if (!bmr3) throw new Error(`${slug} has no ${BMR}/3.`);
  if (bmr3.name === NEW_BMR3) {
    console.log(`${space.name}: BMR 3 is already split — nothing to do.`);
    return;
  }
  if (byCode(10)) throw new Error(`${BMR}/10 already exists — the numbering is not what this script expects.`);
  const sections = (Array.isArray(bmr3.sections) ? bmr3.sections : []) as unknown as QaSection[];
  const find = (re: RegExp) => sections.find((s) => re.test(s.title));
  const batch = find(/^batch identification$/i);
  const setup = find(/3d printing\s*[—-]\s*setup/i);
  const run = find(/3d printing\s*[—-]\s*run/i);
  if (!batch || !setup || !run) throw new Error(`BMR 3 should have Batch identification, setup and run sections; it has: ${sections.map((s) => s.title).join(", ")}`);
  const others = sections.filter((s) => ![batch, setup, run].includes(s) && !s.items.every((i) => i.type === "sign"));
  if (others.length) throw new Error(`BMR 3 has sections this script does not place: ${others.map((s) => s.title).join(", ")}`);

  // Done by / Checked by, styled like the sign-off BMR 3 had.
  const signs = sections.flatMap((s) => s.items).filter((i) => i.type === "sign");
  const like = (signer: QaItem["signer"], at: number) => signs.find((i) => i.signer === signer) ?? signs[at];
  const signOff = (): QaSection =>
    section(
      "Sign-off",
      (
        [
          ["Done by", "submitter", 0],
          ["Checked by", "approver", 1],
        ] as const
      ).map(([label, signer, at]) => {
        const model = like(signer, at);
        return item("sign", label, { value: "", signer, req: true, ...(model?.style ? { style: model.style } : {}), ...(model?.roles ? { roles: model.roles } : {}) });
      }),
      2,
    );
  const bmr3Sections = [batch, setup, signOff()];
  const bmr4Sections = [fresh(batch), run, signOff()];

  // BMR 4–9 become 5–10: label before → after, for the workflows.
  const relabel = new Map<string, string>();
  const renumber: Array<{ id: string; from: string; code: string; name: string }> = [];
  for (let n = 9; n >= 4; n -= 1) {
    const t = byCode(n);
    if (!t) continue;
    const name = t.name.replace(new RegExp(`^BMR ${n}\\b`), `BMR ${n + 1}`);
    const code = `${BMR}/${n + 1}`;
    renumber.push({ id: t.id, from: templateLabel(t), code, name });
    relabel.set(templateLabel(t).toLowerCase(), templateLabel({ name, code }));
  }
  const bmr3Label = templateLabel({ name: NEW_BMR3, code: `${BMR}/3` });
  const bmr4Label = templateLabel({ name: NEW_BMR4, code: `${BMR}/4` });
  relabel.set(templateLabel(bmr3).toLowerCase(), bmr3Label);

  // Workflows: "3D printing run" after the printing stage; form lists renamed.
  const changedFlows: Array<{ id: string; name: string; data: WorkflowData; before: string; after: string }> = [];
  for (const wf of workflows) {
    const data = wf.data as unknown as WorkflowData;
    const stages = Array.isArray(data?.stages) ? data.stages : [];
    const at = stages.findIndex((s) => isPrintStage(s.name));
    const mentions = stages.some((s) => (s.forms ?? []).some((f) => relabel.has(f.trim().toLowerCase())));
    if (at < 0 && !mentions) continue;
    const renamed = stages.map((s) => ({ ...s, forms: (s.forms ?? []).map((f) => relabel.get(f.trim().toLowerCase()) ?? f) }));
    if (at >= 0 && !stages.some((s) => s.name.trim().toLowerCase() === RUN_STAGE.toLowerCase())) {
      const print = renamed[at];
      const runStage: WorkflowStage = { ...print, id: randomUUID(), name: RUN_STAGE, forms: [bmr4Label], tasks: [], emailsNext: [], emailsBack: [] };
      renamed.splice(at + 1, 0, runStage);
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
  console.log(`BMR 3 → "${NEW_BMR3}": ${bmr3Sections.map((s) => s.title).join(", ")} (Done by, Checked by)`);
  console.log(`New "${NEW_BMR4}" (${BMR}/4): ${bmr4Sections.map((s) => s.title).join(", ")} (Done by, Checked by)`);
  for (const r of [...renumber].reverse()) console.log(`  ${r.from} → ${r.name} (${r.code})`);
  for (const f of changedFlows) console.log(`Workflow ${f.name}:\n  before: ${f.before}\n  after:  ${f.after}`);
  if (dry) return;

  writeFileSync(backup!, JSON.stringify({ space: slug, at: new Date().toISOString(), templates, workflows }, null, 2));
  console.log(`Backup written: ${backup}`);

  await db.$transaction(async (tx) => {
    for (const r of renumber) await tx.qaTemplate.update({ where: { id: r.id }, data: { code: r.code, name: r.name, updatedByName: by } });
    await tx.qaTemplate.update({ where: { id: bmr3.id }, data: { name: NEW_BMR3, sections: bmr3Sections as unknown as Prisma.InputJsonArray, updatedByName: by } });
    const created = await tx.qaTemplate.create({
      data: {
        spaceId: space.id,
        name: NEW_BMR4,
        code: `${BMR}/4`,
        clause: bmr3.clause,
        issue: bmr3.issue,
        effective: bmr3.effective,
        rev: bmr3.rev,
        docLayout: bmr3.docLayout,
        attach: [RUN_STAGE],
        sections: bmr4Sections as unknown as Prisma.InputJsonArray,
        updatedByName: by,
      },
    });
    for (const f of changedFlows) await tx.resource.update({ where: { id: f.id }, data: { data: f.data as unknown as Prisma.InputJsonObject } });
    const log = (action: string, entityType: string, entityId: string, entityName: string, summary: string) =>
      tx.auditLog.create({ data: { action, entityType, spaceId: space.id, entityId, entityName, summary, actorId: actor?.id ?? null, actorEmail: actor?.email ?? null } });
    await log("qa.template_save", "qa", bmr3.id, NEW_BMR3, `Split BMR 3: kept the print setup with Done by / Checked by; the print run moved to ${BMR}/4`);
    await log("qa.template_create", "qa", created.id, NEW_BMR4, `Created QA form ${BMR}/4 from BMR 3's print run`);
    for (const r of renumber) await log("qa.template_save", "qa", r.id, r.name, `Renumbered ${r.from} → ${r.name} (${r.code})`);
    for (const f of changedFlows) await log("resource.update", "workflows", f.id, f.name, `Added stage "${RUN_STAGE}" for BMR 4; form lists follow the BMR renumbering`);
  });
  console.log("Done.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
