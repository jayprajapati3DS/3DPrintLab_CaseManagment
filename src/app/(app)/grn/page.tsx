import type { Metadata } from "next";

import { GrnList } from "@/app/(app)/grn/grn-list";
import { IntroBanner } from "@/components/setup/ui";
import { requireSpaceUser } from "@/lib/auth/rbac";
import { getGrnConfig, lineOptions, listGrns } from "@/lib/grn/queries";
import { grnStatus, type LineType } from "@/lib/grn/config";
import { spaceToday } from "@/lib/resources/queries";

export const metadata: Metadata = { title: "GRN List" };

export default async function GrnPage() {
  const user = await requireSpaceUser();
  const today = await spaceToday(user.space.id);
  const [grns, { config }, options] = await Promise.all([listGrns(user.space.id), getGrnConfig(user.space.id), lineOptions(user.space.id, today)]);
  const approved = new Map(options.suppliers.map((s) => [s.id, s.approved]));

  return (
    <div className="flex flex-col gap-4">
      <IntroBanner
        icon="M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"
        before="Goods receipt for "
        space={user.space.name}
        after=" — every delivery is received here, inspected, then accepted into stock (ISO 13485 §7.4.3)."
      />
      <GrnList
        rows={grns.map((g) => {
          const header = (g.header ?? {}) as Record<string, string>;
          const accepted = g.lines.filter((l) => l.decision === "Accepted").length;
          const pending = g.lines.filter((l) => !l.decision || l.decision === "Quarantine").length;
          const types = [...new Set(g.lines.map((l) => config.types[l.type as LineType]?.label ?? l.type))];
          return {
            id: g.id,
            number: g.number,
            po: header.po ?? "",
            invoice: header.invoice ?? "",
            date: g.receivedOn.toISOString().slice(0, 10),
            supplier: g.supplierName ?? "",
            supplierApproved: g.supplierId ? (approved.get(g.supplierId) ?? false) : true,
            lines: `${g.lines.length} line${g.lines.length === 1 ? "" : "s"}${accepted ? ` · ${accepted} accepted` : ""}${pending && g.received ? ` · ${pending} pending` : ""}`,
            types: types.join(", "),
            status: grnStatus(g),
            toInspect: g.received ? pending : 0,
            rejectedLines: g.lines.filter((l) => l.decision === "Rejected").length,
          };
        })}
      />
    </div>
  );
}
