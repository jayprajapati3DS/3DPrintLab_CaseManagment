"use server";

import { redirect } from "next/navigation";

import { recordAudit } from "@/lib/audit";
import { assertSameOrigin } from "@/lib/auth/origin";
import { destroySession, getSession } from "@/lib/auth/session";
import { waitingForMe } from "@/lib/qa/approvals";

/** How many quality forms wait for the signed-in person — kept fresh beside My Approvals. */
export async function myApprovalCount(): Promise<number> {
  const session = await getSession();
  const space = session?.user.space;
  return space ? waitingForMe(space.id, session.user.id) : 0;
}

export async function signOutAction(): Promise<void> {
  await assertSameOrigin();
  const session = await getSession();
  await destroySession("logout");
  if (session) {
    await recordAudit({
      action: "auth.logout",
      entityType: "user",
      spaceId: session.user.space?.id ?? null,
      entityId: session.user.id,
      actorId: session.user.id,
      actorEmail: session.user.email,
      summary: "Signed out.",
    });
  }
  redirect("/login");
}
