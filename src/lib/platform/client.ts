import { isIP } from "node:net";

/**
 * Typed client for the 3D Surgical platform REST API.
 *
 * Shapes here were taken from the platform source (a Laravel 9 + Passport app),
 * not from the PDF: `app/Http/Controllers/Api/AuthController.php`,
 * `CaseController.php` and `app/Http/Resources/*`. Where the two disagree the
 * source wins — for example `domain-verification` is documented as requiring a
 * bearer token but is registered outside the auth middleware group.
 */

/** Every endpoint answers with this envelope (ApiController::sendResponse). */
export interface PlatformEnvelope<T> {
  success: number;
  message: string;
  data: T;
}

export interface PlatformLoginData {
  id: number;
  slug: string;
  email: string;
  "2fa": boolean;
  "2fa_type": "authenticator_app" | "email" | "disabled";
  avatar_url: string | null;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  gender: string | null;
  phone: string | null;
  role: string;
  role_group: string;
  token: string;
}

export interface PlatformDomainData {
  logo: string | null;
  name: string | null;
  app_add_ons: boolean;
}

export interface PlatformDashboardData {
  total_case: number;
  live_case: number;
  completed_case: number;
  new_case: number;
}

/**
 * One row of `POST /api/cases`, per `CaseResource::toArray`.
 *
 * Note what is *absent*: the surgeon and sales rep arrive as display names with
 * no ids, and `case_created_on` is preformatted with the tenant's date format
 * rather than ISO-8601. Both constrain how cases are ingested.
 */
export interface PlatformCase {
  id: number;
  case_number: string | null;
  case_code: string | null;
  product_code: string | null;
  case_status: string | null;
  product: string | null;
  scope_name: string | null;
  surgeon: string | null;
  representative_name: string | null;
  case_state: string | null;
  case_archive: boolean;
  surgery_date: string;
  anticipated_ship_date: string;
  case_created_on: string;
  // Patient fields are returned by the platform but intentionally not modelled
  // here — the ingestion layer drops them. See mapper.ts.
  [key: string]: unknown;
}

/** Laravel's LengthAwarePaginator, as serialised into `data`. */
export interface PlatformPage<T> {
  current_page: number;
  data: T[];
  from: number | null;
  last_page: number;
  per_page: number | string;
  to: number | null;
  total: number;
}

export class PlatformError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** True when the platform rejected the credential rather than erroring. */
    readonly isAuthFailure = false,
  ) {
    super(message);
    this.name = "PlatformError";
  }
}

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 2;

/**
 * Pull a readable sentence out of the platform's error envelope.
 *
 * `ApiController::sendError` puts its first argument into `message`, and callers
 * pass wildly different things: a plain string ("Validation Error."), an object
 * (`{"error":"Unauthorised"}`), or Laravel's validator bag
 * (`{"email":["The email must be a valid email address."]}`). All three reach a
 * human, so all three have to be flattened.
 */
function extractEnvelopeMessage(parsed: unknown): string {
  const fallback = "The platform rejected the request.";
  if (!parsed || typeof parsed !== "object") return fallback;

  const collect = (value: unknown, depth = 0): string[] => {
    if (depth > 3) return [];
    if (typeof value === "string") return value.trim() ? [value.trim()] : [];
    if (Array.isArray(value)) return value.flatMap((v) => collect(v, depth + 1));
    if (value && typeof value === "object") {
      return Object.values(value as Record<string, unknown>).flatMap((v) =>
        collect(v, depth + 1),
      );
    }
    return [];
  };

  const envelope = parsed as { message?: unknown; data?: unknown };
  // Prefer `message`; fall back to `data`, which is where sendError puts the
  // human-readable half when `message` holds the machine-readable one.
  const parts = collect(envelope.message);
  const chosen = parts.length > 0 ? parts : collect(envelope.data);
  if (chosen.length === 0) return fallback;

  // De-duplicate: a validation bag often repeats the same sentence.
  return [...new Set(chosen)].join(" ").slice(0, 300);
}

/** Wording the platform uses when it is the *credential* it is refusing. */
const CREDENTIAL_REJECTION = /unauthoris|unauthoriz|invalid credential|incorrect password|account inactive/i;

/**
 * Distinguish "your password is wrong" from "that request was malformed".
 *
 * Both come back as HTTP 400 with `success: 0`, so the status line alone cannot
 * tell them apart — and the difference decides whether the user is told to
 * check their password or shown what the platform actually complained about.
 */
function isCredentialRejection(status: number, parsed: unknown): boolean {
  if (status === 401 || status === 403) return true;
  if (status >= 500) return false;
  return CREDENTIAL_REJECTION.test(extractEnvelopeMessage(parsed));
}

/**
 * Reject base URLs that point at this application's own network. The platform URL is
 * admin-configurable, which would otherwise turn this client into an SSRF
 * primitive against anything reachable from the server.
 */
export function assertSafeBaseUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PlatformError(`"${rawUrl}" is not a valid URL.`, 400);
  }

  if (url.protocol !== "https:") {
    // http is tolerated only for local development against a dev platform.
    const localDev =
      process.env.NODE_ENV !== "production" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (!localDev) {
      throw new PlatformError("The platform URL must use https.", 400);
    }
  }

  const host = url.hostname.toLowerCase();
  const blockedNames = ["localhost", "metadata.google.internal", "[::1]"];
  if (process.env.NODE_ENV === "production" && blockedNames.includes(host)) {
    throw new PlatformError("That host is not allowed.", 400);
  }

  if (isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new PlatformError(
        "The platform URL must not point at a private or link-local address.",
        400,
      );
    }
  }

  return url;
}

function isPrivateAddress(host: string): boolean {
  if (isIP(host) === 6) {
    const v6 = host.toLowerCase();
    return (
      v6 === "::1" ||
      v6.startsWith("fc") ||
      v6.startsWith("fd") ||
      v6.startsWith("fe80")
    );
  }
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** Normalise a tenant domain into the `/api` base the endpoints live under. */
export function toApiBaseUrl(domainUrl: string): string {
  const url = assertSafeBaseUrl(domainUrl);
  const path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/api")) return `${url.origin}${path}`;
  return `${url.origin}${path}/api`;
}

interface RequestOptions {
  method: "GET" | "POST";
  path: string;
  token?: string;
  body?: Record<string, string | number | boolean | undefined | null>;
  timeoutMs?: number;
  /** Retries are only safe for reads; writes opt out. */
  idempotent?: boolean;
}

export class PlatformClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    // Validates and strips any trailing slash.
    this.baseUrl = toApiBaseUrl(baseUrl).replace(/\/+$/, "");
  }

  private async request<T>(options: RequestOptions): Promise<T> {
    const { method, path, token, body, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
    const url = `${this.baseUrl}/${path.replace(/^\/+/, "")}`;

    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    let payload: FormData | undefined;
    if (body) {
      payload = new FormData();
      for (const [key, value] of Object.entries(body)) {
        if (value === undefined || value === null) continue;
        payload.append(key, String(value));
      }
    }

    const attempts = options.idempotent ? MAX_RETRIES + 1 : 1;
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 300 * 2 ** (attempt - 1)));
      }
      try {
        const response = await fetch(url, {
          method,
          headers,
          body: payload,
          signal: AbortSignal.timeout(timeoutMs),
          cache: "no-store",
          redirect: "manual",
        });

        // The platform redirects non-/api requests to the web app; a redirect
        // here means the base URL is wrong, and following it would leak the
        // bearer token to an HTML endpoint.
        if (response.status >= 300 && response.status < 400) {
          throw new PlatformError(
            "The platform redirected the request — check that the URL includes the /api prefix.",
            response.status,
          );
        }

        if (response.status === 401 || response.status === 403) {
          throw new PlatformError(
            "The platform rejected the credentials.",
            response.status,
            true,
          );
        }

        if (response.status >= 500) {
          throw new PlatformError(
            `The platform returned ${response.status}.`,
            response.status,
          );
        }

        const text = await response.text();
        let parsed: PlatformEnvelope<T>;
        try {
          parsed = JSON.parse(text) as PlatformEnvelope<T>;
        } catch {
          throw new PlatformError(
            "The platform returned a non-JSON response — check the URL and that Accept: application/json is honoured.",
            response.status,
          );
        }

        if (!parsed || parsed.success !== 1) {
          // The envelope, not the status code, carries the real outcome: the
          // platform answers a rejected credential with HTTP 400 and puts the
          // reason in `message`, which is sometimes a string and sometimes an
          // object keyed by field or by "error".
          const message = extractEnvelopeMessage(parsed);
          throw new PlatformError(
            message,
            response.status,
            isCredentialRejection(response.status, parsed),
          );
        }

        return parsed.data;
      } catch (error) {
        lastError = error;
        const retryable =
          !(error instanceof PlatformError) ||
          (error.status >= 500 && !error.isAuthFailure);
        if (!retryable || attempt === attempts - 1) break;
      }
    }

    if (lastError instanceof PlatformError) throw lastError;
    throw this.describeNetworkFailure(lastError);
  }

  /**
   * Turn a transport failure into something actionable.
   *
   * "Could not reach the platform" is true of a typo in the hostname, a firewall,
   * an expired certificate and a server that is simply down — and sends whoever
   * reads it looking in the wrong place. Node surfaces the real reason on
   * `error.cause.code`, so name it.
   */
  private describeNetworkFailure(error: unknown): PlatformError {
    const host = (() => {
      try {
        return new URL(this.baseUrl).host;
      } catch {
        return this.baseUrl;
      }
    })();

    if (error instanceof Error && error.name === "TimeoutError") {
      return new PlatformError(
        `${host} accepted the connection but did not respond in time.`,
        504,
      );
    }

    const cause = (error as { cause?: { code?: string } } | undefined)?.cause;
    const code = typeof cause?.code === "string" ? cause.code : undefined;

    switch (code) {
      case "ENOTFOUND":
      case "EAI_AGAIN":
        return new PlatformError(
          `No server exists at "${host}" — the name does not resolve. Check it for a typo.`,
          502,
        );
      case "ECONNREFUSED":
        return new PlatformError(
          `${host} refused the connection. The address resolves, but nothing is listening on that port.`,
          502,
        );
      case "ETIMEDOUT":
      case "UND_ERR_CONNECT_TIMEOUT":
        return new PlatformError(
          `${host} did not answer. It may be behind a firewall that does not allow this server.`,
          504,
        );
      case "ECONNRESET":
        return new PlatformError(
          `${host} closed the connection unexpectedly.`,
          502,
        );
      case "CERT_HAS_EXPIRED":
      case "ERR_TLS_CERT_ALTNAME_INVALID":
      case "DEPTH_ZERO_SELF_SIGNED_CERT":
      case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
        return new PlatformError(
          `The TLS certificate for ${host} could not be trusted (${code}).`,
          502,
        );
      default:
        return new PlatformError(
          `Could not reach ${host}${code ? ` (${code})` : ""}. Check the URL and that this server has network access to it.`,
          502,
        );
    }
  }

  /**
   * Authenticate against the platform.
   *
   * Caution: the platform issues a working Passport token here even when the
   * account has 2FA pending — it only gates the second factor client-side. The
   * application must not open a session on this alone; see verifyTwoFactor.
   */
  login(email: string, password: string) {
    return this.request<PlatformLoginData>({
      method: "POST",
      path: "login",
      body: { email, password },
    });
  }

  verifyTwoFactor(token: string, oneTimePassword: string) {
    return this.request<PlatformLoginData>({
      method: "POST",
      path: "2fa-challenge-verify",
      token,
      body: { one_time_password: oneTimePassword },
    });
  }

  resendTwoFactor(token: string) {
    return this.request<unknown[]>({
      method: "GET",
      path: "2fa-challenge-resend",
      token,
    });
  }

  logout(token: string) {
    return this.request<unknown[]>({ method: "POST", path: "logout", token });
  }

  /** Public endpoint — confirms the domain belongs to a real tenant. */
  verifyDomain(domainUrl: string) {
    return this.request<PlatformDomainData>({
      method: "POST",
      path: "domain-verification",
      body: { domain_url: domainUrl },
      idempotent: true,
    });
  }

  dashboard(token: string) {
    return this.request<PlatformDashboardData>({
      method: "POST",
      path: "dashboard",
      token,
      idempotent: true,
    });
  }

  cases(
    token: string,
    params: {
      page?: number;
      per_page?: number;
      sort_type?: "ASC" | "DESC";
      sort_column?: string;
      search?: string;
      action?: "archived";
    } = {},
  ) {
    const { page, ...body } = params;
    // `page` is read from the query string by Laravel's paginator, the rest
    // from the request body.
    const suffix = page && page > 1 ? `cases?page=${page}` : "cases";
    return this.request<PlatformPage<PlatformCase>>({
      method: "POST",
      path: suffix,
      token,
      body,
      idempotent: true,
      timeoutMs: 45_000,
    });
  }
}
