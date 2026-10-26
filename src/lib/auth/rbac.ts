import "server-only";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import {
  getSession,
  type AppRole,
  type AuthenticatedSession,
  type SessionSpace,
  type SessionUser,
} from "@/lib/auth/session";
import { siteOnlyAllows, surgeonOnlyAllows } from "@/lib/sites/scope";

/**
 * Authorisation.
 *
 * Two things live here and are used together everywhere: a *role* check (may
 * this person open this page at all) and the *space* every query is scoped to.
 * A row from another space is indistinguishable from one that does not exist.
 */

export const ROLE_LABELS: Record<AppRole, string> = {
  SUPER_ADMIN: "Super Admin",
  SPACE_ADMIN: "Space Admin",
  MEMBER: "Member",
};

/** Every role a person holds, by name: the app's role and their platform role. */
export function userRoleNames(user: { role: AppRole; platformRoleName: string | null }): string[] {
  return [ROLE_LABELS[user.role], user.platformRoleName].filter((r): r is string => Boolean(r && r.trim()));
}

export function isSuperAdmin(user: SessionUser): boolean {
  return user.role === "SUPER_ADMIN";
}

/** Users, the platform connection and the sync belong to a space's admins. */
export function canManageSpace(user: SessionUser): boolean {
  return user.role === "SUPER_ADMIN" || user.role === "SPACE_ADMIN";
}

export async function requireSession(): Promise<AuthenticatedSession> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** Require a signed-in user, or send them to sign in. */
export async function requireUser(): Promise<SessionUser> {
  return (await requireSession()).user;
}

export async function requireSuperAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!isSuperAdmin(user)) redirect("/no-access");
  return user;
}

export async function requireSpaceAdmin(): Promise<SessionUser & { space: SessionSpace }> {
  const user = await requireUser();
  if (!canManageSpace(user)) redirect("/no-access");
  return withSpace(user);
}

/**
 * Require a user who is working inside a space. The only person without one is
 * a super admin on a fresh install, who is sent to create the first space.
 */
export async function requireSpaceUser(): Promise<SessionUser & { space: SessionSpace }> {
  const user = withSpace(await requireUser());
  // A site-only person (a vendor's staff) works on their sites' parts — any other page sends them there.
  if (user.siteOnly) {
    const path = (await headers()).get("x-pathname") ?? "/";
    if (!siteOnlyAllows(path)) redirect("/parts");
  }
  // A surgeon checks and signs their cases' order forms — any other page sends them to their orders.
  if (user.surgeonOnly) {
    const path = (await headers()).get("x-pathname") ?? "/";
    if (!surgeonOnlyAllows(path)) redirect("/orders");
  }
  return user;
}

function withSpace(user: SessionUser): SessionUser & { space: SessionSpace } {
  if (!user.space) redirect("/spaces");
  return user as SessionUser & { space: SessionSpace };
}

/**
 * Assert a record was actually visible under the caller's space. Callers fetch
 * with the space filter applied, so a miss means either "does not exist" or
 * "not yours" — deliberately indistinguishable, so ids cannot be probed.
 */
export function assertVisible<T>(record: T | null | undefined): T {
  if (!record) notFound();
  return record;
}
