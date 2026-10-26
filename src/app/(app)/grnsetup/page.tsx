import type { Metadata } from "next";

import { GrnSetup } from "@/app/(app)/grnsetup/grn-setup";
import { IntroBanner } from "@/components/setup/ui";
import { canManageSpace, requireSpaceUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { getGrnConfig, knownLotIds } from "@/lib/grn/queries";
import { spaceTimeZone } from "@/lib/queries/cases";
import { spaceToday } from "@/lib/resources/queries";

export const metadata: Metadata = { title: "GRN Setup" };

export default async function GrnSetupPage() {
  const user = await requireSpaceUser();
  const [setup, numbers, lotIds, today, timeZone] = await Promise.all([
    getGrnConfig(user.space.id),
    db.grn.findMany({ where: { spaceId: user.space.id }, select: { number: true } }),
    knownLotIds(user.space.id),
    spaceToday(user.space.id),
    spaceTimeZone(user.space.id),
  ]);
  return (
    <div className="flex flex-col gap-4">
      <IntroBanner
        icon="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"
        before="Goods receipt setup for "
        space={user.space.name}
        after=" — numbering, receipt fields, lot IDs, acceptance tests and rules. Changes apply to new and open GRNs."
      />
      <GrnSetup
        initial={setup.config}
        canEdit={canManageSpace(user)}
        existingNumbers={numbers.map((n) => n.number)}
        lotIds={lotIds}
        today={today}
        savedNote={setup.updatedAt ? `Last saved ${fmtDateTime(setup.updatedAt, timeZone)}${setup.updatedByName ? ` by ${setup.updatedByName}` : ""}.` : null}
      />
    </div>
  );
}
