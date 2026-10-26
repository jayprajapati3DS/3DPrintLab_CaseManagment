"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { recordAudit } from "@/lib/audit";
import { assertSameOrigin, CrossOriginError } from "@/lib/auth/origin";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { requireSession } from "@/lib/auth/rbac";
import { revokeAllSessionsForUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { deleteStoredFile, saveFile } from "@/lib/files";

export interface PasswordState {
  ok: boolean;
  message?: string;
}

const input = z
  .object({
    current: z.string().min(1, "Enter your current password.").max(1024),
    next: z.string().min(10, "A new password needs at least 10 characters.").max(1024),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { message: "The new passwords do not match." })
  .refine((v) => v.next !== v.current, { message: "Choose a password different from the current one." });

/**
 * Change a local password. Only accounts that have one can — everyone else's
 * password lives on the platform and is changed there.
 */
export async function changePasswordAction(
  _previous: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  try {
    await assertSameOrigin();
  } catch (error) {
    if (error instanceof CrossOriginError) return { ok: false, message: error.message };
    throw error;
  }

  const session = await requireSession();

  const parsed = input.safeParse({
    current: formData.get("current"),
    next: formData.get("next"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message };
  }

  const user = await db.user.findUnique({ where: { id: session.user.id } });
  if (!user?.passwordHash) {
    return { ok: false, message: "This account's password is managed on the 3D Surgical Platform." };
  }
  if (!(await verifyPassword(parsed.data.current, user.passwordHash))) {
    return { ok: false, message: "That is not your current password." };
  }

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(parsed.data.next) },
  });
  // Every other device is signed out; this one stays.
  await revokeAllSessionsForUser(user.id, "password_changed", session.sessionId);

  await recordAudit({
    action: "user.password_change",
    entityType: "user",
    spaceId: session.user.space?.id ?? null,
    entityId: user.id,
    actorId: user.id,
    actorEmail: user.email,
    summary: "Changed their password.",
  });

  return { ok: true, message: "Password changed. Other devices have been signed out." };
}

// --- My signature --------------------------------------------------------------------------------

export interface SignatureResult {
  ok: boolean;
  message?: string;
}

const SIGNATURE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;

/**
 * Keep a signature image — drawn on the page or uploaded — for signing quality
 * forms. Only people in a company space sign forms, so only they can keep one.
 */
export async function saveSignatureAction(formData: FormData): Promise<SignatureResult> {
  try {
    await assertSameOrigin();
  } catch (error) {
    if (error instanceof CrossOriginError) return { ok: false, message: error.message };
    throw error;
  }
  const session = await requireSession();
  const space = session.user.space;
  if (!space) return { ok: false, message: "Signatures are kept for people who sign forms in a company space." };

  const file = formData.get("signature");
  if (!(file && typeof file === "object" && "arrayBuffer" in file && file.size > 0)) {
    return { ok: false, message: "Draw your signature or choose an image." };
  }
  if (!SIGNATURE_TYPES.includes(file.type)) return { ok: false, message: "Use a PNG, JPEG or WebP image." };
  if (file.size > MAX_SIGNATURE_BYTES) return { ok: false, message: "The image is larger than 2 MB." };

  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { id: true, email: true, signatureKey: true } });
  if (!user) return { ok: false, message: "Your account could not be found." };
  const key = await saveFile(space.id, Buffer.from(await file.arrayBuffer()));
  await db.user.update({
    where: { id: user.id },
    data: { signatureKey: key, signatureType: file.type, signatureUpdatedAt: new Date() },
  });
  // Forms already signed hold their own copy; the old image is no longer needed.
  if (user.signatureKey) await deleteStoredFile(user.signatureKey).catch(() => undefined);

  await recordAudit({
    action: "user.signature_save",
    entityType: "user",
    spaceId: space.id,
    entityId: user.id,
    actorId: user.id,
    actorEmail: user.email,
    summary: user.signatureKey ? "Replaced their signature image." : "Added their signature image.",
  });
  revalidatePath("/account");
  return { ok: true, message: "Signature saved" };
}

export async function removeSignatureAction(): Promise<SignatureResult> {
  try {
    await assertSameOrigin();
  } catch (error) {
    if (error instanceof CrossOriginError) return { ok: false, message: error.message };
    throw error;
  }
  const session = await requireSession();
  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { id: true, email: true, signatureKey: true } });
  if (!user?.signatureKey) return { ok: true };
  await db.user.update({ where: { id: user.id }, data: { signatureKey: null, signatureType: null, signatureUpdatedAt: null } });
  await deleteStoredFile(user.signatureKey).catch(() => undefined);
  await recordAudit({
    action: "user.signature_remove",
    entityType: "user",
    spaceId: session.user.space?.id ?? null,
    entityId: user.id,
    actorId: user.id,
    actorEmail: user.email,
    summary: "Removed their signature image.",
  });
  revalidatePath("/account");
  return { ok: true, message: "Signature removed" };
}
