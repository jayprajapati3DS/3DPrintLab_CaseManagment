"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { recordAudit } from "@/lib/audit";
import { assertSameOrigin } from "@/lib/auth/origin";
import { hashPassword } from "@/lib/auth/password";
import { requireSpaceAdmin } from "@/lib/auth/rbac";
import { revokeAllSessionsForUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { newResourceDraft } from "@/lib/resources/actions";
import { KINDS, SITE_ITEM_KINDS, type ResourceKind } from "@/lib/resources/config";

/**
 * Who works at a manufacturing site: people of the space added to it or taken
 * off it, whether they see only their sites' parts (a vendor's or partner's
 * staff), and new site accounts with a password kept here — so a vendor's
 * staff need no platform account. All of it is the space admin's.
 */

export interface SiteResult {
  ok: boolean;
  message: string;
}

async function loadSite(spaceId: string, siteId: string) {
  return db.resource.findFirst({ where: { id: siteId, spaceId, kind: "sites", archivedAt: null }, select: { id: true, name: true } });
}

function revalidateSite(siteId: string) {
  revalidatePath(`/sites/${siteId}`);
  revalidatePath("/sites");
  revalidatePath("/users");
}

/** Add someone of the space to the site, or take them off it. */
export async function setSiteMember(siteId: string, userId: string, member: boolean): Promise<SiteResult> {
  await assertSameOrigin();
  const actor = await requireSpaceAdmin();
  const site = await loadSite(actor.space.id, siteId);
  if (!site) return { ok: false, message: "That site is no longer available." };
  const person = await db.user.findFirst({ where: { id: userId, spaceId: actor.space.id }, select: { id: true, name: true, siteIds: true, siteOnly: true } });
  if (!person) return { ok: false, message: "That person is no longer in this space." };
  const siteIds = member ? [...new Set([...person.siteIds, site.id])] : person.siteIds.filter((s) => s !== site.id);
  // Site-only with no site left would see nothing: they become an ordinary member again.
  const siteOnly = person.siteOnly && siteIds.length > 0;
  await db.user.update({ where: { id: person.id }, data: { siteIds, siteOnly } });
  if (person.siteOnly) await revokeAllSessionsForUser(person.id, "site membership changed");
  await recordAudit({
    action: member ? "site.member_add" : "site.member_remove",
    entityType: "resource",
    spaceId: actor.space.id,
    entityId: site.id,
    actorId: actor.id,
    actorEmail: actor.email,
    summary: `${member ? "Added" : "Removed"} ${person.name} ${member ? "to" : "from"} the site ${site.name}.`,
    before: { siteIds: person.siteIds },
    after: { siteIds },
  });
  revalidateSite(site.id);
  return { ok: true, message: member ? `${person.name} added to ${site.name}.` : `${person.name} removed from ${site.name}.` };
}

/** Site-only access on or off: on, they see only the parts made at their sites — no cases, no setup. */
export async function setSiteOnly(siteId: string, userId: string, siteOnly: boolean): Promise<SiteResult> {
  await assertSameOrigin();
  const actor = await requireSpaceAdmin();
  const site = await loadSite(actor.space.id, siteId);
  if (!site) return { ok: false, message: "That site is no longer available." };
  const person = await db.user.findFirst({ where: { id: userId, spaceId: actor.space.id }, select: { id: true, name: true, role: true, siteIds: true } });
  if (!person) return { ok: false, message: "That person is no longer in this space." };
  if (person.role === "SPACE_ADMIN") return { ok: false, message: "A space admin always sees everything." };
  if (siteOnly && person.siteIds.length === 0) return { ok: false, message: "Add them to a site first." };
  await db.user.update({ where: { id: person.id }, data: { siteOnly } });
  // The change applies at once: their sessions end, and they sign in again with the new access.
  await revokeAllSessionsForUser(person.id, "site access changed");
  await recordAudit({
    action: "site.access",
    entityType: "user",
    spaceId: actor.space.id,
    entityId: person.id,
    actorId: actor.id,
    actorEmail: actor.email,
    summary: `${person.name}: ${siteOnly ? "site-only access (their sites' parts only)" : "full access"}.`,
    after: { siteOnly },
  });
  revalidateSite(site.id);
  return { ok: true, message: siteOnly ? `${person.name} now sees only their sites' parts.` : `${person.name} has full access.` };
}

const newAccount = z.object({
  name: z.string().trim().min(2, "Enter their name.").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(200),
  password: z.string().min(10, "The password needs at least 10 characters.").max(200),
  roleName: z.string().trim().max(120),
  siteOnly: z.boolean(),
});

/** A new account for someone at the site — a vendor's operator, say — signing in with a password kept here. */
export async function createSiteAccount(siteId: string, input: unknown): Promise<SiteResult> {
  await assertSameOrigin();
  const actor = await requireSpaceAdmin();
  const site = await loadSite(actor.space.id, siteId);
  if (!site) return { ok: false, message: "That site is no longer available." };
  const parsed = newAccount.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the details." };
  const { name, email, password, roleName, siteOnly } = parsed.data;
  const taken = await db.user.findFirst({ where: { spaceId: actor.space.id, email }, select: { id: true } });
  if (taken) return { ok: false, message: `${email} is already in this space — add them from the list instead.` };
  const created = await db.user.create({
    data: {
      spaceId: actor.space.id,
      email,
      name,
      role: "MEMBER",
      platformRoleName: roleName || "Site operator",
      passwordHash: await hashPassword(password),
      siteIds: [site.id],
      siteOnly,
    },
  });
  await recordAudit({
    action: "site.account_create",
    entityType: "user",
    spaceId: actor.space.id,
    entityId: created.id,
    actorId: actor.id,
    actorEmail: actor.email,
    summary: `Added a site account for ${name} (${email}) at ${site.name}${siteOnly ? " — site-only access" : ""}.`,
    after: { name, email, roleName: roleName || "Site operator", site: site.name, siteOnly },
  });
  revalidateSite(site.id);
  return { ok: true, message: `${name} can now sign in with ${email}.` };
}

// --- What is at a site ------------------------------------------------------------------------------

/** Set an item to this site — or take it off, so it is shared by all sites again. */
export async function setItemSite(siteId: string, itemId: string, here: boolean): Promise<SiteResult> {
  await assertSameOrigin();
  const actor = await requireSpaceAdmin();
  const site = await loadSite(actor.space.id, siteId);
  if (!site) return { ok: false, message: "That site is no longer available." };
  const item = await db.resource.findFirst({ where: { id: itemId, spaceId: actor.space.id, archivedAt: null, kind: { in: SITE_ITEM_KINDS } } });
  if (!item) return { ok: false, message: "That item is no longer available." };
  const data = (item.data ?? {}) as Record<string, unknown>;
  const before = typeof data.siteId === "string" ? data.siteId : "";
  const after = here ? site.id : "";
  if (before === after) return { ok: true, message: "No change." };
  await db.resource.update({ where: { id: item.id }, data: { data: { ...data, siteId: after } as Prisma.InputJsonObject } });
  await recordAudit({
    action: "resource.update",
    entityType: item.kind,
    entityId: item.id,
    entityName: item.name,
    spaceId: actor.space.id,
    actorId: actor.id,
    actorEmail: actor.email,
    summary: here ? `Set ${item.name} to the site ${site.name}.` : `Took ${item.name} off the site ${site.name} — shared by all sites.`,
    before: { siteId: before },
    after: { siteId: after },
  });
  revalidateSite(site.id);
  revalidatePath(`${KINDS[item.kind as ResourceKind].route}/${item.id}`);
  return { ok: true, message: here ? `${item.name} is now at ${site.name}.` : `${item.name} is shared by all sites.` };
}

/** A new item of one of the lists, made at this site; its other details are filled on its own page. */
export async function addSiteItem(siteId: string, kind: string, name: string): Promise<SiteResult & { href?: string }> {
  await assertSameOrigin();
  const actor = await requireSpaceAdmin();
  const site = await loadSite(actor.space.id, siteId);
  if (!site) return { ok: false, message: "That site is no longer available." };
  if (!SITE_ITEM_KINDS.includes(kind as ResourceKind)) return { ok: false, message: "Choose which list it goes in." };
  const clean = String(name ?? "").trim().slice(0, 200);
  if (!clean) return { ok: false, message: `Give the ${KINDS[kind as ResourceKind].noun} a name.` };
  const config = KINDS[kind as ResourceKind];
  if (await db.resource.findFirst({ where: { spaceId: actor.space.id, kind, name: clean, archivedAt: null }, select: { id: true } })) {
    return { ok: false, message: `There is already a ${config.noun} called ${clean} — add it from the list instead.` };
  }
  const draft = await newResourceDraft(kind as ResourceKind);
  const created = await db.resource.create({
    data: { spaceId: actor.space.id, kind, name: clean, status: draft.status, data: { ...draft.data, siteId: site.id } as Prisma.InputJsonObject },
  });
  await recordAudit({
    action: "resource.create",
    entityType: kind,
    entityId: created.id,
    entityName: clean,
    spaceId: actor.space.id,
    actorId: actor.id,
    actorEmail: actor.email,
    summary: `Added the ${config.noun} ${clean} at the site ${site.name}.`,
    after: { name: clean, status: draft.status, siteId: site.id },
  });
  revalidateSite(site.id);
  revalidatePath(config.route);
  return { ok: true, message: `${clean} added at ${site.name} — open it to fill in its details.`, href: `${config.route}/${created.id}` };
}

/** An item's status, changed from the site's list. */
export async function setSiteItemStatus(siteId: string, itemId: string, status: string): Promise<SiteResult> {
  await assertSameOrigin();
  const actor = await requireSpaceAdmin();
  const item = await db.resource.findFirst({ where: { id: itemId, spaceId: actor.space.id, archivedAt: null, kind: { in: SITE_ITEM_KINDS } } });
  if (!item) return { ok: false, message: "That item is no longer available." };
  const allowed = KINDS[item.kind as ResourceKind].statuses;
  if (!allowed.includes(status)) return { ok: false, message: "Choose a status from the list." };
  if (item.status === status) return { ok: true, message: "No change." };
  await db.resource.update({ where: { id: item.id }, data: { status } });
  await recordAudit({
    action: "resource.status",
    entityType: item.kind,
    entityId: item.id,
    entityName: item.name,
    spaceId: actor.space.id,
    actorId: actor.id,
    actorEmail: actor.email,
    summary: `${item.name}: status ${item.status || "—"} → ${status}.`,
    before: { status: item.status },
    after: { status },
  });
  revalidateSite(siteId);
  revalidatePath(`${KINDS[item.kind as ResourceKind].route}/${item.id}`);
  return { ok: true, message: `${item.name} is now ${status}.` };
}
