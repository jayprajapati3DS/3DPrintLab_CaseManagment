import type { Prisma } from "@prisma/client";

import { caseDetails } from "@/lib/cases/case-form";
import { partStageMeta, partStages } from "@/lib/parts/queries";

/**
 * Who is working on a case or a part, read from what they are assigned to and
 * have done on it — the TeamPanel shows it.
 */

export interface TeamPerson {
  name: string;
  roles: string;
  /** What they did here: "Owner of Segmentation", "Approved Design Freeze"… */
  did: string[];
}

export interface TeamSection {
  title: string;
  hint: string;
  people: TeamPerson[];
}

/** Collects people into sections, once each per section, with everything they did. */
export class TeamBuilder {
  private sections = new Map<string, { hint: string; people: Map<string, TeamPerson> }>();

  constructor(private rolesOf: (name: string) => string) {}

  section(title: string, hint: string) {
    if (!this.sections.has(title)) this.sections.set(title, { hint, people: new Map() });
    return this;
  }

  add(title: string, name: string | null | undefined, did: string) {
    const who = (name ?? "").trim();
    if (!who) return this;
    const sec = this.sections.get(title);
    if (!sec) return this;
    const key = who.toLowerCase();
    const person = sec.people.get(key) ?? { name: who, roles: this.rolesOf(who), did: [] };
    if (did && !person.did.includes(did)) person.did.push(did);
    sec.people.set(key, person);
    return this;
  }

  build(): TeamSection[] {
    return [...this.sections.entries()].map(([title, s]) => ({ title, hint: s.hint, people: [...s.people.values()] }));
  }
}

/** A person's roles, by name, as the space knows them. */
export function rolesOfName(people: Array<{ name: string; roles: string[] }>) {
  const byName = new Map(people.map((p) => [p.name.trim().toLowerCase(), p.roles.join(", ")]));
  return (name: string) => byName.get(name.trim().toLowerCase()) ?? "";
}

/**
 * Everyone on a case: the surgeon and the hospital's people, sales, the case
 * team — owner, status owners, who moved it on, who filled and approved its
 * forms and did its tasks — and the production team of its parts.
 */
export function caseTeam({
  record,
  rolesOf,
  stages,
  marks,
  forms,
  tasks,
  parts,
}: {
  record: { surgeonName: string | null; representativeName: string | null; hospitalName: string | null; assigneeName?: string | null; details: unknown };
  rolesOf: (name: string) => string;
  stages: Array<{ name: string }>;
  marks: Array<{ by?: string | null; ownerName?: string | null }>;
  forms: Array<{ name: string; savedByName: string | null; submittedByName: string | null; approvedByName: string | null; sentToName: string | null; status: string }>;
  tasks: Array<{ name: string; assigneeName: string | null; completedByName: string | null }>;
  parts: Array<{ part: PartTeamSource; qa: { forms: Array<{ name: string; savedByName: string | null; submittedByName: string | null; approvedByName: string | null; sentToName: string | null; status: string }> } }>;
}) {
  const details = new Map(caseDetails(record).map((d) => [d.var, d.value]));
  const list = (v: string | undefined) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const SURGEON = "Surgeon & hospital";
  const SALES = "Sales";
  const CASE = "Case team";
  const PRODUCTION = "Production team";
  const t = new TeamBuilder(rolesOf)
    .section(SURGEON, [record.hospitalName, details.get("case.department")].filter(Boolean).join(" · "))
    .section(SALES, "")
    .section(CASE, "Project management, segmentation, design — by status")
    .section(PRODUCTION, "Who makes its parts");
  t.add(SURGEON, record.surgeonName, "Surgeon");
  for (const n of list(details.get("case.secondarySurgeons"))) t.add(SURGEON, n, "Secondary surgeon");
  for (const n of list(details.get("case.salesRep") ?? record.representativeName ?? undefined)) t.add(SALES, n, "Sales person");
  t.add(CASE, details.get("case.projectManager"), "Project manager");
  t.add(CASE, record.assigneeName, "Case owner");
  stages.forEach((st, i) => {
    t.add(CASE, marks[i]?.ownerName, `Owner of ${st.name}`);
    t.add(CASE, marks[i]?.by, `Completed ${st.name}`);
  });
  for (const f of forms) {
    t.add(CASE, f.savedByName, `Filled ${f.name}`);
    t.add(CASE, f.submittedByName, `Sent ${f.name}`);
    t.add(CASE, f.status === "Approved" ? f.approvedByName : f.sentToName, `${f.status === "Approved" ? "Approved" : "Approving"} ${f.name}`);
  }
  for (const k of tasks) {
    t.add(CASE, k.assigneeName, `Task: ${k.name}`);
    t.add(CASE, k.completedByName, `Did: ${k.name}`);
  }
  for (const { part, qa } of parts) addPartTeam(t, PRODUCTION, part, qa.forms, true);
  return t.build();
}

/** What a part's team is read from. */
export interface PartTeamSource {
  partNumber: string;
  requestedByName: string;
  assigneeName: string | null;
  stages: Prisma.JsonValue;
  stageMeta: Prisma.JsonValue;
}

/** A part's production team into a section: who requested it, owns it and its stages, completed them, filled and approved its forms. */
export function addPartTeam(
  t: TeamBuilder,
  section: string,
  part: PartTeamSource,
  forms: Array<{ name: string; savedByName: string | null; submittedByName: string | null; approvedByName: string | null; sentToName: string | null; status: string }>,
  withPart: boolean,
) {
  const of = withPart ? ` · ${part.partNumber}` : "";
  t.add(section, part.requestedByName, `Requested the part${of}`);
  t.add(section, part.assigneeName, `Part owner${of}`);
  const stages = partStages(part);
  const meta = partStageMeta(part);
  stages.forEach((st, i) => {
    t.add(section, meta[i]?.assignee, `Owner of ${st.name}${of}`);
    t.add(section, meta[i]?.by, `Completed ${st.name}${of}`);
  });
  for (const f of forms) {
    t.add(section, f.savedByName, `Filled ${f.name}${of}`);
    t.add(section, f.submittedByName, `Sent ${f.name}${of}`);
    t.add(section, f.status === "Approved" ? f.approvedByName : f.sentToName, `${f.status === "Approved" ? "Approved" : "Approving"} ${f.name}${of}`);
  }
}


/** Everyone on a part: its case's surgeon and sales, and the part's own production team. */
export function partTeam(
  part: PartTeamSource & { case: { surgeonName: string | null; representativeName: string | null; hospitalName: string | null; details: unknown } | null },
  forms: Array<{ name: string; savedByName: string | null; submittedByName: string | null; approvedByName: string | null; sentToName: string | null; status: string }>,
  rolesOf: (name: string) => string,
) {
  const details = new Map(part.case ? caseDetails(part.case).map((d) => [d.var, d.value]) : []);
  const list = (v: string | null | undefined) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const SURGEON = "Surgeon & hospital";
  const SALES = "Sales";
  const PRODUCTION = "Production team";
  const t = new TeamBuilder(rolesOf)
    .section(SURGEON, [part.case?.hospitalName, details.get("case.department")].filter(Boolean).join(" · "))
    .section(SALES, "")
    .section(PRODUCTION, "Who makes this part");
  t.add(SURGEON, part.case?.surgeonName, "Surgeon");
  for (const n of list(details.get("case.secondarySurgeons"))) t.add(SURGEON, n, "Secondary surgeon");
  for (const n of list(details.get("case.salesRep") ?? part.case?.representativeName)) t.add(SALES, n, "Sales person");
  t.add(PRODUCTION, details.get("case.projectManager"), "Project manager");
  addPartTeam(t, PRODUCTION, part, forms, false);
  return t.build();
}
