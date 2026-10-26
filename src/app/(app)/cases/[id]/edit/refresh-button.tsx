"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { refreshCaseDetailAction } from "@/app/(app)/cases/actions";

export function RefreshButton({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      title={failed ? "The platform could not be read; see the message on the page." : undefined}
      onClick={() =>
        startTransition(async () => {
          const result = await refreshCaseDetailAction(caseId);
          setFailed(!result.ok);
          router.refresh();
        })
      }
      className="border-field text-ink flex h-9 items-center gap-2 rounded-[9px] border bg-white px-3 text-[13px] font-semibold whitespace-nowrap disabled:opacity-60"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={pending ? "animate-spin" : ""}
      >
        <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
      </svg>
      {pending ? "Refreshing…" : "Refresh"}
    </button>
  );
}
