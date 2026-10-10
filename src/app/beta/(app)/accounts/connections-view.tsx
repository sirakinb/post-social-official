"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { AccountMark } from "@/components/beta/avatar-img";
import { PlatformMark, Status } from "@/components/beta/ui";
import { ago, subscribe } from "@/lib/beta/ago";
import { cn } from "@/lib/utils";
import { disconnect, startConnection } from "./actions";

export type SocialAccount = { id: string; platform: string; handle: string; name: string; avatarUrl: string | null; health: string; reason: string | null; postTypes: string[]; connectedAt: string; lastPostedAt: string | null };

const PLATFORMS = [
  { id: "instagram", name: "Instagram", note: "Business or Creator" },
  { id: "facebook", name: "Facebook Page", note: "Pages you manage" },
  { id: "threads", name: "Threads", note: "Your profile" },
  { id: "youtube", name: "YouTube", note: "Shorts" },
  { id: "tiktok", name: "TikTok", note: "Your account" },
  { id: "linkedin", name: "LinkedIn", note: "Your profile" },
  { id: "bluesky", name: "Bluesky", note: "Your account" },
  { id: "x", name: "X", note: "Your account" },
];
const KIND: Record<string, string> = { instagram: "Instagram", facebook: "Facebook Page", threads: "Threads", youtube: "YouTube channel", tiktok: "TikTok", linkedin: "LinkedIn", bluesky: "Bluesky", x: "X" };


const btn = "inline-flex h-[30px] items-center rounded-lg border border-white/[0.12] px-3 text-xs hover:border-white/25 disabled:opacity-50";

export function ConnectionsView(props: {
  workspaceId: string;
  workspaceSlug: string;
  role: string;
  accounts: SocialAccount[];
  loadError: boolean;
  notice: string | null;
  error: string | null;
  requested: string | null;
}) {
  const router = useRouter();
  const now = useSyncExternalStore(subscribe, () => Math.floor(Date.now() / 60_000) * 60_000, () => 0);
  const canEdit = props.role !== "reviewer";
  const requested = PLATFORMS.find((p) => p.id === props.requested);
  const [message, setMessage] = useState<{ kind: "error" | "notice"; text: string } | null>(
    props.error ? { kind: "error", text: props.error } : props.notice ? { kind: "notice", text: props.notice } : requested && canEdit ? { kind: "notice", text: `Your AI asked you to connect ${requested.name}. Press Connect on ${requested.name} below; you'll sign in on ${requested.name}'s own page.` } : null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const [askHandle, setAskHandle] = useState(false);
  const [blueskyHandle, setBlueskyHandle] = useState("");
  const active = props.accounts.filter((a) => a.health !== "disconnected");
  const past = props.accounts.filter((a) => a.health === "disconnected");
  const attention = active.filter((a) => a.health === "needs_attention");

  async function connect(platform: string, handle?: string) {
    // Bluesky asks which account first: its sign-in starts on the account's own server.
    if (platform === "bluesky" && handle === undefined) return setAskHandle(true);
    setBusy(platform);
    setMessage(null);
    const r = await startConnection(props.workspaceId, props.workspaceSlug, platform, handle);
    if (!r.ok) {
      setBusy(null);
      return setMessage({ kind: "error", text: r.error });
    }
    window.location.assign(r.data.url);
  }

  async function run(id: string, action: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setBusy(id);
    setMessage(null);
    const r = await action();
    setBusy(null);
    setConfirming(null);
    setMessage(r.ok ? { kind: "notice", text: done } : { kind: "error", text: r.error ?? "That didn't work. Try again." });
    router.refresh();
  }



  return (
    <div className="flex w-full max-w-[1100px] flex-col gap-7 px-8 pb-14 pt-5">
      <div>
        <h1 className="m-0 text-lg font-medium">Accounts</h1>
        <p className="mt-1 text-ps-muted">The social accounts Post Social posts to.</p>
      </div>

      {message && <p role={message.kind === "error" ? "alert" : "status"} className={cn("m-0 rounded-[10px] border px-3.5 py-2.5", message.kind === "error" ? "border-ps-failed/30 bg-ps-failed/[0.08] text-[#FF8A8E]" : "border-ps-line bg-ps-surface text-ps-muted")}>{message.text}</p>}
      {attention.map((a) => (
        <div key={a.id} role="status" className="flex flex-wrap items-center gap-2.5 rounded-[10px] border border-ps-attention/30 bg-ps-attention/[0.07] px-3.5 py-2.5 text-[#F5D49A]">
          <span className="h-1.5 w-1.5 rounded-full bg-ps-attention" />
          <span className="flex-1">{a.name} on {KIND[a.platform]} needs to be reconnected{a.reason ? `: ${a.reason}` : "."}</span>
          {canEdit && <button type="button" disabled={busy !== null} onClick={() => connect(a.platform, a.platform === "bluesky" ? a.handle : undefined)} className={btn}>Reconnect</button>}
        </div>
      ))}

      <section aria-labelledby="social-h">
        <div className="mb-2.5 flex items-baseline justify-between">
          <h2 id="social-h" className="m-0 text-sm font-medium">Social accounts</h2>
          <span className="text-xs text-ps-subtle">{active.length} connected</span>
        </div>
        <div className="rounded-xl border border-ps-line bg-ps-surface">
          {props.loadError && <p role="alert" className="m-0 px-4 py-3 text-[#FF8A8E]">Your accounts could not be loaded. Refresh the page to try again.</p>}
          {active.length === 0 && !props.loadError && <p className="m-0 px-4 py-6 text-center text-ps-muted">No accounts yet. Connect one below.</p>}
          {active.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-3 border-b border-white/[0.05] px-4 py-3">
              <span className="relative">
                <AccountMark platform={a.platform} avatarUrl={a.avatarUrl} size={32} badge={16} />
              </span>
              <span className="min-w-[180px] flex-1">
                <span className="block">{a.name} <span className="text-ps-subtle">{a.platform === "youtube" || a.platform === "facebook" || a.platform === "linkedin" ? KIND[a.platform] : `@${a.handle} · ${KIND[a.platform]}`}</span></span>
                <span className="mt-0.5 block text-xs text-ps-subtle">{a.lastPostedAt ? `Last post ${ago(a.lastPostedAt, now)}` : `Connected ${ago(a.connectedAt, now)}`}{a.platform === "tiktok" ? " · AI posts go to your TikTok inbox" : ""}</span>
              </span>
              {a.health === "needs_attention" ? <Status tone="attention" label="Needs attention" /> : <Status tone="live" label="Connected" />}
              {canEdit &&
                (confirming === a.id ? (
                  <span className="flex gap-1.5">
                    <button type="button" disabled={busy !== null} onClick={() => run(a.id, () => disconnect(a.id), `Disconnected ${a.name}. Scheduled posts for it were cancelled.`)} className={cn(btn, "border-ps-failed/40 text-[#FF8A8E]")}>{busy === a.id ? "Disconnecting…" : "Confirm disconnect"}</button>
                    <button type="button" onClick={() => setConfirming(null)} className={btn}>Keep</button>
                  </span>
                ) : (
                  <span className="flex gap-1.5">
                    {a.health === "needs_attention" && <button type="button" disabled={busy !== null} onClick={() => connect(a.platform, a.platform === "bluesky" ? a.handle : undefined)} className={btn}>Reconnect</button>}
                    <button type="button" onClick={() => setConfirming(a.id)} className="h-[30px] rounded-lg px-2.5 text-xs text-ps-subtle hover:text-ps-text">Disconnect</button>
                  </span>
                ))}
            </div>
          ))}
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
              <span className="mr-1 text-ps-subtle">Connect</span>
              {PLATFORMS.map((p) => (
                <button key={p.id} type="button" disabled={busy !== null} onClick={() => connect(p.id)} className={cn(btn, "gap-2", requested?.id === p.id && "border-ps-plum text-ps-text")} title={p.note}>
                  <PlatformMark platform={p.id} size={16} className="rounded-[5px]" />
                  {busy === p.id ? "Opening…" : p.name}
                </button>
              ))}
            </div>
          )}
          {canEdit && askHandle && (
            <form
              className="flex flex-wrap items-center gap-2 border-t border-ps-line px-4 py-3"
              onSubmit={(e) => {
                e.preventDefault();
                void connect("bluesky", blueskyHandle);
              }}
            >
              <label htmlFor="bluesky-handle" className="text-ps-subtle">Bluesky handle</label>
              <input
                id="bluesky-handle"
                value={blueskyHandle}
                onChange={(e) => setBlueskyHandle(e.target.value)}
                placeholder="name.bsky.social"
                autoComplete="off"
                spellCheck={false}
                className="h-[30px] min-w-[200px] flex-1 rounded-lg border border-ps-line bg-transparent px-2.5 text-sm text-ps-text placeholder:text-ps-subtle"
              />
              <button type="submit" disabled={busy !== null} className={btn}>{busy === "bluesky" ? "Opening…" : "Continue to Bluesky"}</button>
              <button type="button" onClick={() => setAskHandle(false)} className="h-[30px] rounded-lg px-2.5 text-xs text-ps-subtle hover:text-ps-text">Cancel</button>
              <p className="m-0 w-full text-xs text-ps-subtle">You&apos;ll sign in on Bluesky&apos;s own page. Leave it empty if your account is on bsky.social and you&apos;d rather pick it there.</p>
            </form>
          )}
        </div>
        {past.length > 0 && <p className="mt-2 text-xs text-ps-subtle">Disconnected: {past.map((a) => a.name).join(", ")}. Connect again any time.</p>}
      </section>

    </div>
  );
}
