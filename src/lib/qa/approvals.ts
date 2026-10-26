import { db } from "@/lib/db";

/** Quality forms waiting for this person to sign or approve — the number beside My Approvals. */
export function waitingForMe(spaceId: string, userId: string): Promise<number> {
  return db.partForm.count({ where: { spaceId, sentToId: userId, status: "Pending approval" } });
}
