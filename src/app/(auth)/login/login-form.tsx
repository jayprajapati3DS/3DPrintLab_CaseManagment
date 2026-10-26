"use client";

import { useActionState, useState, useTransition } from "react";

import {
  cancelTwoFactorAction,
  resendCodeAction,
  signInAction,
  verifyAction,
  type LoginState,
} from "@/app/(auth)/login/actions";

const INPUT =
  "h-12 rounded-lg border bg-white px-3.5 text-[15px] text-[#16191F] placeholder:text-[#8A8F98] " +
  "focus:border-[#16191F] focus:shadow-[0_0_0_3px_rgba(196,80,28,.18)] focus:outline-none";

const INITIAL: LoginState = { status: "idle" };

export function LoginForm({
  next,
  header,
  submitLabel,
  footNote,
}: {
  next: string;
  /** Who this sign-in page is for — drawn by the page, which knows the site. */
  header: React.ReactNode;
  submitLabel: string;
  footNote: string;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [state, signIn, signingIn] = useActionState(signInAction, INITIAL);

  if (state.status === "two_factor") {
    return <TwoFactorStep next={next} initial={state} />;
  }

  const fieldError = (field: LoginState["field"]) =>
    state.status === "error" && state.field === field ? state.message : undefined;
  const formError =
    state.status === "error" && !state.field ? state.message : undefined;

  return (
    <>
      {header}

      <form action={signIn} className="flex flex-col gap-[18px]" noValidate>
        <input type="hidden" name="next" value={next} />

        <Field label="Email" htmlFor="email" error={fieldError("email")}>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            defaultValue={state.email}
            placeholder="you@company.com"
            className={`${INPUT} ${fieldError("email") ? "border-[#B3261E]" : "border-[#CFC8BC]"}`}
          />
        </Field>

        <Field label="Password" htmlFor="password" error={fieldError("password")}>
          <div className="relative flex">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Enter your password"
              className={`${INPUT} grow pr-[52px] ${fieldError("password") ? "border-[#B3261E]" : "border-[#CFC8BC]"}`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute top-0.5 right-0.5 flex h-11 w-11 items-center justify-center rounded-md border-0 bg-transparent text-[#5B606A]"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {showPassword ? (
                  <>
                    <path d="M3 3l18 18" />
                    <path d="M10.6 5.1A9.8 9.8 0 0112 5c5 0 9 4.5 10 7-.4 1-1.3 2.4-2.6 3.7M6.6 6.6C4.4 8 2.8 10.2 2 12c1 2.5 5 7 10 7 1.9 0 3.6-.6 5-1.5" />
                    <path d="M9.9 9.9a3 3 0 004.2 4.2" />
                  </>
                ) : (
                  <>
                    <path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z" />
                    <circle cx="12" cy="12" r="3" />
                  </>
                )}
              </svg>
            </button>
          </div>
        </Field>

        <label className="flex min-h-6 cursor-pointer items-center gap-2.5 text-sm text-[#3A3F48]">
          <input
            type="checkbox"
            name="remember"
            defaultChecked
            className="m-0 h-[18px] w-[18px] accent-[#C4501C]"
          />
          Keep me signed in
        </label>

        {formError ? (
          <div
            role="alert"
            className="rounded-lg border border-[#F0C2BD] bg-[#FBEAE8] px-3.5 py-3 text-sm leading-[1.45] text-[#8C1D18]"
          >
            {formError}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={signingIn}
          className="h-[52px] rounded-lg border-0 bg-[#C4501C] text-base font-semibold text-white disabled:bg-[#8F4A2C]"
        >
          {signingIn ? "Signing in…" : submitLabel}
        </button>
        <span className="text-center text-[12.5px] leading-[1.5] text-[#8A8F98]">{footNote}</span>
      </form>
    </>
  );
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <div role="alert" className="text-[13px] text-[#B3261E]">
          {error}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The one-time code step. Not in the design — the prototype has no second
 * factor — but the platform does, and a session must not exist before the code
 * is confirmed. It borrows the sign-in card's type and spacing.
 */
function TwoFactorStep({ next, initial }: { next: string; initial: LoginState }) {
  const [state, verify, verifying] = useActionState(verifyAction, initial);
  const [notice, setNotice] = useState<string | null>(null);
  const [resending, startResend] = useTransition();

  const error = state.field === "code" || state.status === "error" ? state.message : undefined;

  return (
    <>
      <h1 className="font-display m-0 text-[28px] font-medium tracking-[-0.02em]">
        Verify it&rsquo;s you
      </h1>
      <p className="m-0 text-sm leading-[1.5] text-[#3A3F48]">
        {initial.method === "authenticator_app"
          ? "Enter the current code from your authenticator app."
          : `We sent a verification code to ${initial.email ?? "your email address"}.`}
      </p>

      <form action={verify} className="flex flex-col gap-[18px]" noValidate>
        <input type="hidden" name="next" value={next} />
        <Field label="Verification code" htmlFor="code" error={error}>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            placeholder="123456"
            className={`${INPUT} font-mono tracking-[0.2em] ${error ? "border-[#B3261E]" : "border-[#CFC8BC]"}`}
          />
        </Field>

        {notice ? <p className="m-0 text-[13px] text-[#3A3F48]">{notice}</p> : null}

        <button
          type="submit"
          disabled={verifying}
          className="h-[52px] rounded-lg border-0 bg-[#C4501C] text-base font-semibold text-white disabled:bg-[#8F4A2C]"
        >
          {verifying ? "Verifying…" : "Verify"}
        </button>
      </form>

      <div className="flex justify-between text-[13px] font-medium">
        {initial.method === "authenticator_app" ? (
          <span />
        ) : (
          <button
            type="button"
            disabled={resending}
            onClick={() =>
              startResend(async () => {
                const result = await resendCodeAction();
                setNotice(result.message);
              })
            }
            className="border-0 bg-transparent p-0 text-[#B4481A] disabled:opacity-60"
          >
            {resending ? "Sending…" : "Send a new code"}
          </button>
        )}
        <form action={cancelTwoFactorAction}>
          <button type="submit" className="border-0 bg-transparent p-0 text-[#5B606A]">
            Use a different account
          </button>
        </form>
      </div>
    </>
  );
}
