import type { Metadata } from "next";

import { AddRow } from "@/app/(app)/tech/add-row";
import { IntroBanner, S_TD, S_TH, SectionCard } from "@/components/setup/ui";
import { canManageSpace, requireSpaceUser } from "@/lib/auth/rbac";
import { addTechnologyAction, removeTechnologyAction } from "@/lib/resources/actions";
import { listTechnologies, technologyUse } from "@/lib/resources/queries";

export const metadata: Metadata = { title: "Manufacturing Tech" };

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default async function TechnologyPage() {
  const user = await requireSpaceUser();
  const canEdit = canManageSpace(user);
  const technologies = await listTechnologies(user.space.id);
  const uses = await Promise.all(technologies.map((t) => technologyUse(user.space.id, t.name)));

  return (
    <div className="flex max-w-[980px] flex-col gap-5">
      <IntroBanner
        icon="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"
        before="Manufacturing technologies used by "
        space={user.space.name}
        after=" — used to group printers and materials."
      />

      <SectionCard
        title="Manufacturing technology"
        hint="Fabrication processes used by workflows, printers and materials. Counts update as you link them."
      >
        <div className="border-line overflow-hidden rounded-[10px] border">
          <table className="w-full border-collapse">
            <thead className="bg-subtle">
              <tr>
                {["Type", "Materials", "Printers", "Workflows", ""].map((h, i) => (
                  <th key={i} className={S_TH}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {technologies.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-muted px-3 py-8 text-center text-[13px]">
                    No technologies yet. Add the processes you use — they are chosen on workflows,
                    machines and materials.
                  </td>
                </tr>
              ) : null}
              {technologies.map((tech, i) => {
                const use = uses[i];
                const inUse = use.materials + use.printers + use.workflows > 0;
                return (
                  <tr key={tech.id}>
                    <td className={`${S_TD} font-semibold`}>{tech.name}</td>
                    <td className={S_TD}>{count(use.materials, "material")}</td>
                    <td className={S_TD}>{count(use.printers, "printer")}</td>
                    <td className={S_TD}>{count(use.workflows, "workflow")}</td>
                    <td className={S_TD}>
                      {canEdit ? (
                        <form action={removeTechnologyAction} className="flex justify-end">
                          <input type="hidden" name="id" value={tech.id} />
                          <button
                            type="submit"
                            disabled={inUse}
                            aria-label={`Remove ${tech.name}`}
                            title={inUse ? "In use — unlink first" : "Remove"}
                            className="text-muted hover:text-bad h-7 w-7 rounded-md border-0 bg-transparent text-base disabled:opacity-30"
                          >
                            ×
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {canEdit ? <AddRow action={addTechnologyAction} placeholder="e.g. Laser Cutting" label="Add technology" /> : null}
      </SectionCard>
    </div>
  );
}
