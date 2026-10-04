"use server";

import { redirect } from "next/navigation";
import { createServerClient } from "@insforge/sdk/ssr";
import { insforgeAuthActions } from "@/lib/insforge/server";
import {
  BETA_LOGIN,
  passwordProblem,
  resetErrorMessage,
  safeNextPath,
  signInErrorMessage,
} from "@/lib/insforge/auth-rules";

export type FormState = { error?: string; notice?: string; step?: "request" | "complete"; email?: string };

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function signIn(_previous: FormState, formData: FormData): Promise<FormState> {
  const email = field(formData, "email");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const auth = await insforgeAuthActions();
  const { data, error } = await auth.signInWithPassword({ email, password });
  if (error || !data?.user) return { error: signInErrorMessage(error ?? { statusCode: 401 }) ?? undefined };

  redirect(safeNextPath(field(formData, "next")));
}

export async function signOut() {
  const auth = await insforgeAuthActions();
  await auth.signOut();
  redirect(BETA_LOGIN);
}

// Password reset uses a one-time code sent by email (reset_password_method = "code").
export async function requestPasswordReset(_previous: FormState, formData: FormData): Promise<FormState> {
  const email = field(formData, "email");
  if (!email) return { step: "request", error: "Enter the email you sign in with." };

  const client = createServerClient();
  const { error } = await client.auth.sendResetPasswordEmail({ email });
  // Same answer whether or not the account exists, so the form cannot be used to find accounts.
  if (error && error.statusCode !== undefined && (error.statusCode === 429 || error.statusCode >= 500)) {
    return { step: "request", email, error: resetErrorMessage(error) ?? undefined };
  }
  return {
    step: "complete",
    email,
    notice: "If that email has an account, we sent it a reset code. It expires soon, so use it now.",
  };
}

export async function completePasswordReset(_previous: FormState, formData: FormData): Promise<FormState> {
  const email = field(formData, "email");
  const code = field(formData, "code");
  const newPassword = String(formData.get("password") ?? "");
  const problem = passwordProblem(newPassword);
  if (!email || !code) return { step: "complete", email, error: "Enter the code from the email." };
  if (problem) return { step: "complete", email, error: problem };

  const client = createServerClient();
  const exchange = await client.auth.exchangeResetPasswordToken({ email, code });
  if (exchange.error || !exchange.data?.token) {
    return { step: "complete", email, error: resetErrorMessage(exchange.error ?? { statusCode: 400 }) ?? undefined };
  }
  const reset = await client.auth.resetPassword({ newPassword, otp: exchange.data.token });
  if (reset.error) {
    return { step: "complete", email, error: resetErrorMessage(reset.error) ?? undefined };
  }
  // End any session in this browser so the person lands on the sign-in page and sees the
  // confirmation, instead of being bounced into the app by the proxy.
  const auth = await insforgeAuthActions();
  await auth.signOut();
  redirect(`${BETA_LOGIN}?reset=done`);
}
