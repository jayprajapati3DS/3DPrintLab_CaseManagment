import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/app/(auth)/login/login-form";
import { getSession } from "@/lib/auth/session";
import { initials } from "@/lib/format";
import { getRealm } from "@/lib/realm";

export const metadata: Metadata = {
  title: { absolute: "Sign in · 3D Surgical" },
  description: "Sign in to continue.",
};

export const dynamic = "force-dynamic";

/**
 * Sign-in. There is one page, and it is a different page at every address: the
 * admin console's, one company space's, or — at an address that is nobody's —
 * a note saying so.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Somebody who is genuinely signed in has no business on the sign-in page.
  // Decided here rather than in the proxy because only this layer can ask the
  // database whether the session behind the cookie is actually alive.
  const session = await getSession();
  if (session) redirect("/");

  const realm = await getRealm();
  const hostname = realm.host.replace(/:\d+$/, "");

  const params = await searchParams;
  const rawNext = params?.next;
  const next =
    typeof rawNext === "string" && rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : "/";

  return (
    <div className="flex min-h-dvh w-full flex-col items-center justify-center gap-7 bg-[#F6F4EF] px-4 py-8 text-[#16191F]">
      <div className="flex items-center gap-3">
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
          <path d="M18 3L31 10.5V25.5L18 33L5 25.5V10.5L18 3Z" stroke="#C4501C" strokeWidth="2" />
          <path d="M18 3V18M18 18L31 25.5M18 18L5 25.5" stroke="#16191F" strokeWidth="1.5" />
        </svg>
        <div className="flex flex-col gap-0.5">
          <div className="font-display text-xl font-semibold tracking-[-0.01em]">3D Surgical</div>
          <div className="font-mono text-[11px] tracking-[0.14em] text-[#5B606A]">
            {realm.kind === "admin" ? "ADMIN CONSOLE" : "MANUFACTURING MANAGEMENT"}
          </div>
        </div>
      </div>

      {realm.kind === "unknown" ? (
        <div className="flex w-full max-w-[440px] flex-col gap-3 rounded-[14px] border border-[#E2DDD3] bg-white p-8 text-center">
          <h1 className="font-display m-0 text-2xl font-medium">No space at this address</h1>
          <p className="m-0 text-sm leading-[1.55] text-[#5B606A]">
            There is no company space at{" "}
            <b className="font-mono text-[#16191F]">{hostname}</b>. Check the link your space admin
            shared with you.
          </p>
        </div>
      ) : (
        <div className="flex w-full max-w-[440px] flex-col gap-[22px] rounded-[14px] border border-[#E2DDD3] bg-white p-8">
          {realm.kind === "admin" ? (
            <LoginForm
              next={next}
              submitLabel="Sign in to admin console"
              footNote="Only platform administrators can sign in here."
              header={
                <div className="flex flex-col gap-2">
                  <span className="self-start rounded-full bg-[#16191F] px-2.5 py-1 font-mono text-[11px] tracking-[0.1em] text-white">
                    PLATFORM ADMIN
                  </span>
                  <h1 className="font-display m-0 text-[28px] font-medium tracking-[-0.02em]">
                    Admin console sign in
                  </h1>
                  <span className="text-[13.5px] leading-[1.5] text-[#5B606A]">
                    Create and manage all company spaces. Company users sign in at their own space
                    URL.
                  </span>
                </div>
              }
            />
          ) : (
            <LoginForm
              next={next}
              submitLabel={`Sign in to ${realm.space.name}`}
              footNote={`Only ${realm.space.name} users can sign in at this address.`}
              header={
                <div className="flex flex-col gap-3.5">
                  <div className="flex items-center gap-3 rounded-[10px] border border-[#E9E3D8] bg-[#F6F4EF] px-3.5 py-3">
                    <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[9px] bg-[#C4501C] text-[15px] font-semibold text-white">
                      {initials(realm.space.name)}
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-[15px] font-semibold">{realm.space.name}</span>
                      <span className="truncate font-mono text-xs text-[#5B606A]">{hostname}</span>
                    </span>
                  </div>
                  <h1 className="font-display m-0 text-[28px] font-medium tracking-[-0.02em]">
                    Sign in
                  </h1>
                </div>
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
