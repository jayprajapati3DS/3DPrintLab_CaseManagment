"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { myApprovalCount, signOutAction } from "@/app/(app)/actions";
import { CURRENT_PHASE, navSections, pageForPath } from "@/components/shell/nav";
import type { AppRole } from "@/lib/auth/session";
import { initials } from "@/lib/format";

export interface SidebarProps {
  role: AppRole;
  roleLabel: string;
  userName: string;
  /** The company space's name; null in the admin console. */
  spaceName: string | null;
  /** Numbers shown beside pages, by page id — forms waiting for approval. */
  counts?: Record<string, number>;
  /** Site-only access: a short menu of their sites' parts. */
  siteOnly?: boolean;
  /** Surgeon access: their orders. */
  surgeonOnly?: boolean;
}

export function Sidebar({
  role,
  roleLabel,
  siteOnly = false,
  surgeonOnly = false,
  userName,
  spaceName,
  counts,
  open,
  onNavigate,
}: SidebarProps & {
  /** Below desktop width the sidebar is a drawer; this is whether it is out. */
  open: boolean;
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  const current = pageForPath(role, pathname)?.id;
  const isAdmin = role === "SUPER_ADMIN";

  // Forms sent to this person arrive from others: the number is checked again
  // on every page change, when the window comes back into focus, and each minute.
  const [approvals, setApprovals] = useState(counts?.approvals ?? 0);
  const [given, setGiven] = useState(counts?.approvals);
  if (counts?.approvals !== given) {
    setGiven(counts?.approvals);
    setApprovals(counts?.approvals ?? 0);
  }
  useEffect(() => {
    if (isAdmin) return;
    let live = true;
    const check = () =>
      myApprovalCount()
        .then((n) => live && setApprovals(n))
        .catch(() => undefined);
    check();
    const timer = setInterval(check, 60_000);
    window.addEventListener("focus", check);
    // A form approved, sent, rejected or passed on here.
    window.addEventListener("approvals-changed", check);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", check);
      window.removeEventListener("approvals-changed", check);
    };
  }, [isAdmin, pathname]);
  const countFor = (id: string) => (id === "approvals" ? approvals : (counts?.[id] ?? 0));

  return (
    <aside
      id="main-menu"
      className={
        "bg-navy fixed inset-y-0 left-0 z-40 flex h-dvh w-64 max-w-[85vw] flex-none flex-col text-[#C6CEDA] transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0 " +
        (open ? "translate-x-0" : "invisible -translate-x-full lg:visible")
      }
    >
      <div className="flex items-center gap-[11px] px-5 pt-5 pb-[18px]">
        <svg width="34" height="34" viewBox="0 0 36 36" fill="none" aria-hidden="true">
          <path d="M18 3L31 10.5V25.5L18 33L5 25.5V10.5L18 3Z" stroke="#FF6633" strokeWidth="2.2" />
          <path d="M18 3V18M18 18L31 25.5M18 18L5 25.5" stroke="#FF8A5C" strokeWidth="1.6" />
        </svg>
        <div className="flex flex-col gap-0.5">
          <div className="text-[15px] font-bold tracking-[-0.2px] text-white">
            3D <span className="text-brand-glow">Surgical</span>
          </div>
          <div className="text-navy-muted text-[10.5px] tracking-[0.3px]">
            Manufacturing Management
          </div>
        </div>
      </div>

      {/* Which site this is. It names the place rather than offering a way
          out of it: the admin console and each space are separate addresses. */}
      <div className="px-3 pb-1">
        <div className="flex w-full items-center gap-2.5 rounded-[10px] border border-white/10 bg-white/[0.04] px-2.5 py-[9px] text-white">
          <div
            className={
              "flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg text-xs font-bold text-white " +
              (isAdmin ? "bg-brand" : "bg-[#1570EF]")
            }
          >
            {isAdmin ? "AD" : initials(spaceName ?? "")}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-px">
            <div className="text-[10px] font-semibold tracking-[0.8px] text-[#7A889C] uppercase">
              {isAdmin ? "Admin console" : "Company space"}
            </div>
            <div className="truncate text-[13px] font-semibold">
              {isAdmin ? "3D Surgical platform" : spaceName}
            </div>
          </div>
        </div>
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pt-1 pb-3">
        {navSections(role, siteOnly, surgeonOnly).map((section) => (
          <div key={section.title} className="mt-4 flex flex-col gap-0.5">
            <div className="px-2.5 pb-[7px] text-[10px] font-semibold tracking-[0.9px] text-[#7A889C] uppercase">
              {section.title}
            </div>
            {section.items.map((item) => {
              const on = current === item.id;
              const planned = item.phase > CURRENT_PHASE;
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={on ? "page" : undefined}
                  title={planned ? `${item.title} — planned for phase ${item.phase}` : undefined}
                  className={
                    "flex min-h-[38px] w-full items-center gap-[11px] rounded-[9px] border-l-[3px] py-[9px] pr-[11px] text-[13px] no-underline " +
                    (on
                      ? "border-brand-glow text-brand-glow bg-white/[0.07] pl-[9px] font-semibold"
                      : "text-navy-text border-transparent pl-3 font-medium hover:bg-white/[0.04]")
                  }
                >
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className={"flex-none " + (planned && !on ? "opacity-60" : "")}
                  >
                    <path d={item.icon} />
                  </svg>
                  <span className={"min-w-0 flex-1 " + (planned && !on ? "opacity-60" : "")}>{item.title}</span>
                  {countFor(item.id) > 0 ? (
                    <span
                      data-testid={`nav-count-${item.id}`}
                      aria-label={`${countFor(item.id)} waiting`}
                      className="bg-brand flex h-5 min-w-5 flex-none items-center justify-center rounded-full px-1.5 font-mono text-[11px] font-bold text-white"
                    >
                      {countFor(item.id) > 99 ? "99+" : countFor(item.id)}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-white/[0.07] p-3">
        <div className="flex items-center gap-2.5 p-1">
          <Link
            href="/account"
            onClick={onNavigate}
            title="Account settings"
            className={
              "flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1.5 text-left no-underline " +
              (current === "account" ? "bg-white/[0.07]" : "bg-transparent")
            }
          >
            <div
              className={
                "flex h-8 w-8 flex-none items-center justify-center rounded-full text-[13px] font-semibold text-white " +
                (isAdmin ? "bg-brand" : "bg-[#1570EF]")
              }
            >
              {initials(userName)}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="truncate text-[12.5px] font-semibold text-white">{userName}</div>
              <div className="text-navy-muted truncate text-[11px]">{roleLabel}</div>
            </div>
          </Link>
          <form action={signOutAction}>
            <button
              type="submit"
              aria-label="Sign out"
              title="Sign out"
              className="text-navy-muted flex h-9 w-9 flex-none items-center justify-center rounded-lg border-0 bg-transparent hover:bg-white/[0.07]"
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
