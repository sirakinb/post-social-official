// The activity feed: audit events turned into short sentences with a status. Read with the
// person's own session (row-level security).
import type { ActorKind } from "@/components/beta/marks";

type Client = Awaited<ReturnType<typeof import("@/lib/insforge/server").insforgeServerClient>>;

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
