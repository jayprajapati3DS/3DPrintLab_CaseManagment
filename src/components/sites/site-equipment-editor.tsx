"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { S_BTN_PRIMARY, S_INPUT, S_TD, S_TH, SectionCard } from "@/components/setup/ui";
import { KINDS, SITE_ITEM_KINDS as SITE_KINDS, type ResourceKind } from "@/lib/resources/config";
import { addSiteItem, setItemSite, setSiteItemStatus, type SiteResult } from "@/lib/sites/actions";

export interface SiteItemRow {
  id: string;
  kind: string;
  name: string;
  status: string;
  /** The site it is set to; "" = shared by all. */
  siteId: string;
  siteName: string;
}

const LABEL = "text-muted text-[11px] font-semibold tracking-[0.5px] uppercase";

export function SiteEquipmentEditor({ siteId, rows, parts, canEdit }: { siteId: string; rows: SiteItemRow[]; parts: number; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<(SiteResult & { href?: string }) | null>(null);
  const [pickKind, setPickKind] = useState<ResourceKind>("printers");
  const [pickId, setPickId] = useState("");
  const [newKind, setNewKind] = useState<ResourceKind>("printers");
  const [newName, setNewName] = useState("");

  const here = rows.filter((r) => r.siteId === siteId);
  const shared = rows.filter((r) => !r.siteId).length;
  const elsewhere = rows.filter((r) => r.kind === pickKind && r.siteId !== siteId);

  const run = (fn: () => Promise<SiteResult & { href?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setResult(r);
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });

  const kindSelect = (value: ResourceKind, onChange: (k: ResourceKind) => void, label: string) => (
    <label className="flex flex-col gap-1">
      <span className={LABEL}>List</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as ResourceKind)} className={`${S_INPUT} h-9`}>
        {SITE_KINDS.map((k) => (
          <option key={k} value={k}>
            {KINDS[k].title}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="Equipment & materials at this site">
        <p className="text-muted m-0 mb-3 text-[12.5px]">
          A part made here offers these in its quality forms, with the {shared} item{shared === 1 ? "" : "s"} shared by all sites. {parts} part{parts === 1 ? " is" : "s are"} made here.
        </p>
        {here.length === 0 ? (
          <p className="text-muted m-0 text-[13px]">Nothing set to this site yet{canEdit ? " — add items below." : "."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[13px]" aria-label="Site equipment">
              <thead>
                <tr>
                  <th className={S_TH}>List</th>
                  <th className={S_TH}>Item</th>
                  <th className={S_TH}>Status</th>
                  {canEdit ? <th className={S_TH} /> : null}
                </tr>
              </thead>
              <tbody>
                {SITE_KINDS.flatMap((kind) =>
                  here
                    .filter((i) => i.kind === kind)
                    .map((i) => {
                      const statuses = KINDS[kind].statuses;
                      return (
                        <tr key={i.id}>
                          <td className={S_TD + " text-ink-3"}>{KINDS[kind].title}</td>
                          <td className={S_TD}>
                            <Link href={`${KINDS[kind].route}/${i.id}`} className="text-brand-ink font-semibold no-underline hover:underline">
                              {i.name}
                            </Link>
                          </td>
                          <td className={S_TD}>
                            {canEdit && statuses.length ? (
                              <select
                                aria-label={`Status of ${i.name}`}
                                value={i.status}
                                disabled={pending}
                                onChange={(e) => run(() => setSiteItemStatus(siteId, i.id, e.target.value))}
                                className={`${S_INPUT} h-8 w-[170px]!`}
                              >
                                {!statuses.includes(i.status) ? <option value={i.status}>{i.status || "—"}</option> : null}
                                {statuses.map((s) => (
                                  <option key={s}>{s}</option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-ink-3">{i.status || "—"}</span>
                            )}
                          </td>
                          {canEdit ? (
                            <td className={S_TD + " text-right whitespace-nowrap"}>
                              <Link href={`${KINDS[kind].route}/${i.id}`} className="text-brand-ink mr-3 text-[12.5px] font-semibold no-underline">
                                Edit details
                              </Link>
                              <button
                                type="button"
                                disabled={pending}
                                title="Take it off this site — it becomes shared by all sites"
                                onClick={() => run(() => setItemSite(siteId, i.id, false))}
                                className="text-bad border-0 bg-transparent text-[12.5px] font-semibold"
                              >
                                Remove from site
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      );
                    }),
                )}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {canEdit ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SectionCard title="Add from a list">
            <p className="text-muted m-0 mb-3 text-[12.5px]">An item shared by all sites, or at another site, moves to this one.</p>
            <div className="flex flex-wrap items-end gap-2">
              {kindSelect(pickKind, (k) => {
                setPickKind(k);
                setPickId("");
              }, "List to add from")}
              <label className="flex min-w-[200px] flex-1 flex-col gap-1">
                <span className={LABEL}>Item</span>
                <select aria-label="Item to add" value={pickId} onChange={(e) => setPickId(e.target.value)} className={`${S_INPUT} h-9`}>
                  <option value="">{elsewhere.length ? "Choose…" : "Nothing else in this list"}</option>
                  {elsewhere.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} — {i.siteId ? `at ${i.siteName}` : "shared"}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" disabled={!pickId || pending} onClick={() => run(() => setItemSite(siteId, pickId, true), () => setPickId(""))} className={S_BTN_PRIMARY}>
                Add to site
              </button>
            </div>
          </SectionCard>
          <SectionCard title="New item at this site">
            <p className="text-muted m-0 mb-3 text-[12.5px]">Made here and set to this site — then open it to fill in its details.</p>
            <div className="flex flex-wrap items-end gap-2">
              {kindSelect(newKind, setNewKind, "List of the new item")}
              <label className="flex min-w-[200px] flex-1 flex-col gap-1">
                <span className={LABEL}>{KINDS[newKind].nameLabel}</span>
                <input aria-label="New item name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={KINDS[newKind].newName} className={`${S_INPUT} h-9`} />
              </label>
              <button type="button" disabled={!newName.trim() || pending} onClick={() => run(() => addSiteItem(siteId, newKind, newName), () => setNewName(""))} className={S_BTN_PRIMARY}>
                Create
              </button>
            </div>
          </SectionCard>
        </div>
      ) : null}
      {result ? (
        <p role="status" className={"m-0 text-[13px] " + (result.ok ? "text-[#067647]" : "text-bad")}>
          {result.message}
          {result.ok && result.href ? (
            <>
              {" "}
              <Link href={result.href} className="text-brand-ink font-semibold underline">
                Open it
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
