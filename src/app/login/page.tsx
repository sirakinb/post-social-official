"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

function messageFor(error: unknown) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "Something did not work. Please check your details and try again.";
}

export default function LoginPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const result = await authClient.signIn.email({ email: String(form.get("email")), password: String(form.get("password")) });
      if (result.error) throw result.error;
      router.push("/app"); router.refresh();
    } catch (cause) { setError(messageFor(cause)); } finally { setBusy(false); }
  }

  return (
    <div className="technical-grid flex min-h-screen flex-col">
      <header className="border-b border-border bg-[#080610]/90"><div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 md:px-8"><Brand /><Link href="/" className="rounded-md px-2 py-1 text-sm font-medium text-ink-muted hover:text-ink">Back to home</Link></div></header>
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="grooved-surface w-full max-w-md rounded-xl border border-border bg-surface p-7 shadow-hairline md:p-8">
          <div className="text-center"><p className="utility-label text-accent">Post Social / Access</p><h1 className="mt-3 text-2xl font-semibold tracking-[-0.035em] text-ink">Welcome to Post Social</h1><p className="mt-2 text-sm text-ink-muted">Sign in to open your private workspace, connected accounts, drafts, and publishing controls. New access is granted through Pentridge Labs membership.</p></div>
          <div className="mt-8 grid h-10 w-full grid-cols-2 items-center rounded-lg border border-border bg-canvas-ivory p-1">
            <span className="inline-flex items-center justify-center rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink shadow-soft">Sign in</span>
            <Link href="https://www.pentridgemedia.com/labs" className="inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Create account</Link>
          </div>
          <form className="mt-6 space-y-4" onSubmit={signIn}>
            <div className="space-y-2"><label htmlFor="signin-email" className="text-sm font-medium text-ink">Email</label><Input id="signin-email" name="email" type="email" placeholder="you@example.com" autoComplete="email" required /></div>
            <div className="space-y-2"><label htmlFor="signin-password" className="text-sm font-medium text-ink">Password</label><Input id="signin-password" name="password" type="password" placeholder="••••••••" autoComplete="current-password" required /></div>
            <Button type="submit" variant="primary" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
          </form>
          {error && <p role="alert" className="mt-4 rounded-lg border border-error/20 bg-error-bg p-3 text-sm text-error">{error}</p>}
          <p className="mt-5 text-center text-xs leading-5 text-ink-subtle">Post Social access is included with Pentridge Labs membership. Your password is handled by the secure sign-in service. Social account passwords are never collected.</p>
        </div>
      </main>
      <footer className="border-t border-border bg-[#080610]/90"><div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-6 md:flex-row md:px-8"><p className="text-xs text-ink-subtle">© {new Date().getFullYear()} Pentridge Media</p><nav className="flex gap-6 text-xs text-ink-muted"><Link href="/terms" className="hover:text-ink">Terms</Link><Link href="/privacy" className="hover:text-ink">Privacy</Link><Link href="/data-deletion" className="hover:text-ink">Data deletion</Link></nav></div></footer>
    </div>
  );
}
