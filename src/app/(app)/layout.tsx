import { Shell } from "@/components/shell/shell";
import { ImageZoom } from "@/components/ui/image-zoom";
import { requireUser, ROLE_LABELS } from "@/lib/auth/rbac";
import { waitingForMe } from "@/lib/qa/approvals";
import { getRealm } from "@/lib/realm";

/**
 * Everything behind the session gate — on either site. The proxy only checks
 * that a cookie is present; this is where the session behind it is actually
 * validated, including that it belongs to the address being visited.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const realm = await getRealm();

  // Forms waiting for this person, shown beside My Approvals.
  const approvals = user.space ? await waitingForMe(user.space.id, user.id) : 0;

  const roleLabel = user.space
    ? `${ROLE_LABELS[user.role]} · ${user.space.name}`
    : ROLE_LABELS[user.role];

  return (
    <Shell
      role={user.role}
      roleLabel={roleLabel}
      userName={user.name}
      spaceName={user.space?.name ?? null}
      hostname={realm.host.replace(/:\d+$/, "")}
      counts={{ approvals }}
      siteOnly={user.siteOnly}
      surgeonOnly={user.surgeonOnly}
    >
      {children}
      {/* Hover any stored picture to see it larger. */}
      <ImageZoom />
    </Shell>
  );
}
