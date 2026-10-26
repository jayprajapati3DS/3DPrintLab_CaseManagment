"use client";

import { useActionState } from "react";

import { changePasswordAction, type PasswordState } from "@/app/(app)/account/actions";
import { BTN_PRIMARY, CARD, INPUT, LABEL } from "@/components/ui/styles";

const IDLE: PasswordState = { ok: true };

export function ChangePassword() {
  const [state, submit, pending] = useActionState(changePasswordAction, IDLE);

  return (
    <section className={`${CARD} flex flex-col`}>
      <div className="border-line-3 border-b px-5 py-4 text-[15px] font-semibold">Password</div>
      <form action={submit} className="flex flex-col gap-4 px-5 py-5">
        <label className="flex max-w-[360px] flex-col gap-1.5">
          <span className={LABEL}>Current password</span>
          <input name="current" type="password" autoComplete="current-password" className={INPUT} />
        </label>
        <div className="grid max-w-[736px] grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>New password</span>
            <input name="next" type="password" autoComplete="new-password" className={INPUT} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Repeat new password</span>
            <input name="confirm" type="password" autoComplete="new-password" className={INPUT} />
          </label>
        </div>
        <p className="text-muted m-0 text-[12.5px]">
          At least 10 characters. Changing it signs you out on every other device.
        </p>
        {state.message ? (
          <p role="status" className={"m-0 text-[13px] " + (state.ok ? "text-ok" : "text-bad")}>
            {state.message}
          </p>
        ) : null}
        <div>
          <button type="submit" disabled={pending} className={BTN_PRIMARY}>
            {pending ? "Saving…" : "Change password"}
          </button>
        </div>
      </form>
    </section>
  );
}
