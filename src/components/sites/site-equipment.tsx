import { SiteEquipmentEditor } from "@/components/sites/site-equipment-editor";
import { db } from "@/lib/db";
import { SITE_ITEM_KINDS as SITE_KINDS } from "@/lib/resources/config";

/**
 * What a site has: its machines, equipment, materials, parameters, software
 * and operators — each item set to this site — and how many parts are being
 * made there. Items shared by all sites are counted apart. The space admin
 * adds items here (new, or from the lists), changes their status, or takes
 * them off the site.
 */
export async function SiteEquipment({ spaceId, siteId, canEdit }: { spaceId: string; siteId: string; canEdit: boolean }) {
  const [items, sites, parts] = await Promise.all([
    db.resource.findMany({ where: { spaceId, archivedAt: null, kind: { in: SITE_KINDS } }, select: { id: true, kind: true, name: true, status: true, data: true }, orderBy: { name: "asc" } }),
    db.resource.findMany({ where: { spaceId, kind: "sites" }, select: { id: true, name: true } }),
    db.part.count({ where: { spaceId, siteId } }),
  ]);
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  const rows = items.map((i) => {
    const at = ((i.data ?? {}) as { siteId?: string }).siteId ?? "";
    return { id: i.id, kind: i.kind, name: i.name, status: i.status, siteId: at, siteName: at ? (siteName.get(at) ?? "another site") : "" };
  });
  return <SiteEquipmentEditor siteId={siteId} rows={rows} parts={parts} canEdit={canEdit} />;
}
