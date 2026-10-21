"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { completePasswordReset, requestPasswordReset, signIn, signUp, startGoogleSignIn, type FormState } from "./actions";
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

export function SignInForm({ next, notice, error, signupLink }: { next?: string; notice?: string; error?: string; signupLink?: boolean }) {
  const [state, action, pending] = useActionState(signIn, error ? { error } : notice ? { notice } : {});
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
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
          <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.5 14.6 2.5 12 2.5 6.8 2.5 2.6 6.7 2.6 12s4.2 9.5 9.4 9.5c5.4 0 9-3.8 9-9.2 0-.6-.1-1.1-.2-1.6H12z" />
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
