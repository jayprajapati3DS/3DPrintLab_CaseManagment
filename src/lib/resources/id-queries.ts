import "server-only";

import { db } from "@/lib/db";
import { KINDS, type ResourceKind } from "@/lib/resources/config";
import { readIdRule, type IdRule } from "@/lib/resources/ids";

/**
 * The ID rules a space has saved, one per kind of record (SpaceSetting "ids"),
 * and the IDs already in use.
 */

export async function getIdRule(spaceId: string, kind: ResourceKind): Promise<IdRule | null> {
  const ids = KINDS[kind].ids;
  if (!ids) return null;
  const row = await db.spaceSetting.findUnique({ where: { spaceId_key: { spaceId, key: "ids" } } });
  const stored = (row?.value ?? {}) as Record<string, unknown>;
  return readIdRule(stored[kind], ids.pattern);
}

/**
 * Every ID of this kind already given — archived records included, so an ID
 * is never handed out twice — with the record it belongs to.
 */
export async function usedIds(
  spaceId: string,
  kind: ResourceKind,
  exceptId?: string,
): Promise<Array<{ id: string; name: string; value: string }>> {
  const ids = KINDS[kind].ids;
  if (!ids) return [];
  const rows = await db.resource.findMany({
    where: { spaceId, kind, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true, name: true, data: true },
  });
  return rows
    .map((r) => ({ id: r.id, name: r.name, value: String(((r.data ?? {}) as Record<string, unknown>)[ids.field] ?? "").trim() }))
    .filter((r) => r.value !== "");
}
