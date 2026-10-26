import "server-only";

import type { CaseRecord } from "@prisma/client";

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import {
  CaseDetailParseError,
  editPathFromActionButtons,
  parseCaseEditPage,
  type CaseDetail,
} from "@/lib/platform/case-detail";
import { PlatformClient, PlatformError } from "@/lib/platform/client";
import { getServiceCredentials } from "@/lib/platform/sync";
import { fetchPlatformPage } from "@/lib/platform/web";

/**
 * A case's full detail, as the platform's own edit page shows it.
 *
 * Read from the platform when the case is opened and cached on the case, so a
 * page that was just read is not read again, and so the last known detail is
 * still there when the platform cannot be reached.
 */

/** How long a cached read is shown before the platform is asked again. */
const FRESH_FOR_MS = 10 * 60_000;

export interface CaseDetailResult {
  detail: CaseDetail | null;
  fetchedAt: Date | null;
  /** Why the platform could not be read just now; the cached detail still shows. */
  error: string | null;
}

function readCache(record: CaseRecord): CaseDetail | null {
  const json = decryptSecret(record.detailEncrypted);
  if (!json) return null;
  try {
    return JSON.parse(json) as CaseDetail;
  } catch {
    return null;
  }
}

export async function loadCaseDetail(
  record: CaseRecord,
  options: { refresh?: boolean } = {},
): Promise<CaseDetailResult> {
  const cached = readCache(record);
  const fetchedAt = record.detailFetchedAt;

  const fresh = cached && fetchedAt && Date.now() - fetchedAt.getTime() < FRESH_FOR_MS;
  if (fresh && !options.refresh) return { detail: cached, fetchedAt, error: null };

  const failed = (error: string): CaseDetailResult => ({ detail: cached, fetchedAt, error });

  const connection = await db.platformConnection.findUnique({
    where: { spaceId: record.spaceId },
  });
  if (!connection) return failed("This space is not connected to the platform.");

  const credentials = getServiceCredentials(connection);
  if (!credentials) {
    return failed("No service account is saved, so the platform's case page cannot be read.");
  }

  try {
    let editPath = record.platformEditPath;

    // Cases synced before the link was captured do not have it yet. The API's
    // list is searchable, so it can be looked up for this one case.
    if (!editPath) {
      const client = new PlatformClient(connection.baseUrl);
      const login = await client.login(credentials.email, credentials.password);
      for (const archived of [false, true]) {
        const page = await client.cases(login.token, {
          per_page: 50,
          search: record.caseNumber ?? String(record.platformCaseId),
          ...(archived ? { action: "archived" as const } : {}),
        });
        const row = (page.data ?? []).find((c) => c.id === record.platformCaseId);
        editPath = row ? editPathFromActionButtons(row.action_buttons) : null;
        if (editPath) break;
      }
      if (!editPath) return failed("The platform did not give an edit page for this case.");
    }

    const html = await fetchPlatformPage(connection.domainUrl, credentials, editPath);
    const detail = parseCaseEditPage(html);
    const now = new Date();

    await db.caseRecord.update({
      where: { id: record.id },
      data: {
        platformEditPath: editPath,
        detailEncrypted: encryptSecret(JSON.stringify(detail)),
        detailFetchedAt: now,
      },
    });

    return { detail, fetchedAt: now, error: null };
  } catch (error) {
    if (error instanceof PlatformError || error instanceof CaseDetailParseError) {
      return failed(error.message);
    }
    console.error("[case-detail] unexpected failure", error);
    return failed("The platform's case page could not be read.");
  }
}

/** The cached detail only — no request to the platform. */
export function cachedCaseDetail(record: CaseRecord): CaseDetail | null {
  return readCache(record);
}
