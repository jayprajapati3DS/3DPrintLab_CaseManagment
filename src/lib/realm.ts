import "server-only";

import { headers } from "next/headers";
import { cache } from "react";

import { db } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Which site a request is for.
 *
 * The application is one deployment serving several sites, told apart by the
 * address they are reached at:
 *
 *   admin.<BASE_DOMAIN>     the admin console — platform administrators only
 *   <slug>.<BASE_DOMAIN>    one company space
 *   a space's custom domain the same space, under the company's own name
 *
 * Everything that depends on "where am I" — which sign-in page to show, whose
 * session is acceptable, which space a query is scoped to — starts here, so
 * the answer is derived from the address in exactly one place.
 */

export const ADMIN_LABEL = "admin";

export interface RealmSpace {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
}

export type Realm =
  | { kind: "admin"; host: string }
  | { kind: "space"; host: string; space: RealmSpace }
  | { kind: "unknown"; host: string };

const SPACE_SELECT = { id: true, name: true, slug: true, isActive: true } as const;

/** The request's host, split. `host` keeps the port; `hostname` does not. */
async function requestHost(): Promise<{ host: string; hostname: string; port: string }> {
  const h = await headers();
  const host = (h.get("host") ?? "").trim().toLowerCase();
  const colon = host.lastIndexOf(":");
  // An IPv6 literal ends in "]"; anything after a later colon is the port.
  const hasPort = colon > -1 && !host.endsWith("]");
  return {
    host,
    hostname: hasPort ? host.slice(0, colon) : host,
    port: hasPort ? host.slice(colon + 1) : "",
  };
}

export const getRealm = cache(async (): Promise<Realm> => {
  const { host, hostname } = await requestHost();
  const base = env.BASE_DOMAIN;

  if (hostname === `${ADMIN_LABEL}.${base}`) return { kind: "admin", host };

  if (hostname.endsWith(`.${base}`)) {
    const label = hostname.slice(0, -(base.length + 1));
    // One label only: `a.b.<base>` is nobody's space.
    if (label && !label.includes(".")) {
      const space = await db.space.findUnique({ where: { slug: label }, select: SPACE_SELECT });
      if (space) return { kind: "space", host, space };
    }
    return { kind: "unknown", host };
  }

  if (hostname && hostname !== base) {
    const space = await db.space.findUnique({
      where: { customDomain: hostname },
      select: SPACE_SELECT,
    });
    if (space) return { kind: "space", host, space };
  }

  return { kind: "unknown", host };
});

/**
 * The origin of a sibling site — a space's sign-in address, as seen from the
 * admin console. It is built from the current request, so the scheme and port
 * match however this deployment is actually being reached.
 */
export async function siteOrigin(label: string): Promise<string> {
  const h = await headers();
  const { port } = await requestHost();
  const forwarded = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const scheme = forwarded || (env.NODE_ENV === "production" ? "https" : "http");
  return `${scheme}://${label}.${env.BASE_DOMAIN}${port ? `:${port}` : ""}`;
}

/** `jajal-medical.example.com` — for display, without scheme or port. */
export function siteHostname(label: string): string {
  return `${label}.${env.BASE_DOMAIN}`;
}

/** Subdomains that must never become a space. */
export const RESERVED_SLUGS = new Set([ADMIN_LABEL, "www", "api", "app", "mail"]);
