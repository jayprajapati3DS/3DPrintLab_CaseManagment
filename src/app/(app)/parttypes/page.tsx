import type { Metadata } from "next";

import { PartTypeRow } from "@/app/(app)/parttypes/part-type-row";
import { AddRow } from "@/app/(app)/tech/add-row";
import { IntroBanner, S_TH, SectionCard } from "@/components/setup/ui";
import { canManageSpace, requireSpaceUser } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { addPartTypeAction } from "@/lib/resources/actions";

export const metadata: Metadata = { title: "Part Types" };

export default async function PartTypesPage() {
  const user = await requireSpaceUser();
  const canEdit = canManageSpace(user);
  const partTypes = await db.partType.findMany({
    where: { spaceId: user.space.id },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="flex max-w-[980px] flex-col gap-5">
      <IntroBanner
        icon="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"
        before="Part types offered by "
        space={user.space.name}
        after=" — shown in the part request form."
      />

      <SectionCard title="Part types" hint="Categories of deliverable, chosen when a part is requested.">
        <div className="border-line overflow-hidden rounded-[10px] border">
          <table className="w-full border-collapse">
            <thead className="bg-subtle">
              <tr>
                {["Part type", "Code", ""].map((h, i) => (
                  <th key={i} className={S_TH}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {partTypes.length === 0 ? (
                <tr>
                  <td colSpan={3} className="text-muted px-3 py-8 text-center text-[13px]">
                    No part types yet. Add the kinds of part you make — implant, surgical guide,
                    anatomical model…
                  </td>
                </tr>
              ) : null}
              {partTypes.map((pt) => (
                <PartTypeRow key={`${pt.id}:${pt.name}:${pt.code}`} id={pt.id} name={pt.name} code={pt.code} canEdit={canEdit} />
              ))}
            </tbody>
          </table>
        </div>

        {canEdit ? <AddRow action={addPartTypeAction} placeholder="e.g. Cutting guide" label="Add part type" /> : null}
        <p className="text-muted m-0 text-xs">
          The code is used in part IDs: up to six letters or digits, stored in capitals.
        </p>
      </SectionCard>
    </div>
  );
}
