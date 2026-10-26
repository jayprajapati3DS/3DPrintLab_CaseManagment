"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { recordAudit } from "@/lib/audit";
import { assertSameOrigin, CrossOriginError } from "@/lib/auth/origin";
import { requireSpaceAdmin } from "@/lib/auth/rbac";
import { encryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { PlatformClient, PlatformError, toApiBaseUrl } from "@/lib/platform/client";
import {
  detectDateFormat,
  mapCase,
  normaliseDateFormat,
  parseFieldMap,
  SUPPORTED_DATE_FORMATS,
  type PlatformDateFormat,
} from "@/lib/platform/mapper";
import { getServiceCredentials, runSync } from "@/lib/platform/sync";

export interface ActionResult<T = undefined> {
  ok: boolean;
  message?: string;
  data?: T;
}

async function guard() {
  await assertSameOrigin();
  return requireSpaceAdmin();
}

function crossOrigin(error: unknown): ActionResult | null {
  return error instanceof CrossOriginError ? { ok: false, message: error.message } : null;
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

const connectionInput = z.object({
  domainUrl: z.url("Enter the full platform URL, including https://"),
  serviceEmail: z.union([z.email("Enter a valid service account email."), z.literal("")]),
  // Blank means "leave the stored password alone".
  servicePassword: z.string().max(1024),
  dateFormat: z.enum(SUPPORTED_DATE_FORMATS),
  timezone: z.string().trim().min(1).max(64),
});

export async function saveConnectionAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  let user;
  try {
    user = await guard();
  } catch (error) {
    const rejected = crossOrigin(error);
    if (rejected) return rejected;
    throw error;
  }

  const parsed = connectionInput.safeParse({
    domainUrl: formData.get("domainUrl"),
    serviceEmail: String(formData.get("serviceEmail") ?? "").trim(),
    servicePassword: String(formData.get("servicePassword") ?? ""),
    dateFormat: formData.get("dateFormat"),
    timezone: formData.get("timezone"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message };
  }

  const domainUrl = parsed.data.domainUrl.replace(/\/+$/, "");
  let baseUrl: string;
  try {
    // Rejects private/link-local hosts and non-https URLs, so an admin cannot
    // point the connection at this application's own network.
    baseUrl = toApiBaseUrl(domainUrl);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof PlatformError ? error.message : "That URL is not usable.",
    };
  }

  // Verify the timezone is one the runtime actually knows, so a typo cannot
  // silently shift every parsed case date.
  try {
    new Intl.DateTimeFormat("en", { timeZone: parsed.data.timezone });
  } catch {
    return { ok: false, message: "That is not a recognised timezone." };
  }

  const existing = await db.platformConnection.findUnique({
    where: { spaceId: user.space.id },
  });

  const data = {
    domainUrl,
    baseUrl,
    serviceEmail: parsed.data.serviceEmail || null,
    dateFormat: parsed.data.dateFormat,
    timezone: parsed.data.timezone,
    ...(parsed.data.servicePassword
      ? { servicePasswordEncrypted: encryptSecret(parsed.data.servicePassword) }
      : {}),
    // A different tenant has not been verified just because the last one was.
    ...(existing && existing.domainUrl !== domainUrl
      ? { verifiedAt: null, verifiedName: null }
      : {}),
  };

  const saved = existing
    ? await db.platformConnection.update({ where: { id: existing.id }, data })
    : await db.platformConnection.create({ data: { ...data, spaceId: user.space.id } });

  await recordAudit({
    action: "connection.update",
    entityType: "platform_connection",
    spaceId: user.space.id,
    entityId: saved.id,
    actorId: user.id,
    actorEmail: user.email,
    summary: `Connection set to ${domainUrl}.`,
    // Never the password, and never the encrypted form of it.
    before: existing
      ? {
          domainUrl: existing.domainUrl,
          serviceEmail: existing.serviceEmail,
          dateFormat: existing.dateFormat,
          timezone: existing.timezone,
        }
      : null,
    after: {
      domainUrl,
      serviceEmail: data.serviceEmail,
      dateFormat: data.dateFormat,
      timezone: data.timezone,
      passwordChanged: Boolean(parsed.data.servicePassword),
    },
  });

  revalidatePath("/integrations");
  return { ok: true, message: "Connection saved." };
}

export interface ConnectionTest {
  domainVerified: boolean;
  tenantName: string | null;
  loginOk: boolean;
  roleGroup: string | null;
  isAdminAccount: boolean;
  sampleTotal: number | null;
  /** Keys present on a real case row — what the field mapping can point at. */
  availableKeys: string[];
  detectedDateFormat: PlatformDateFormat | null;
  warnings: string[];
}

/**
 * Probe the connection end to end: verify the domain, sign the service account
 * in, pull a few cases and try the current mapping against a real row.
 */
export async function testConnectionAction(): Promise<ActionResult<ConnectionTest>> {
  let user;
  try {
    user = await guard();
  } catch (error) {
    const rejected = crossOrigin(error);
    if (rejected) return { ok: false, message: rejected.message };
    throw error;
  }

  const connection = await db.platformConnection.findUnique({
    where: { spaceId: user.space.id },
  });
  if (!connection) {
    return { ok: false, message: "Save a platform URL first." };
  }

  const result: ConnectionTest = {
    domainVerified: false,
    tenantName: null,
    loginOk: false,
    roleGroup: null,
    isAdminAccount: false,
    sampleTotal: null,
    availableKeys: [],
    detectedDateFormat: null,
    warnings: [],
  };

  const finish = async (): Promise<ActionResult<ConnectionTest>> => {
    await recordAudit({
      action: "connection.test",
      entityType: "platform_connection",
      spaceId: user.space.id,
      entityId: connection.id,
      actorId: user.id,
      actorEmail: user.email,
      summary: `Connection test: ${result.warnings.length} warning(s).`,
    });
    revalidatePath("/integrations");
    return { ok: true, data: result };
  };

  const client = new PlatformClient(connection.baseUrl);

  try {
    const domain = await client.verifyDomain(connection.domainUrl);
    result.domainVerified = true;
    result.tenantName = domain.name;
    await db.platformConnection.update({
      where: { id: connection.id },
      data: { verifiedAt: new Date(), verifiedName: domain.name },
    });
  } catch (error) {
    result.warnings.push(
      error instanceof PlatformError
        ? `Domain check failed: ${error.message}`
        : "Domain check failed.",
    );
  }

  const credentials = getServiceCredentials(connection);
  if (!credentials) {
    result.warnings.push("No service account is saved, so cases cannot be synced yet.");
    return finish();
  }

  let token: string;
  try {
    const login = await client.login(credentials.email, credentials.password);
    result.loginOk = true;
    result.roleGroup = login.role_group;
    result.isAdminAccount = (login.role_group ?? "").toLowerCase() === "admin";
    token = login.token;
    if (!result.isAdminAccount) {
      result.warnings.push(
        `The service account's role group is "${login.role_group}". The platform ` +
          `scopes case results by role, so a non-Admin account will import only part of the data.`,
      );
    }
  } catch (error) {
    result.warnings.push(
      error instanceof PlatformError ? `Sign-in failed: ${error.message}` : "Sign-in failed.",
    );
    return finish();
  }

  try {
    const page = await client.cases(token, { per_page: 5 });
    result.sampleTotal = Number(page.total) || 0;
    const rows = Array.isArray(page.data) ? page.data : [];
    if (rows.length > 0) {
      // Key names only: the values include patient identifiers, which have no
      // business in a diagnostic readout.
      result.availableKeys = Object.keys(rows[0]).sort();

      const fieldMap = parseFieldMap(connection.fieldMap);
      const samples = rows
        .map((row) => row[fieldMap.createdAt])
        .filter((v): v is string => typeof v === "string" && v.trim() !== "");
      result.detectedDateFormat = detectDateFormat(samples);

      try {
        mapCase(rows[0], fieldMap, normaliseDateFormat(connection.dateFormat), connection.timezone);
      } catch (error) {
        result.warnings.push(
          error instanceof Error
            ? `The current mapping could not read a real case: ${error.message}`
            : "The current mapping could not read a real case.",
        );
      }

      if (result.detectedDateFormat && result.detectedDateFormat !== connection.dateFormat) {
        result.warnings.push(
          `Dates look like "${result.detectedDateFormat}" but the connection is set to ` +
            `"${connection.dateFormat}". Every case date will be wrong until this matches.`,
        );
      }
    } else {
      result.warnings.push("The platform returned no cases to sample.");
    }
  } catch (error) {
    result.warnings.push(
      error instanceof PlatformError ? `Case fetch failed: ${error.message}` : "Case fetch failed.",
    );
  }

  return finish();
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export async function runSyncAction(): Promise<ActionResult> {
  let user;
  try {
    user = await guard();
  } catch (error) {
    const rejected = crossOrigin(error);
    if (rejected) return rejected;
    throw error;
  }

  const connection = await db.platformConnection.findUnique({
    where: { spaceId: user.space.id },
  });
  if (!connection) return { ok: false, message: "Save a platform connection first." };
  if (!getServiceCredentials(connection)) {
    return { ok: false, message: "Add a service account before syncing." };
  }

  const alreadyRunning = await db.syncRun.findFirst({
    where: {
      connectionId: connection.id,
      status: "RUNNING",
      startedAt: { gte: new Date(Date.now() - 30 * 60_000) },
    },
  });
  if (alreadyRunning) {
    return { ok: false, message: "A sync is already running." };
  }

  await recordAudit({
    action: "sync.start",
    entityType: "platform_connection",
    spaceId: user.space.id,
    entityId: connection.id,
    actorId: user.id,
    actorEmail: user.email,
    summary: "Started a manual sync.",
  });

  // A full pull can take minutes, which is far longer than a request should
  // hold open. The run is tracked in sync_runs, so the page reports on it.
  void runSync(connection, { trigger: "manual", triggeredById: user.id }).catch((error) =>
    console.error("[sync] manual run failed", error),
  );

  revalidatePath("/integrations");
  return { ok: true, message: "Sync started. Refresh in a moment to see the result." };
}
