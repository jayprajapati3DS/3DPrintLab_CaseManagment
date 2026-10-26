import type { Metadata } from "next";
import Link from "next/link";

import { requireUser } from "@/lib/auth/rbac";

export const metadata: Metadata = { title: "No access" };

export default async function NoAccessPage() {
  await requireUser();

  return (
    <div className="flex min-h-full items-center justify-center">
      <div className="border-line flex w-[440px] max-w-full flex-col items-center gap-2 rounded-[14px] border bg-white p-9 text-center">
        <div className="text-xl font-bold tracking-[-0.3px]">You don&rsquo;t have access to that page</div>
        <p className="text-muted m-0 text-[13px] leading-[1.5]">
          It is limited to administrators. If you need it, ask a space admin to change your role
          under Users &amp; Roles.
        </p>
        <Link href="/" className="text-brand-ink mt-2 text-[13px] font-semibold no-underline">
          Back to the dashboard
        </Link>
      </div>
    </div>
  );
}
