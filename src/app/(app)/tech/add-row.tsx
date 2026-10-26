"use client";

import { S_BTN_DARK, S_INPUT } from "@/components/setup/ui";
import { useFormAction } from "@/components/setup/use-form-action";
import type { ActionResult } from "@/lib/resources/actions";

/** A one-field "type a name, press Add" row, as under the technology and part-type tables. */
export function AddRow({
  action,
  placeholder,
  label,
}: {
  action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
  placeholder: string;
  label: string;
}) {
  const { state, pending, onSubmit } = useFormAction(action, (form) => form.reset());

  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={onSubmit} className="flex gap-2.5">
        <input name="name" required aria-label={label} placeholder={placeholder} className={`${S_INPUT} max-w-[360px]`} />
        <button type="submit" disabled={pending} className={S_BTN_DARK + " h-[38px]"}>
          {label}
        </button>
      </form>
      {!state.ok && state.message ? (
        <p role="alert" className="text-bad m-0 text-[12.5px]">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
