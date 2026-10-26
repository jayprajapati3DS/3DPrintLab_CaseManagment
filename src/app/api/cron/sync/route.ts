import { NextResponse, type NextRequest } from "next/server";

import { pruneLoginAttempts } from "@/lib/auth/rate-limit";
import { pruneExpiredSessions } from "@/lib/auth/session";
import { safeEquals } from "@/lib/crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getServiceCredentials, runSync } from "@/lib/platform/sync";

/**
 * Scheduled sync, for every space that has a service account.
 *
 * Called by cron with `Authorization: Bearer $CRON_SECRET`. It is the only
 * route outside the sign-in gate, so the shared secret is the whole control:
 * compared in constant time, and never echoed back in a response.
 *
 *   curl -X POST https://admin.$BASE_DOMAIN/api/cron/sync -H "Authorization: Bearer $CRON_SECRET"
 */

export const dynamic = "force-dynamic";
// A full pull is minutes of work, not seconds.
export const maxDuration = 300;

function authorise(request: NextRequest): boolean {
  const header = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  return safeEquals(header.slice(prefix.length), env.CRON_SECRET);
}

export async function POST(request: NextRequest) {
  if (!authorise(request)) {
    // No detail: a caller without the secret learns nothing about why.
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const connections = await db.platformConnection.findMany({
    where: { space: { isActive: true } },
    include: { space: { select: { slug: true } } },
  });

  // One space at a time: they may share a platform host, and a slow tenant
  // should not be hit by several pulls at once.
  const spaces = [];
  for (const connection of connections) {
    if (!getServiceCredentials(connection)) {
      spaces.push({ space: connection.space.slug, status: "SKIPPED", reason: "No service account." });
      continue;
    }
    const result = await runSync(connection, { trigger: "schedule" });
    spaces.push({
      space: connection.space.slug,
      status: result.status,
      casesSeen: result.casesSeen,
      casesCreated: result.casesCreated,
      casesUpdated: result.casesUpdated,
      warnings: result.warnings.length,
      error: result.errorMessage,
    });
  }

  // Housekeeping rides along with the schedule rather than needing its own job.
  const [sessionsPruned, attemptsPruned] = await Promise.all([
    pruneExpiredSessions(),
    pruneLoginAttempts(),
  ]);

  const failed = spaces.some((s) => s.status === "FAILED");
  return NextResponse.json(
    { spaces, housekeeping: { sessionsPruned, attemptsPruned } },
    { status: failed ? 500 : 200 },
  );
}

/** GET is rejected so the sync cannot be triggered by a link or a prefetch. */
export function GET() {
  return NextResponse.json(
    { error: "Use POST." },
    { status: 405, headers: { Allow: "POST" } },
  );
}
