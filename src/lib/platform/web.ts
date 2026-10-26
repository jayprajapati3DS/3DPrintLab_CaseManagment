import "server-only";

import { parse } from "node-html-parser";

import { assertSafeBaseUrl, PlatformError } from "@/lib/platform/client";

/**
 * Read-only access to the platform's web application.
 *
 * The REST API has a case list and nothing else: no endpoint returns one case
 * in full. Priority, scan type, shipping address, the status table, the
 * documents and the share links exist only on the platform's own case edit
 * page. So, to show them here, this signs in to the web application the way a
 * browser does — a CSRF token, a session cookie — and reads that page's HTML.
 *
 * That is brittle by nature: it depends on the platform's markup. It is kept
 * to one page, it only ever issues GETs after signing in, and everything that
 * knows about the markup lives in case-detail.ts. If the platform gains a
 * case-detail endpoint, this file is what it replaces.
 */

const TIMEOUT_MS = 25_000;
/** Laravel's default session lifetime is two hours; stay well inside it. */
const SESSION_TTL_MS = 30 * 60_000;

interface WebSession {
  cookies: Map<string, string>;
  createdAt: number;
}

/** One web session per tenant and account, reused across requests. */
const sessions = new Map<string, WebSession>();

function cookieHeader(session: WebSession): string {
  return [...session.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
}

function absorbCookies(session: WebSession, response: Response): void {
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(";", 1)[0];
    const eq = pair.indexOf("=");
    if (eq > 0) session.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
  }
}

function describe(error: unknown): PlatformError {
  if (error instanceof PlatformError) return error;
  if (error instanceof Error && error.name === "TimeoutError") {
    return new PlatformError("The platform did not respond in time.", 504);
  }
  return new PlatformError("Could not reach the platform.", 502);
}

async function signIn(origin: string, email: string, password: string): Promise<WebSession> {
  const session: WebSession = { cookies: new Map(), createdAt: Date.now() };

  try {
    const loginPage = await fetch(`${origin}/login`, {
      headers: { Accept: "text/html" },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    absorbCookies(session, loginPage);
    const token = parse(await loginPage.text())
      .querySelector('input[name="_token"]')
      ?.getAttribute("value");
    if (!token) {
      throw new PlatformError("The platform's sign-in page was not recognised.", 502);
    }

    const response = await fetch(`${origin}/login`, {
      method: "POST",
      headers: {
        Accept: "text/html",
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieHeader(session),
      },
      body: new URLSearchParams({ _token: token, email, password }),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    absorbCookies(session, response);

    // Success is a redirect into the application; failure is a redirect back
    // to the sign-in page, or to a second-factor challenge.
    const location = response.headers.get("location") ?? "";
    const target = location ? new URL(location, origin).pathname : "";
    if (response.status < 300 || response.status >= 400 || target.startsWith("/login")) {
      throw new PlatformError("The platform rejected the service account's credentials.", 401, true);
    }
    if (/two-factor|mfa|2fa|otp/i.test(target)) {
      throw new PlatformError(
        "The service account has two-factor sign-in, so its case pages cannot be read. " +
          "Use a service account without it.",
        401,
        true,
      );
    }
  } catch (error) {
    throw describe(error);
  }

  return session;
}

/**
 * Fetch one page of the web application as the service account.
 *
 * @param path  A path on the tenant, e.g. `/case-models/<id>/edit`.
 */
export async function fetchPlatformPage(
  domainUrl: string,
  credentials: { email: string; password: string },
  path: string,
): Promise<string> {
  // The same guard the API client applies: never a private or local address.
  const origin = assertSafeBaseUrl(domainUrl).origin;
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new PlatformError("That is not a page on the platform.", 400);
  }

  const key = `${origin}|${credentials.email}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    let session = sessions.get(key);
    if (!session || Date.now() - session.createdAt > SESSION_TTL_MS) {
      session = await signIn(origin, credentials.email, credentials.password);
      sessions.set(key, session);
    }

    let response: Response;
    try {
      response = await fetch(`${origin}${path}`, {
        headers: { Accept: "text/html", Cookie: cookieHeader(session) },
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw describe(error);
    }
    absorbCookies(session, response);

    if (response.status === 200) return response.text();

    // Bounced to sign-in: the session lapsed. Drop it and try once more.
    if (response.status >= 300 && response.status < 400) {
      sessions.delete(key);
      continue;
    }
    if (response.status === 404) {
      throw new PlatformError("That case no longer exists on the platform.", 404);
    }
    throw new PlatformError(`The platform returned ${response.status}.`, response.status);
  }

  throw new PlatformError("Could not stay signed in to the platform.", 401, true);
}
