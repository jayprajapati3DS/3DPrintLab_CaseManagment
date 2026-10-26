import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { env } from "@/lib/env";

const KEY = Buffer.from(env.ENCRYPTION_KEY, "base64");
const IV_BYTES = 12; // GCM standard nonce length
const VERSION = "v1";

/**
 * Encrypt a secret for storage. Output is `v1.<iv>.<tag>.<ciphertext>`, all
 * base64url — self-describing so the format can be rotated later without
 * guessing at what a stored value is.
 *
 * Used for the platform service-account password and per-session platform
 * tokens: both are bearer credentials for an upstream system, so a dump of the
 * database must not hand an attacker access to the platform.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Reverse of {@link encryptSecret}. Returns null rather than throwing when the
 * value is malformed or fails authentication — callers treat that as "no
 * usable credential", which is the safe reading of a tampered row.
 */
export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;

  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const ciphertext = Buffer.from(parts[3], "base64url");
    const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/** A URL-safe random token with 256 bits of entropy. */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Keyed digest used to store session tokens without storing the token itself. */
export function hashToken(token: string): string {
  return createHmac("sha256", KEY).update(token).digest("hex");
}

/** Constant-time string comparison for secrets compared against user input. */
export function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so length isn't leaked by timing alone.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
