"use client";

import { useEffect, useState } from "react";

import { Header } from "@/components/shell/header";
import { Sidebar, type SidebarProps } from "@/components/shell/sidebar";

/**
 * The frame around every page: the navigation and the header.
 *
 * On a desktop the navigation is a fixed column. Below that width it is a
 * drawer — off-screen until the header's menu button opens it, and closed
 * again by choosing a page, tapping outside it, or pressing Escape.
 */
export function Shell({
  hostname,
  children,
  ...sidebar
}: SidebarProps & { hostname: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="bg-canvas text-ink flex h-dvh overflow-hidden">
      {open ? (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 cursor-default border-0 bg-[rgba(12,21,36,.55)] lg:hidden"
        />
      ) : null}
      <Sidebar {...sidebar} open={open} onNavigate={() => setOpen(false)} />
      <div className="flex h-dvh min-w-0 flex-1 flex-col">
        <Header role={sidebar.role} spaceName={sidebar.spaceName} hostname={hostname} onMenu={() => setOpen(true)} />
        <main className="min-h-0 flex-1 overflow-auto px-3 py-4 sm:px-5 sm:py-5 lg:px-7 lg:py-[26px]">{children}</main>
      </div>
    </div>
  );
}
