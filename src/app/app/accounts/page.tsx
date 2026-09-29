"use client";

import { AlertCircle, CheckCircle2, RefreshCw, Trash2, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AccountAvatar } from "@/components/account-avatar";
import { demoAccounts, platformLabel } from "@/lib/demo";
import { ConnectedAccount } from "@/lib/types";
import { cn } from "@/lib/utils";
import { friendlyErrorMessage } from "@/lib/error-message";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";

function AccountRow({
  account,
  onReconnect,
  onDisconnect,
  busy,
}: {
  account: ConnectedAccount;
  onReconnect: () => void;
  onDisconnect: () => void;
  busy: boolean;
}) {
  const isConnected = account.health === "connected";
  const needsAttention = account.health === "needs_attention";

  return (
    <li className="flex flex-col gap-4 border-b border-border p-5 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4 min-w-0">
        <AccountAvatar
          platform={account.platform}
          src={account.avatarUrl}
          name={account.displayName}
          size="lg"
        />
        <div className="min-w-0">
          <p className="font-display text-lg font-semibold text-ink">
            {account.displayName}
          </p>
          <p className="text-sm text-ink-subtle">
            {platformLabel(account.platform)} · @{account.handle.replace(/^@/, "")}
          </p>
          <div className="mt-2 flex items-center gap-2">
            {isConnected ? (
              <Badge variant="success" className="gap-1">
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                Connected
              </Badge>
            ) : needsAttention ? (
              <Badge variant="warning" className="gap-1">
                <AlertCircle className="h-3 w-3" aria-hidden="true" />
                Needs attention
              </Badge>
            ) : (
              <Badge variant="default">Disconnected</Badge>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {needsAttention ? (
          <Button variant="primary" size="sm" onClick={onReconnect} disabled={busy}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Reconnect
          </Button>
        ) : isConnected ? (
          <Button variant="secondary" size="sm" onClick={onReconnect} disabled={busy}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Reconnect
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={onReconnect} disabled={busy}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Connect
          </Button>
        )}
        {isConnected || needsAttention ? (
          <Button variant="danger" size="sm" onClick={onDisconnect} disabled={busy}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Disconnect
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export default function AccountsPage() {
  const workspace = useWorkspace();
  const liveAccounts = useQuery(api.accounts.list, workspace.workspaceId ? { workspaceId: workspace.workspaceId } : "skip");
  const startTikTok = useAction(api.oauth.startTikTok);
  const startInstagram = useAction(api.oauth.startInstagram);
  const startFacebook = useAction(api.oauth.startFacebook);
  const startThreads = useAction(api.oauth.startThreads);
  const startYouTube = useAction(api.oauth.startYouTube);
  const disconnectAccount = useAction(api.accountLifecycle.disconnect);
  const [connecting, setConnecting] = useState<"tiktok" | "instagram" | "facebook" | "threads" | "youtube" | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [connectionMessage, setConnectionMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const accounts: ConnectedAccount[] = workspace.mode === "live" ? (liveAccounts ?? []).map(account => ({ id: account._id, platform: account.platform, handle: account.handle, displayName: account.displayName, avatarUrl: account.avatarUrl, health: account.health, healthReason: account.healthReason })) : demoAccounts;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const connected = params.get("connected");
      if (connected) {
        const label = connected === "tiktok" ? "TikTok" : connected === "instagram" ? "Instagram" : connected === "threads" ? "Threads" : connected === "youtube" ? "YouTube" : "Facebook Page";
        setConnectionMessage({ kind: "success", text: `${label} connected successfully.` });
      }
      const error = params.get("error");
      if (error) setConnectionMessage({ kind: "error", text: friendlyErrorMessage(error, "The connection could not be completed.") });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function connect(provider: "tiktok" | "instagram" | "facebook" | "threads" | "youtube") {
    if (!workspace.workspaceId) { window.location.href = "/login"; return; }
    setConnecting(provider); setConnectionMessage(null);
    try {
      window.location.href = provider === "tiktok"
        ? await startTikTok({ workspaceId: workspace.workspaceId })
        : provider === "instagram"
          ? await startInstagram({ workspaceId: workspace.workspaceId })
          : provider === "threads"
            ? await startThreads({ workspaceId: workspace.workspaceId })
            : provider === "youtube"
              ? await startYouTube({ workspaceId: workspace.workspaceId })
              : await startFacebook({ workspaceId: workspace.workspaceId });
    }
    catch (cause) { setConnectionMessage({ kind: "error", text: friendlyErrorMessage(cause, "The connection could not be started.") }); setConnecting(null); }
  }

  async function disconnect(account: ConnectedAccount) {
    if (!workspace.workspaceId || workspace.mode !== "live") return;
    const confirmed = window.confirm(`Disconnect ${account.displayName}? Any unpublished posts queued for this account will be cancelled.`);
    if (!confirmed) return;
    setDisconnecting(account.id);
    setConnectionMessage(null);
    try {
      await disconnectAccount({ workspaceId: workspace.workspaceId, accountId: account.id as Id<"connectedAccounts"> });
      setConnectionMessage({ kind: "success", text: `${account.displayName} was disconnected and its publishing access was removed.` });
    } catch (cause) {
      setConnectionMessage({ kind: "error", text: friendlyErrorMessage(cause, "The account could not be disconnected.") });
    } finally {
      setDisconnecting(null);
    }
  }
  return (
    <div className="space-y-8 pb-10">
      <div className="stage-enter flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="utility-label text-accent">Post Social / Connections</p>
          <h1 className="mt-3 text-[clamp(1.9rem,2.8vw,2.75rem)] font-bold leading-[1.02] tracking-[-0.04em] text-ink">
            Accounts<span className="scanline-accent">.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-ink-muted">
            Connect your accounts once. Know at a glance where you are ready to publish.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => connect("tiktok")} disabled={connecting !== null}><Plus className="h-4 w-4" aria-hidden="true" />{connecting === "tiktok" ? "Opening TikTok…" : "Connect TikTok"}</Button>
          <Button variant="primary" onClick={() => connect("instagram")} disabled={connecting !== null}><Plus className="h-4 w-4" aria-hidden="true" />{connecting === "instagram" ? "Opening Instagram…" : "Connect Instagram"}</Button>
          <Button variant="secondary" onClick={() => connect("facebook")} disabled={connecting !== null}><Plus className="h-4 w-4" aria-hidden="true" />{connecting === "facebook" ? "Opening Facebook…" : "Connect Facebook Page"}</Button>
          <Button variant="secondary" onClick={() => connect("threads")} disabled={connecting !== null}><Plus className="h-4 w-4" aria-hidden="true" />{connecting === "threads" ? "Opening Threads…" : "Connect Threads"}</Button>
          <Button variant="secondary" onClick={() => connect("youtube")} disabled={connecting !== null}><Plus className="h-4 w-4" aria-hidden="true" />{connecting === "youtube" ? "Opening YouTube…" : "Connect YouTube"}</Button>
        </div>
      </div>

      {connectionMessage && <div role={connectionMessage.kind === "error" ? "alert" : "status"} className={`grooved-surface rounded-xl border p-4 text-sm ${connectionMessage.kind === "error" ? "border-error/25 bg-error-bg text-error" : "border-success/25 bg-success-bg text-success"}`}>{connectionMessage.text}</div>}

      <div className="stage-enter-delayed rounded-2xl border border-warning/20 bg-warning-bg p-5 text-sm text-warning">
        <div className="flex items-start gap-2">
          <AlertCircle
            className="mt-0.5 h-4 w-4 shrink-0"
            aria-hidden="true"
          />
          <div>
            <p className="font-medium">Choose each channel separately</p>
            <p className="mt-1">
              Instagram requires a professional Business or Creator account, but
              it does not need to be linked to a Facebook Page. Facebook connects
              only the Pages where you have permission to create content.
            </p>
          </div>
        </div>
      </div>

      <Card className="overflow-hidden rounded-xl">
        <CardHeader>
          <CardTitle>Connected accounts</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ul>
            {accounts.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                onReconnect={() => connect(account.platform)}
                onDisconnect={() => disconnect(account)}
                busy={connecting !== null || disconnecting === account.id}
              />
            ))}
            {accounts.length === 0 && <li className="p-10 text-center"><p className="font-medium">No accounts connected yet.</p><p className="mt-2 text-sm text-ink-muted">Choose Connect account to add your first channel.</p></li>}
          </ul>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { platform: "tiktok", label: "TikTok", action: "Connect TikTok" },
          { platform: "instagram", label: "Instagram", action: "Connect Instagram" },
          { platform: "facebook", label: "Facebook Page", action: "Connect Facebook" },
          { platform: "threads", label: "Threads", action: "Connect Threads" },
          { platform: "youtube", label: "YouTube", action: "Connect YouTube" },
        ].map((item) => (
          <button
            key={item.platform}
            type="button"
            onClick={() => connect(item.platform as "tiktok" | "instagram" | "facebook" | "threads" | "youtube")}
            disabled={connecting !== null}
            className={cn(
              "group flex min-h-36 flex-col items-start justify-between gap-2 rounded-[1.5rem] border border-border bg-surface p-6 text-left transition-all hover:-translate-y-1 hover:border-accent hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
            )}
          >
            <span className="font-display text-2xl font-semibold text-ink">
              {item.label}
            </span>
            <span className="text-sm text-accent">{item.action}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
