"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { recordAudit } from "@/lib/audit";
import { assertSameOrigin } from "@/lib/auth/origin";
import { hashPassword } from "@/lib/auth/password";
import { requireSpaceAdmin } from "@/lib/auth/rbac";
import { revokeAllSessionsForUser } from "@/lib/auth/session";
import { db } from "@/lib/db";

const mappingInput = z.object({
  platformRoleName: z.string().trim().min(1).max(120),
  role: z.enum(["SPACE_ADMIN", "MEMBER"]),
});

/**
 * Allow a platform role into this space, or change the role it maps to.
 * Everyone signed in under that role is signed out, so the change takes effect
 * now rather than whenever their session happens to end.
 */
export async function saveRoleMappingAction(formData: FormData): Promise<void> {
  await assertSameOrigin();
  const user = await requireSpaceAdmin();

  const parsed = mappingInput.safeParse({
    platformRoleName: formData.get("platformRoleName"),
    role: formData.get("role"),
  });
  if (!parsed.success) return;

  const { platformRoleName, role } = parsed.data;
  const key = { spaceId: user.space.id, platformRoleName };
  const before = await db.roleMapping.findUnique({ where: { spaceId_platformRoleName: key } });

  await db.roleMapping.upsert({
    where: { spaceId_platformRoleName: key },
    update: { role, canAccess: true },
    create: { ...key, role },
  });

  await signOutRole(user.space.id, platformRoleName, user.id, "role_mapping_changed");
  await recordAudit({
    action: "rolemapping.update",
    entityType: "role_mapping",
    spaceId: user.space.id,
    actorId: user.id,
    actorEmail: user.email,
    summary: `Platform role "${platformRoleName}" now signs in as ${role}.`,
    before: before ? { role: before.role, canAccess: before.canAccess } : null,
    after: { role, canAccess: true },
  });

  revalidatePath("/users");
}

export async function deleteRoleMappingAction(formData: FormData): Promise<void> {
  await assertSameOrigin();
  const user = await requireSpaceAdmin();

  const id = String(formData.get("id") ?? "");
  const mapping = await db.roleMapping.findFirst({ where: { id, spaceId: user.space.id } });
  if (!mapping) return;

  await db.roleMapping.delete({ where: { id: mapping.id } });
  await signOutRole(user.space.id, mapping.platformRoleName, user.id, "role_mapping_removed");
  await recordAudit({
    action: "rolemapping.delete",
    entityType: "role_mapping",
    spaceId: user.space.id,
    actorId: user.id,
    actorEmail: user.email,
    summary: `Platform role "${mapping.platformRoleName}" can no longer sign in.`,
    before: { role: mapping.role, canAccess: mapping.canAccess },
  });

  revalidatePath("/users");
}

/** Never the person making the change — locking yourself out helps nobody. */
async function signOutRole(
  spaceId: string,
  platformRoleName: string,
  exceptUserId: string,
  reason: string,
): Promise<void> {
  const affected = await db.user.findMany({
    where: { spaceId, platformRoleName, id: { not: exceptUserId } },
    select: { id: true },
  });
  await Promise.all(affected.map((u) => revokeAllSessionsForUser(u.id, reason)));
}

export async function setUserActiveAction(formData: FormData): Promise<void> {
  await assertSameOrigin();
  const user = await requireSpaceAdmin();

  const id = String(formData.get("id") ?? "");
  const isActive = formData.get("isActive") === "true";
  if (id === user.id) return;

  const target = await db.user.findFirst({ where: { id, spaceId: user.space.id } });
  if (!target) return;

  await db.user.update({ where: { id: target.id }, data: { isActive } });
  if (!isActive) await revokeAllSessionsForUser(target.id, "deactivated");

  await recordAudit({
    action: "user.active.update",
    entityType: "user",
    spaceId: user.space.id,
    entityId: target.id,
    actorId: user.id,
    actorEmail: user.email,
    summary: `${isActive ? "Reactivated" : "Deactivated"} ${target.email}.`,
    before: { isActive: target.isActive },
    after: { isActive },
  });

  revalidatePath("/users");
}

const personInput = z.object({
  name: z.string().trim().min(1, "Enter the person's name.").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email.").max(200),
  roleName: z.string().trim().min(1, "Give them a role, e.g. Surgeon.").max(120),
});

/**
 * Add someone who works with the space's cases without signing in here — a
 * surgeon, say — so case forms can offer them. They get no password; if they
 * later sign in with their platform account under this email, it is them.
 */
export async function addPersonAction(_previous: { ok: boolean; message: string } | null, formData: FormData): Promise<{ ok: boolean; message: string }> {
  await assertSameOrigin();
  const user = await requireSpaceAdmin();
  const parsed = personInput.safeParse({ name: formData.get("name"), email: formData.get("email"), roleName: formData.get("roleName") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the details." };
  const { name, email, roleName } = parsed.data;
  const taken = await db.user.findFirst({ where: { spaceId: user.space.id, email }, select: { id: true } });
  if (taken) return { ok: false, message: `${email} is already in this space.` };
  const created = await db.user.create({ data: { spaceId: user.space.id, email, name, role: "MEMBER", platformRoleName: roleName } });
  await recordAudit({
    action: "user.person_add",
    entityType: "user",
    spaceId: user.space.id,
    entityId: created.id,
    actorId: user.id,
    actorEmail: user.email,
    summary: `Added ${name} (${roleName}) — ${email}.`,
    after: { name, email, roleName },
  });
  revalidatePath("/users");
  return { ok: true, message: `${name} added.` };
}

/**
 * A person's hospitals — and, for someone added here, their role name; whether
 * they have surgeon access (their own cases' Order tab only); and a password to
 * sign in with here, for someone with no platform account.
 */
export async function savePersonAction(
  userId: string,
  input: { roleName?: string; hospitalIds: string[]; surgeonOnly?: boolean; password?: string },
): Promise<{ ok: boolean; message: string }> {
  await assertSameOrigin();
  const user = await requireSpaceAdmin();
  const target = await db.user.findFirst({ where: { id: userId, spaceId: user.space.id } });
  if (!target) return { ok: false, message: "That person is no longer here." };
  const ids = [...new Set((input.hospitalIds ?? []).filter((h) => typeof h === "string"))].slice(0, 50);
  const found = ids.length ? await db.resource.count({ where: { id: { in: ids }, spaceId: user.space.id, kind: "hospitals", archivedAt: null } }) : 0;
  if (found !== ids.length) return { ok: false, message: "Choose hospitals from the Hospitals list." };
  // Only a person added here has a role kept here; a platform account's comes from the platform.
  const local = !target.platformUserId && !target.passwordHash;
  const roleName = local && typeof input.roleName === "string" && input.roleName.trim() ? input.roleName.trim().slice(0, 120) : target.platformRoleName;
  // Surgeon access, and a password kept here — never for a space admin, nor over a platform account's.
  const surgeonOnly = typeof input.surgeonOnly === "boolean" ? input.surgeonOnly : target.surgeonOnly;
  if (surgeonOnly && target.role === "SPACE_ADMIN") return { ok: false, message: "A space admin always sees everything." };
  const password = typeof input.password === "string" ? input.password : "";
  if (password && target.platformUserId) return { ok: false, message: "This person signs in with their platform account." };
  if (password && password.length < 10) return { ok: false, message: "The password needs at least 10 characters." };
  await db.user.update({
    where: { id: target.id },
    data: { hospitalIds: ids, platformRoleName: roleName, surgeonOnly, ...(password ? { passwordHash: await hashPassword(password) } : {}) },
  });
  // A change of access or password applies at once: their sessions end.
  if (surgeonOnly !== target.surgeonOnly || password) await revokeAllSessionsForUser(target.id, "access changed");
  await recordAudit({
    action: "user.person_update",
    entityType: "user",
    spaceId: user.space.id,
    entityId: target.id,
    actorId: user.id,
    actorEmail: user.email,
    summary: `Updated ${target.name} — ${ids.length} hospital${ids.length === 1 ? "" : "s"}${roleName !== target.platformRoleName ? `, role ${roleName}` : ""}${surgeonOnly !== target.surgeonOnly ? (surgeonOnly ? ", surgeon access (Order tab only)" : ", full access") : ""}${password ? ", sign-in password set" : ""}.`,
    before: { hospitalIds: target.hospitalIds, roleName: target.platformRoleName, surgeonOnly: target.surgeonOnly },
    after: { hospitalIds: ids, roleName, surgeonOnly },
  });
  revalidatePath("/users");
  revalidatePath("/hospitals");
  return { ok: true, message: "Saved." };
}
