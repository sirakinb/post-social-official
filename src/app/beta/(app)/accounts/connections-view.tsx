"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { ActorMark } from "@/components/beta/marks";
import { AccountMark } from "@/components/beta/avatar-img";
import { PlatformMark, Status } from "@/components/beta/ui";
import { cn } from "@/lib/utils";
import { createKey, revokeGrant, revokeKey } from "../keys/actions";
import { disconnect, startConnection } from "./actions";

export type SocialAccount = { id: string; platform: string; handle: string; name: string; avatarUrl: string | null; health: string; reason: string | null; postTypes: string[]; connectedAt: string; lastPostedAt: string | null };
export type AiApp = { id: string; name: string; label: string; mine: boolean; lastUsedAt: string | null; createdAt: string };
export type ApiKey = { id: string; name: string; prefix: string; mode: "live" | "test"; lastUsedAt: string | null; createdAt: string };

const PLATFORMS = [
  { id: "instagram", name: "Instagram", note: "Business or Creator" },
  { id: "facebook", name: "Facebook Page", note: "Pages you manage" },
  { id: "threads", name: "Threads", note: "Your profile" },
  { id: "youtube", name: "YouTube", note: "Shorts" },
  { id: "tiktok", name: "TikTok", note: "Your account" },
  { id: "linkedin", name: "LinkedIn", note: "Your profile" },
  { id: "bluesky", name: "Bluesky", note: "Your account" },
];
const KIND: Record<string, string> = { instagram: "Instagram", facebook: "Facebook Page", threads: "Threads", youtube: "YouTube channel", tiktok: "TikTok", linkedin: "LinkedIn", bluesky: "Bluesky" };

// "12 min ago" in the browser; plain dates on the server (it doesn't know the clock here).
const ago = (iso: string | null, now: number) => {
  if (!iso) return "never";
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (!now || minutes > 60 * 24 * 6) return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} d ago`;
};
const subscribe = () => () => {};

const btn = "inline-flex h-[30px] items-center rounded-lg border border-white/[0.12] px-3 text-xs hover:border-white/25 disabled:opacity-50";

export function ConnectionsView(props: {
  workspaceId: string;
  workspaceSlug: string;
  role: string;
  accounts: SocialAccount[];
  apps: AiApp[];
  keys: ApiKey[];
  loadError: boolean;
  notice: string | null;
  error: string | null;
  requested: string | null;
  mcpUrl: string;
  serverName: string;
}) {
  const router = useRouter();
  const now = useSyncExternalStore(subscribe, () => Math.floor(Date.now() / 60_000) * 60_000, () => 0);
  const canEdit = props.role !== "reviewer";
  const canManageKeys = props.role === "owner" || props.role === "admin";
  const requested = PLATFORMS.find((p) => p.id === props.requested);
  const [message, setMessage] = useState<{ kind: "error" | "notice"; text: string } | null>(
    props.error ? { kind: "error", text: props.error } : props.notice ? { kind: "notice", text: props.notice } : requested && canEdit ? { kind: "notice", text: `Your AI asked you to connect ${requested.name}. Press Connect on ${requested.name} below; you'll sign in on ${requested.name}'s own page.` } : null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [openApp, setOpenApp] = useState<string | null>(null);
  const [client, setClient] = useState<"claude" | "chatgpt" | "code" | "cli">("claude");
  const [keyForm, setKeyForm] = useState(false);
  const [newKey, setNewKey] = useState<{ name: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);

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

  async function onCreateKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("key");
    const r = await createKey(props.workspaceId, String(form.get("name") ?? ""), form.get("mode") === "test" ? "test" : "live");
    setBusy(null);
    if (!r.ok) return setMessage({ kind: "error", text: r.error });
    setKeyForm(false);
    setNewKey({ name: r.data.name, key: r.data.key });
    setCopied(false);
    router.refresh();
  }

  const snippets = {
    claude: { label: "Claude", help: "In Claude, open Settings → Connectors → Add custom connector and paste this address. Claude sends you here to approve it.", code: props.mcpUrl },
    chatgpt: { label: "ChatGPT", help: "In ChatGPT, turn on Developer mode (Settings → Apps & Connectors → Advanced), create a connector with this address, and sign in.", code: props.mcpUrl },
    code: { label: "Claude Code", help: "Run this, then type /mcp in Claude Code and choose Authenticate.", code: `claude mcp add --transport http ${props.serverName} ${props.mcpUrl}` },
    cli: { label: "CLI", help: "For scripts and terminals. JSON in, JSON out.", code: "npx postsocial login\nnpx postsocial list-social-accounts --pretty" },
  } as const;

  return (
    <div className="flex w-full max-w-[1100px] flex-col gap-7 px-8 pb-14 pt-5">
      <div>
        <h1 className="m-0 text-lg font-medium">Accounts &amp; AI</h1>
        <p className="mt-1 text-ps-muted">The social accounts Post Social posts to, and the AIs that do the posting.</p>
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
              <span className="ml-auto text-xs text-ps-subtle">X is coming soon</span>
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

      <section aria-labelledby="ai-h">
        <div className="mb-2.5 flex items-baseline justify-between">
          <h2 id="ai-h" className="m-0 text-sm font-medium">AI apps you signed in to</h2>
          <a href="#connect-ai" className="text-xs text-ps-plum-soft hover:text-ps-text">How to connect an AI</a>
        </div>
        <div className="rounded-xl border border-ps-line bg-ps-surface">
          {props.apps.length === 0 && <p className="m-0 px-4 py-6 text-center text-ps-muted">No AI apps yet. Connect Claude or ChatGPT below; they&apos;ll show up here.</p>}
          {props.apps.map((a) => (
            <div key={a.id} className="border-b border-white/[0.05] last:border-b-0">
              <button type="button" aria-expanded={openApp === a.id} onClick={() => setOpenApp(openApp === a.id ? null : a.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                <ActorMark kind="oauth_grant" name={a.name} size={28} />
                <span className="flex-1">{a.name}<span className="mt-0.5 block text-xs text-ps-subtle">Connected {ago(a.createdAt, now)} · last used {ago(a.lastUsedAt, now)}</span></span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6E6784" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className={cn("transition-transform", openApp === a.id && "rotate-90")}><path d="m9 6 6 6-6 6" /></svg>
              </button>
              {openApp === a.id && (
                <div className="flex flex-wrap gap-6 px-4 pb-4 pl-[60px]">
                  <ul className="m-0 flex-[1_1_260px] list-none space-y-1.5 p-0 text-ps-muted">
                    <li>✓ See your accounts, media and posts</li>
                    <li>✓ Upload media and write posts</li>
                    <li>✓ Publish and schedule when you ask it to</li>
                    <li className="text-ps-subtle">✕ Connect accounts or change settings</li>
                  </ul>
                  {(a.mine || canManageKeys) && (
                    confirming === a.id ? (
                      <button type="button" disabled={busy !== null} onClick={() => run(a.id, () => revokeGrant(a.id), `Disconnected ${a.name}. It can't use Post Social anymore.`)} className={cn(btn, "self-start border-ps-failed/40 text-[#FF8A8E]")}>Confirm disconnect</button>
                    ) : (
                      <button type="button" onClick={() => setConfirming(a.id)} className={cn(btn, "self-start text-[#FF8A8E]")}>Disconnect {a.name}</button>
                    )
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(360px,1fr))]">
        <section id="keys" aria-labelledby="keys-h">
          <div className="mb-2.5 flex items-baseline justify-between">
            <h2 id="keys-h" className="m-0 text-sm font-medium">API keys</h2>
            {canManageKeys && !keyForm && <button type="button" onClick={() => setKeyForm(true)} className="h-[30px] rounded-lg bg-ps-plum px-3 text-xs font-medium text-ps-ground hover:bg-[#AD86FF]">Create key</button>}
          </div>
          <div className="rounded-xl border border-ps-line bg-ps-surface">
            {newKey && (
              <div className="border-b border-white/[0.06] p-4">
                <p className="m-0 rounded-lg border border-ps-attention/30 bg-ps-attention/[0.07] px-3 py-2 text-xs text-[#F5D49A]">Copy your key for “{newKey.name}” now. You won&apos;t see it again.</p>
                <div className="mt-2.5 flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-lg border border-ps-line bg-ps-ground px-3 py-2 font-mono text-xs">{newKey.key}</code>
                  <button type="button" onClick={() => navigator.clipboard.writeText(newKey.key).then(() => setCopied(true))} className={btn}>{copied ? "Copied" : "Copy"}</button>
                </div>
                <button type="button" onClick={() => setNewKey(null)} className="mt-2.5 text-xs text-ps-subtle hover:text-ps-text">I&apos;ve saved it</button>
              </div>
            )}
            {keyForm && (
              <form onSubmit={onCreateKey} className="flex flex-wrap items-end gap-3 border-b border-white/[0.06] p-4">
                <label className="flex min-w-[180px] flex-1 flex-col gap-1.5">
                  <span className="text-xs text-ps-muted">Name</span>
                  <input name="name" required maxLength={80} placeholder="e.g. Content scripts" className="h-9 rounded-lg border border-ps-line-strong bg-ps-ground px-2.5 text-[13px]" />
                </label>
                <fieldset className="m-0 border-0 p-0">
                  <legend className="mb-1.5 text-xs text-ps-muted">Mode</legend>
                  <span className="flex gap-3">
                    <label className="flex items-center gap-1.5"><input type="radio" name="mode" value="live" defaultChecked className="accent-[#9B6CFF]" /> Live</label>
                    <label className="flex items-center gap-1.5"><input type="radio" name="mode" value="test" className="accent-[#9B6CFF]" /> Test</label>
                  </span>
                </fieldset>
                <button type="submit" disabled={busy === "key"} className="h-9 rounded-lg bg-ps-plum px-3.5 font-medium text-ps-ground disabled:opacity-60">{busy === "key" ? "Creating…" : "Create"}</button>
                <button type="button" onClick={() => setKeyForm(false)} className="h-9 px-2 text-ps-subtle hover:text-ps-text">Cancel</button>
              </form>
            )}
            {props.keys.length === 0 && !keyForm && <p className="m-0 px-4 py-5 text-center text-ps-muted">No keys. Most people don&apos;t need one: signing in from Claude or ChatGPT is easier.</p>}
            {props.keys.map((k) => (
              <div key={k.id} className="flex items-center gap-3 border-b border-white/[0.05] px-4 py-3">
                <ActorMark kind="api_key" name={k.name} size={26} />
                <span className="min-w-0 flex-1">{k.name}<span className="mt-0.5 block font-mono text-[11px] text-ps-subtle">{k.prefix}…</span></span>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px]", k.mode === "live" ? "bg-ps-live/[0.12] text-[#7FE6B1]" : "bg-white/[0.06] text-ps-muted")}>{k.mode === "live" ? "Live" : "Test"}</span>
                <span className="w-24 text-right text-xs text-ps-subtle">{k.lastUsedAt ? `Used ${ago(k.lastUsedAt, now)}` : "Never used"}</span>
                {canManageKeys &&
                  (confirming === k.id ? (
                    <button type="button" disabled={busy !== null} onClick={() => run(k.id, () => revokeKey(k.id), `Revoked “${k.name}”. It stops working right away.`)} className={cn(btn, "border-ps-failed/40 text-[#FF8A8E]")}>Confirm</button>
                  ) : (
                    <button type="button" onClick={() => setConfirming(k.id)} className="h-[30px] px-1.5 text-xs text-ps-subtle hover:text-ps-text">Revoke</button>
                  ))}
              </div>
            ))}
            <p className="m-0 px-4 py-3 text-xs text-ps-subtle">Test keys can do everything except publish. A key is shown once.</p>
          </div>
        </section>

        <section id="connect-ai" aria-labelledby="connect-h">
          <h2 id="connect-h" className="m-0 mb-2.5 text-sm font-medium">Connect an AI</h2>
          <div className="overflow-hidden rounded-xl border border-ps-line bg-ps-surface">
            <div role="tablist" aria-label="AI app" className="flex gap-0.5 border-b border-white/[0.06] px-2 pt-1.5">
              {(Object.keys(snippets) as Array<keyof typeof snippets>).map((id) => (
                <button key={id} type="button" role="tab" aria-selected={client === id} onClick={() => setClient(id)} className={cn("h-[34px] px-3 text-xs", client === id ? "text-ps-text shadow-[inset_0_-2px_0_#9B6CFF]" : "text-ps-muted hover:text-ps-text")}>{snippets[id].label}</button>
              ))}
            </div>
            <div className="flex flex-col gap-2.5 p-4">
              <p className="m-0 leading-relaxed text-ps-muted">{snippets[client].help}</p>
              <div className="relative">
                <pre className="m-0 whitespace-pre-wrap break-all rounded-lg border border-white/[0.08] bg-ps-ground py-3 pl-3.5 pr-11 font-mono text-xs leading-relaxed">{snippets[client].code}</pre>
                <button type="button" aria-label="Copy" onClick={() => navigator.clipboard.writeText(snippets[client].code)} className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-ps-surface text-ps-muted hover:text-ps-text">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
                </button>
              </div>
              <span className="text-xs text-ps-subtle">Everything your AI does shows in Activity with its name. <a href="/docs" className="text-ps-plum-soft hover:text-ps-text">Full setup guide</a></span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
