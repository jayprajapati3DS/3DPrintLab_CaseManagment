"use client";

import { useState } from "react";

import { S_BTN_DANGER, S_BTN_OUTLINE, S_INPUT, S_LABEL } from "@/components/setup/ui";
import { useFormAction } from "@/components/setup/use-form-action";
import { archiveResourceAction } from "@/lib/resources/actions";

export function ArchiveButton({ resourceId, name, label = "Archive" }: { resourceId: string; name: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const { state, pending, onSubmit } = useFormAction(archiveResourceAction);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={S_BTN_DANGER}>
        {label}
      </button>
      {open ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-[rgba(16,24,40,0.45)] p-3 sm:items-center sm:p-6">
          <form
            onSubmit={onSubmit}
            role="dialog"
            aria-modal="true"
            aria-labelledby="arc-title"
            className="flex w-[480px] max-w-full flex-col gap-4 rounded-[14px] bg-white p-[22px] shadow-[0_20px_40px_rgba(16,24,40,.2)]"
          >
            <input type="hidden" name="id" value={resourceId} />
            <h2 id="arc-title" className="m-0 text-base font-bold">
              Archive &ldquo;{name}&rdquo;?
            </h2>
            <p className="text-ink-2 m-0 text-[13px] leading-[1.55]">
              It will be removed from active lists and selections. All its data, history and
              documents are kept in the Archived list, and you can restore it at any time.
            </p>
            <label className="flex flex-col gap-[5px]">
              <span className={S_LABEL}>Reason for archiving</span>
              <input
                name="reason"
                required
                autoFocus
                placeholder="e.g. decommissioned, replaced by new model"
                className={S_INPUT}
              />
            </label>
            {!state.ok && state.message ? (
              <p role="alert" className="text-bad m-0 text-[12.5px]">
                {state.message}
              </p>
            ) : null}
            <div className="flex justify-end gap-2.5">
              <button type="button" onClick={() => setOpen(false)} className={S_BTN_OUTLINE}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="h-9 rounded-[9px] border-0 bg-[#B42318] px-3.5 text-[13px] font-semibold text-white disabled:opacity-45"
              >
                {pending ? "Archiving…" : "Archive"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
