"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { assertSameOrigin, CrossOriginError } from "@/lib/auth/origin";
import {
  attemptAdminLogin,
  attemptSpaceLogin,
  clearChallenge,
  resendTwoFactor,
  verifyTwoFactor,
} from "@/lib/auth/login";
import { getRealm } from "@/lib/realm";

export interface LoginState {
  status: "idle" | "error" | "two_factor";
  message?: string;
  /** Which field the message belongs to; absent for a form-level message. */
  field?: "email" | "password" | "code";
  /** "email" or "authenticator_app" — changes the wording of the OTP step. */
  method?: string;
  /**
   * The address that was typed, handed back so a rejected attempt does not
   * empty the form. Never the password.
   */
  email?: string;
}

const credentials = z.object({
  email: z.email("Enter a valid email address.").max(254),
  password: z.string().min(1, "Enter your password.").max(1024),
  remember: z.boolean(),
  next: z.string().optional(),
});

const otp = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{4,10}$/, "Enter the numeric code you were sent."),
  next: z.string().optional(),
});

/**
 * Only same-site paths are ever redirected to, so a crafted `?next=` cannot
 * bounce someone to another origin after they authenticate.
 */
function safeNext(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export async function signInAction(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  try {
    await assertSameOrigin();
  } catch (error) {
    if (error instanceof CrossOriginError) {
      return { status: "error", message: error.message };
    }
    throw error;
  }

  const email = String(formData.get("email") ?? "").slice(0, 254);

  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    remember: formData.get("remember") === "on",
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path[0];
    return {
      email,
      status: "error",
      message: issue?.message ?? "Check the details you entered.",
      field: field === "email" || field === "password" ? field : undefined,
    };
  }

  // Which sign-in this is comes from the address the form was served at — the
  // admin console or one company's space — never from the form itself.
  const realm = await getRealm();
  if (realm.kind === "unknown") {
    return { email, status: "error", message: "There is no company space at this address." };
  }

  const outcome =
    realm.kind === "admin"
      ? await attemptAdminLogin(parsed.data.email, parsed.data.password, parsed.data.remember)
      : await attemptSpaceLogin(
          realm.space,
          parsed.data.email,
          parsed.data.password,
          parsed.data.remember,
        );

  if (outcome.kind === "error") {
    return { email, status: "error", message: outcome.message };
  }

  if (outcome.kind === "two_factor") {
    return {
      status: "two_factor",
      method: outcome.method,
      email: outcome.email,
      message:
        outcome.method === "authenticator_app"
          ? "Enter the current code from your authenticator app."
          : "We sent a verification code to your email address.",
    };
  }

  // redirect() signals by throwing, so it must sit outside any try/catch.
  redirect(safeNext(parsed.data.next));
}

export async function verifyAction(
  previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  try {
    await assertSameOrigin();
  } catch (error) {
    if (error instanceof CrossOriginError) {
      return { ...previous, status: "error", message: error.message };
    }
    throw error;
  }

  const parsed = otp.safeParse({
    code: formData.get("code"),
    next: formData.get("next") ?? undefined,
  });

  if (!parsed.success) {
    return {
      ...previous,
      status: "two_factor",
      field: "code",
      message: parsed.error.issues[0]?.message,
    };
  }

  const outcome = await verifyTwoFactor(parsed.data.code);

  if (outcome.kind === "error") {
    return { ...previous, status: "two_factor", field: "code", message: outcome.message };
  }

  redirect(safeNext(parsed.data.next));
}

export async function resendCodeAction(): Promise<{ message: string }> {
  await assertSameOrigin();
  const result = await resendTwoFactor();
  return { message: result.message };
}

export async function cancelTwoFactorAction(): Promise<void> {
  await clearChallenge();
  redirect("/login");
}
