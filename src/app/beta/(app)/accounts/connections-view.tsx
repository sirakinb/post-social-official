"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { AccountMark } from "@/components/beta/avatar-img";
import { PlatformMark, Status } from "@/components/beta/ui";
import { ago, subscribe } from "@/lib/beta/ago";
import { cn } from "@/lib/utils";
import { createProfile, deleteProfile, disconnect, moveAccount, startConnection, updateProfile, type ProfileInput } from "./actions";
import { ProfileDialog, type Profile } from "./profile-dialog";

export type { Profile };
export type SocialAccount = { id: string; platform: string; handle: string; name: string; avatarUrl: string | null; health: string; reason: string | null; postTypes: string[]; connectedAt: string; lastPostedAt: string | null; profileId: string | null };

// The filter: every account, one profile, or the accounts in no profile.
type Filter = "all" | "none" | string;

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
  profiles: Profile[];
  profilesReady: boolean; // false until the profiles migration is applied here
  filter: string | null;
  connectProfile: string | null;
  loadError: boolean;
  notice: string | null;
  error: string | null;
  requested: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "/beta/accounts";
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

  const profileById = new Map(props.profiles.map((p) => [p.id, p]));
  const filter: Filter = props.filter === "none" || (props.filter && profileById.has(props.filter)) ? props.filter : "all";
  const [editing, setEditing] = useState<Profile | "new" | null>(null);
  // Where the next connection goes: the profile being viewed, or one an AI's link named.
  const [target, setTarget] = useState<string>(props.connectProfile && profileById.has(props.connectProfile) ? props.connectProfile : filter !== "all" && filter !== "none" ? filter : "");
  const countIn = (id: string | null) => active.filter((a) => a.profileId === id).length;
  const groups: Array<{ profile: Profile | null; accounts: SocialAccount[] }> =
    filter === "all"
      ? [...props.profiles.map((p) => ({ profile: p, accounts: active.filter((a) => a.profileId === p.id) })), { profile: null, accounts: active.filter((a) => !a.profileId || !profileById.has(a.profileId)) }].filter((g) => g.profile || g.accounts.length || !props.profiles.length)
      : filter === "none"
        ? [{ profile: null, accounts: active.filter((a) => !a.profileId || !profileById.has(a.profileId)) }]
        : [{ profile: profileById.get(filter)!, accounts: active.filter((a) => a.profileId === filter) }];

  function setFilter(next: Filter) {
    const url = new URL(window.location.href);
    if (next === "all") url.searchParams.delete("profile");
    else url.searchParams.set("profile", next);
    if (next !== "all" && next !== "none") setTarget(next);
    router.replace(`${pathname}${url.search}`, { scroll: false });
  }

  async function saveProfile(input: ProfileInput) {
    const r = editing && editing !== "new" ? await updateProfile(editing.id, input) : await createProfile(props.workspaceId, input);
    if (!r.ok) return r.error;
    setEditing(null);
    setMessage({ kind: "notice", text: editing === "new" ? `Created ${input.name.trim()}. Connect accounts to it, or move existing ones in.` : `Saved ${input.name.trim()}.` });
    if (editing === "new") {
      setTarget(r.data.profile.id);
      setFilter(r.data.profile.id);
    }
    router.refresh();
    return null;
  }

  async function removeProfile(profile: Profile) {
    const r = await deleteProfile(profile.id);
    if (!r.ok) return r.error;
    setEditing(null);
    setMessage({ kind: "notice", text: `Deleted ${profile.name}. Its accounts are still connected, under No profile.` });
    if (target === profile.id) setTarget("");
    setFilter("all");
    router.refresh();
    return null;
  }

  async function connect(platform: string, handle?: string) {
    // Bluesky asks which account first: its sign-in starts on the account's own server.
    if (platform === "bluesky" && handle === undefined) return setAskHandle(true);
    setBusy(platform);
    setMessage(null);
    const r = await startConnection(props.workspaceId, props.workspaceSlug, platform, handle, target || null);
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



  const row = (a: SocialAccount) => (
    <div key={a.id} className="flex flex-wrap items-center gap-3 border-b border-white/[0.05] px-4 py-3 last:border-b-0">
      <span className="relative">
        <AccountMark platform={a.platform} avatarUrl={a.avatarUrl} size={32} badge={16} />
      </span>
      <span className="min-w-[180px] flex-1">
        <span className="block">{a.name} <span className="text-ps-subtle">{a.platform === "youtube" || a.platform === "facebook" || a.platform === "linkedin" ? KIND[a.platform] : `@${a.handle} · ${KIND[a.platform]}`}</span></span>
        <span className="mt-0.5 block text-xs text-ps-subtle">{a.lastPostedAt ? `Last post ${ago(a.lastPostedAt, now)}` : `Connected ${ago(a.connectedAt, now)}`}{a.platform === "tiktok" ? " · AI posts go to your TikTok inbox" : ""}</span>
      </span>
      {a.health === "needs_attention" ? <Status tone="attention" label="Needs attention" /> : <Status tone="live" label="Connected" />}
      {canEdit && props.profilesReady && props.profiles.length > 0 && (
        <label className="flex items-center">
          <span className="sr-only">Profile for {a.name}</span>
          <select
            value={a.profileId && profileById.has(a.profileId) ? a.profileId : ""}
            disabled={busy !== null}
            onChange={(e) => run(a.id, () => moveAccount(a.id, e.target.value || null), e.target.value ? `Moved ${a.name} to ${profileById.get(e.target.value)?.name}.` : `Took ${a.name} out of its profile.`)}
            className="h-[30px] max-w-[160px] rounded-lg border border-white/[0.12] bg-transparent px-2 text-xs text-ps-muted [color-scheme:dark] hover:border-white/25"
          >
            <option value="">No profile</option>
            {props.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}
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
  );

  const pill = (id: Filter, label: string, count: number, color?: string) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={filter === id}
      onClick={() => setFilter(id)}
      className={cn("inline-flex h-[30px] flex-none items-center gap-2 rounded-lg border px-3 text-xs", filter === id ? "border-ps-plum/60 bg-ps-plum/[0.14] text-ps-text" : "border-white/[0.08] text-ps-muted hover:border-white/20 hover:text-ps-text")}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />}
      {label}
      <span className="font-mono text-[11px] text-ps-subtle">{count}</span>
    </button>
  );

  return (
    <div className="flex w-full max-w-[1100px] flex-col gap-6 px-8 pb-14 pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="m-0 text-lg font-medium">Accounts</h1>
          <p className="mt-1 text-ps-muted">The social accounts Post Social posts to, grouped by profile.</p>
        </div>
        {canEdit && props.profilesReady && <button type="button" onClick={() => setEditing("new")} className={btn}>New profile</button>}
      </div>

      {message && <p role={message.kind === "error" ? "alert" : "status"} className={cn("m-0 rounded-[10px] border px-3.5 py-2.5", message.kind === "error" ? "border-ps-failed/30 bg-ps-failed/[0.08] text-[#FF8A8E]" : "border-ps-line bg-ps-surface text-ps-muted")}>{message.text}</p>}
      {attention.map((a) => (
        <div key={a.id} role="status" className="flex flex-wrap items-center gap-2.5 rounded-[10px] border border-ps-attention/30 bg-ps-attention/[0.07] px-3.5 py-2.5 text-[#F5D49A]">
          <span className="h-1.5 w-1.5 rounded-full bg-ps-attention" />
          <span className="flex-1">{a.name} on {KIND[a.platform]} needs to be reconnected{a.reason ? `: ${a.reason}` : "."}</span>
          {canEdit && <button type="button" disabled={busy !== null} onClick={() => connect(a.platform, a.platform === "bluesky" ? a.handle : undefined)} className={btn}>Reconnect</button>}
        </div>
      ))}

      {props.profiles.length > 0 && (
        <div role="tablist" aria-label="Profiles" className="-mb-2 flex gap-2 overflow-x-auto pb-1">
          {pill("all", "All accounts", active.length)}
          {props.profiles.map((p) => pill(p.id, p.name, countIn(p.id), p.color))}
          {pill("none", "No profile", active.filter((a) => !a.profileId || !profileById.has(a.profileId)).length)}
        </div>
      )}

      {props.loadError && <p role="alert" className="m-0 rounded-xl border border-ps-line bg-ps-surface px-4 py-3 text-[#FF8A8E]">Your accounts could not be loaded. Refresh the page to try again.</p>}

      {groups.map(({ profile, accounts }) => (
        <section key={profile?.id ?? "none"} aria-label={profile?.name ?? "No profile"}>
          {(props.profiles.length > 0 || profile) && (
            <div className="mb-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ backgroundColor: profile?.color ?? "#6E6784" }} />
              <h2 className="m-0 text-sm font-medium">{profile?.name ?? "No profile"}</h2>
              {profile?.description && <span className="min-w-0 truncate text-xs text-ps-subtle">{profile.description}</span>}
              <span className="flex-1" />
              {profile?.timezone && <span className="font-mono text-[11px] text-ps-subtle">{profile.timezone.replace(/_/g, " ")}</span>}
              <span className="text-xs text-ps-subtle">{accounts.length} connected</span>
              {profile && canEdit && <button type="button" onClick={() => setEditing(profile)} className="h-[26px] rounded-md px-2 text-xs text-ps-subtle hover:bg-white/[0.04] hover:text-ps-text">Edit</button>}
            </div>
          )}
          <div className="rounded-xl border border-ps-line bg-ps-surface">
            {accounts.length === 0 && !props.loadError && (
              <p className="m-0 px-4 py-6 text-center text-ps-muted">
                {profile ? `No accounts in ${profile.name} yet. Connect one below, or move one here from another profile.` : props.profiles.length ? "Every account is in a profile." : "No accounts yet. Connect one below."}
              </p>
            )}
            {accounts.map(row)}
          </div>
        </section>
      ))}

      {props.profilesReady && props.profiles.length === 0 && canEdit && active.length > 0 && (
        <p className="m-0 -mt-3 text-xs text-ps-subtle">Managing more than one brand or client? <button type="button" onClick={() => setEditing("new")} className="text-ps-plum-soft hover:text-ps-text">Create a profile</button> for each and group their accounts.</p>
      )}

      {canEdit && (
        <section aria-labelledby="connect-h" className="rounded-xl border border-ps-line bg-ps-surface">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/[0.05] px-4 py-3">
            <h2 id="connect-h" className="m-0 text-sm font-medium">Connect an account</h2>
            <span className="flex-1" />
            {props.profilesReady && props.profiles.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-ps-subtle">
                Add to
                <select value={target} onChange={(e) => setTarget(e.target.value)} className="h-[30px] rounded-lg border border-white/[0.12] bg-transparent px-2 text-xs text-ps-text [color-scheme:dark]">
                  <option value="">No profile</option>
                  {props.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            {PLATFORMS.map((p) => (
              <button key={p.id} type="button" disabled={busy !== null} onClick={() => connect(p.id)} className={cn(btn, "gap-2", requested?.id === p.id && "border-ps-plum text-ps-text")} title={p.note}>
                <PlatformMark platform={p.id} size={16} className="rounded-[5px]" />
                {busy === p.id ? "Opening…" : p.name}
              </button>
            ))}
          </div>
          {askHandle && (
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
        </section>
      )}
      {past.length > 0 && <p className="-mt-3 text-xs text-ps-subtle">Disconnected: {past.map((a) => a.name).join(", ")}. Connect again any time.</p>}

      {editing && (
        <ProfileDialog
          profile={editing === "new" ? null : editing}
          accountCount={editing === "new" ? 0 : countIn(editing.id)}
          onSave={saveProfile}
          onDelete={editing === "new" ? undefined : () => removeProfile(editing)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
