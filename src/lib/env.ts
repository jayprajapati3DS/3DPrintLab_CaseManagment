import { z } from "zod";

/**
 * Environment contract. Parsed once at module load so a misconfigured deploy
 * fails loudly at boot rather than at the first request that needs a secret.
 *
 * This module must only ever be imported from server code.
 */
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  /**
   * Base64-encoded 32-byte key for AES-256-GCM. Protects platform service
   * account passwords, per-session platform tokens and patient identifiers at
   * rest.
   */
  ENCRYPTION_KEY: z
    .string()
    .min(1, "ENCRYPTION_KEY is required")
    .refine(
      (v) => Buffer.from(v, "base64").length === 32,
      "ENCRYPTION_KEY must be exactly 32 bytes, base64-encoded",
    ),

  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters"),

  /** Shared secret for the scheduled-sync endpoint. */
  CRON_SECRET: z.string().min(16, "CRON_SECRET must be at least 16 characters"),

  /**
   * The domain the application is served under. The admin console lives at
   * `admin.<BASE_DOMAIN>` and each company space at `<slug>.<BASE_DOMAIN>`.
   * A hostname only — no scheme, no port. In development `localhost` works
   * as-is, because browsers resolve every `*.localhost` name to this machine.
   */
  BASE_DOMAIN: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)*$/, "BASE_DOMAIN is a hostname, e.g. mms.example.com")
    .default("localhost"),

  /**
   * Where uploaded documents, reports and photos are kept. Must be persistent
   * storage, and backed up: it holds qualification and calibration evidence.
   */
  STORAGE_DIR: z.string().min(1).default(".storage"),

  /** Idle session timeout in minutes. */
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(60),
  /** Absolute session lifetime in hours, regardless of activity. */
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().positive().default(12),

  /** Failed logins allowed per email (and per IP) inside the window. */
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
  LOGIN_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
});

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.`,
    );
  }
  return parsed.data;
}

export const env = load();

export const isProduction = env.NODE_ENV === "production";
