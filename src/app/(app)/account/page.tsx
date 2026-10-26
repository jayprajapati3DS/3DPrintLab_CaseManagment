import type { Metadata } from "next";

import { ChangePassword } from "@/app/(app)/account/change-password";
import { MySignature } from "@/app/(app)/account/my-signature";
import { signOutAction } from "@/app/(app)/actions";
import { BTN_SECONDARY, CARD } from "@/components/ui/styles";
import { requireUser, ROLE_LABELS } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { initials } from "@/lib/format";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const user = await requireUser();
  const isSuperAdmin = user.role === "SUPER_ADMIN";
  const signature = await db.user.findUnique({ where: { id: user.id }, select: { signatureKey: true, signatureUpdatedAt: true } });

  const details: Array<[string, string]> = [
    ["Name", user.name],
    ["Email", user.email],
    ["Role", ROLE_LABELS[user.role]],
    ...(user.platformRoleName ? ([["Platform role", user.platformRoleName]] as Array<[string, string]>) : []),
    ["Access", isSuperAdmin ? "Admin console — all company spaces" : `${user.space?.name} only`],
    [
      "Password",
      user.hasLocalPassword ? "Held here" : "Managed on the 3D Surgical Platform",
    ],
  ];

  return (
    <div className="flex max-w-[720px] flex-col gap-5">
      <section className={`${CARD} flex items-center gap-[18px] p-6`}>
        <div
          className={
            "flex h-16 w-16 flex-none items-center justify-center rounded-full text-[22px] font-semibold text-white " +
            (isSuperAdmin ? "bg-brand" : "bg-[#1570EF]")
          }
        >
          {initials(user.name)}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="m-0 text-lg font-bold tracking-[-0.3px]">{user.name}</h2>
          <div className="text-muted text-[13.5px]">{user.email}</div>
        </div>
        <div className="bg-brand-tint text-brand-ink rounded-full px-2.5 py-[5px] text-xs font-semibold">
          {ROLE_LABELS[user.role]}
        </div>
      </section>

      <section className={`${CARD} flex flex-col`}>
        <div className="border-line-3 border-b px-5 py-4 text-[15px] font-semibold">
          Account details
        </div>
        <dl className="m-0 grid grid-cols-[110px_minmax(0,1fr)] text-[13.5px] sm:grid-cols-[200px_minmax(0,1fr)]">
          {details.map(([label, value], i) => {
            const border = i < details.length - 1 ? "border-line-3 border-b" : "";
            return (
              <div key={label} className="contents">
                <dt className={`text-muted px-5 py-3.5 ${border}`}>{label}</dt>
                <dd className={`m-0 px-5 py-3.5 ${border}`}>{value}</dd>
              </div>
            );
          })}
        </dl>
      </section>

      {/* Only people in a company space sign quality forms. */}
      {user.space ? <MySignature version={signature?.signatureKey ? (signature.signatureUpdatedAt?.toISOString() ?? "1") : null} /> : null}

      {user.hasLocalPassword ? <ChangePassword /> : null}

      <form action={signOutAction} className="flex gap-2.5">
        <button type="submit" className={BTN_SECONDARY}>
          Sign out
        </button>
      </form>
    </div>
  );
}
