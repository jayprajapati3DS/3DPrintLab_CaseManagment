import type { Metadata } from "next";

import { LotList } from "@/app/(app)/grnlots/lot-list";
import { IntroBanner } from "@/components/setup/ui";
import { requireSpaceUser } from "@/lib/auth/rbac";
import { lotRegister } from "@/lib/grn/queries";
import { spaceToday } from "@/lib/resources/queries";

export const metadata: Metadata = { title: "Lot List" };

export default async function LotsPage() {
  const user = await requireSpaceUser();
  const rows = await lotRegister(user.space.id, await spaceToday(user.space.id));
  return (
    <div className="flex flex-col gap-4">
      <IntroBanner
        icon="M4 6h16M4 12h16M4 18h10M18 16l2 2 3-3"
        before="Lot register for "
        space={user.space.name}
        after=" — every lot received, its stock, full log and the parts made from it (ISO 13485 §7.5.9 traceability)."
      />
      <LotList rows={rows} />
    </div>
  );
}
