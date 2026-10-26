import "server-only";

import { headers } from "next/headers";

/**
 * Cross-origin request rejection for state-changing endpoints.
 *
 * Session cookies are SameSite=Lax, which already blocks cross-site POSTs, and
 * Next verifies Origin against Host for server actions. This is the third layer
 * and the one that also covers route handlers: a mutation must come from the
 * very site it is addressed to, or it does not run.
 *
 * "The same site" is the request's own host rather than one configured origin,
 * because the application is served on many: the admin console and every
 * company space have their own address, and a form on one must not be able to
 * act on another.
 */

export class CrossOriginError extends Error {
  constructor(message = "This request did not come from the application.") {
    super(message);
    this.name = "CrossOriginError";
  }
}

function hostOf(value: string): string | null {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * @throws CrossOriginError when the request's Origin is absent or is not the
 * host the request was sent to.
 */
export async function assertSameOrigin(): Promise<void> {
  const h = await headers();
  const host = (h.get("host") ?? "").toLowerCase();
  if (!host) throw new CrossOriginError();

  // A same-origin form POST from an older browser may omit Origin; fall back
  // to Referer, and reject when neither is present.
  const source = h.get("origin") ?? h.get("referer");
  if (!source || hostOf(source) !== host) throw new CrossOriginError();
}
