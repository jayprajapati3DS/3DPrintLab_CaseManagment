import "server-only";

import { ROLE_LABELS, userRoleNames } from "@/lib/auth/rbac";
import { db } from "@/lib/db";

/**
 * The roles people in a space hold, by name — this app's (Space Admin,
 * Member) and the platform roles allowed to sign in here — for choosing who
 * owns a workflow stage, who approves its forms and who may sign.
 */
export async function spaceRoles(spaceId: string): Promise<string[]> {
  const [mappings, people] = await Promise.all([
    db.roleMapping.findMany({
      where: { spaceId, canAccess: true },
      select: { platformRoleName: true },
      orderBy: { platformRoleName: "asc" },
    }),
    // Roles given to people added here — a surgeon who never signs in, say.
    db.user.findMany({ where: { spaceId, isActive: true, platformRoleName: { not: null } }, select: { platformRoleName: true }, distinct: ["platformRoleName"] }),
  ]);
  const extra = people.map((p) => p.platformRoleName!).filter((r) => r.trim()).sort((a, b) => a.localeCompare(b));
  return [...new Set([ROLE_LABELS.SPACE_ADMIN, ROLE_LABELS.MEMBER, ...mappings.map((m) => m.platformRoleName), ...extra])];
}

export interface RolePerson {
  id: string;
  name: string;
  /** Their roles, comma separated: "Member, QA Manager". */
  roles: string;
}

/** Everyone active in the space, with their roles. */
export async function spacePeopleWithRoles(spaceId: string): Promise<RolePerson[]> {
  const users = await db.user.findMany({
    where: { spaceId, isActive: true },
    select: { id: true, name: true, role: true, platformRoleName: true },
    orderBy: { name: "asc" },
  });
  return users.map((u) => ({ id: u.id, name: u.name, roles: userRoleNames(u).join(", ") }));
}
