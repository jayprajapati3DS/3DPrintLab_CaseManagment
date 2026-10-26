import type { Metadata } from "next";

import { setSpaceActiveAction } from "@/app/(app)/spaces/actions";
import {
  CreateSpace,
  ResetAdminPassword,
  SignInLinkActions,
} from "@/app/(app)/spaces/create-space";
import { CARD, CARD_HEADER, TABLE_HEAD, TABLE_ROW } from "@/components/ui/styles";
import { requireSuperAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { fmtDate, plural } from "@/lib/format";
import { siteHostname, siteOrigin } from "@/lib/realm";

export const metadata: Metadata = { title: "Company Spaces" };

const COLUMNS =
  "grid min-w-[980px] grid-cols-[minmax(0,1.2fr)_minmax(0,1.9fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.8fr)_120px] items-center gap-3";

export default async function SpacesPage() {
  await requireSuperAdmin();

  const spaces = await db.space.findMany({
    orderBy: { createdAt: "asc" },
    include: { connection: { select: { verifiedAt: true } } },
  });

  const origins = await Promise.all(spaces.map((s) => siteOrigin(s.slug)));

  return (
    <section className={`${CARD} flex flex-col overflow-x-auto`}>
      <div className={CARD_HEADER}>
        <h2 className="m-0 text-[15px] font-semibold">All company spaces</h2>
        <div className="flex items-center gap-3">
          <div className="text-muted font-mono text-xs whitespace-nowrap">{plural(spaces.length, "space")}</div>
          <CreateSpace variant="primary" baseDomain={env.BASE_DOMAIN} />
        </div>
      </div>

      <div className={`${TABLE_HEAD} ${COLUMNS}`}>
        <div>Space</div>
        <div>Sign-in URL</div>
        <div>Space admin</div>
        <div>Platform API</div>
        <div>Created</div>
        <div className="text-right">Status</div>
      </div>

      {spaces.length === 0 ? (
        <div className="flex flex-col items-center gap-2.5 px-5 py-12 text-center">
          <div className="text-[15px] font-semibold">No company spaces yet</div>
          <div className="text-muted max-w-[380px] text-[13px] leading-[1.5]">
            Create a space for each company. Its data stays isolated, and its admin connects it to
            the 3D Surgical Platform.
          </div>
          <CreateSpace variant="empty" baseDomain={env.BASE_DOMAIN} />
        </div>
      ) : (
        spaces.map((space, i) => (
          <div key={space.id} className={`${TABLE_ROW} ${COLUMNS}`}>
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="font-semibold">{space.name}</div>
              <div className="text-muted font-mono text-xs">{space.slug}</div>
            </div>

            <div className="flex min-w-0 flex-col gap-[5px]">
              <span className="text-brand-ink truncate font-mono text-[12.5px]">
                {siteHostname(space.slug)}
              </span>
              {space.customDomain ? (
                <span className="text-muted truncate font-mono text-[11.5px]">
                  also {space.customDomain}
                </span>
              ) : null}
              <SignInLinkActions url={origins[i]} />
            </div>

            <div className="flex min-w-0 flex-col items-start gap-[5px]">
              <span className="text-ink-2 max-w-full truncate">{space.adminEmail}</span>
              <ResetAdminPassword spaceId={space.id} spaceName={space.name} />
            </div>

            {space.connection?.verifiedAt ? (
              <div className="text-ok flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#12B76A]" />
                Connected
              </div>
            ) : (
              <div className="text-warn flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#F79009]" />
                {space.connection ? "Not verified" : "Not connected"}
              </div>
            )}

            <div className="text-muted">{fmtDate(space.createdAt)}</div>

            <div className="flex flex-col items-end gap-1.5">
              <span
                className={
                  "rounded-full px-2.5 py-1 text-xs font-semibold " +
                  (space.isActive ? "bg-ok-tint text-ok" : "bg-bad-tint text-bad")
                }
              >
                {space.isActive ? "Active" : "Suspended"}
              </span>
              <form action={setSpaceActiveAction}>
                <input type="hidden" name="id" value={space.id} />
                <input type="hidden" name="isActive" value={String(!space.isActive)} />
                <button
                  type="submit"
                  className={
                    "border-field h-7 rounded-[7px] border bg-white px-2.5 text-xs font-semibold " +
                    (space.isActive ? "text-bad" : "text-ok")
                  }
                >
                  {space.isActive ? "Suspend" : "Reactivate"}
                </button>
              </form>
            </div>
          </div>
        ))
      )}
    </section>
  );
}
