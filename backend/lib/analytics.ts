// Post stats for people and AIs. Only platforms whose stats are switched on in this
// environment are ever shown (ANALYTICS_PLATFORMS), so nothing half-available appears.
// Counters a platform does not report are left out rather than shown as zero.
import { ApiError, membership, requireUuid, type Caller, type Sql } from "./access";
import { DISPLAY_NAMES, type Platform } from "./connections/platforms";
import { page } from "./api/reads";

const COUNTERS = ["views", "likes", "comments", "shares", "saves", "reposts", "quotes"] as const;
export const ANALYTICS_PERIODS = ["last_7_days", "last_30_days", "last_90_days", "all"] as const;
const SORTS = ["published_at", ...COUNTERS] as const;
const REFRESH_COOLDOWN_MINUTES = 30;

type Row = Record<string, unknown> & { platform: Platform; unavailable: string[] };

function counters(row: Record<string, unknown>) {
  const out: Record<string, number> = {};
  for (const key of COUNTERS) if (row[key] !== null && row[key] !== undefined) out[key] = Number(row[key]);
  return out;
}

function note(row: Row, missing: string[]) {
  if (row.last_error) return String(row.last_error);
  if (!row.fetched_at) return "Stats are being collected; check back in a few minutes.";
  // An account connected before stats were switched on has not granted the permission.
  if (missing.length) return `Reconnect ${row.account} on ${DISPLAY_NAMES[row.platform]} to see ${missing.join(", ")}.`;
  return null;
}

function shape(row: Row) {
  const missing = row.unavailable ?? [];
  return {
    post_id: row.post_id,
    destination_id: row.destination_id,
    platform: row.platform,
    platform_name: DISPLAY_NAMES[row.platform],
    account: row.account,
    caption: row.caption,
    live_url: row.live_url,
    published_at: row.published_at,
    stats: counters(row),
    ...(row.extra && Object.keys(row.extra as object).length ? { more: row.extra } : {}),
    updated_at: row.fetched_at,
    ...(note(row, missing) ? { note: note(row, missing) } : {}),
  };
}

const enabledOrEmpty = (platforms: Platform[]) => (platforms.length ? platforms : ["none"]);

export async function listAnalytics(
  sql: Sql,
  caller: Caller,
  platforms: Platform[],
  input: { workspace_id: string; platform?: unknown; period?: unknown; sort?: unknown; limit?: unknown; offset?: unknown },
) {
  await membership(sql, caller, input.workspace_id, false);
  const { limit, offset } = page(input);
  const period = (input.period || "last_30_days") as (typeof ANALYTICS_PERIODS)[number];
  if (!ANALYTICS_PERIODS.includes(period)) throw new ApiError(400, `period must be one of: ${ANALYTICS_PERIODS.join(", ")}.`);
  const sort = (input.sort || "published_at") as (typeof SORTS)[number];
  if (!SORTS.includes(sort)) throw new ApiError(400, `sort must be one of: ${SORTS.join(", ")}.`);
  const platform = input.platform ? String(input.platform) : null;
  if (platform && !platforms.includes(platform as Platform)) throw new ApiError(400, `Stats are available for: ${platforms.map((p) => DISPLAY_NAMES[p]).join(", ")}.`);
  const days = { last_7_days: 7, last_30_days: 30, last_90_days: 90, all: 36500 }[period];

  const where = `m.workspace_id = $1 AND m.platform = ANY($2::text[]) AND ($3::text IS NULL OR m.platform = $3)
                 AND m.published_at >= now() - make_interval(days => $4)`;
  const rows = await sql<Row>(
    `SELECT m.*, left(p.caption, 200) AS caption, d.live_url, a.display_name AS account
     FROM public.post_metrics m
     JOIN public.posts p ON p.id = m.post_id
     JOIN public.destinations d ON d.id = m.destination_id
     JOIN public.connected_accounts a ON a.id = m.connected_account_id
     WHERE ${where}
     ORDER BY ${sort === "published_at" ? "m.published_at" : `m.${sort}`} DESC NULLS LAST, m.destination_id
     LIMIT $5 OFFSET $6`,
    [input.workspace_id, enabledOrEmpty(platforms), platform, days, limit + 1, offset],
  );
  const totals = await sql<Record<string, unknown> & { platform: Platform; posts: string }>(
    `SELECT m.platform, count(*) AS posts, ${COUNTERS.map((c) => `sum(m.${c}) AS ${c}`).join(", ")}
     FROM public.post_metrics m WHERE ${where} GROUP BY m.platform ORDER BY m.platform`,
    [input.workspace_id, enabledOrEmpty(platforms), platform, days],
  );
  return {
    period,
    platforms: platforms.map((p) => DISPLAY_NAMES[p]),
    totals_by_platform: totals.map((t) => ({ platform: t.platform, platform_name: DISPLAY_NAMES[t.platform], posts: Number(t.posts), stats: counters(t) })),
    posts: rows.slice(0, limit).map(shape),
    has_more: rows.length > limit,
    limit,
    offset,
  };
}

export async function postAnalytics(sql: Sql, caller: Caller, platforms: Platform[], input: { post_id?: unknown }) {
  const postId = requireUuid(input.post_id, "Post");
  const [post] = await sql<{ workspace_id: string }>(`SELECT workspace_id FROM public.posts WHERE id = $1`, [postId]);
  if (!post) throw new ApiError(404, "That post was not found.");
  await membership(sql, caller, post.workspace_id, false).catch((error) => {
    if (error instanceof ApiError && error.status === 404) throw new ApiError(404, "That post was not found.");
    throw error;
  });
  const rows = await sql<Row>(
    `SELECT m.*, left(p.caption, 200) AS caption, d.live_url, a.display_name AS account
     FROM public.post_metrics m JOIN public.posts p ON p.id = m.post_id
     JOIN public.destinations d ON d.id = m.destination_id JOIN public.connected_accounts a ON a.id = m.connected_account_id
     WHERE m.post_id = $1 AND m.platform = ANY($2::text[]) ORDER BY m.platform`,
    [postId, enabledOrEmpty(platforms)],
  );
  const days = await sql<Record<string, unknown> & { destination_id: string; day: string }>(
    `SELECT destination_id, to_char(day, 'YYYY-MM-DD') AS day, ${COUNTERS.join(", ")}
     FROM public.post_metric_days WHERE destination_id = ANY($1::uuid[]) ORDER BY day`,
    [rows.map((r) => r.destination_id)],
  );
  return {
    post_id: postId,
    destinations: rows.map((row) => ({
      ...shape(row),
      by_day: days.filter((d) => d.destination_id === row.destination_id).map((d) => ({ day: d.day, stats: counters(d) })),
    })),
    ...(rows.length ? {} : { note: "No stats for this post yet. Stats appear a few minutes after a post is published." }),
  };
}

// Asks the worker to fetch fresh numbers now (at most every 30 minutes per post).
export async function refreshAnalytics(sql: Sql, caller: Caller, platforms: Platform[], input: { workspace_id: string; post_id?: unknown }) {
  // It makes the worker call the platforms, so read-only members (reviewers) can't.
  await membership(sql, caller, input.workspace_id, true, "Reviewers can view stats but not refresh them.");
  const postId = input.post_id === undefined || input.post_id === "" ? null : requireUuid(input.post_id, "Post");
  const [result] = await sql<{ queued: string; cooling: string }>(
    `WITH candidates AS (
       SELECT destination_id, fetched_at FROM public.post_metrics
       WHERE workspace_id = $1 AND platform = ANY($2::text[]) AND ($3::uuid IS NULL OR post_id = $3)
         AND published_at > now() - interval '90 days'
     ), queued AS (
       UPDATE public.post_metrics SET next_fetch_at = now(), refresh_requested_at = now()
       WHERE destination_id IN (
         SELECT destination_id FROM candidates
         WHERE fetched_at IS NULL OR fetched_at < now() - make_interval(mins => $4)
       )
       RETURNING 1
     )
     SELECT (SELECT count(*) FROM queued) AS queued,
            (SELECT count(*) FROM candidates WHERE fetched_at >= now() - make_interval(mins => $4)) AS cooling`,
    [input.workspace_id, enabledOrEmpty(platforms), postId, REFRESH_COOLDOWN_MINUTES],
  );
  const queued = Number(result.queued);
  const cooling = Number(result.cooling);
  return {
    queued,
    message: queued
      ? `Fetching fresh stats for ${queued} post${queued === 1 ? "" : "s"}; they update within a few minutes.`
      : cooling
        ? `These stats were updated in the last ${REFRESH_COOLDOWN_MINUTES} minutes, so they are already fresh.`
        : "There are no published posts with stats to refresh.",
  };
}
