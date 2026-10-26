"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { S_BTN_PRIMARY, S_INPUT, S_TD, S_TH, SectionCard } from "@/components/setup/ui";
import { createSiteAccount, setSiteMember, setSiteOnly, type SiteResult } from "@/lib/sites/actions";

export interface SitePerson {
  id: string;
  name: string;
  email: string;
  role: string;
  isAdmin: boolean;
  siteOnly: boolean;
  /** Signs in with a password kept here (a site account), not the platform. */
  local: boolean;
  member: boolean;
}

/**
 * A site's people: who works there, whether each sees only the site's parts,
 * and — for the space admin — adding someone of the space, taking them off, or
 * giving a vendor's operator an account of their own.
 */
export function SiteMembers({ siteId, siteName, people, canEdit }: { siteId: string; siteName: string; people: SitePerson[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<SiteResult | null>(null);
  const [adding, setAdding] = useState("");
  const [account, setAccount] = useState({ name: "", email: "", password: "", roleName: "Site operator", siteOnly: true });
  const members = people.filter((p) => p.member);
  const others = people.filter((p) => !p.member);

  const run = (fn: () => Promise<SiteResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setResult(r);
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title={`People at ${siteName}`}>
        {members.length === 0 ? (
          <p className="text-muted m-0 text-[13px]">No one yet — add people of the space below, or give a vendor&apos;s operator an account.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[13px]" aria-label="Site members">
              <thead>
                <tr>
                  <th className={S_TH}>Name</th>
                  <th className={S_TH}>Role</th>
                  <th className={S_TH}>Access</th>
                  {canEdit ? <th className={S_TH} /> : null}
                </tr>
              </thead>
              <tbody>
                {members.map((p) => (
                  <tr key={p.id}>
                    <td className={S_TD}>
                      <span className="text-ink font-semibold">{p.name}</span>
                      <span className="text-muted block text-[12px]">
                        {p.email}
                        {p.local ? " · site account" : ""}
                      </span>
                    </td>
                    <td className={S_TD}>{p.role}</td>
                    <td className={S_TD}>
                      {p.isAdmin ? (
                        <span className="text-muted text-[12.5px]">Full — space admin</span>
                      ) : (
                        <label className="flex items-center gap-2 text-[12.5px]">
                          <input
                            type="checkbox"
                            checked={p.siteOnly}
                            disabled={!canEdit || pending}
                            aria-label={`Site-only access for ${p.name}`}
                            onChange={(e) => run(() => setSiteOnly(siteId, p.id, e.target.checked))}
                            className="h-4 w-4"
                          />
                          {p.siteOnly ? "Site-only — this site's parts" : "Full access"}
                        </label>
                      )}
                    </td>
                    {canEdit ? (
                      <td className={S_TD + " text-right"}>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => run(() => setSiteMember(siteId, p.id, false))}
                          className="text-bad border-0 bg-transparent text-[12.5px] font-semibold"
                        >
                          Remove
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canEdit ? (
          <div className="border-line-3 mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
            <label className="flex min-w-[240px] flex-1 flex-col gap-1">
              <span className="text-muted text-[11px] font-semibold tracking-[0.5px] uppercase">Add someone of the space</span>
              <select aria-label="Add a person to the site" value={adding} onChange={(e) => setAdding(e.target.value)} className={`${S_INPUT} h-9`}>
                <option value="">Choose a person…</option>
                {others.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.role}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" disabled={!adding || pending} onClick={() => run(() => setSiteMember(siteId, adding, true), () => setAdding(""))} className={S_BTN_PRIMARY}>
              Add to site
            </button>
          </div>
        ) : null}
      </SectionCard>

      {canEdit ? (
        <SectionCard title="New site account">
          <p className="text-muted m-0 mb-3 text-[12.5px]">
            For a vendor&apos;s or partner&apos;s staff with no 3D Surgical Platform account: they sign in at this site&apos;s address with the email and password set here. With site-only
            access they see only the parts made at their sites — no cases, no patient details, no setup.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ["name", "Name", "text"],
                ["email", "Email", "email"],
                ["password", "Password (10+ characters)", "password"],
                ["roleName", "Role", "text"],
              ] as const
            ).map(([key, label, type]) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-muted text-[11px] font-semibold tracking-[0.5px] uppercase">{label}</span>
                <input
                  type={type}
                  aria-label={label}
                  autoComplete={type === "password" ? "new-password" : "off"}
                  value={account[key]}
                  onChange={(e) => setAccount((a) => ({ ...a, [key]: e.target.value }))}
                  className={`${S_INPUT} h-9`}
                />
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={account.siteOnly} onChange={(e) => setAccount((a) => ({ ...a, siteOnly: e.target.checked }))} className="h-4 w-4" />
              Site-only access
            </label>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => createSiteAccount(siteId, account), () => setAccount({ name: "", email: "", password: "", roleName: "Site operator", siteOnly: true }))}
              className={S_BTN_PRIMARY}
            >
              Create account
            </button>
          </div>
        </SectionCard>
      ) : null}
      {result ? (
        <p role="status" className={"m-0 text-[13px] " + (result.ok ? "text-[#067647]" : "text-bad")}>
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
