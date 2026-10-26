"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { recordAudit } from "@/lib/audit";
import { assertSameOrigin, CrossOriginError } from "@/lib/auth/origin";
import { hashPassword } from "@/lib/auth/password";
import { requireSuperAdmin } from "@/lib/auth/rbac";
import { revokeAllSessionsForUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { RESERVED_SLUGS, siteOrigin } from "@/lib/realm";

/**
 * What the space's first admin needs to get in. Shown to the platform admin
 * once, to pass on; only a hash of the password is kept.
 */
export interface SpaceAdminCredentials {
  spaceName: string;
  signInUrl: string;
  email: string;
  password: string;
}

export interface SpaceActionState {
  ok: boolean;
  message?: string;
  credentials?: SpaceAdminCredentials;
}

const input = z.object({
  name: z.string().trim().min(1, "Enter a company name.").max(120),
  slug: z
    .string()
    .trim()
    .min(1, "Enter a space ID.")
    .max(40)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "A space ID has only lowercase letters, numbers and hyphens."),
  adminEmail: z.email("Enter a valid space admin email.").max(254),
  customDomain: z
    .string()
    .trim()
    .toLowerCase()
    .max(253)
    .regex(/^$|^[a-z0-9-]+(\.[a-z0-9-]+)+$/, "Enter a valid custom domain, e.g. mms.acmeortho.com"),
});

/** 14 characters from a 62-letter alphabet: about 83 bits. */
function temporaryPassword(): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(14), (b) => alphabet[b % alphabet.length]).join("");
}

async function guard(): Promise<
  { user: Awaited<ReturnType<typeof requireSuperAdmin>> } | { error: SpaceActionState }
> {
  try {
    await assertSameOrigin();
  } catch (error) {
    if (error instanceof CrossOriginError) return { error: { ok: false, message: error.message } };
    throw error;
  }
  return { user: await requireSuperAdmin() };
}

export async function createSpaceAction(
  _previous: SpaceActionState,
  formData: FormData,
): Promise<SpaceActionState> {
  const guarded = await guard();
  if ("error" in guarded) return guarded.error;
  const { user } = guarded;

  const parsed = input.safeParse({
    name: formData.get("name"),
    slug: String(formData.get("slug") ?? "").toLowerCase(),
    adminEmail: formData.get("adminEmail"),
    customDomain: String(formData.get("customDomain") ?? ""),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message };
  }

  const { name, slug } = parsed.data;
  const adminEmail = parsed.data.adminEmail.toLowerCase();
  const customDomain = parsed.data.customDomain || null;

  if (RESERVED_SLUGS.has(slug) || (await db.space.findUnique({ where: { slug }, select: { id: true } }))) {
    return { ok: false, message: "That space ID is already taken or reserved." };
  }

  if (customDomain) {
    // A custom domain inside our own domain would shadow another site.
    if (customDomain === env.BASE_DOMAIN || customDomain.endsWith(`.${env.BASE_DOMAIN}`)) {
      return { ok: false, message: "A custom domain must be the company's own, not part of this one." };
    }
    if (await db.space.findUnique({ where: { customDomain }, select: { id: true } })) {
      return { ok: false, message: "That custom domain already belongs to another space." };
    }
  }

  const password = temporaryPassword();

  const space = await db.space.create({
    data: {
      name,
      slug,
      adminEmail,
      customDomain,
      createdById: user.id,
      // The platform's own administrators are the obvious people to run the
      // space; everyone else is added deliberately under Users & Roles.
      roleMappings: { create: { platformRoleName: "Admin", role: "SPACE_ADMIN" } },
      // A local account, so somebody can sign in before the space has been
      // connected to the platform — which is the first thing they are for.
      users: {
        create: {
          email: adminEmail,
          name: "Space Admin",
          role: "SPACE_ADMIN",
          passwordHash: await hashPassword(password),
        },
      },
    },
  });

  await recordAudit({
    action: "space.create",
    entityType: "space",
    spaceId: space.id,
    entityId: space.id,
    actorId: user.id,
    actorEmail: user.email,
    summary: `Created company space ${name} (${slug}).`,
    after: { name, slug, adminEmail, customDomain },
  });

  revalidatePath("/spaces");
  return {
    ok: true,
    credentials: {
      spaceName: name,
      signInUrl: `${await siteOrigin(slug)}/login`,
      email: adminEmail,
      password,
    },
  };
}

/** Suspend a space, or bring it back. Suspension signs everyone in it out. */
export async function setSpaceActiveAction(formData: FormData): Promise<void> {
  const guarded = await guard();
  if ("error" in guarded) return;
  const { user } = guarded;

  const id = String(formData.get("id") ?? "");
  const isActive = formData.get("isActive") === "true";

  const space = await db.space.findUnique({ where: { id } });
  if (!space || space.isActive === isActive) return;

  await db.space.update({ where: { id }, data: { isActive } });

  await recordAudit({
    action: isActive ? "space.reactivate" : "space.suspend",
    entityType: "space",
    spaceId: space.id,
    entityId: space.id,
    actorId: user.id,
    actorEmail: user.email,
    summary: `${isActive ? "Reactivated" : "Suspended"} company space ${space.name}.`,
    before: { isActive: space.isActive },
    after: { isActive },
  });

  revalidatePath("/spaces");
}

/**
 * Give the space's admin a new temporary password — for when the first one was
 * lost before it was used, or the admin is locked out.
 */
export async function resetSpaceAdminPasswordAction(
  _previous: SpaceActionState,
  formData: FormData,
): Promise<SpaceActionState> {
  const guarded = await guard();
  if ("error" in guarded) return guarded.error;
  const { user } = guarded;

  const id = String(formData.get("id") ?? "");
  const space = await db.space.findUnique({ where: { id } });
  if (!space) return { ok: false, message: "That space no longer exists." };

  const password = temporaryPassword();
  const passwordHash = await hashPassword(password);

  const admin = await db.user.upsert({
    where: { spaceId_email: { spaceId: space.id, email: space.adminEmail } },
    update: { passwordHash, isActive: true, role: "SPACE_ADMIN" },
    create: {
      spaceId: space.id,
      email: space.adminEmail,
      name: "Space Admin",
      role: "SPACE_ADMIN",
      passwordHash,
    },
  });
  await revokeAllSessionsForUser(admin.id, "password_reset");

  await recordAudit({
    action: "space.admin_password_reset",
    entityType: "space",
    spaceId: space.id,
    entityId: space.id,
    actorId: user.id,
    actorEmail: user.email,
    summary: `Reset the space admin password for ${space.name}.`,
  });

  return {
    ok: true,
    credentials: {
      spaceName: space.name,
      signInUrl: `${await siteOrigin(space.slug)}/login`,
      email: space.adminEmail,
      password,
    },
  };
}
