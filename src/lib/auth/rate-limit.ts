import "server-only";

import { db } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Login throttling, backed by the login_attempts table.
 *
 * Counting in the database rather than in memory is deliberate: the application may run
 * more than one instance, and an in-process counter would let an attacker get
 * N attempts per instance. It also leaves the attempts visible for review.
 *
 * Both the email and the source address are limited, so neither spraying one
 * account from many addresses nor many accounts from one address gets a free
 * pass.
 */

export interface ThrottleVerdict {
  allowed: boolean;
  retryAfterSeconds: number;
  reason?: "email" | "ip";
}

export async function checkLoginThrottle(
  email: string,
  ip: string,
): Promise<ThrottleVerdict> {
  const since = new Date(Date.now() - env.LOGIN_WINDOW_MINUTES * 60_000);
  const normalisedEmail = email.trim().toLowerCase();

  const [emailFailures, ipFailures] = await Promise.all([
    db.loginAttempt.count({
      where: { email: normalisedEmail, successful: false, createdAt: { gte: since } },
    }),
    db.loginAttempt.count({
      where: { ip, successful: false, createdAt: { gte: since } },
    }),
  ]);

  // The IP allowance is looser, since a whole office can share one address.
  const ipLimit = env.LOGIN_MAX_ATTEMPTS * 4;

  if (emailFailures >= env.LOGIN_MAX_ATTEMPTS) {
    return {
      allowed: false,
      retryAfterSeconds: env.LOGIN_WINDOW_MINUTES * 60,
      reason: "email",
    };
  }
  if (ipFailures >= ipLimit) {
    return {
      allowed: false,
      retryAfterSeconds: env.LOGIN_WINDOW_MINUTES * 60,
      reason: "ip",
    };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

export async function recordLoginAttempt(params: {
  email: string;
  ip: string;
  successful: boolean;
  reason?: string;
}): Promise<void> {
  await db.loginAttempt
    .create({
      data: {
        email: params.email.trim().toLowerCase(),
        ip: params.ip,
        successful: params.successful,
        reason: params.reason ?? null,
      },
    })
    .catch((error) => {
      console.error("[auth] failed to record login attempt", error);
    });
}

/** Clear an account's failure streak once it authenticates successfully. */
export async function clearLoginFailures(email: string): Promise<void> {
  await db.loginAttempt
    .deleteMany({
      where: { email: email.trim().toLowerCase(), successful: false },
    })
    .catch(() => undefined);
}

/** Housekeeping: attempts older than 30 days have no further value. */
export async function pruneLoginAttempts(): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 24 * 3_600_000);
  const result = await db.loginAttempt.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return result.count;
}
