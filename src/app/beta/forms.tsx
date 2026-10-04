"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { completePasswordReset, requestPasswordReset, signIn, type FormState } from "./actions";
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

export function SignInForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action, pending] = useActionState(signIn, notice ? { notice } : {});
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
