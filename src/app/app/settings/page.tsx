"use client";

import { useMemo, useState } from "react";
import { Check, ShieldCheck, Code2 } from "lucide-react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { friendlyErrorMessage } from "@/lib/error-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { AccountAvatar } from "@/components/account-avatar";
import { platformLabel } from "@/lib/demo";

type ApprovalPolicy = "confirm_each" | "approve_after_draft" | "autonomous";

const policies: Array<{ value: ApprovalPolicy; title: string; description: string }> = [
  {
    value: "confirm_each",
    title: "Confirm every publish",
    description: "The safest choice. You review the final post and its channel settings immediately before it can publish.",
  },
  {
    value: "approve_after_draft",
    title: "Approve the prepared draft",
    description: "You approve the finished draft once. Post Social can then publish it at the time you selected.",
  },
  {
    value: "autonomous",
    title: "Fully autonomous",
    description: "Approved automations can create and publish without asking each time. Every action is still recorded.",
  },
];

export default function SettingsPage() {
  const workspace = useWorkspace();
  const accounts = useQuery(api.accounts.list, workspace.workspaceId ? { workspaceId: workspace.workspaceId } : "skip");
  const updateWorkspace = useMutation(api.workspaces.updateApprovalPolicy);
  const updateAccount = useMutation(api.accounts.updateApprovalPolicy);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const currentPolicy = workspace.approvalPolicy;
  const selected = useMemo(() => policies.find((policy) => policy.value === currentPolicy)!, [currentPolicy]);

  async function saveWorkspace(policy: ApprovalPolicy) {
    if (!workspace.workspaceId || workspace.mode !== "live") {
      setMessage("Sign in to save an approval rule for your workspace.");
      return;
    }
    setBusy("workspace");
    setMessage(null);
    try {
      await updateWorkspace({ workspaceId: workspace.workspaceId, policy });
      setMessage(`Saved: ${policies.find((item) => item.value === policy)?.title}.`);
    } catch (cause) {
      setMessage(friendlyErrorMessage(cause, "The approval rule could not be saved."));
    } finally {
      setBusy(null);
    }
  }

  async function saveAccount(accountId: string, value: string) {
    if (!workspace.workspaceId || workspace.mode !== "live") return;
    setBusy(accountId);
    setMessage(null);
    try {
      await updateAccount({
        workspaceId: workspace.workspaceId,
        accountId: accountId as Id<"connectedAccounts">,
        policy: value === "workspace_default" ? null : value as ApprovalPolicy,
      });
      setMessage("The channel-specific approval rule was saved.");
    } catch (cause) {
      setMessage(friendlyErrorMessage(cause, "The channel rule could not be saved."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-8 pb-10">
      <header className="stage-enter">
        <p className="utility-label text-accent">Post Social / Settings</p>
        <h1 className="mt-3 text-[clamp(1.9rem,2.8vw,2.75rem)] font-bold leading-[1.02] tracking-[-0.04em] text-ink">
          Approval control<span className="scanline-accent">.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-ink-muted">
          Decide when Post Social—or an AI assistant using it later—must stop and ask you before publishing.
        </p>
      </header>

      {message ? <div role="status" className="grooved-surface rounded-xl border border-accent/30 bg-accent-muted/40 p-4 text-sm text-ink">{message}</div> : null}

      <section className="grid gap-4 lg:grid-cols-3" aria-label="Workspace approval choices">
        {policies.map((policy) => {
          const active = currentPolicy === policy.value;
          return (
            <button
              key={policy.value}
              type="button"
              onClick={() => saveWorkspace(policy.value)}
              disabled={busy !== null}
              className={`grooved-surface min-h-56 rounded-xl border p-6 text-left transition hover:-translate-y-1 hover:border-accent disabled:cursor-wait disabled:opacity-60 ${active ? "border-accent bg-accent-muted/55" : "border-border bg-surface"}`}
            >
              <span className={`flex h-9 w-9 items-center justify-center rounded-lg border ${active ? "border-accent bg-accent text-canvas" : "border-border bg-surface-raised text-ink-subtle"}`}>
                {active ? <Check className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
              </span>
              <h2 className="mt-6 text-xl font-semibold text-ink">{policy.title}</h2>
              <p className="mt-3 text-sm leading-6 text-ink-muted">{policy.description}</p>
            </button>
          );
        })}
      </section>

      <Card>
        <CardHeader className="border-b border-border">
          <p className="utility-label text-ink-subtle">Channel overrides</p>
          <CardTitle className="mt-2">Use a different rule for one account</CardTitle>
          <p className="max-w-2xl text-sm leading-6 text-ink-muted">Most people can leave every account on the workspace default. An override is useful when one client or channel needs tighter review.</p>
        </CardHeader>
        <CardContent className="p-0">
          {workspace.mode === "demo" ? (
            <div className="p-6 text-sm text-ink-muted">Sign in to connect accounts and choose channel-specific rules. The sample workspace uses {selected.title.toLowerCase()}.</div>
          ) : accounts?.length ? (
            <ul className="divide-y divide-border">
              {accounts.filter((account) => account.health !== "disconnected").map((account) => (
                <li key={account._id} className="grid gap-4 p-5 md:grid-cols-[1fr_280px] md:items-center">
                  <div className="flex min-w-0 items-center gap-3">
                    <AccountAvatar platform={account.platform} src={account.avatarUrl} name={account.displayName} size="sm" />
                    <div className="min-w-0"><p className="truncate font-semibold text-ink">{account.displayName}</p><p className="text-xs text-ink-subtle">{platformLabel(account.platform)}</p></div>
                  </div>
                  <Select aria-label={`Approval rule for ${account.displayName}`} value={account.approvalPolicyOverride ?? "workspace_default"} disabled={busy !== null} onChange={(event) => saveAccount(account._id, event.target.value)}>
                    <option value="workspace_default">Use workspace default</option>
                    {policies.map((policy) => <option key={policy.value} value={policy.value}>{policy.title}</option>)}
                  </Select>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-6 text-sm text-ink-muted">Connect an account first, then it can inherit or override this workspace rule.</div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-end gap-3"><Button asChild variant="secondary"><Link href="/app/developers"><Code2 className="h-4 w-4" />Developer access</Link></Button><Button variant="secondary" onClick={() => window.location.assign("/app/accounts")}>Manage connected accounts</Button></div>
    </div>
  );
}
