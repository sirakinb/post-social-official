// Everything Home shows: what's coming up, what needs attention, recent activity and
// first-run setup. Read with the person's own session (row-level security).
import type { ActorKind } from "@/components/beta/marks";
import { callServer, type Workspace } from "./workspace";

type Client = Awaited<ReturnType<typeof import("@/lib/insforge/server").insforgeServerClient>>;

export type PlatformId = "instagram" | "facebook" | "threads" | "youtube" | "tiktok" | "linkedin";
export type UpcomingPost = {
  id: string;
  caption: string;
  scheduledAt: string | null;
  status: string;
  thumb: { url: string | null; isVideo: boolean } | null;
  destinations: Array<{ platform: PlatformId; account: string }>;
};
export type Attention = { id: string; kind: "failed" | "account"; platform: PlatformId; title: string; detail: string; when: string; href: string };
export type ActivityRow = {
  id: string;
  at: string;
  actorId: string | null;
  actorKind: ActorKind;
  actorName: string;
  sentence: string;
  via: string;
  status: { label: string; tone: "live" | "scheduled" | "failed" | "attention" | "quiet" } | null;
};

const VIA: Record<string, string> = { mcp: "via MCP", api: "via the API", ui: "", worker: "", system: "" };

export function statusFor(eventType: string, summary: string): ActivityRow["status"] {
  switch (eventType) {
    case "destination.published":
      // TikTok inbox posts wait in the person's drafts until they post them in TikTok.
      return /TikTok drafts/i.test(summary) ? { label: "In drafts", tone: "attention" } : { label: "Live", tone: "live" };
    case "destination.failed":
    case "media.failed":
    case "account.refresh_failed":
      return { label: "Failed", tone: "failed" };
    case "post.submitted":
      return /^Scheduled/i.test(summary) ? { label: "Scheduled", tone: "scheduled" } : /approval/i.test(summary) ? { label: "Waiting", tone: "attention" } : { label: "Publishing", tone: "scheduled" };
    case "post.rescheduled":
      return { label: "Scheduled", tone: "scheduled" };
    case "post.created":
      return { label: "Draft", tone: "quiet" };
    case "account.connected":
    case "account.reconnected":
      return { label: "Connected", tone: "live" };
    case "media.ready":
      return { label: "Ready", tone: "live" };
    case "media.uploaded":
    case "media.import_requested":
      return { label: "Checking", tone: "quiet" };
    case "post.cancelled":
    case "account.disconnected":
    case "api_key.revoked":
    case "oauth_grant.revoked":
      return { label: "Ended", tone: "quiet" };
    default:
      return null;
  }
}

// "Created a draft for X" → "created a draft for X", so it reads after the actor's name.
export const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

export async function loadActivity(client: Client, workspaceId: string, opts: { limit: number; actorId?: string | null; before?: string | null }) {
  let query = client.database
    .from("audit_events")
    .select("id, occurred_at, event_type, entry_point, summary, actor_id, actors(kind, display_name, user_id)")
    .eq("workspace_id", workspaceId)
    .order("occurred_at", { ascending: false })
    .limit(opts.limit + 1);
  if (opts.actorId) query = query.eq("actor_id", opts.actorId);
  if (opts.before) query = query.lt("occurred_at", opts.before);
  const { data } = await query;
  const rows = (data ?? []) as unknown as Array<{ id: string; occurred_at: string; event_type: string; entry_point: string; summary: string; actor_id: string | null; actors: { kind: ActorKind; display_name: string; user_id: string | null } | null }>;
  const activity: ActivityRow[] = rows.slice(0, opts.limit).map((r) => ({
    id: r.id,
    at: r.occurred_at,
    actorId: r.actor_id,
    actorKind: r.actors?.kind ?? "system",
    actorName: r.actors ? r.actors.display_name : "Post Social",
    sentence: lowerFirst(r.summary),
    via: VIA[r.entry_point] ?? "",
    status: statusFor(r.event_type, r.summary),
  }));
  return { activity, hasMore: rows.length > opts.limit };
}

export async function loadHome(client: Client, workspace: Workspace) {
  const ws = workspace.id;
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const [upcomingRes, failedRes, accountsRes, keysRes, grantsRes, postCountRes, activityRes, actorsRes] = await Promise.all([
    client.database
      .from("posts")
      .select("id, caption, scheduled_at, status, created_at, destinations(platform, connected_accounts(display_name)), post_media(position, media_assets(id, media_type, status))")
      .eq("workspace_id", ws)
      .in("status", ["scheduled", "approved", "processing", "awaiting_approval"])
      .order("scheduled_at", { ascending: true, nullsFirst: true })
      .limit(5),
    client.database
      .from("destinations")
      .select("id, post_id, platform, error_message, updated_at, connected_accounts(display_name), posts(caption)")
      .eq("workspace_id", ws)
      .eq("status", "failed")
      .gte("updated_at", weekAgo)
      .order("updated_at", { ascending: false })
      .limit(5),
    client.database.from("connected_accounts").select("id, platform, display_name, health, health_reason, updated_at").eq("workspace_id", ws),
    client.database.from("api_keys").select("id").eq("workspace_id", ws).is("revoked_at", null),
    client.database.from("oauth_grants").select("id").eq("workspace_id", ws).is("revoked_at", null),
    client.database.from("posts").select("id").eq("workspace_id", ws).limit(1),
    loadActivity(client, ws, { limit: 12 }),
    client.database.from("actors").select("id, kind, display_name").eq("workspace_id", ws).in("kind", ["user", "api_key", "oauth_grant"]),
  ]);

  type UpRow = { id: string; caption: string; scheduled_at: string | null; status: string; destinations: Array<{ platform: PlatformId; connected_accounts: { display_name: string } | null }>; post_media: Array<{ position: number; media_assets: { id: string; media_type: string; status: string } | null }> };
  const upRows = (upcomingRes.data ?? []) as unknown as UpRow[];
  const firstMedia = upRows.map((p) => [...p.post_media].sort((a, b) => a.position - b.position)[0]?.media_assets ?? null);
  const readyIds = firstMedia.filter((m) => m && m.status === "ready").map((m) => m!.id);
  const linkSet = readyIds.length ? await callServer<{ links: Record<string, string>; posters: Record<string, string> }>("media_links", { workspace_id: ws, media_ids: readyIds }) : null;
  const links = linkSet?.links ?? {};
  const posters = linkSet?.posters ?? {};
  const upcoming: UpcomingPost[] = upRows.map((p, i) => ({
    id: p.id,
    caption: p.caption,
    scheduledAt: p.scheduled_at,
    status: p.status,
    thumb: firstMedia[i] ? { url: (firstMedia[i]!.media_type === "video" ? posters : links)[firstMedia[i]!.id] ?? null, isVideo: firstMedia[i]!.media_type === "video" } : null,
    destinations: p.destinations.map((d) => ({ platform: d.platform, account: d.connected_accounts?.display_name ?? "" })),
  }));

  const accounts = (accountsRes.data ?? []) as Array<{ id: string; platform: PlatformId; display_name: string; health: string; health_reason: string | null; updated_at: string }>;
  const failed = (failedRes.data ?? []) as unknown as Array<{ id: string; post_id: string; platform: PlatformId; error_message: string | null; updated_at: string; connected_accounts: { display_name: string } | null; posts: { caption: string } | null }>;
  const attention: Attention[] = [
    ...accounts
      .filter((a) => a.health === "needs_attention")
      .map((a) => ({ id: a.id, kind: "account" as const, platform: a.platform, title: `${a.display_name} needs to be reconnected`, detail: a.health_reason ?? "Its access ended. Reconnect it to keep posting.", when: a.updated_at, href: "/beta/accounts" })),
    ...failed.map((d) => ({
      id: d.id,
      kind: "failed" as const,
      platform: d.platform,
      title: `Post to ${d.connected_accounts?.display_name ?? "an account"} didn't publish`,
      detail: d.error_message ?? "The platform refused it.",
      when: d.updated_at,
      href: `/beta/activity`,
    })),
  ];

  const connected = accounts.filter((a) => a.health !== "disconnected").length;
  const aiConnections = (keysRes.data?.length ?? 0) + (grantsRes.data?.length ?? 0);
  const hasPosts = (postCountRes.data?.length ?? 0) > 0;
  const nextDay = Date.now() + 24 * 3600_000;
  const goingOut = upcoming.filter((p) => p.scheduledAt && Date.parse(p.scheduledAt) < nextDay).length;
  const aiNames = ((actorsRes.data ?? []) as Array<{ kind: ActorKind; display_name: string }>).filter((a) => a.kind === "oauth_grant").map((a) => a.display_name);

  return {
    upcoming,
    attention,
    activity: activityRes.activity,
    actors: ((actorsRes.data ?? []) as Array<{ id: string; kind: ActorKind; display_name: string }>),
    setup: { connected, aiConnections, hasPosts, done: connected > 0 && aiConnections > 0 && hasPosts },
    goingOut,
    aiNames: [...new Set(aiNames)],
  };
}
