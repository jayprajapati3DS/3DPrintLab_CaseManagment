import type { Prisma } from "@prisma/client";

/**
 * What a site-only person — a vendor's or partner's staff — may reach: the
 * parts made at their sites and those parts' quality forms; nothing of cases,
 * patients or setup. Everyone else is not narrowed.
 */

export interface SiteScoped {
  siteOnly: boolean;
  siteIds: string[];
  /** A surgeon: their own cases' Order tab only (by the case's surgeon). */
  surgeonOnly?: boolean;
  name?: string;
}

/** The pages a surgeon may open: their orders, their cases (the Order tab), what waits for them. */
const SURGEON_PATHS = ["/orders", "/cases", "/approvals", "/account", "/no-access", "/api/"];

export function surgeonOnlyAllows(pathname: string): boolean {
  return SURGEON_PATHS.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`) || pathname.startsWith(`${p}?`));
}

/** Whether a surgeon is this case's: its surgeon, or one of its secondary surgeons. */
export function seesCase(user: SiteScoped & { id?: string }, record: { surgeonName: string | null; details?: unknown }): boolean {
  if (!user.surgeonOnly) return true;
  if (record.surgeonName && record.surgeonName === user.name) return true;
  const details = Array.isArray(record.details) ? (record.details as Array<{ ids?: unknown }>) : [];
  return Boolean(user.id && details.some((d) => Array.isArray(d.ids) && d.ids.includes(user.id)));
}

/** The pages a site-only person may open (and post actions from). */
const SITE_ONLY_PATHS = ["/parts", "/qualityforms", "/approvals", "/account", "/no-access", "/api/"];

export function siteOnlyAllows(pathname: string): boolean {
  return SITE_ONLY_PATHS.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`) || pathname.startsWith(`${p}?`));
}

/** Parts they may see: those made at their sites. */
export function partScope(user: SiteScoped): Prisma.PartWhereInput {
  // A surgeon works on no part.
  if (user.surgeonOnly) return { id: "-" };
  return user.siteOnly ? { siteId: { in: user.siteIds } } : {};
}

/** Quality forms they may see: the forms of those parts — never a case's own. */
export function formScope(user: SiteScoped): Prisma.PartFormWhereInput {
  // A surgeon: the Order tab forms of the cases they operate on.
  if (user.surgeonOnly) return { area: "order", withdrawnAt: null, case: { surgeonName: user.name ?? "-" } };
  return user.siteOnly ? { part: { siteId: { in: user.siteIds } } } : {};
}

/** Whether they may see this part. */
export function seesPart(user: SiteScoped, part: { siteId: string | null }): boolean {
  return !user.siteOnly || Boolean(part.siteId && user.siteIds.includes(part.siteId));
}
