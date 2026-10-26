import "server-only";

import { cookies } from "next/headers";
import type { SpaceRole, User } from "@prisma/client";

import { recordAudit, requestContext } from "@/lib/audit";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import {
  checkLoginThrottle,
  clearLoginFailures,
  recordLoginAttempt,
} from "@/lib/auth/rate-limit";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { isProduction } from "@/lib/env";
import {
  PlatformClient,
  PlatformError,
  type PlatformLoginData,
} from "@/lib/platform/client";
import type { RealmSpace } from "@/lib/realm";

/**
 * Sign-in.
 *
 * There are two doors, at two different addresses:
 *
 *  - **The admin console** — platform administrators, who create and manage
 *    company spaces and belong to none. Always a local password.
 *  - **A company space** — that company's people, at the space's own address.
 *    Most have no password here: their credentials are checked by the company's
 *    tenant on the 3D Surgical platform, and an account is provisioned from the
 *    profile it returns, so people use the login they already have. The one
 *    exception is the admin a space is created with, who has a local password —
 *    somebody has to be able to sign in before the platform is connected.
 *
 * Which door a request is at is decided by the address it arrived on, never by
 * anything in the form.
 *
 * The platform hands back a working API token *before* the second factor is
 * verified (it gates 2FA client-side only). That is not accepted here: when an
 * account has 2FA enabled the token is parked in a short-lived encrypted cookie
 * and no session exists until the one-time code is confirmed.
 */

const CHALLENGE_COOKIE = isProduction ? "__Host-mms_2fa" : "mms_2fa";
const CHALLENGE_TTL_MS = 10 * 60_000;

export type LoginOutcome =
  | { kind: "session" }
  | { kind: "two_factor"; method: string; email: string }
  | { kind: "error"; message: string };

interface ChallengePayload {
  userId: string;
  spaceId: string;
  platformToken: string;
  email: string;
  persistent: boolean;
  expiresAt: number;
}

const THROTTLED =
  "Too many failed sign-in attempts. Please wait a few minutes and try again.";

// --- Admin console ----------------------------------------------------------

export async function attemptAdminLogin(
  email: string,
  password: string,
  persistent: boolean,
): Promise<LoginOutcome> {
  const { ip, userAgent } = await requestContext();
  const normalised = email.trim().toLowerCase();

  const throttle = await checkLoginThrottle(normalised, ip);
  if (!throttle.allowed) return { kind: "error", message: THROTTLED };

  const user = await db.user.findFirst({
    where: { isSuperAdmin: true, email: normalised },
  });

  let valid = false;
  if (user) {
    valid = await verifyPassword(password, user.passwordHash);
  } else {
    // Spend the same effort on an unknown address, so the response time does
    // not reveal which addresses belong to an administrator.
    await hashPassword(password);
  }

  if (!user || !valid || !user.isActive) {
    await recordLoginAttempt({
      email: normalised,
      ip,
      successful: false,
      reason: "invalid_credentials",
    });
    await recordAudit({
      action: "auth.login_failed",
      entityType: "user",
      actorEmail: normalised,
      summary: "Admin sign-in rejected.",
    });
    // Deliberately the same message whether the account exists or not.
    return {
      kind: "error",
      message:
        "Incorrect email or password. Company users should sign in at their space URL.",
    };
  }

  await completeSignIn({
    user,
    spaceId: null,
    platformToken: null,
    persistent,
    ip,
    userAgent,
  });
  return { kind: "session" };
}

// --- Company space ------------------------------------------------------------

export async function attemptSpaceLogin(
  realmSpace: RealmSpace,
  email: string,
  password: string,
  persistent: boolean,
): Promise<LoginOutcome> {
  const { ip, userAgent } = await requestContext();
  const normalised = email.trim().toLowerCase();

  if (!realmSpace.isActive) {
    return {
      kind: "error",
      message: `${realmSpace.name} is suspended. Contact your 3D Surgical platform admin.`,
    };
  }

  const throttle = await checkLoginThrottle(normalised, ip);
  if (!throttle.allowed) return { kind: "error", message: THROTTLED };

  const space = await db.space.findUnique({
    where: { id: realmSpace.id },
    include: { connection: true },
  });

  const rejected: LoginOutcome = {
    kind: "error",
    message: `Incorrect email or password for ${realmSpace.name}.`,
  };
  if (!space) return rejected;

  // --- Local account -------------------------------------------------------
  // An address with a local password is checked here and nowhere else: its
  // password is not the platform's business, so it is never sent there.
  const local = await db.user.findFirst({
    where: { spaceId: space.id, email: normalised, passwordHash: { not: null } },
  });

  if (local) {
    const valid = await verifyPassword(password, local.passwordHash);
    if (!valid || !local.isActive) {
      await recordLoginAttempt({
        email: normalised,
        ip,
        successful: false,
        reason: valid ? "inactive" : "invalid_credentials",
      });
      await recordAudit({
        action: "auth.login_failed",
        entityType: "user",
        spaceId: space.id,
        actorEmail: normalised,
        summary: "Local account sign-in rejected.",
      });
      return rejected;
    }
    await completeSignIn({
      user: local,
      spaceId: space.id,
      platformToken: null,
      persistent,
      ip,
      userAgent,
    });
    return { kind: "session" };
  }

  // --- Platform account ----------------------------------------------------
  if (!space.connection) {
    // Nobody but the space's own admin can sign in before the platform is
    // connected, and saying so would tell a stranger how far set-up has got.
    await hashPassword(password);
    await recordLoginAttempt({
      email: normalised,
      ip,
      successful: false,
      reason: "not_connected",
    });
    return rejected;
  }

  let profile: PlatformLoginData;
  try {
    const client = new PlatformClient(space.connection.baseUrl);
    profile = await client.login(normalised, password);
  } catch (error) {
    const isAuthFailure =
      error instanceof PlatformError ? error.isAuthFailure : false;
    await recordLoginAttempt({
      email: normalised,
      ip,
      successful: false,
      reason: isAuthFailure ? "invalid_credentials" : "platform_error",
    });

    // Every failed sign-in is audited, whatever the cause. An attacker probing
    // credentials should not be able to hide by provoking a different error
    // class than the one the audit branch happened to cover.
    await recordAudit({
      action: "auth.login_failed",
      entityType: "user",
      spaceId: space.id,
      actorEmail: normalised,
      summary: isAuthFailure
        ? "Platform rejected the credentials."
        : `Sign-in could not be completed: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
    });

    if (isAuthFailure) return rejected;

    console.error("[auth] platform login error", {
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      kind: "error",
      message:
        error instanceof PlatformError
          ? error.message
          : "Could not reach the platform to verify your sign-in. Please try again.",
    };
  }

  // --- Access decision -----------------------------------------------------
  const role = await decideRole(space, normalised, profile);
  if (!role) {
    await recordLoginAttempt({
      email: normalised,
      ip,
      successful: false,
      reason: "role_not_permitted",
    });
    await recordAudit({
      action: "auth.login_failed",
      entityType: "user",
      spaceId: space.id,
      actorEmail: normalised,
      summary: `Role "${profile.role}" is not permitted in this space.`,
    });
    // Naming the role is safe — it is the caller's own — and it is the one
    // piece of information that turns "I can't get in" into a fix an
    // administrator can apply under Users & Roles without guessing.
    return {
      kind: "error",
      message:
        `Your platform account is valid, but its role ("${profile.role}") does not have ` +
        `access to this space. A space admin can grant it under Users & Roles.`,
    };
  }

  const user = await provisionUser(space.id, profile, role, normalised);

  if (!user.isActive) {
    await recordLoginAttempt({ email: normalised, ip, successful: false, reason: "inactive" });
    return {
      kind: "error",
      message: "This account has been deactivated. Contact a space admin.",
    };
  }

  // --- Second factor -------------------------------------------------------
  if (profile["2fa"]) {
    await stashChallenge({
      userId: user.id,
      spaceId: space.id,
      platformToken: profile.token,
      email: user.email,
      persistent,
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });
    return { kind: "two_factor", method: profile["2fa_type"], email: user.email };
  }

  await completeSignIn({
    user,
    spaceId: space.id,
    platformToken: profile.token,
    persistent,
    ip,
    userAgent,
  });
  return { kind: "session" };
}

/**
 * Which role, if any, a platform account gets in a space.
 *
 * A platform account with the space's designated admin address always gets in
 * as its admin. Everyone else needs their platform role to be on the
 * allow-list.
 */
async function decideRole(
  space: { id: string; adminEmail: string },
  email: string,
  profile: PlatformLoginData,
): Promise<SpaceRole | null> {
  if (email === space.adminEmail.trim().toLowerCase()) return "SPACE_ADMIN";

  const mapping = await db.roleMapping.findUnique({
    where: {
      spaceId_platformRoleName: {
        spaceId: space.id,
        platformRoleName: profile.role,
      },
    },
  });
  if (!mapping || !mapping.canAccess) return null;
  return mapping.role;
}

export async function verifyTwoFactor(code: string): Promise<LoginOutcome> {
  const { ip, userAgent } = await requestContext();
  const challenge = await readChallenge();

  if (!challenge) {
    return {
      kind: "error",
      message: "That verification step has expired. Please sign in again.",
    };
  }

  const throttle = await checkLoginThrottle(challenge.email, ip);
  if (!throttle.allowed) {
    return {
      kind: "error",
      message: "Too many attempts. Please wait a few minutes and try again.",
    };
  }

  const connection = await db.platformConnection.findUnique({
    where: { spaceId: challenge.spaceId },
  });
  if (!connection) {
    return { kind: "error", message: "This space is no longer connected to the platform." };
  }

  try {
    const client = new PlatformClient(connection.baseUrl);
    await client.verifyTwoFactor(challenge.platformToken, code);
  } catch (error) {
    await recordLoginAttempt({
      email: challenge.email,
      ip,
      successful: false,
      reason: "invalid_otp",
    });
    await recordAudit({
      action: "auth.2fa_failed",
      entityType: "user",
      spaceId: challenge.spaceId,
      entityId: challenge.userId,
      actorEmail: challenge.email,
      summary: "Incorrect or expired one-time code.",
    });
    return {
      kind: "error",
      message:
        error instanceof PlatformError
          ? error.message
          : "That code was not accepted. Please try again.",
    };
  }

  const user = await db.user.findUnique({ where: { id: challenge.userId } });
  if (!user || !user.isActive) {
    return { kind: "error", message: "This account is no longer active." };
  }

  await clearChallenge();
  await completeSignIn({
    user,
    spaceId: challenge.spaceId,
    platformToken: challenge.platformToken,
    persistent: challenge.persistent,
    ip,
    userAgent,
  });
  return { kind: "session" };
}

export async function resendTwoFactor(): Promise<{ ok: boolean; message: string }> {
  const challenge = await readChallenge();
  if (!challenge) {
    return { ok: false, message: "That step has expired. Please sign in again." };
  }

  const connection = await db.platformConnection.findUnique({
    where: { spaceId: challenge.spaceId },
  });
  if (!connection) {
    return { ok: false, message: "This space is no longer connected to the platform." };
  }

  try {
    const client = new PlatformClient(connection.baseUrl);
    await client.resendTwoFactor(challenge.platformToken);
    return { ok: true, message: "A new code is on its way." };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof PlatformError
          ? error.message
          : "Could not send a new code. Please try again.",
    };
  }
}

/**
 * Create or refresh this application's shadow of a platform user.
 *
 * The platform stays the source of truth for identity, so every sign-in
 * re-reads it; the role is re-decided each time too, so a change to the
 * allow-list takes effect at the next sign-in.
 */
async function provisionUser(
  spaceId: string,
  profile: PlatformLoginData,
  role: SpaceRole,
  /**
   * The address the person actually typed. The platform's UserResource does
   * `'email' => $this->name`, so `profile.email` holds their *name*, not an
   * address. The typed address is the only reliable one, and it is already
   * proven correct because the platform authenticated with it.
   */
  email: string,
): Promise<User> {
  const identity = {
    email,
    platformUserId: profile.id,
    platformSlug: profile.slug,
    name: profile.name?.trim() || email,
    firstName: profile.first_name,
    lastName: profile.last_name,
    phone: profile.phone,
    avatarUrl: profile.avatar_url,
    platformRoleName: profile.role,
    platformRoleGroup: profile.role_group,
    role,
    twoFactorEnabled: Boolean(profile["2fa"]),
    twoFactorType: profile["2fa_type"] ?? null,
  };

  // The platform id is stable across an email change, so it is tried first.
  const existing = await db.user.findFirst({
    where: {
      spaceId,
      OR: [{ platformUserId: profile.id }, { email }],
    },
    orderBy: { platformUserId: { sort: "asc", nulls: "last" } },
  });

  if (existing) {
    return db.user.update({ where: { id: existing.id }, data: identity });
  }
  return db.user.create({ data: { ...identity, spaceId } });
}

async function completeSignIn(params: {
  user: User;
  spaceId: string | null;
  platformToken: string | null;
  persistent: boolean;
  ip: string;
  userAgent: string | null;
}): Promise<void> {
  const { user, ip } = params;
  await createSession({
    user,
    platformToken: params.platformToken,
    persistent: params.persistent,
    ip,
    userAgent: params.userAgent,
  });
  await Promise.all([
    db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastLoginIp: ip },
    }),
    recordLoginAttempt({ email: user.email, ip, successful: true }),
    clearLoginFailures(user.email),
    recordAudit({
      action: "auth.login",
      entityType: "user",
      spaceId: params.spaceId,
      entityId: user.id,
      actorId: user.id,
      actorEmail: user.email,
      summary: `Signed in as ${user.email}.`,
    }),
  ]);
}

// --- Pending-2FA cookie ------------------------------------------------------

async function stashChallenge(payload: ChallengePayload): Promise<void> {
  const store = await cookies();
  store.set(CHALLENGE_COOKIE, encryptSecret(JSON.stringify(payload)), {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: CHALLENGE_TTL_MS / 1000,
  });
}

async function readChallenge(): Promise<ChallengePayload | null> {
  const store = await cookies();
  const raw = store.get(CHALLENGE_COOKIE)?.value;
  const decrypted = decryptSecret(raw);
  if (!decrypted) return null;

  try {
    const payload = JSON.parse(decrypted) as ChallengePayload;
    if (!payload.userId || !payload.spaceId || !payload.platformToken) return null;
    if (Date.now() > payload.expiresAt) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function clearChallenge(): Promise<void> {
  const store = await cookies();
  store.delete(CHALLENGE_COOKIE);
}
