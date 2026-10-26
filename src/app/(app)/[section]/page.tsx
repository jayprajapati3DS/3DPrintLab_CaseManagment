import { notFound } from "next/navigation";

import { ResourceListPage } from "@/components/setup/resource-list-page";
import { pageForPath } from "@/components/shell/nav";
import { requireUser } from "@/lib/auth/rbac";
import { kindForRoute } from "@/lib/resources/config";

/**
 * Every sidebar page without a folder of its own.
 *
 * The manufacturing-setup pages — machines, materials, suppliers and the
 * equipment registries — are one screen driven by configuration, so they are
 * served from here. Anything else is a page that is planned but not built; a
 * page that exists takes precedence over this route, so each module replaces
 * its placeholder simply by being added.
 */
export default async function SectionPage({ params, searchParams }: PageProps<"/[section]">) {
  const user = await requireUser();
  const { section } = await params;

  // Only pages of the site being visited: a space has no admin pages.
  const page = pageForPath(user.role, `/${section}`);
  if (!page) notFound();

  const kind = user.space ? kindForRoute(`/${section}`) : null;
  if (kind) {
    return <ResourceListPage kind={kind} archived={(await searchParams).view === "archived"} />;
  }

  return (
    <div className="flex min-h-full items-center justify-center">
      <div className="border-field flex w-[440px] max-w-full flex-col items-center gap-2 rounded-[14px] border border-dashed bg-white p-9 text-center">
        <div className="text-brand-ink text-[11px] font-semibold tracking-[0.9px] uppercase">
          Planned · phase {page.phase}
        </div>
        <div className="text-xl font-bold tracking-[-0.3px]">{page.title}</div>
        <div className="text-muted text-[13px] leading-[1.5]">{page.subtitle}.</div>
      </div>
    </div>
  );
}
