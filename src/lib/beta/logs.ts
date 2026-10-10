// The logs page: every audit event with where it came from, whether it worked, and for
// failures the reason the platform or our worker gave. Read with the person's own session
// (row-level security).
import type { ActorKind } from "@/components/beta/marks";

type Client = Awaited<ReturnType<typeof import("@/lib/insforge/server").insforgeServerClient>>;

export const AREAS = {
  posts: { label: "Posts", prefixes: ["post.", "destination."] },
  accounts: { label: "Accounts", prefixes: ["account.", "profile."] },
  media: { label: "Media", prefixes: ["media."] },
  access: { label: "Keys & apps", prefixes: ["api_key.", "oauth_grant."] },
} as const;
export type Area = keyof typeof AREAS;

export const SOURCES = { ui: "Web app", api: "API", mcp: "MCP", worker: "Publisher", system: "System" } as const;
export type Source = keyof typeof SOURCES;

// Events that mean something went wrong, and ones worth a look.
export const ERROR_EVENTS = ["destination.failed", "media.failed", "account.refresh_failed"];
export const WARNING_EVENTS = ["account.deauthorized", "media.expired"];

export type LogStatus = { label: string; tone: "live" | "scheduled" | "failed" | "attention" | "quiet" } | null;

// A short status for events that have one ("Live", "Failed", "Scheduled").
export function statusFor(eventType: string, summary: string): LogStatus {
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

export type LogLevel = "error" | "warning" | "info";
export type LogRow = {
  id: string;
  at: string;
  level: LogLevel;
  eventType: string;
  area: Area | null;
  source: Source;
  actorKind: ActorKind;
  // The app's own name when an AI app did it ("Claude Code"), else the person's or key's.
  actorName: string;
  // The key or connection the app used, when that differs from the name shown.
  actorVia: string | null;
  summary: string;
  status: LogStatus;
  // For failures: the reason given, and its code when there is one.
  error: { code: string | null; message: string } | null;
  target: { platform: string; account: string; postId: string } | null;
  details: Record<string, unknown> | null;
};

export type LogFilters = { level: "all" | "errors"; area: Area | null; source: Source | null; actorId: string | null; before: string | null };

export function levelOf(eventType: string): LogLevel {
  return ERROR_EVENTS.includes(eventType) ? "error" : WARNING_EVENTS.includes(eventType) ? "warning" : "info";
}

export function areaOf(eventType: string): Area | null {
  for (const [area, { prefixes }] of Object.entries(AREAS)) if (prefixes.some((p) => eventType.startsWith(p))) return area as Area;
  return null;
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

// The reason a failure gives, from wherever the writer put it.
export function errorOf(eventType: string, after: Record<string, unknown> | null, metadata: Record<string, unknown> | null): LogRow["error"] {
  if (levelOf(eventType) === "info") return null;
  const message = text(after?.message) ?? text(after?.reason) ?? text(after?.error) ?? text(metadata?.message) ?? text(metadata?.error) ?? text(metadata?.reason);
  if (!message) return null;
  return { code: text(after?.code) ?? text(metadata?.code), message };
}

type EventRow = {
  id: string;
  occurred_at: string;
  event_type: string;
  entry_point: Source;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  before_values: Record<string, unknown> | null;
  after_values: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  actors: Actor | null;
};

type Actor = { kind: ActorKind; display_name: string; client_name?: string | null };

// Who to show for an event. Publishing steps run in our worker, so they are credited to
// whoever made the post (a person in the web app, or the AI app that sent it); events
// with no one behind them are Post Social's.
export function whoDid(actor: Actor | null, postedBy: Actor | null): Pick<LogRow, "actorKind" | "actorName" | "actorVia"> {
  const who = actor ?? postedBy;
  if (!who) return { actorKind: "system", actorName: "Post Social", actorVia: null };
  const app = who.kind === "user" ? null : who.client_name?.trim() || null;
  return { actorKind: who.kind, actorName: app ?? who.display_name, actorVia: app && app !== who.display_name ? who.display_name : null };
}

export async function loadLogs(client: Client, workspaceId: string, filters: LogFilters, limit = 50) {
  let query = client.database
    .from("audit_events")
    .select("id, occurred_at, event_type, entry_point, entity_type, entity_id, summary, before_values, after_values, metadata, actors(kind, display_name, client_name)")
    .eq("workspace_id", workspaceId)
    .order("occurred_at", { ascending: false })
    .limit(limit + 1);
  if (filters.level === "errors") query = query.in("event_type", [...ERROR_EVENTS, ...WARNING_EVENTS]);
  if (filters.area) query = query.or(AREAS[filters.area].prefixes.map((p) => `event_type.like.${p}*`).join(","));
  if (filters.source) query = query.eq("entry_point", filters.source);
  if (filters.actorId) query = query.eq("actor_id", filters.actorId);
  if (filters.before) query = query.lt("occurred_at", filters.before);
  const { data, error } = await query;
  const rows = ((data ?? []) as unknown as EventRow[]).slice(0, limit);

  // Which post and account each publishing event was about.
  const destinationIds = [...new Set(rows.filter((r) => r.entity_type === "destination" && r.entity_id).map((r) => r.entity_id!))];
  const targets = new Map<string, NonNullable<LogRow["target"]>>();
  const postedBy = new Map<string, Actor>();
  if (destinationIds.length) {
    const { data: destinations } = await client.database
      .from("destinations")
      .select("id, platform, post_id, connected_accounts(display_name), actors!destinations_actor_id_fkey(kind, display_name, client_name)")
      .in("id", destinationIds);
    for (const d of (destinations ?? []) as unknown as Array<{ id: string; platform: string; post_id: string; connected_accounts: { display_name: string } | null; actors: Actor | null }>) {
      targets.set(d.id, { platform: d.platform, account: d.connected_accounts?.display_name ?? "", postId: d.post_id });
      if (d.actors) postedBy.set(d.id, d.actors);
    }
  }

  const logs: LogRow[] = rows.map((r) => {
    const details = { ...(r.before_values ? { before: r.before_values } : {}), ...(r.after_values ? { after: r.after_values } : {}), ...(r.metadata ? { metadata: r.metadata } : {}) };
    return {
      id: r.id,
      at: r.occurred_at,
      level: levelOf(r.event_type),
      eventType: r.event_type,
      area: areaOf(r.event_type),
      source: r.entry_point,
      ...whoDid(r.actors, r.entity_type === "destination" && r.entity_id ? (postedBy.get(r.entity_id) ?? null) : null),
      summary: r.summary,
      status: statusFor(r.event_type, r.summary),
      error: errorOf(r.event_type, r.after_values, r.metadata),
      target: r.entity_id ? (targets.get(r.entity_id) ?? null) : null,
      details: Object.keys(details).length ? details : null,
    };
  });
  return { logs, hasMore: (data ?? []).length > limit, failed: Boolean(error) };
}
