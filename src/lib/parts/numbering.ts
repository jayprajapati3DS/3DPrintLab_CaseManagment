import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { buildPartNumber, sequenceAfterStem, sequenceStem, type IdContext, type IdRule } from "@/lib/parts/request-form";

type Client = Prisma.TransactionClient | typeof db;

/**
 * The ID a new part takes, and its sequence.
 *
 * The rule says what PART_SEQ counts within: the part's case, its case and
 * part type, its part type, this month or year (UTC, as the YYYY and MM
 * tokens read it), or every part of the space. "Match the ID" counts among
 * the parts whose ID starts the same up to PART_SEQ, read from the IDs
 * already given.
 *
 * Should the ID still be taken — a rule that leaves out what it counts by,
 * or no PART_SEQ at all — the sequence is added at the end.
 */
export async function nextPartNumber(
  client: Client,
  spaceId: string,
  rule: IdRule,
  context: Omit<IdContext, "sequence">,
  part: { caseId: string | null; partType: string | null },
): Promise<{ partNumber: string; sequence: number }> {
  const scope = rule.scope ?? "case";
  const stem = scope === "auto" ? sequenceStem(rule, context) : null;
  if (stem !== null) {
    const rows = await client.part.findMany({ where: { spaceId, partNumber: { startsWith: stem } }, select: { partNumber: true } });
    let last = 0;
    for (const { partNumber } of rows) last = Math.max(last, sequenceAfterStem(rule, stem, partNumber) ?? 0);
    const taken = new Set(rows.map((r) => r.partNumber));
    let sequence = last + 1;
    while (taken.has(buildPartNumber(rule, { ...context, sequence }))) sequence += 1;
    return { partNumber: buildPartNumber(rule, { ...context, sequence }), sequence };
  }

  const now = context.now;
  const among: Prisma.PartWhereInput =
    scope === "case-type"
      ? { spaceId, caseId: part.caseId, partType: part.partType }
      : scope === "type"
        ? { spaceId, partType: part.partType }
        : scope === "month"
          ? { spaceId, createdAt: { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) } }
          : scope === "year"
            ? { spaceId, createdAt: { gte: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)) } }
            : scope === "space"
              ? { spaceId }
              : { spaceId, caseId: part.caseId };
  const last = await client.part.aggregate({ where: among, _max: { sequence: true } });
  const sequence = (last._max.sequence ?? 0) + 1;
  const base = buildPartNumber(rule, { ...context, sequence });
  const taken = await client.part.findFirst({ where: { spaceId, partNumber: base }, select: { id: true } });
  const partNumber = taken ? [base, String(sequence).padStart(rule.width ?? 2, "0")].join(rule.sep || "-") : base;
  return { partNumber, sequence };
}
