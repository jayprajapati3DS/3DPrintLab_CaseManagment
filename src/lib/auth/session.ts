import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";
import type { User } from "@prisma/client";

import { db } from "@/lib/db";
import { encryptSecret, hashToken, randomToken } from "@/lib/crypto";
import { env, isProduction } from "@/lib/env";
import { getRealm } from "@/lib/realm";

/**
 * Server-side session management.
 *
 * The cookie holds an opaque 256-bit random token; the database stores only its
 * keyed hash. That means a database dump yields no usable sessions, and it lets
 * a session be revoked instantly — which a stateless JWT could not do.
 *
 * Two clocks bound a session: an idle timeout that slides forward on activity,
 * and an absolute lifetime it can never outlive.
 *
 * A session also belongs to one site. The admin console and each company space
 * are separate addresses, and a session is only honoured on the one it was
 * issued for: a platform administrator's at the admin console, a space user's
 * at their own space.
 */

/**
 * The `__Host-` prefix pins the cookie to this exact origin, with no Domain
 * attribute and Path=/, so a sibling subdomain cannot set or overwrite it —
 * which is what keeps one space's cookie out of another's reach.
 * It requires Secure, so plain-http local development uses the plain name.
 */
export const SESSION_COOKIE = isProduction
  ? "__Host-mms_session"
  : "mms_session";

export type AppRole = "SUPER_ADMIN" | "SPACE_ADMIN" | "MEMBER";

export interface SessionSpace {
  id: string;
  name: string;
  slug: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: AppRole;
  platformRoleName: string | null;
  /** True for accounts whose password is held here rather than on the platform. */
  hasLocalPassword: boolean;
  /** The manufacturing sites they work at. */
  siteIds: string[];
  /** Site-only access: just the parts made at their sites (a vendor's staff). */
  siteOnly: boolean;
  /** Surgeon access: just their own cases' Order tab. */
  surgeonOnly: boolean;
  /** The user's space. Null for a super admin, who belongs to none. */
  space: SessionSpace | null;
}

export interface AuthenticatedSession {
  sessionId: string;
  user: SessionUser;
}

function idleExpiry(from = new Date()) {
  return new Date(from.getTime() + env.SESSION_IDLE_MINUTES * 60_000);
}

function absoluteExpiry(from = new Date()) {
  return new Date(from.getTime() + env.SESSION_ABSOLUTE_HOURS * 3_600_000);
}

/**
 * Issue a session and set the cookie. `platformToken` is the Passport token the
 * platform handed back at login; it is encrypted before storage.
 *
 * `persistent` is the sign-in page's "Keep me signed in". Without it the cookie
 * has no expiry and goes when the browser closes; either way the server-side
 * idle and absolute limits still apply.
 */
export async function createSession(params: {
  user: User;
  platformToken?: string | null;
  persistent?: boolean;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  const token = randomToken();
  const now = new Date();
  const absolute = absoluteExpiry(now);

  await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId: params.user.id,
      platformToken: params.platformToken
        ? encryptSecret(params.platformToken)
        : null,
      ip: params.ip ?? null,
      userAgent: params.userAgent?.slice(0, 512) ?? null,
      expiresAt: idleExpiry(now),
      absoluteExpiresAt: absolute,
    },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    ...(params.persistent ? { expires: absolute } : {}),
  });
}

/**
 * Resolve the current session, sliding the idle window forward.
 *
 * Wrapped in React's `cache` so a request that checks authorisation in the
 * layout, the page and a server action still costs one query.
 */
export const getSession = cache(
  async (): Promise<AuthenticatedSession | null> => {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (!token) return null;

    const realm = await getRealm();
    if (realm.kind === "unknown") return null;

    const session = await db.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { include: { space: true } } },
    });

    if (!session || session.revokedAt) return null;

    const now = new Date();
    if (session.expiresAt <= now || session.absoluteExpiresAt <= now) {
      await db.session
        .update({
          where: { id: session.id },
          data: { revokedAt: now, revokedReason: "expired" },
        })
        .catch(() => undefined);
      return null;
    }

    const { user } = session;
    if (!user.isActive) return null;

    // The session must belong to the site being visited. Cookies are already
    // host-only, so this should never fail in a browser — it is here so that a
    // cookie carried to another address by hand still buys nothing.
    if (realm.kind === "admin") {
      if (!user.isSuperAdmin) return null;
    } else {
      if (user.isSuperAdmin || user.spaceId !== realm.space.id) return null;
      // A suspended space takes its live sessions down with it.
      if (!realm.space.isActive) return null;
    }

    // Slide the idle window, but never past the absolute ceiling. Only write
    // when it moves meaningfully, to keep read traffic off the write path.
    const nextExpiry = new Date(
      Math.min(idleExpiry(now).getTime(), session.absoluteExpiresAt.getTime()),
    );
    if (nextExpiry.getTime() - session.expiresAt.getTime() > 60_000) {
      await db.session
        .update({
          where: { id: session.id },
          data: { expiresAt: nextExpiry, lastSeenAt: now },
        })
        .catch(() => undefined);
    }

    return {
      sessionId: session.id,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.isSuperAdmin ? "SUPER_ADMIN" : user.role,
        platformRoleName: user.platformRoleName,
        hasLocalPassword: Boolean(user.passwordHash),
        siteIds: user.siteIds ?? [],
        // Site-only needs a site; an admin is never site-only.
        siteOnly: Boolean(user.siteOnly && !user.isSuperAdmin && user.role !== "SPACE_ADMIN"),
        surgeonOnly: Boolean(user.surgeonOnly && !user.isSuperAdmin && user.role !== "SPACE_ADMIN"),
        space:
          realm.kind === "space"
            ? { id: realm.space.id, name: realm.space.name, slug: realm.space.slug }
            : null,
      },
    };
  },
);

/** Revoke the current session and clear the cookie. */
export async function destroySession(reason = "logout"): Promise<string | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  store.delete(SESSION_COOKIE);
  if (!token) return null;

  const session = await db.session
    .update({
      where: { tokenHash: hashToken(token) },
      data: { revokedAt: new Date(), revokedReason: reason },
      select: { id: true, userId: true },
    })
    .catch(() => null);

  return session?.userId ?? null;
}

/** Used when a user is deactivated, or their role or password changes. */
export async function revokeAllSessionsForUser(
  userId: string,
  reason: string,
  exceptSessionId?: string,
): Promise<number> {
  const result = await db.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return result.count;
}

/** Housekeeping: drop sessions that expired more than a week ago. */
export async function pruneExpiredSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 3_600_000);
  const result = await db.session.deleteMany({
    where: { absoluteExpiresAt: { lt: cutoff } },
  });
  return result.count;
}
