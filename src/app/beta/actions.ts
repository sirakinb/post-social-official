"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@insforge/sdk/ssr";
import { insforgeAuthActions } from "@/lib/insforge/server";
import {
  BETA_LOGIN,
  needsEmailVerification,
  OAUTH_CALLBACK,
  OAUTH_VERIFIER_COOKIE,
  passwordProblem,
  resetErrorMessage,
  safeNextPath,
  signInErrorMessage,
  signUpErrorMessage,
  signupOpen,
  verifyErrorMessage,
} from "@/lib/insforge/auth-rules";
import { checkAuthLimit } from "@/lib/security/limits";

// codeRejected: the email code didn't work. The backend says the same for a typo and an expired
// code, so the form words it by how long ago the code was sent.
// at: when the answer was given, so a form with two buttons shows the newest one.
export type FormState = { error?: string; notice?: string; step?: "request" | "complete" | "verify"; email?: string; codeRejected?: boolean; sentAt?: number; at?: number };

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function signIn(_previous: FormState, formData: FormData): Promise<FormState> {
  const email = field(formData, "email");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };
  const limit = await checkAuthLimit("signin", email);
  if (limit.blocked) return { error: limit.blocked };

  const auth = await insforgeAuthActions();
  const { data, error } = await auth.signInWithPassword({ email, password });
  if (needsEmailVerification(error)) return sendVerificationCode(email);
  if (error || !data?.user) return { error: signInErrorMessage(error ?? { statusCode: 401 }) ?? undefined };

  redirect(safeNextPath(field(formData, "next")));
}

// Right password, unconfirmed email: email a fresh code and ask for it. Sends share the
// password-reset email cap, so the form can't be used to fill someone's inbox.
async function sendVerificationCode(email: string): Promise<FormState> {
  const notice = `Confirm your email to finish signing in. We sent a code to ${email}.`;
  const limit = await checkAuthLimit("reset_request", email);
  if (limit.blocked) return { error: limit.blocked };
  if (limit.send) {
    const client = createServerClient();
    const { error } = await client.auth.resendVerificationEmail({ email });
    if (error && error.statusCode !== undefined && (error.statusCode === 429 || error.statusCode >= 500)) {
      return { error: verifyErrorMessage(error) ?? undefined };
    }
  }
  return { step: "verify", email, notice, sentAt: Date.now() };
}

// "Send a new code" on the code screen. Same cap as above, so it can't fill someone's inbox.
export async function resendEmailCode(_previous: FormState, formData: FormData): Promise<FormState> {
  const email = field(formData, "email");
  if (!email) return { step: "verify", error: "Start again from the sign-in page." };
  const sent = await sendVerificationCode(email);
  return sent.error ? { step: "verify", email, error: sent.error, at: Date.now() } : { step: "verify", email, notice: `We sent a new code to ${email}.`, sentAt: Date.now(), at: Date.now() };
}

// The code from the confirmation email. A correct code confirms the email and signs the
// person in.
export async function verifyEmailCode(previous: FormState, formData: FormData): Promise<FormState> {
  return { ...(await checkEmailCode(previous, formData)), at: Date.now() };
}

async function checkEmailCode(_previous: FormState, formData: FormData): Promise<FormState> {
  const email = field(formData, "email");
  const code = field(formData, "code");
  if (!email || !code) return { step: "verify", email, error: "Enter the code from the email." };
  if (!/^\d{6}$/.test(code)) return { step: "verify", email, error: "Enter the 6-digit code from the email." };
  const limit = await checkAuthLimit("reset_complete", email);
  if (limit.blocked) return { step: "verify", email, error: limit.blocked };

  const auth = await insforgeAuthActions();
  const { data, error } = await auth.verifyEmail({ email, otp: code });
  if (error?.statusCode === 400 || (!error && !data?.user)) return { step: "verify", email, codeRejected: true };
  if (error || !data?.user) return { step: "verify", email, error: verifyErrorMessage(error) ?? undefined };

  redirect(safeNextPath(field(formData, "next")));
}

// Open sign-up with an email and password. The workspace is created on the first visit to
// the app (loadViewer), the same way as for Google sign-ups.
export async function signUp(_previous: FormState, formData: FormData): Promise<FormState> {
  if (!signupOpen()) return { error: "Post Social is invite-only for now." };
  const name = field(formData, "name").slice(0, 80);
  const email = field(formData, "email");
  const password = String(formData.get("password") ?? "");
  if (!name || !email || !password) return { error: "Enter your name, email and a password." };
  const problem = passwordProblem(password);
  if (problem) return { error: problem };
  const limit = await checkAuthLimit("signup", email);
  if (limit.blocked) return { error: limit.blocked };

  const auth = await insforgeAuthActions();
  const { data, error } = await auth.signUp({ email, password, name });
  if (error) return { error: signUpErrorMessage(error) ?? undefined };
  if (!data?.user || (data as { requireEmailVerification?: boolean }).requireEmailVerification) {
    return { step: "verify", email, notice: `We sent a code to ${email}. Enter it to finish creating your account.`, sentAt: Date.now() };
  }
  redirect(safeNextPath(field(formData, "next")));
}

// Google sign-in (and sign-up): sends the person to Google with a PKCE challenge. The
// verifier waits in a short-lived httpOnly cookie for the callback route to finish.
export async function startGoogleSignIn(formData: FormData) {
  if (!signupOpen()) redirect(BETA_LOGIN);
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const proto = requestHeaders.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const next = safeNextPath(field(formData, "next"));
  const callback = new URL(OAUTH_CALLBACK, `${proto}://${host}`);
  if (next !== "/beta") callback.searchParams.set("next", next);

  const auth = await insforgeAuthActions();
  const { data, error } = await auth.signInWithOAuth("google", { redirectTo: callback.toString(), skipBrowserRedirect: true });
  if (error || !data?.url || !data.codeVerifier) redirect(`${BETA_LOGIN}?error=google`);
  (await cookies()).set(OAUTH_VERIFIER_COOKIE, data.codeVerifier, {
    httpOnly: true,
    secure: proto === "https",
    sameSite: "lax",
    path: OAUTH_CALLBACK,
    maxAge: 600,
  });
  redirect(data.url);
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
  const limit = await checkAuthLimit("reset_request", email);
  if (limit.blocked) return { step: "request", email, error: limit.blocked };
  const sent = "If that email has an account, we sent it a reset code. It expires soon, so use it now.";
  // Too many reset emails for this address already: answer the same, send nothing more.
  if (!limit.send) return { step: "complete", email, notice: sent };

  const client = createServerClient();
  const { error } = await client.auth.sendResetPasswordEmail({ email });
  // Same answer whether or not the account exists, so the form cannot be used to find accounts.
  if (error && error.statusCode !== undefined && (error.statusCode === 429 || error.statusCode >= 500)) {
    return { step: "request", email, error: resetErrorMessage(error) ?? undefined };
  }
  return {
    step: "complete",
    email,
    notice: sent,
  };
}

export async function completePasswordReset(_previous: FormState, formData: FormData): Promise<FormState> {
  const email = field(formData, "email");
  const code = field(formData, "code");
  const newPassword = String(formData.get("password") ?? "");
  const problem = passwordProblem(newPassword);
  if (!email || !code) return { step: "complete", email, error: "Enter the code from the email." };
  if (problem) return { step: "complete", email, error: problem };
  const limit = await checkAuthLimit("reset_complete", email);
  if (limit.blocked) return { step: "complete", email, error: limit.blocked };

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
