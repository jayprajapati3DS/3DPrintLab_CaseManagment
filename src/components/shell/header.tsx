"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";

import { pageForPath } from "@/components/shell/nav";
import type { AppRole } from "@/lib/auth/session";

export function Header({
  role,
  spaceName,
  hostname,
  onMenu,
}: {
  role: AppRole;
  spaceName: string | null;
  /** This site's address, shown so it is always plain which site one is on. */
  hostname: string;
  /** Opens the navigation drawer, where the sidebar is not always on screen. */
  onMenu: () => void;
}) {
  const pathname = usePathname();
  const page = pageForPath(role, pathname);
  const [notifOpen, setNotifOpen] = useState(false);
  const isAdmin = role === "SUPER_ADMIN";

  const title = page?.title ?? "Not found";
  const subtitle = page
    ? page.id === "dashboard"
      ? `${spaceName ?? ""} · overview`
      : page.subtitle
    : "";

  return (
    <header className="border-line relative z-[5] flex h-16 flex-none items-center gap-2.5 border-b bg-white px-3 sm:gap-4 sm:px-5 lg:px-6">
      <button
        type="button"
        onClick={onMenu}
        aria-label="Open menu"
        aria-controls="main-menu"
        className="border-line text-ink-2 flex h-10 w-10 flex-none items-center justify-center rounded-[9px] border bg-white lg:hidden"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>
      <div className="flex min-w-0 flex-auto flex-col gap-px">
        <h1 className="text-ink m-0 truncate text-[16.5px] leading-[1.2] font-bold tracking-[-0.3px]">
          {title}
        </h1>
        <div className="text-muted truncate text-[12.5px]">{subtitle}</div>
      </div>

      <div
        title={
          isAdmin
            ? "Platform admin console — manage all company spaces"
            : "Your company space address"
        }
        className={
          "hidden h-8 min-w-0 flex-[0_1_auto] items-center gap-[7px] rounded-full border px-[11px] md:flex " +
          (isAdmin ? "border-field bg-chip" : "border-line bg-white")
        }
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#067647"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="flex-none"
        >
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        <span className="text-ink-2 truncate font-mono text-xs">{hostname}</span>
      </div>

      {/* The design's search box has no behaviour of its own; in a space it
          searches cases, the one thing there is to search so far. The admin
          console has nothing to search, so it has no box. */}
      {isAdmin ? null : (
        <form action="/cases" role="search" className="relative hidden min-w-0 flex-[0_1_200px] sm:flex">
          <input type="hidden" name="tile" value="all" />
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#98A2B3"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
            className="absolute top-3 left-[11px]"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="search"
            name="q"
            aria-label="Search cases"
            placeholder="Search cases…"
            className="border-line bg-subtle text-ink h-[38px] w-full rounded-[9px] border pr-3 pl-[33px] text-[13px]"
          />
        </form>
      )}

      <div className="relative flex-none">
        <button
          type="button"
          onClick={() => setNotifOpen((v) => !v)}
          aria-label="Notifications"
          aria-expanded={notifOpen}
          className="border-line text-ink-3 relative flex h-10 w-10 items-center justify-center rounded-[9px] border bg-white"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </button>
        {notifOpen ? (
          <div className="border-line shadow-popover absolute top-12 right-0 flex w-[300px] max-w-[calc(100vw-24px)] flex-col rounded-xl border bg-white">
            <div className="border-line-3 border-b px-4 py-3.5 text-sm font-semibold">
              Notifications
            </div>
            <div className="text-muted px-4 py-7 text-center text-[13px]">
              You&rsquo;re all caught up.
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
}
