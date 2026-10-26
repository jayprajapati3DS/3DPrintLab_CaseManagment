import { NextResponse, type NextRequest } from "next/server";

/**
 * Proxy (formerly "middleware"): security headers and a cheap sign-in gate.
 *
 * This runs on the Edge runtime and cannot reach the database, so it only
 * checks whether a session cookie is *present*. Whether that cookie is valid,
 * unexpired and attached to an active user is decided in the app layout, which
 * can query. Treat this purely as a redirect convenience, never as the control.
 */

const PUBLIC_PATHS = ["/login"];

/** Cookie names must match src/lib/auth/session.ts. */
const SESSION_COOKIES = ["__Host-mms_session", "mms_session"];

function buildCsp(nonce: string, isDev: boolean): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'strict-dynamic' lets the nonced Next bootstrap load its own chunks
    // without enumerating them; the host allow-list is ignored by browsers
    // that honour it, and acts as the fallback for those that do not.
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      // React refresh and the dev overlay evaluate generated code.
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    // Next and the chart library inject element-level styles at runtime.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    // The browser never calls the platform directly — all upstream traffic goes
    // through this server — so same-origin is the whole allowance.
    "connect-src": ["'self'", ...(isDev ? ["ws:", "wss:"] : [])],
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
  };

  if (!isDev) directives["upgrade-insecure-requests"] = [];

  return Object.entries(directives)
    .map(([key, values]) => (values.length ? `${key} ${values.join(" ")}` : key))
    .join("; ");
}

export function proxy(request: NextRequest) {
  const isDev = process.env.NODE_ENV !== "production";
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, isDev);

  const { pathname } = request.nextUrl;

  // The bare base domain is neither the admin console nor a space. Rather than
  // a dead end, it leads to the console; the cron endpoint answers anywhere.
  const base = (process.env.BASE_DOMAIN ?? "localhost").toLowerCase();
  const host = (request.headers.get("host") ?? "").toLowerCase();
  if (host.replace(/:\d+$/, "") === base && !pathname.startsWith("/api/cron")) {
    const port = host.match(/:\d+$/)?.[0] ?? "";
    const url = request.nextUrl.clone();
    url.host = `admin.${base}${port}`;
    return NextResponse.redirect(url);
  }

  const isPublic =
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    pathname.startsWith("/api/cron");

  const hasSessionCookie = SESSION_COOKIES.some((name) =>
    request.cookies.has(name),
  );

  if (!isPublic && !hasSessionCookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    // Only same-site paths are ever echoed back, so this cannot be used as an
    // open redirect.
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Sending an already-signed-in visitor from /login to / is decided by the
  // login page, not here, and deliberately so.
  //
  // This middleware runs on the edge and cannot query the database, so all it
  // ever knew was that *a cookie exists* — not that the session behind it is
  // alive. Once a cookie outlives its session (an idle timeout, a role change,
  // a sign-out elsewhere) the two layers disagreed and bounced the browser
  // between them until it gave up with ERR_TOO_MANY_REDIRECTS:
  //
  //   /       -> the app rejects the dead session      -> /login
  //   /login  -> a cookie exists, so "already in"      -> /
  //
  // The login page can read the real session, so it decides. Presence of a
  // cookie is never again treated as proof of anything.

  // Next reads the nonce back off the request headers and stamps it onto the
  // scripts it emits.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // The page asked for: a site-only person may open only some (src/lib/sites/scope.ts).
  requestHeaders.set("x-pathname", pathname);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // Stored files carry their own policy (an SVG logo is sandboxed): /api/files/[id].
  if (!pathname.startsWith("/api/files/")) response.headers.set("content-security-policy", csp);
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  response.headers.set("x-frame-options", "DENY");
  // Nothing here uses the camera, microphone or location.
  response.headers.set(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  );
  response.headers.set("cross-origin-opener-policy", "same-origin");
  response.headers.set("x-dns-prefetch-control", "off");
  if (!isDev) {
    response.headers.set(
      "strict-transport-security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except Next's own static output and the favicon — those are
     * public assets that need no gate and no per-request nonce.
     */
    {
      source: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
