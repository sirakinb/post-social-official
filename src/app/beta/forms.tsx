"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { completePasswordReset, requestPasswordReset, signIn, signUp, startGoogleSignIn, verifyEmailCode, type FormState } from "./actions";
import { PASSWORD_MIN_LENGTH } from "@/lib/insforge/auth-rules";

function Alert({ state }: { state: FormState }) {
  if (state.error) {
    return <p role="alert" className="mt-4 rounded-lg border border-error/20 bg-error-bg p-3 text-sm text-error">{state.error}</p>;
  }
  if (state.notice) {
    return <p role="status" className="mt-4 rounded-lg border border-border bg-canvas-ivory p-3 text-sm text-ink">{state.notice}</p>;
  }
  return null;
}

// Asks for the code from the confirmation email (after sign-up, or a sign-in with an
// unconfirmed email).
function VerifyEmailForm({ start, next }: { start: FormState; next?: string }) {
  const [state, action, pending] = useActionState(verifyEmailCode, {});
  const shown = state.error ? state : start;
  return (
    <>
      <form className="mt-6 space-y-4" action={action}>
        <input type="hidden" name="email" value={start.email ?? ""} />
        <input type="hidden" name="next" value={next ?? ""} />
        <div className="space-y-2"><label htmlFor="verify-code" className="text-sm font-medium text-ink">Code from the email</label><Input id="verify-code" name="code" inputMode="numeric" autoComplete="one-time-code" required /></div>
        <Button type="submit" variant="primary" className="w-full" disabled={pending}>{pending ? "Checking…" : "Confirm email"}</Button>
      </form>
      <Alert state={shown} />
    </>
  );
}

export function SignInForm({ next, notice, error, signupLink }: { next?: string; notice?: string; error?: string; signupLink?: boolean }) {
  const [state, action, pending] = useActionState(signIn, error ? { error } : notice ? { notice } : {});
  if (state.step === "verify") return <VerifyEmailForm start={state} next={next} />;
  return (
    <>
      <form className="mt-6 space-y-4" action={action}>
        <input type="hidden" name="next" value={next ?? ""} />
        <div className="space-y-2"><label htmlFor="signin-email" className="text-sm font-medium text-ink">Email</label><Input id="signin-email" name="email" type="email" placeholder="you@example.com" autoComplete="email" required /></div>
        <div className="space-y-2"><label htmlFor="signin-password" className="text-sm font-medium text-ink">Password</label><Input id="signin-password" name="password" type="password" placeholder="••••••••" autoComplete="current-password" required /></div>
        <Button type="submit" variant="primary" className="w-full" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</Button>
      </form>
      <Alert state={state} />
      <p className="mt-5 text-center text-sm"><Link href="/beta/reset-password" className="text-ink-muted underline-offset-4 hover:text-ink hover:underline">Forgot your password?</Link></p>
      {signupLink && (
        <p className="mt-2 text-center text-sm text-ink-muted">New to Post Social? <Link href={next ? `/beta/signup?next=${encodeURIComponent(next)}` : "/beta/signup"} className="text-ink underline-offset-4 hover:underline">Start for free</Link></p>
      )}
    </>
  );
}

// "Continue with Google": signs in, or creates the account on first use.
export function GoogleButton({ next }: { next?: string }) {
  return (
    <form action={startGoogleSignIn} className="mt-6">
      <input type="hidden" name="next" value={next ?? ""} />
      <Button type="submit" variant="secondary" className="w-full gap-2">
        {/* Google's standard four-color "G" mark. */}
        <svg aria-hidden="true" viewBox="0 0 48 48" className="h-[18px] w-[18px]">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
        Continue with Google
      </Button>
    </form>
  );
}

// Divider between the Google button and the email form.
export function OrDivider() {
  return (
    <div className="mt-6 flex items-center gap-3 text-xs text-ink-subtle" aria-hidden="true">
      <span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" />
    </div>
  );
}

export function SignUpForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(signUp, {});
  if (state.step === "verify") return <VerifyEmailForm start={state} next={next} />;
  return (
    <>
      <form className="mt-6 space-y-4" action={action}>
        <input type="hidden" name="next" value={next ?? ""} />
        <div className="space-y-2"><label htmlFor="signup-name" className="text-sm font-medium text-ink">Name</label><Input id="signup-name" name="name" placeholder="Your name" autoComplete="name" maxLength={80} required /></div>
        <div className="space-y-2"><label htmlFor="signup-email" className="text-sm font-medium text-ink">Email</label><Input id="signup-email" name="email" type="email" placeholder="you@example.com" autoComplete="email" required /></div>
        <div className="space-y-2">
          <label htmlFor="signup-password" className="text-sm font-medium text-ink">Password</label>
          <Input id="signup-password" name="password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required />
          <p className="text-xs text-ink-subtle">At least {PASSWORD_MIN_LENGTH} characters, including a number.</p>
        </div>
        <Button type="submit" variant="primary" className="w-full" disabled={pending}>{pending ? "Creating your account…" : "Create free account"}</Button>
      </form>
      <Alert state={state} />
      <p className="mt-5 text-center text-sm text-ink-muted">Already have an account? <Link href={next ? `/beta/login?next=${encodeURIComponent(next)}` : "/beta/login"} className="text-ink underline-offset-4 hover:underline">Sign in</Link></p>
    </>
  );
}

export function ResetPasswordForm() {
  const [requestState, requestAction, requesting] = useActionState(requestPasswordReset, { step: "request" });
  const [completeState, completeAction, completing] = useActionState(completePasswordReset, {});

  if (requestState.step !== "complete") {
    return (
      <>
        <form className="mt-6 space-y-4" action={requestAction}>
          <div className="space-y-2"><label htmlFor="reset-email" className="text-sm font-medium text-ink">Email</label><Input id="reset-email" name="email" type="email" placeholder="you@example.com" autoComplete="email" required /></div>
          <Button type="submit" variant="primary" className="w-full" disabled={requesting}>{requesting ? "Sending…" : "Email me a reset code"}</Button>
        </form>
        <Alert state={requestState} />
      </>
    );
  }

  const shown = completeState.error ? completeState : requestState;
  return (
    <>
      <form className="mt-6 space-y-4" action={completeAction}>
        <input type="hidden" name="email" value={requestState.email ?? ""} />
        <div className="space-y-2"><label htmlFor="reset-code" className="text-sm font-medium text-ink">Reset code</label><Input id="reset-code" name="code" inputMode="numeric" autoComplete="one-time-code" required /></div>
        <div className="space-y-2">
          <label htmlFor="reset-password" className="text-sm font-medium text-ink">New password</label>
          <Input id="reset-password" name="password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required />
          <p className="text-xs text-ink-subtle">At least {PASSWORD_MIN_LENGTH} characters, including a number.</p>
        </div>
        <Button type="submit" variant="primary" className="w-full" disabled={completing}>{completing ? "Saving…" : "Set new password"}</Button>
      </form>
      <Alert state={shown} />
    </>
  );
}
