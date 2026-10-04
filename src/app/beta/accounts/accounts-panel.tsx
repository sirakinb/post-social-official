"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AccountAvatar } from "@/components/account-avatar";
import { PlatformCardIcon } from "@/components/platform-logos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Platform } from "@/lib/types";
import { disconnect, startConnection } from "./actions";

export type ConnectedAccount = {
  id: string;
  platform: string;
  handle: string;
  displayName: string;
  avatarUrl?: string;
  health: string;
  healthReason: string | null;
  postTypes: string[];
};

const PLATFORMS: Array<{ id: "instagram" | "facebook" | "threads" | "youtube" | "tiktok"; name: string; note: string }> = [
  { id: "instagram", name: "Instagram", note: "Business or Creator account" },
  { id: "facebook", name: "Facebook Pages", note: "Pages you manage" },
  { id: "threads", name: "Threads", note: "Your Threads profile" },
  { id: "youtube", name: "YouTube", note: "Shorts on your channel" },
  { id: "tiktok", name: "TikTok", note: "Your TikTok account" },
];

const HEALTH: Record<string, { label: string; variant: "success" | "warning" | "default" }> = {
  connected: { label: "Connected", variant: "success" },
  needs_attention: { label: "Needs attention", variant: "warning" },
  disconnected: { label: "Disconnected", variant: "default" },
};

export function AccountsPanel(props: {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  canEdit: boolean;
  accounts: ConnectedAccount[];
  loadError: boolean;
  notice: string | null;
  error: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "notice"; text: string } | null>(
    props.error ? { kind: "error", text: props.error } : props.notice ? { kind: "notice", text: props.notice } : null,
  );
  const [confirming, setConfirming] = useState<string | null>(null);

  async function connect(platform: string) {
    setBusy(platform);
    setMessage(null);
    const result = await startConnection(props.workspaceId, props.workspaceSlug, platform);
    if (!result.ok) {
      setBusy(null);
      return setMessage({ kind: "error", text: result.error });
    }
    window.location.assign(result.data.url);
  }

  async function remove(account: ConnectedAccount) {
    setBusy(account.id);
    setMessage(null);
    const result = await disconnect(account.id);
    setBusy(null);
    setConfirming(null);
    if (!result.ok) return setMessage({ kind: "error", text: result.error });
    const cancelled = result.data.cancelled_destinations;
    setMessage({
      kind: "notice",
      text: `Disconnected ${account.displayName}.${cancelled ? ` ${cancelled} scheduled or pending post${cancelled === 1 ? " was" : "s were"} cancelled for this account.` : ""}`,
    });
    router.refresh();
  }

  const active = props.accounts.filter((a) => a.health !== "disconnected");
  const past = props.accounts.filter((a) => a.health === "disconnected");

  return (
    <div>
      <p className="utility-label text-accent">{props.workspaceName} / Accounts</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-ink">Connected accounts</h1>
      <p className="mt-1 text-sm text-ink-muted">Connect the social accounts Post Social can post to. You sign in on each platform&apos;s own page; Post Social never sees your passwords.</p>

      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={`mt-6 rounded-lg border p-3 text-sm ${message.kind === "error" ? "border-error/20 bg-error-bg text-error" : "border-border bg-canvas-ivory text-ink"}`}>
          {message.text}
        </p>
      )}

      {props.canEdit && (
        <section className="mt-8" aria-label="Connect an account">
          <h2 className="text-sm font-semibold text-ink">Connect an account</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PLATFORMS.map((platform) => (
              <li key={platform.id} className="grooved-surface flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4">
                <div className="flex items-center gap-3">
                  <PlatformCardIcon platform={platform.id} size="sm" />
                  <div>
                    <p className="text-sm font-medium text-ink">{platform.name}</p>
                    <p className="text-xs text-ink-subtle">{platform.note}</p>
                  </div>
                </div>
                <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => connect(platform.id)}>
                  {busy === platform.id ? "Opening…" : "Connect"}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-sm font-semibold text-ink">Your accounts</h2>
        {props.loadError ? (
          <p role="alert" className="mt-3 text-sm text-error">Your accounts could not be loaded. Refresh the page to try again.</p>
        ) : active.length === 0 ? (
          <p className="mt-3 rounded-xl border border-border bg-surface p-8 text-center text-sm text-ink-muted">No accounts connected yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">
            {active.map((account) => {
              const health = HEALTH[account.health] ?? HEALTH.connected;
              return (
                <li key={account.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <AccountAvatar platform={account.platform as Platform} src={account.avatarUrl} name={account.displayName} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{account.displayName}</p>
                      <p className="truncate text-xs text-ink-subtle">
                        {account.handle !== account.displayName ? `@${account.handle} · ` : ""}
                        {account.postTypes.join(", ")}
                      </p>
                      {account.healthReason && account.health === "needs_attention" && <p className="mt-1 text-xs text-warning">{account.healthReason}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={health.variant}>{health.label}</Badge>
                    {props.canEdit && account.health === "needs_attention" && (
                      <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => connect(account.platform)}>Reconnect</Button>
                    )}
                    {props.canEdit &&
                      (confirming === account.id ? (
                        <>
                          <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => remove(account)}>
                            {busy === account.id ? "Disconnecting…" : "Confirm disconnect"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Keep</Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setConfirming(account.id)}>Disconnect</Button>
                      ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {past.length > 0 && (
          <p className="mt-3 text-xs text-ink-subtle">
            {past.length} disconnected account{past.length === 1 ? "" : "s"}: {past.map((a) => a.displayName).join(", ")}. Connect again any time.
          </p>
        )}
      </section>
    </div>
  );
}
