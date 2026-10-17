// Keeps published posts' stats fresh: often while a post is new, then less often, and not
// after 90 days. Each fetch updates the post's current numbers and today's history row.
import type { Sql } from "../../../backend/lib/access";
import { DISPLAY_NAMES as PLATFORM_NAMES, type Platform, type Settings } from "../../../backend/lib/connections/platforms";
import { accountToken } from "../credentials";
import { FETCHERS, type Counters, type FetchContext, type MetricsResult } from "./platforms";
import { PUBLIC_POST_FIELDS, PUBLIC_POST_READERS, type PublicContext, type PublicPostResult } from "./public";

export type MetricsDeps = {
  sql: Sql;
  setting: Settings;
  platforms: Platform[]; // platforms read through their own API here (ANALYTICS_PLATFORMS)
  // Platforms read from their public pages through ScrapeCreators (ANALYTICS_PUBLIC_PLATFORMS):
  // on their own until the platform approves Post Social, and to fill gaps where both are on.
  publicPlatforms?: Platform[];
  publicApiKey?: string | null;
  publicReaders?: Partial<Record<Platform, (ctx: PublicContext, url: string) => Promise<PublicPostResult>>>;
  onlyWorkspace?: string; // tests and manual runs; otherwise every unpaused workspace
  http?: typeof fetch;
  fetchers?: Partial<Record<Platform, (ctx: FetchContext) => Promise<MetricsResult>>>;
  now?: () => number;
  log?: (message: string, details?: Record<string, unknown>) => void;
};

const HOUR = 3600_000;
const DAY = 24 * HOUR;

// When to look again, by the post's age. null: stop checking. Public reads cost a credit
// each, so they run less often and stop after 30 days.
export function nextFetchAt(publishedAt: number, now: number, source: "official" | "public" = "official"): Date | null {
  const age = now - publishedAt;
  if (source === "public") {
    if (age < DAY) return new Date(now + 3 * HOUR);
    if (age < 7 * DAY) return new Date(now + DAY);
    if (age < 30 * DAY) return new Date(now + 7 * DAY);
    return null;
  }
  if (age < DAY) return new Date(now + HOUR);
  if (age < 7 * DAY) return new Date(now + 6 * HOUR);
  if (age < 30 * DAY) return new Date(now + DAY);
  if (age < 90 * DAY) return new Date(now + 7 * DAY);
  return null;
}

type Claimed = { destination_id: string; workspace_id: string; connected_account_id: string; platform: Platform; published_at: string };
type Target = { platform_request_id: string | null; media_type: string | null; display_name: string; live_url: string | null };
const COUNTER_KEYS: Array<keyof Counters> = ["views", "likes", "comments", "shares", "saves", "reposts", "quotes"];

// Official numbers win; numbers the official read could not give are taken from the public
// page when there is one.
export function fillGaps(official: MetricsResult, pub: PublicPostResult): { result: MetricsResult; filled: boolean } {
  const result: MetricsResult = { ...official, extra: { ...official.extra }, unavailable: [] };
  let filled = false;
  for (const key of COUNTER_KEYS) {
    if (result[key] === undefined && pub[key] !== undefined) {
      result[key] = pub[key];
      filled = true;
    }
  }
  result.unavailable = official.unavailable.filter((key) => result[key] === undefined);
  return { result, filled };
}

export async function runMetricsSweep(deps: MetricsDeps): Promise<number> {
  const all = [...new Set([...deps.platforms, ...publicOn(deps)])];
  if (!all.length) return 0;
  const now = deps.now ?? Date.now;
  const rows = await deps.sql<Claimed>(`SELECT * FROM public.claim_metrics_to_fetch($1::text[], 20, 300, $2)`, [all, deps.onlyWorkspace ?? null]);
  for (const row of rows) await fetchOne(deps, row, now).catch((error) => deps.log?.("metrics error", { destination: row.destination_id, message: String(error?.message ?? error) }));
  return rows.length;
}

// Public reads need the ScrapeCreators key; without it they are simply off.
const publicOn = (deps: MetricsDeps) => (deps.publicApiKey ? deps.publicPlatforms ?? [] : []);

async function fetchOne(deps: MetricsDeps, row: Claimed, now: () => number) {
  const [target] = await deps.sql<Target>(
    `SELECT d.platform_request_id, d.options->>'media_type' AS media_type, a.display_name, d.live_url
     FROM public.destinations d JOIN public.connected_accounts a ON a.id = d.connected_account_id WHERE d.id = $1`,
    [row.destination_id],
  );
  const later = (at: Date | null, error: string | null) =>
    deps.sql(`UPDATE public.post_metrics SET next_fetch_at = $2, fetch_lease_until = NULL, last_error = $3 WHERE destination_id = $1`, [row.destination_id, at?.toISOString() ?? null, error]);
  const official = deps.platforms.includes(row.platform);
  const reader = deps.publicReaders?.[row.platform] ?? PUBLIC_POST_READERS[row.platform];
  const canReadPublic = publicOn(deps).includes(row.platform) && Boolean(reader) && Boolean(target?.live_url);
  let learnedHandle: string | undefined;
  const readPublic = () =>
    reader!({ apiKey: deps.publicApiKey!, http: deps.http ?? fetch }, target!.live_url!).then((pub) => {
      learnedHandle = pub.handle;
      return pub;
    });
  const deleted = (message: string) => /does not exist|Unsupported get request|not found|video_not_found/i.test(message);
  const failed = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    // Deleted on the platform: stop checking and say so.
    if (deleted(message)) return later(null, `This post is no longer on ${PLATFORM_NAMES[row.platform]}; it may have been deleted.`);
    // Anything else (expired access, a platform hiccup): try again later.
    return later(new Date(now() + 6 * HOUR), message.slice(0, 500));
  };

  let result: MetricsResult;
  let source: "official" | "public" | "mixed" = "official";
  let followers: number | undefined;
  if (official && (target?.platform_request_id || !canReadPublic)) {
    if (!target?.platform_request_id) return later(null, "The platform did not return an id for this post, so its stats cannot be read.");
    // Stats reads count against the account's platform limits like any other call.
    const [{ reserve_platform_call: retryAt }] = await deps.sql<{ reserve_platform_call: string | null }>(
      `SELECT public.reserve_platform_call($1, 'analytics', 150, 3600)`,
      [row.connected_account_id],
    );
    if (retryAt) return later(new Date(retryAt), null);

    const fetcher = deps.fetchers?.[row.platform] ?? FETCHERS[row.platform];
    try {
      result = await fetcher({
        platformId: target.platform_request_id,
        mediaType: target.media_type ?? undefined,
        token: () => accountToken(deps, { id: row.connected_account_id, platform: row.platform, displayName: target.display_name }, now),
        http: deps.http ?? fetch,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // The official read failed for a reason other than the post being gone: show the
      // public numbers rather than nothing.
      if (deleted(message) || !canReadPublic) return failed(error);
      try {
        const pub = await readPublic();
        ({ followers } = pub);
        result = { ...pub, extra: {} };
        source = "public";
      } catch {
        return failed(error);
      }
    }
    const fillable = result.unavailable.some((key) => PUBLIC_POST_FIELDS[row.platform]?.includes(key));
    if (source === "official" && fillable && canReadPublic && !result.notYetPosted) {
      const pub = await readPublic().catch(() => null);
      if (pub) {
        const merged = fillGaps(result, pub);
        if (merged.filled) {
          result = merged.result;
          source = "mixed";
        }
        followers = pub.followers;
      }
    }
  } else {
    if (!canReadPublic) return later(null, "This post has no public address, so its stats cannot be read.");
    try {
      const pub = await readPublic();
      ({ followers } = pub);
      result = { ...pub, extra: {} };
      source = "public";
    } catch (error) {
      return failed(error);
    }
  }

  const published = Date.parse(row.published_at);
  if (result.notYetPosted) return later(now() - published < 30 * DAY ? new Date(now() + HOUR) : null, null);

  const values = [result.views, result.likes, result.comments, result.shares, result.saves, result.reposts, result.quotes].map((v) => (v === undefined ? null : v));
  await deps.sql(
    `WITH m AS (
       UPDATE public.post_metrics SET views = $2, likes = $3, comments = $4, shares = $5, saves = $6, reposts = $7, quotes = $8,
         extra = $9::jsonb, unavailable = $10, fetched_at = now(), next_fetch_at = $11, fetch_lease_until = NULL,
         refresh_requested_at = NULL, last_error = NULL, source = $14
       WHERE destination_id = $1
     ), d AS (
       INSERT INTO public.post_metric_days (destination_id, workspace_id, day, views, likes, comments, shares, saves, reposts, quotes)
       VALUES ($1, $12, (now() AT TIME ZONE 'UTC')::date, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (destination_id, day) DO UPDATE SET views = EXCLUDED.views, likes = EXCLUDED.likes, comments = EXCLUDED.comments,
         shares = EXCLUDED.shares, saves = EXCLUDED.saves, reposts = EXCLUDED.reposts, quotes = EXCLUDED.quotes
     )
     UPDATE public.destinations SET platform_request_id = coalesce($13, platform_request_id) WHERE id = $1 AND $13::text IS NOT NULL`,
    [row.destination_id, ...values, JSON.stringify(result.extra), result.unavailable, nextFetchAt(published, now(), source === "public" ? "public" : "official")?.toISOString() ?? null, row.workspace_id, result.resolvedId ?? null, source],
  );
  // A YouTube account connected with upload permission only is saved with the placeholder
  // handle "youtube"; its post's page names the channel, so its counts can be looked up.
  if (learnedHandle && row.platform === "youtube") {
    await deps.sql(
      `UPDATE public.connected_accounts SET handle = $2 WHERE id = $1 AND platform = 'youtube' AND coalesce(handle, '') IN ('', 'youtube')`,
      [row.connected_account_id, learnedHandle],
    );
  }
  // Public post pages also show the author's follower count: saved as today's count when
  // nothing better was saved today (LinkedIn's only source).
  if (followers !== undefined) {
    await deps.sql(
      `INSERT INTO public.account_follower_days (connected_account_id, workspace_id, day, followers, source)
       VALUES ($1, $2, (now() AT TIME ZONE 'UTC')::date, $3, 'public') ON CONFLICT (connected_account_id, day) DO NOTHING`,
      [row.connected_account_id, row.workspace_id, followers],
    );
  }
}
