import type { Metadata } from "next";
import Link from "next/link";

import { CompanyDetails } from "@/app/(app)/qaforms/company-details";
import { FormPreview } from "@/app/(app)/qaforms/form-preview";
import { QaList } from "@/app/(app)/qaforms/qa-list";
import { LayoutDesigner } from "@/app/(app)/qaforms/layout-designer";
import { VarsView, type LibraryRow } from "@/app/(app)/qaforms/vars-view";
import { canManageSpace, requireSpaceUser, userRoleNames } from "@/lib/auth/rbac";
import { getPart, getRequestSetup, partInspection } from "@/lib/parts/queries";
import { companyDetails, generalContext, partContext } from "@/lib/qa/context";
import { qaLibraries } from "@/lib/qa/libraries";
import { formTokens } from "@/lib/qa/layouts";
import { docLayoutFor, docLayouts, listTemplates, previewParts, qaSettings } from "@/lib/qa/queries";
import { SOURCE_LABELS, SOURCE_PAGES, SOURCES, templateStats, type Source } from "@/lib/qa/template";
import { catalogueForForms, tokensIn, withCaseForm } from "@/lib/qa/variables";
import { getCaseSetup } from "@/lib/cases/queries";
import { spaceTimeZone } from "@/lib/queries/cases";
import { spaceToday } from "@/lib/resources/queries";

export const metadata: Metadata = { title: "QA Form Setup" };

export default async function QaFormsPage({ searchParams }: PageProps<"/qaforms">) {
  const user = await requireSpaceUser();
  const query = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const view = one(query.view) === "vars" ? "vars" : one(query.view) === "layouts" ? "layouts" : "list";
  const templates = await listTemplates(user.space.id);

  const tabs = (
    <div className="bg-[#EEF0F3] flex gap-1 self-start rounded-[11px] p-1">
      {(
        [
          ["QA forms", "/qaforms", view === "list"],
          ["Header & footer", "/qaforms?view=layouts", view === "layouts"],
          ["Variable library", "/variables", view === "vars"],
        ] as const
      ).map(([label, href, on]) => (
        <Link
          key={label}
          href={href}
          className={
            "flex h-[34px] items-center rounded-lg px-3.5 text-[12.5px] font-semibold whitespace-nowrap no-underline " +
            (on ? "text-brand-ink bg-white shadow-[0_1px_2px_rgba(16,24,40,.1)]" : "text-ink-3")
          }
        >
          {label}
        </Link>
      ))}
    </div>
  );

  // --- Header & footer designs -------------------------------------------------------------------
  if (view === "layouts") {
    const [layouts, company] = await Promise.all([docLayouts(user.space.id), companyDetails(user.space.id)]);
    const usage: Record<string, number> = {};
    for (const { data } of templates) if (data.docLayout) usage[data.docStyle ?? "reference"] = (usage[data.docStyle ?? "reference"] ?? 0) + 1;
    // A form's own words to preview with: the first controlled form's, else an example.
    const example = templates.find(({ data }) => data.docLayout)?.data;
    const sample: Record<string, string> = {
      ...Object.fromEntries(Object.entries(company).map(([k, v]) => [`company.${k}`, v])),
      "space.name": user.space.name,
      ...formTokens({
        name: example?.name || "Custom made device post manufacturing checklist",
        code: example?.code || "850/Form/002",
        rev: example?.rev || "F",
        issue: example?.issue || "3",
        effective: example?.effective || "Aug. 23rd 2026",
        validity: example?.validity || "Aug. 23rd 2029",
        clause: example?.clause || "ISO 13485:2016 §7.5",
      }),
    };
    return (
      <div className="flex flex-col gap-4">
        {tabs}
        <LayoutDesigner initial={layouts} usage={usage} sample={sample} canEdit={canManageSpace(user)} />
      </div>
    );
  }

  if (view === "list") {
    const [settings, company] = await Promise.all([qaSettings(user.space.id), companyDetails(user.space.id)]);
    // A form opened for preview, filled from a part — the one chosen, or the latest (one with balloons first).
    const previewing = templates.find(({ row }) => row.id === one(query.preview));
    let preview: React.ReactNode = null;
    if (previewing) {
      const [parts, libraries, timeZone, today] = await Promise.all([
        previewParts(user.space.id),
        qaLibraries(user.space.id),
        spaceTimeZone(user.space.id),
        spaceToday(user.space.id),
      ]);
      const asked = one(query.part);
      const partId = asked && parts.some((p) => p.id === asked) ? asked : (parts[0]?.id ?? null);
      const part = partId ? await getPart(user.space.id, partId) : null;
      const who = { id: user.id, name: user.name, roles: userRoleNames(user) };
      preview = (
        <FormPreview
          id={previewing.row.id}
          form={previewing.data}
          layout={await docLayoutFor(user.space.id, previewing.data.docStyle)}
          context={part ? await partContext(part, user.space, who, today, timeZone) : await generalContext(user.space, who, today, timeZone)}
          libraries={libraries}
          inspection={part ? partInspection(part) : null}
          parts={parts.map(({ id, label }) => ({ id, label }))}
          partId={partId}
          canEdit={canManageSpace(user)}
        />
      );
    }
    return (
      <div className="flex flex-col gap-4">
        {tabs}
        <QaList
          rows={templates.map(({ row, data, parts }) => ({
            id: row.id,
            name: data.name,
            code: data.code,
            clause: data.clause,
            attach: data.attach,
            usedFor: data.usedFor ?? "generic",
            parts,
            ...templateStats(data.sections),
          }))}
          canEdit={canManageSpace(user)}
          separateApprover={settings.separateApprover}
        />
        <CompanyDetails initial={company} canEdit={canManageSpace(user)} />
        {preview}
      </div>
    );
  }

  // --- Variable library ------------------------------------------------------------------------
  const [setup, parts, libraries, timeZone, today] = await Promise.all([
    getRequestSetup(user.space),
    previewParts(user.space.id),
    qaLibraries(user.space.id),
    spaceTimeZone(user.space.id),
    spaceToday(user.space.id),
  ]);
  const partId = one(query.part) && parts.some((p) => p.id === one(query.part)) ? one(query.part)! : (parts[0]?.id ?? null);
  const part = partId ? await getPart(user.space.id, partId) : null;
  const who = { id: user.id, name: user.name, roles: userRoleNames(user) };
  const context = part ? await partContext(part, user.space, who, today, timeZone) : await generalContext(user.space, who, today, timeZone);

  const usage = new Map<string, Array<{ id: string; code: string }>>();
  for (const { row, data } of templates) {
    const tokens = new Set(
      data.sections.flatMap((s) => s.items.flatMap((i) => tokensIn(`${i.label} ${i.value} ${i.lsl} ${i.usl} ${i.formula ?? ""}`))),
    );
    for (const t of tokens) usage.set(t, [...(usage.get(t) ?? []), { id: row.id, code: data.code }]);
  }

  const libraryRows: LibraryRow[] = SOURCES.filter((s): s is Exclude<Source, "custom"> => s !== "custom").map((key) => {
    const options = libraries[key] ?? [];
    const usedIn = templates
      .filter(({ data }) => data.sections.some((s) => s.items.some((i) => i.type === "select" && i.src === key)))
      .map(({ data }) => data.code || data.name);
    return {
      key,
      name: SOURCE_LABELS[key],
      page: SOURCE_PAGES[key],
      count: options.length,
      first: options.slice(0, 3).map((o) => o.label),
      usedIn,
    };
  });

  return (
    <div className="flex flex-col gap-4">
      {tabs}
      <VarsView
        vars={withCaseForm(catalogueForForms(setup.forms), await getCaseSetup(user.space.id, user.space.name)).map((v) => ({
          ...v,
          example: (context as Record<string, string>)[v.token] ?? "",
          usedIn: usage.get(v.token) ?? [],
        }))}
        libraries={libraryRows}
        parts={parts.map(({ id, label }) => ({ id, label }))}
        partId={partId}
        backHref={one(query.from) ? `/qaforms/${one(query.from)}` : "/qaforms"}
        backLabel={one(query.from) ? "Back to the form" : "All QA forms"}
      />
    </div>
  );
}
