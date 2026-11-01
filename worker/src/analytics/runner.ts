// Keeps published posts' stats fresh: often while a post is new, then less often, and not
// after 90 days. Each fetch updates the post's current numbers and today's history row.
import { parseJson } from "../json";
import type { Sql } from "../../../backend/lib/access";
import { DISPLAY_NAMES as PLATFORM_NAMES, officialPlatformsFor, type Platform, type Settings, type StatsPreview } from "../../../backend/lib/connections/platforms";
import { accountToken } from "../credentials";
import { FETCHERS, type Counters, type FetchContext, type MetricsResult } from "./platforms";
import { PUBLIC_POST_FIELDS, PUBLIC_POST_READERS, realHandle, type PublicContext, type PublicPostResult } from "./public";

export type MetricsDeps = {
  sql: Sql;
  setting: Settings;
  platforms: Platform[]; // platforms read through their own API here (ANALYTICS_PLATFORMS)
  preview?: StatsPreview; // and for these listed workspaces only, these platforms too
  // Platforms read from their public pages through ScrapeCreators (ANALYTICS_PUBLIC_PLATFORMS):
  // on their own until the platform approves Post Social, and to fill gaps where both are on.
  publicPlatforms?: Platform[];
  publicApiKey?: string | null;
  publicReaders?: Partial<Record<Platform, (ctx: PublicContext, url: string) => Promise<PublicPostResult>>>;
  onlyWorkspace?: string; // tests and manual runs; otherwise every unpaused workspace
  http?: typeof fetch;
  token?: (accountId: string) => Promise<string>; // tests; otherwise the account's saved access
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
type Target = { platform_request_id: string | null; media_type: string | null; display_name: string; live_url: string | null; privacy_level: string | null; handle: string | null };
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

type TikTokStatus = { state: string; postId: string | null };

// Where a TikTok upload stands, by its publish id.
export async function tiktokStatus(http: typeof fetch, token: string, publishId: string): Promise<TikTokStatus> {
  const response = await http("https://open.tiktokapis.com/v2/post/publish/status/fetch/", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ publish_id: publishId }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = (await response.text().then(parseJson).catch(() => ({}))) as Record<string, any>;
  if (!response.ok || (body.error?.code && body.error.code !== "ok")) throw new Error(`TikTok status check failed: ${body.error?.message || body.error?.code || `HTTP ${response.status}`}`);
  const raw = body.data?.publicaly_available_post_id ?? body.data?.publicly_available_post_id;
  const postId = Array.isArray(raw) ? raw[0] : raw;
  return { state: String(body.data?.status ?? ""), postId: postId ? String(postId) : null };
}

export async function runMetricsSweep(deps: MetricsDeps): Promise<number> {
  const all = [...new Set([...deps.platforms, ...(deps.preview?.platforms ?? []), ...publicOn(deps)])];
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
    `SELECT d.platform_request_id, d.options->>'media_type' AS media_type, a.display_name, d.live_url,
       d.options->>'privacy_level' AS privacy_level, a.handle
     FROM public.destinations d JOIN public.connected_accounts a ON a.id = d.connected_account_id WHERE d.id = $1`,
    [row.destination_id],
  );
  const later = (at: Date | null, error: string | null) =>
    deps.sql(`UPDATE public.post_metrics SET next_fetch_at = $2, fetch_lease_until = NULL, last_error = $3 WHERE destination_id = $1`, [row.destination_id, at?.toISOString() ?? null, error]);
  const published = Date.parse(row.published_at);
  const token = () =>
    deps.token ? deps.token(row.connected_account_id) : accountToken(deps, { id: row.connected_account_id, platform: row.platform, displayName: target.display_name }, now);

  // TikTok names a post publicly only once it clears TikTok's review, or once the creator
  // posts an inbox draft from the app, often after Post Social's publish step finished. Ask
  // TikTok (free, the account's own access) until it does, then read it like any other post.
  if (row.platform === "tiktok" && target && !target.live_url && target.platform_request_id && !/^\d+$/.test(target.platform_request_id)) {
    const age = now() - published;
    const retry = (error: string) => later(age < 7 * DAY ? new Date(now() + 6 * HOUR) : age < 30 * DAY ? new Date(now() + DAY) : null, error);
    if (target.privacy_level === "SELF_ONLY") return later(null, "Posted privately on TikTok, so it has no public stats.");
    const handle = realHandle("tiktok", target.handle);
    if (!handle) return later(null, "TikTok didn't share this account's username, so its posts' stats can't be read. Reconnect TikTok to fix it.");
    let found: TikTokStatus;
    try {
      found = await tiktokStatus(deps.http ?? fetch, await token(), target.platform_request_id);
    } catch (error) {
      return retry((error instanceof Error ? error.message : String(error)).slice(0, 500));
    }
    if (found.state === "FAILED") return later(null, "TikTok didn't publish this post, so it has no stats.");
    if (!found.postId) {
      return retry(age < 30 * DAY ? "Waiting for TikTok to make this post public." : "TikTok never made this post public, so its stats can't be read.");
    }
    const photo = target.platform_request_id.startsWith("p_") || target.media_type === "photo";
    target.live_url = `https://www.tiktok.com/@${handle}/${photo ? "photo" : "video"}/${found.postId}`;
    target.platform_request_id = found.postId;
    await deps.sql(`UPDATE public.destinations SET live_url = $2, platform_request_id = $3 WHERE id = $1 AND live_url IS NULL`, [row.destination_id, target.live_url, found.postId]);
  }

  const official = officialPlatformsFor(deps.platforms, deps.preview ?? { platforms: [], workspaces: [] }, row.workspace_id).includes(row.platform);
  const reader = deps.publicReaders?.[row.platform] ?? PUBLIC_POST_READERS[row.platform];
  const canReadPublic = publicOn(deps).includes(row.platform) && Boolean(reader) && Boolean(target?.live_url);
  // A preview platform with no public reads here: other workspaces' posts wait, so they're
  // picked up once the platform is switched on for them.
  if (!official && !publicOn(deps).includes(row.platform)) return later(new Date(now() + DAY), null);
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
        token,
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
