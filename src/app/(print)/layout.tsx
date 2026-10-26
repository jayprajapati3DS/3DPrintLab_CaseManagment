import { requireSpaceUser } from "@/lib/auth/rbac";

/**
 * Printable records: the page alone, without the navigation — what goes to
 * paper or to "Save as PDF". Behind the same sign-in as the application.
 */
export default async function PrintLayout({ children }: LayoutProps<"/">) {
  await requireSpaceUser();
  return <div className="min-h-dvh bg-white print:bg-white">{children}</div>;
}
