import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CaseFormsList } from "@/app/(app)/casesetup/case-forms-list";
import { CaseFormBuilder } from "@/app/(app)/casesetup/case-form-builder";
import { CaseRuleCard } from "@/app/(app)/casesetup/case-setup-editor";
import { canManageSpace, requireSpaceUser } from "@/lib/auth/rbac";
import { spaceRoles } from "@/lib/auth/roles";
import { defaultCaseForm, formsInOrder, NEW_CASE_FORM } from "@/lib/cases/case-form";
import { caseCatalog, caseFormUsage, caseNumbersInUse, getCaseSetup } from "@/lib/cases/queries";

export const metadata: Metadata = { title: "Case Form Setup" };

/**
 * Case Form Setup: where this space's cases come from, how a case created here
 * is numbered, and the case forms it is opened with — whose answers become
 * {case.*} variables for QA forms. With ?form=<id>, one form open for editing;
 * ?form=new (&from=<id> to copy one) adds a form, created when it is saved.
 */
export default async function CaseSetupPage({ searchParams }: PageProps<"/casesetup">) {
  const user = await requireSpaceUser();
  const { form: formParam, from } = await searchParams;
  const [setup, catalog] = await Promise.all([getCaseSetup(user.space.id, user.space.name), caseCatalog(user.space.id)]);
  const canEdit = canManageSpace(user);
  const products = catalog.products.map((p) => ({ id: p.id, name: p.name, code: p.code }));

  if (typeof formParam === "string") {
    let form = setup.forms.find((f) => f.id === formParam);
    if (formParam === NEW_CASE_FORM && canEdit) {
      const source = typeof from === "string" ? setup.forms.find((f) => f.id === from) : undefined;
      form = source
        ? { ...structuredClone(source), id: NEW_CASE_FORM, name: `${source.name} (copy)`, isDefault: false }
        : defaultCaseForm(NEW_CASE_FORM, "", false);
    }
    if (!form) notFound();
    const [used, usage, roles] = await Promise.all([caseNumbersInUse(user.space.id), caseFormUsage(user.space.id, setup), spaceRoles(user.space.id)]);
    const opened = usage.get(form.id) ?? 0;
    return (
      <CaseFormBuilder
        key={form.id}
        initial={form}
        others={setup.forms.filter((f) => f.id !== form.id)}
        idPattern={setup.idPattern}
        idStart={setup.idStart}
        products={products}
        used={used}
        canEdit={canEdit}
        roles={roles}
        savedNote={formParam === NEW_CASE_FORM ? "Not saved yet — nothing is added until you save." : `Saved. ${opened} case${opened === 1 ? "" : "s"} opened with it.`}
      />
    );
  }

  const [used, usage] = await Promise.all([caseNumbersInUse(user.space.id), caseFormUsage(user.space.id, setup)]);
  const productName = new Map(catalog.products.map((p) => [p.id, p.name]));
  return (
    <div className="flex max-w-[1100px] flex-col gap-4">
      <CaseRuleCard
        initial={{ source: setup.source, idPattern: setup.idPattern, idStart: setup.idStart }}
        saved={setup.saved}
        canEdit={canEdit}
        productCodes={catalog.products.map((p) => p.code || p.name)}
        used={used}
      />
      <CaseFormsList
        canEdit={canEdit}
        managed={setup.source === "local"}
        rows={formsInOrder(setup).map((f) => ({
          id: f.id,
          name: f.name,
          description: f.description,
          isDefault: f.isDefault,
          products: f.productIds.map((id) => productName.get(id) ?? "a removed product"),
          sections: f.sections.length,
          fields: f.sections.flatMap((s) => s.fields).filter((x) => x.show).length,
          cases: usage.get(f.id) ?? 0,
        }))}
      />
    </div>
  );
}
