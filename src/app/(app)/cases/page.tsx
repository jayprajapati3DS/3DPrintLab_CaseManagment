import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CasesBrowser } from "@/app/(app)/cases/cases-browser";
import { NewCaseDialog } from "@/components/cases/new-case-dialog";
import { requireSpaceUser } from "@/lib/auth/rbac";
import { caseCatalog, caseHospitals, caseNumbersInUse, casePeople, getCaseSetup } from "@/lib/cases/queries";
import { listCases, parseCaseListParams, spaceTimeZone } from "@/lib/queries/cases";

export const metadata: Metadata = { title: "Cases" };

export default async function CasesPage({ searchParams }: PageProps<"/cases">) {
  const user = await requireSpaceUser();
  // A surgeon sees their cases on My Orders.
  if (user.surgeonOnly) redirect("/orders");
  const raw = await searchParams;
  const params = parseCaseListParams(raw);
  const [result, setup] = await Promise.all([
    listCases(user.space.id, params, await spaceTimeZone(user.space.id)),
    getCaseSetup(user.space.id, user.space.name),
  ]);
  // Cases opened here — not synced from the platform — come from the case form.
  const local = setup.source === "local";
  const opening = local && raw.new === "1";
  const [catalog, used, people, hospitals] = opening
    ? await Promise.all([caseCatalog(user.space.id), caseNumbersInUse(user.space.id), casePeople(user.space.id), caseHospitals(user.space.id)])
    : [null, [], [], []];

  return (
    <>
      {local ? (
        <div className="mb-3 flex justify-end">
          <Link href="/cases?new=1" scroll={false} className="bg-brand flex h-9 items-center rounded-[9px] px-3.5 text-[13px] font-bold text-white no-underline">
            + New case
          </Link>
        </div>
      ) : null}
      <CasesBrowser params={params} result={result} />
      {opening && catalog ? (
        <NewCaseDialog setup={setup} products={catalog.products} subscopes={catalog.subscopes} people={people} hospitals={hospitals} used={used} closeHref="/cases" />
      ) : null}
    </>
  );
}
