"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { AuthLoading, Authenticated, Unauthenticated, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { WorkspaceProvider } from "@/components/workspace-provider";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";

function UserBootstrap({ children }: { children: ReactNode }) {
  const ensureCurrent = useMutation(api.users.ensureCurrent);
  const [ready, setReady] = useState(false);
  useEffect(() => { void ensureCurrent().then(() => setReady(true)); }, [ensureCurrent]);
  if (!ready) return <div className="flex min-h-screen items-center justify-center bg-canvas font-mono text-xs uppercase tracking-widest text-ink-muted">Opening workspace…</div>;
  return <WorkspaceProvider>{children}</WorkspaceProvider>;
}

function AccessScreen() {
  return (
    <div className="technical-grid flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="grooved-surface w-full max-w-md rounded-xl border border-border bg-surface p-8 text-center shadow-hairline">
        <Brand size="md" className="mx-auto justify-center" />
        <h1 className="mt-8 text-2xl font-semibold tracking-[-0.035em] text-ink">Sign in required</h1>
        <p className="mt-3 text-sm leading-6 text-ink-muted">
          Workspace data, connected accounts, drafts, and publishing controls are private.
          Sign in to access your Post Social workspace.
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button asChild variant="primary" className="w-full sm:w-auto"><Link href="/login">Sign in</Link></Button>
          <Button asChild variant="secondary" className="w-full sm:w-auto"><Link href="/">Back to home</Link></Button>
        </div>
      </div>
    </div>
  );
}

export function AuthenticatedApp({ children }: { children: ReactNode }) {
  return <><AuthLoading><div className="flex min-h-screen items-center justify-center bg-canvas font-mono text-xs uppercase tracking-widest text-ink-muted">Checking sign-in…</div></AuthLoading><Authenticated><UserBootstrap>{children}</UserBootstrap></Authenticated><Unauthenticated><AccessScreen /></Unauthenticated></>;
}
