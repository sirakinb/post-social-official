// Keeps published posts' stats fresh: often while a post is new, then less often, and not
// after 90 days. Each fetch updates the post's current numbers and today's history row.
import type { Sql } from "../../../backend/lib/access";
import { DISPLAY_NAMES as PLATFORM_NAMES, type Platform, type Settings } from "../../../backend/lib/connections/platforms";
import { accountToken } from "../credentials";
import { FETCHERS, type FetchContext, type MetricsResult } from "./platforms";

export type MetricsDeps = {
  sql: Sql;
  setting: Settings;
  platforms: Platform[]; // which platforms' stats are switched on in this environment
  onlyWorkspace?: string; // tests and manual runs; otherwise every unpaused workspace
  http?: typeof fetch;
  fetchers?: Partial<Record<Platform, (ctx: FetchContext) => Promise<MetricsResult>>>;
  now?: () => number;
  log?: (message: string, details?: Record<string, unknown>) => void;
};

const HOUR = 3600_000;
const DAY = 24 * HOUR;

// When to look again, by the post's age. null: stop checking.
export function nextFetchAt(publishedAt: number, now: number): Date | null {
  const age = now - publishedAt;
  if (age < DAY) return new Date(now + HOUR);
  if (age < 7 * DAY) return new Date(now + 6 * HOUR);
  if (age < 30 * DAY) return new Date(now + DAY);
  if (age < 90 * DAY) return new Date(now + 7 * DAY);
  return null;
}

type Claimed = { destination_id: string; workspace_id: string; connected_account_id: string; platform: Platform; published_at: string };
type Target = { platform_request_id: string | null; media_type: string | null; display_name: string };

export async function runMetricsSweep(deps: MetricsDeps): Promise<number> {
  if (!deps.platforms.length) return 0;
  const now = deps.now ?? Date.now;
  const rows = await deps.sql<Claimed>(`SELECT * FROM public.claim_metrics_to_fetch($1::text[], 20, 300, $2)`, [deps.platforms, deps.onlyWorkspace ?? null]);
  for (const row of rows) await fetchOne(deps, row, now).catch((error) => deps.log?.("metrics error", { destination: row.destination_id, message: String(error?.message ?? error) }));
  return rows.length;
}

async function fetchOne(deps: MetricsDeps, row: Claimed, now: () => number) {
  const [target] = await deps.sql<Target>(
    `SELECT d.platform_request_id, d.options->>'media_type' AS media_type, a.display_name
     FROM public.destinations d JOIN public.connected_accounts a ON a.id = d.connected_account_id WHERE d.id = $1`,
    [row.destination_id],
  );
  const later = (at: Date | null, error: string | null) =>
    deps.sql(`UPDATE public.post_metrics SET next_fetch_at = $2, fetch_lease_until = NULL, last_error = $3 WHERE destination_id = $1`, [row.destination_id, at?.toISOString() ?? null, error]);
  if (!target?.platform_request_id) return later(null, "The platform did not return an id for this post, so its stats cannot be read.");

  // Stats reads count against the account's platform limits like any other call.
  const [{ reserve_platform_call: retryAt }] = await deps.sql<{ reserve_platform_call: string | null }>(
    `SELECT public.reserve_platform_call($1, 'analytics', 150, 3600)`,
    [row.connected_account_id],
  );
  if (retryAt) return later(new Date(retryAt), null);

  const fetcher = deps.fetchers?.[row.platform] ?? FETCHERS[row.platform];
  let result: MetricsResult;
  try {
    result = await fetcher({
      platformId: target.platform_request_id,
      mediaType: target.media_type ?? undefined,
      token: () => accountToken(deps, { id: row.connected_account_id, platform: row.platform, displayName: target.display_name }, now),
      http: deps.http ?? fetch,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Deleted on the platform: stop checking and say so.
    if (/does not exist|Unsupported get request|not found|video_not_found/i.test(message)) {
      return later(null, `This post is no longer on ${PLATFORM_NAMES[row.platform]}; it may have been deleted.`);
    }
    // Anything else (expired access, a platform hiccup): try again later.
    return later(new Date(now() + 6 * HOUR), message.slice(0, 500));
  }

  const published = Date.parse(row.published_at);
  if (result.notYetPosted) return later(now() - published < 30 * DAY ? new Date(now() + HOUR) : null, null);

  const values = [result.views, result.likes, result.comments, result.shares, result.saves, result.reposts, result.quotes].map((v) => (v === undefined ? null : v));
  await deps.sql(
    `WITH m AS (
       UPDATE public.post_metrics SET views = $2, likes = $3, comments = $4, shares = $5, saves = $6, reposts = $7, quotes = $8,
         extra = $9::jsonb, unavailable = $10, fetched_at = now(), next_fetch_at = $11, fetch_lease_until = NULL,
         refresh_requested_at = NULL, last_error = NULL
       WHERE destination_id = $1
     ), d AS (
       INSERT INTO public.post_metric_days (destination_id, workspace_id, day, views, likes, comments, shares, saves, reposts, quotes)
       VALUES ($1, $12, (now() AT TIME ZONE 'UTC')::date, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (destination_id, day) DO UPDATE SET views = EXCLUDED.views, likes = EXCLUDED.likes, comments = EXCLUDED.comments,
         shares = EXCLUDED.shares, saves = EXCLUDED.saves, reposts = EXCLUDED.reposts, quotes = EXCLUDED.quotes
     )
     UPDATE public.destinations SET platform_request_id = coalesce($13, platform_request_id) WHERE id = $1 AND $13::text IS NOT NULL`,
    [row.destination_id, ...values, JSON.stringify(result.extra), result.unavailable, nextFetchAt(published, now())?.toISOString() ?? null, row.workspace_id, result.resolvedId ?? null],
  );
}
