// Usage for a workspace over a period, with the plan's limits, broken down by social
// account, by who did it (the person, each API key, each signed-in app) and by day. One
// report backs the web app's usage page, the REST API and the MCP tool, so every pricing
// experiment reads the same numbers. Periods are in UTC.
import { ApiError, membership, requireUuid, type Caller, type Sql } from "./access";

export const PERIODS = ["this_month", "last_month", "last_7_days", "last_30_days", "today"] as const;
export type Period = (typeof PERIODS)[number];

const DAY = 24 * 3600_000;

export function periodRange(period: string | undefined, now = new Date()): { name: Period; start: Date; end: Date } {
  const name = (period || "this_month") as Period;
  if (!PERIODS.includes(name)) throw new ApiError(400, `period must be one of: ${PERIODS.join(", ")}.`);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  switch (name) {
    case "this_month":
      return { name, start: new Date(monthStart), end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) };
    case "last_month":
      return { name, start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)), end: new Date(monthStart) };
    case "last_7_days":
      return { name, start: new Date(today - 6 * DAY), end: new Date(today + DAY) };
    case "last_30_days":
      return { name, start: new Date(today - 29 * DAY), end: new Date(today + DAY) };
    case "today":
      return { name, start: new Date(today), end: new Date(today + DAY) };
  }
}

const KIND_LABEL: Record<string, string> = { user: "Person", api_key: "API key", oauth_grant: "Signed-in app", system: "Post Social" };
const n = (value: unknown) => Number(value ?? 0);

export async function usageReport(sql: Sql, caller: Caller, input: { workspace_id?: unknown; period?: unknown }) {
  const workspaceId = requireUuid(input.workspace_id, "Workspace");
  await membership(sql, caller, workspaceId, false);
  const { name, start, end } = periodRange(typeof input.period === "string" ? input.period : undefined);
  const range = [workspaceId, start.toISOString(), end.toISOString()];

  const [plan] = await sql<{ id: string; name: string; max_connected_accounts: number; max_posts_per_month: number; max_media_storage_bytes: string; max_api_calls_per_day: number }>(
    `SELECT p.* FROM public.plans p
     WHERE p.id = coalesce((SELECT plan_id FROM public.workspace_plans WHERE workspace_id = $1), 'tester')`,
    [workspaceId],
  );

  // Totals for the period, plus the live amounts the plan limits are measured against.
  const [totals] = await sql<Record<string, string>>(
    `SELECT
       (SELECT coalesce(sum(quantity), 0) FROM public.usage_events WHERE workspace_id = $1 AND event_type = 'post_published' AND occurred_at >= $2 AND occurred_at < $3) AS posts_published,
       (SELECT coalesce(sum(quantity), 0) FROM public.usage_events WHERE workspace_id = $1 AND event_type = 'api_call' AND occurred_at >= $2 AND occurred_at < $3) AS api_calls,
       (SELECT count(*) FROM public.posts WHERE workspace_id = $1 AND created_at >= $2 AND created_at < $3) AS posts_created,
       (SELECT count(*) FROM public.posts WHERE workspace_id = $1 AND entry_point IN ('api', 'mcp') AND created_at >= $2 AND created_at < $3) AS posts_created_by_ai,
       (SELECT count(*) FROM public.destinations WHERE workspace_id = $1 AND status = 'failed' AND updated_at >= $2 AND updated_at < $3) AS publishes_failed,
       (SELECT coalesce(sum(quantity), 0) FROM public.usage_events WHERE workspace_id = $1 AND event_type = 'post_published' AND occurred_at >= date_trunc('month', now())) AS posts_this_month,
       (SELECT coalesce(sum(quantity), 0) FROM public.usage_events WHERE workspace_id = $1 AND event_type = 'api_call' AND occurred_at >= date_trunc('day', now())) AS api_calls_today,
       (SELECT coalesce(sum(size_bytes), 0) FROM public.media_assets WHERE workspace_id = $1 AND status IN ('uploading', 'processing', 'ready')) AS storage_bytes,
       (SELECT count(*) FROM public.connected_accounts WHERE workspace_id = $1 AND health <> 'disconnected') AS connected_accounts`,
    range,
  );

  const byAccount = await sql<Record<string, unknown>>(
    `SELECT a.id AS account_id, a.platform, a.display_name AS account, a.health,
            coalesce(sum(u.quantity) FILTER (WHERE u.event_type = 'post_published'), 0) AS posts_published,
            (SELECT count(*) FROM public.destinations d WHERE d.connected_account_id = a.id AND d.status = 'failed' AND d.updated_at >= $2 AND d.updated_at < $3) AS publishes_failed
     FROM public.connected_accounts a
     LEFT JOIN public.usage_events u ON u.connected_account_id = a.id AND u.occurred_at >= $2 AND u.occurred_at < $3
     WHERE a.workspace_id = $1
     GROUP BY a.id
     HAVING a.health <> 'disconnected' OR coalesce(sum(u.quantity), 0) > 0
     ORDER BY posts_published DESC, a.platform, a.display_name`,
    range,
  );

  const byConnection = await sql<Record<string, unknown>>(
    `WITH calls AS (
       SELECT actor_id, sum(quantity) FILTER (WHERE event_type = 'api_call') AS api_calls,
              sum(quantity) FILTER (WHERE event_type = 'post_published') AS posts_published
       FROM public.usage_events WHERE workspace_id = $1 AND occurred_at >= $2 AND occurred_at < $3 AND actor_id IS NOT NULL
       GROUP BY actor_id
     ), created AS (
       SELECT actor_id, count(*) AS posts_created FROM public.posts
       WHERE workspace_id = $1 AND created_at >= $2 AND created_at < $3 AND actor_id IS NOT NULL
       GROUP BY actor_id
     )
     SELECT a.id AS actor_id, a.kind, a.display_name AS name,
            coalesce(calls.api_calls, 0) AS api_calls, coalesce(calls.posts_published, 0) AS posts_published,
            coalesce(created.posts_created, 0) AS posts_created,
            coalesce(k.revoked_at, g.revoked_at) AS revoked_at, k.mode AS key_mode
     FROM public.actors a
     LEFT JOIN calls ON calls.actor_id = a.id
     LEFT JOIN created ON created.actor_id = a.id
     LEFT JOIN public.api_keys k ON k.id = a.api_key_id
     LEFT JOIN public.oauth_grants g ON g.id = a.oauth_grant_id
     WHERE a.workspace_id = $1 AND (calls.actor_id IS NOT NULL OR created.actor_id IS NOT NULL)
     ORDER BY coalesce(calls.api_calls, 0) + coalesce(created.posts_created, 0) DESC, a.display_name`,
    range,
  );

  const daily = await sql<{ day: string; posts_published: string; api_calls: string }>(
    `SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
            coalesce(sum(u.quantity) FILTER (WHERE u.event_type = 'post_published'), 0) AS posts_published,
            coalesce(sum(u.quantity) FILTER (WHERE u.event_type = 'api_call'), 0) AS api_calls
     FROM generate_series($2::timestamptz, $3::timestamptz - interval '1 day', interval '1 day') AS d(day)
     LEFT JOIN public.usage_events u ON u.workspace_id = $1 AND u.occurred_at >= d.day AND u.occurred_at < d.day + interval '1 day'
     GROUP BY d.day ORDER BY d.day`,
    range,
  );

  const limit = (used: number, allowed: number, unit: string) => ({ used, limit: allowed, unit, percent: allowed > 0 ? Math.round((used / allowed) * 1000) / 10 : null });

  return {
    period: { name, start: start.toISOString(), end: end.toISOString(), timezone: "UTC" },
    plan: {
      id: plan.id,
      name: plan.name,
      limits: {
        posts_per_month: limit(n(totals.posts_this_month), plan.max_posts_per_month, "published posts this month"),
        api_calls_per_day: limit(n(totals.api_calls_today), plan.max_api_calls_per_day, "API calls today"),
        media_storage_bytes: limit(n(totals.storage_bytes), n(plan.max_media_storage_bytes), "bytes stored"),
        connected_accounts: limit(n(totals.connected_accounts), plan.max_connected_accounts, "connected accounts"),
      },
    },
    totals: {
      posts_published: n(totals.posts_published),
      publishes_failed: n(totals.publishes_failed),
      posts_created: n(totals.posts_created),
      posts_created_by_ai: n(totals.posts_created_by_ai),
      api_calls: n(totals.api_calls),
    },
    by_account: byAccount.map((r) => ({ ...r, posts_published: n(r.posts_published), publishes_failed: n(r.publishes_failed) })),
    by_connection: byConnection.map((r) => ({
      actor_id: r.actor_id,
      name: r.name,
      kind: KIND_LABEL[String(r.kind)] ?? String(r.kind),
      ...(r.key_mode ? { key_mode: r.key_mode } : {}),
      active: r.kind === "user" || r.revoked_at === null,
      api_calls: n(r.api_calls),
      posts_created: n(r.posts_created),
      posts_published: n(r.posts_published),
    })),
    daily: daily.map((d) => ({ day: d.day, posts_published: n(d.posts_published), api_calls: n(d.api_calls) })),
  };
}
