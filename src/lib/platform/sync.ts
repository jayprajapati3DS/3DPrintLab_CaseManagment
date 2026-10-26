import type { PlatformConnection, Prisma } from "@prisma/client";

import { classifyCase } from "@/lib/cases/classify";
import { caseSortKey } from "@/lib/cases/sort-key";
import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import {
  PlatformClient,
  PlatformError,
  type PlatformCase,
} from "@/lib/platform/client";
import {
  CaseMappingError,
  mapCase,
  normaliseDateFormat,
  parseFieldMap,
  type MappedCase,
} from "@/lib/platform/mapper";

/**
 * Pulls one space's cases from its platform tenant.
 *
 * The sync is strictly one-way and additive: it creates and refreshes the
 * mirrored platform fields and never deletes anything. A case that disappears
 * upstream stays here, since parts may already have been made against it.
 */

const PER_PAGE = 100;
const MAX_PAGES = 500; // ~50k cases; a guard against a paginator that never ends.

/** Runs older than this lost their process and should not block a new one. */
const STALE_AFTER_MS = 30 * 60_000;

export interface SyncResult {
  syncRunId: string | null;
  status: "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED";
  casesSeen: number;
  casesCreated: number;
  casesUpdated: number;
  pagesFetched: number;
  warnings: string[];
  errorMessage?: string;
}

class SyncAbort extends Error {}

export function getServiceCredentials(connection: PlatformConnection) {
  const password = decryptSecret(connection.servicePasswordEncrypted);
  if (!connection.serviceEmail || !password) return null;
  return { email: connection.serviceEmail, password };
}

/**
 * Run a full sync for the given connection.
 *
 * @param trigger  "manual" when a person pressed Sync, "schedule" from cron.
 */
export async function runSync(
  connection: PlatformConnection,
  options: { trigger?: string; triggeredById?: string | null } = {},
): Promise<SyncResult> {
  // Release runs whose process died, so a crash cannot wedge the next one.
  await db.syncRun.updateMany({
    where: {
      connectionId: connection.id,
      status: "RUNNING",
      startedAt: { lt: new Date(Date.now() - STALE_AFTER_MS) },
    },
    data: {
      status: "FAILED",
      finishedAt: new Date(),
      errorMessage: "The sync did not finish — the process was interrupted.",
    },
  });

  const running = await db.syncRun.findFirst({
    where: { connectionId: connection.id, status: "RUNNING" },
    select: { id: true },
  });
  if (running) {
    return {
      syncRunId: running.id,
      status: "SKIPPED",
      casesSeen: 0,
      casesCreated: 0,
      casesUpdated: 0,
      pagesFetched: 0,
      warnings: [],
      errorMessage: "A sync is already running for this space.",
    };
  }

  const syncRun = await db.syncRun.create({
    data: {
      connectionId: connection.id,
      trigger: options.trigger ?? "manual",
      triggeredById: options.triggeredById ?? null,
      status: "RUNNING",
    },
  });

  const warnings: string[] = [];
  let casesSeen = 0;
  let casesCreated = 0;
  let casesUpdated = 0;
  let pagesFetched = 0;

  try {
    const credentials = getServiceCredentials(connection);
    if (!credentials) {
      throw new SyncAbort(
        "No platform service account is configured. Add one under Integrations & API.",
      );
    }

    const client = new PlatformClient(connection.baseUrl);
    const login = await client.login(credentials.email, credentials.password);

    // /api/cases is scoped by the caller's role group on the platform: any
    // account other than an Admin silently returns only part of the data.
    // Syncing with one would look successful while importing a fraction.
    const roleGroup = (login.role_group ?? "").toLowerCase();
    if (roleGroup !== "admin") {
      warnings.push(
        `The service account's role group is "${login.role_group}", not "Admin". ` +
          `The platform scopes /api/cases by role, so this sync may only see part of the data.`,
      );
    }

    const token = login.token;
    const fieldMap = parseFieldMap(connection.fieldMap);
    const dateFormat = normaliseDateFormat(connection.dateFormat);
    const timeZone = connection.timezone || "Asia/Kolkata";

    // Knowing which cases already exist turns create-or-update into one write
    // per row instead of a read and a write.
    // Cases created in the app have no platform number and are not the sync's.
    const known = new Set(
      (
        await db.caseRecord.findMany({
          where: { spaceId: connection.spaceId, platformCaseId: { not: null } },
          select: { platformCaseId: true },
        })
      ).flatMap((c) => (c.platformCaseId === null ? [] : [c.platformCaseId])),
    );

    for (const scope of ["active", "archived"] as const) {
      let page = 1;
      let lastPage = 1;

      do {
        const result = await client.cases(token, {
          page,
          per_page: PER_PAGE,
          sort_column: "id",
          sort_type: "ASC",
          ...(scope === "archived" ? { action: "archived" as const } : {}),
        });
        pagesFetched += 1;
        lastPage = Math.max(1, Number(result.last_page) || 1);

        const rows = Array.isArray(result.data) ? result.data : [];
        for (const row of rows) {
          casesSeen += 1;
          try {
            const mapped = mapCase(
              row as PlatformCase,
              fieldMap,
              dateFormat,
              timeZone,
            );
            const created = await upsertCase(connection.spaceId, mapped, known);
            if (created) casesCreated += 1;
            else casesUpdated += 1;
          } catch (error) {
            if (error instanceof CaseMappingError) {
              // One malformed row should not sink an otherwise good sync.
              if (warnings.length < 50) warnings.push(error.message);
              continue;
            }
            throw error;
          }
        }

        page += 1;
        if (page > MAX_PAGES) {
          warnings.push(
            `Stopped after ${MAX_PAGES} pages of ${scope} cases as a safety limit.`,
          );
          break;
        }
      } while (page <= lastPage);
    }

    const status = warnings.length > 0 ? "PARTIAL" : "SUCCESS";

    await db.$transaction([
      db.syncRun.update({
        where: { id: syncRun.id },
        data: {
          status,
          finishedAt: new Date(),
          pagesFetched,
          casesSeen,
          casesCreated,
          casesUpdated,
          details: { warnings },
        },
      }),
      db.platformConnection.update({
        where: { id: connection.id },
        data: { lastSyncAt: new Date(), lastSyncStatus: status },
      }),
    ]);

    return {
      syncRunId: syncRun.id,
      status,
      casesSeen,
      casesCreated,
      casesUpdated,
      pagesFetched,
      warnings,
    };
  } catch (error) {
    const errorMessage =
      error instanceof PlatformError || error instanceof SyncAbort
        ? error.message
        : "The sync failed unexpectedly.";

    if (!(error instanceof PlatformError) && !(error instanceof SyncAbort)) {
      console.error("[sync] unexpected failure", error);
    }

    await db.$transaction([
      db.syncRun.update({
        where: { id: syncRun.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          pagesFetched,
          casesSeen,
          casesCreated,
          casesUpdated,
          errorMessage,
          details: { warnings },
        },
      }),
      db.platformConnection.update({
        where: { id: connection.id },
        data: { lastSyncAt: new Date(), lastSyncStatus: "FAILED" },
      }),
    ]);

    return {
      syncRunId: syncRun.id,
      status: "FAILED",
      casesSeen,
      casesCreated,
      casesUpdated,
      pagesFetched,
      warnings,
      errorMessage,
    };
  }
}

/** @returns true when the case was new to this space. */
async function upsertCase(
  spaceId: string,
  mapped: MappedCase,
  known: Set<number>,
): Promise<boolean> {
  const fields = {
    caseNumber: mapped.caseNumber,
    caseNumberSort: caseSortKey(mapped.caseNumber),
    caseCode: mapped.caseCode,
    productName: mapped.productName,
    productCode: mapped.productCode,
    scopeName: mapped.scopeName,
    caseStatus: mapped.caseStatus,
    caseState: mapped.caseState,
    isArchived: mapped.isArchived,
    bucket: classifyCase(mapped),
    surgeonName: mapped.surgeonName,
    representativeName: mapped.representativeName,
    hospitalName: mapped.hospitalName,
    priority: mapped.priority,
    patientNameEncrypted: mapped.patientName
      ? encryptSecret(mapped.patientName)
      : null,
    patientAge: mapped.patientAge,
    patientGender: mapped.patientGender,
    surgeryDate: mapped.surgeryDate,
    anticipatedShipDate: mapped.anticipatedShipDate,
    platformCreatedAt: mapped.platformCreatedAt,
    // Kept when a sync does not carry the link, rather than blanked.
    ...(mapped.editPath ? { platformEditPath: mapped.editPath } : {}),
    lastSyncedAt: new Date(),
    raw: mapped.raw as Prisma.InputJsonValue,
  };

  const key = { spaceId, platformCaseId: mapped.platformCaseId };

  if (known.has(mapped.platformCaseId)) {
    await db.caseRecord.update({
      where: { spaceId_platformCaseId: key },
      data: fields,
    });
    return false;
  }

  await db.caseRecord.create({ data: { ...key, ...fields } });
  known.add(mapped.platformCaseId);
  return true;
}
