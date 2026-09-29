"use client";

import { createContext, FormEvent, useContext, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { friendlyErrorMessage } from "@/lib/error-message";

type WorkspaceContextValue = {
  mode: "demo" | "live";
  workspaceId: Id<"workspaces"> | null;
  name: string;
  approvalPolicy: "confirm_each" | "approve_after_draft" | "autonomous";
};

const WorkspaceContext = createContext<WorkspaceContextValue>({ mode: "demo", workspaceId: null, name: "My content", approvalPolicy: "confirm_each" });

export function useWorkspace() { return useContext(WorkspaceContext); }

function slugFor(name: string) {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 38) || "my-content";
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const workspaces = useQuery(api.workspaces.mine);
  const createWorkspace = useMutation(api.workspaces.create);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (workspaces === undefined) return <div className="flex min-h-screen items-center justify-center bg-canvas font-mono text-xs uppercase tracking-widest text-ink-muted">Loading workspace…</div>;

  if (workspaces.length === 0) {
    async function create(event: FormEvent<HTMLFormElement>) {
      event.preventDefault(); setBusy(true); setError(null);
      const name = String(new FormData(event.currentTarget).get("name"));
      try { await createWorkspace({ name, slug: slugFor(name), defaultApprovalPolicy: "confirm_each" }); }
      catch (cause) { setError(friendlyErrorMessage(cause, "The workspace could not be created.")); }
      finally { setBusy(false); }
    }
    return <main className="technical-grid flex min-h-screen items-center justify-center px-4 py-12"><section className="grooved-surface w-full max-w-lg rounded-xl border border-border bg-surface p-8"><Brand /><p className="utility-label mt-10 text-accent">First workspace</p><h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">What should we call your content space?</h1><p className="mt-3 text-sm leading-6 text-ink-muted">This keeps your posts, approvals, and connected accounts together. You can change the name later.</p><form onSubmit={create} className="mt-7 space-y-4"><div className="space-y-2"><label htmlFor="workspace-name" className="text-sm font-medium">Workspace name</label><Input id="workspace-name" name="name" defaultValue="My content" minLength={2} maxLength={60} required autoFocus /></div><Button type="submit" variant="primary" className="w-full" disabled={busy}>{busy ? "Creating workspace…" : "Create workspace"}</Button></form>{error && <p role="alert" className="mt-4 text-sm text-error">{error}</p>}</section></main>;
  }

  const workspace = workspaces[0];
  return <WorkspaceContext.Provider value={{ mode: "live", workspaceId: workspace._id, name: workspace.name, approvalPolicy: workspace.defaultApprovalPolicy }}>{children}</WorkspaceContext.Provider>;
}
