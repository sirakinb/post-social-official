// Whole-account analytics (PEN-29 to PEN-32): each connected account's own recent posts,
// including ones made outside Post Social, its daily account-level numbers and its audience,
// read through the platform's own API with the permissions it approved. Every account is
// read about twice a day. Numbers an account can't read yet (it connected before the
// platform approved Post Social, so it hasn't granted the insights permission) are left
// out, never reported as zero; posts still come in with what the account can read.
import type { Sql } from "../../../backend/lib/access";
import type { Platform, Settings } from "../../../backend/lib/connections/platforms";
import { accountToken } from "../credentials";
import { parseJson } from "../json";
import { BLUESKY_APPVIEW } from "./platforms";

export type Format = "video" | "carousel" | "photo" | "text";
export type AccountPost = {
  platformPostId: string;
  publishedAt: string; // ISO
  caption: string | null;
  permalink: string | null;
  format: Format;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  reposts?: number;
  quotes?: number;
  reach?: number;
};
export type InsightDay = { day: string; views?: number; reach?: number; profileViews?: number; interactions?: number; engaged?: number };
export type Breakdown = Array<{ label: string; value: number }>;
export type Audience = Partial<Record<"age" | "gender" | "country" | "city", Breakdown>>;
export type AccountRead = { posts: AccountPost[]; insights?: InsightDay | null; audience?: Audience | null; followers?: number | null };

export type ReadContext = {
  externalId: string; // the account's platform id
  token: () => Promise<string>;
  http: typeof fetch;
  now: number;
  withAudience: boolean; // audience changes slowly: read it about once a week
};

// The platforms read here, when their stats are switched on (ANALYTICS_PLATFORMS).
export const WHOLE_ACCOUNT_PLATFORMS: Platform[] = ["instagram", "facebook", "threads", "tiktok", "bluesky"];

const DAY = 24 * 3600_000;
const HOUR = 3600_000;
const LOOKBACK_DAYS = 90;
const MAX_POSTS = 100;
// Per-post insights cost one call each, so only newer posts get them on each read.
const INSIGHT_POSTS = 30;
const INSIGHT_DAYS = 30;

const num = (value: unknown) => (value === undefined || value === null || value === "" || Number.isNaN(Number(value)) ? undefined : Number(value));
const clip = (text: unknown) => (typeof text === "string" && text.trim() ? text.trim().slice(0, 200) : null);
const withToken = (url: string, token: string) => `${url}${url.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function getJson(http: typeof fetch, url: string, init: RequestInit = {}): Promise<Json> {
  const response = await http(url, init);
  const text = await response.text();
  let body: Json = {};
  try {
    body = text ? (parseJson(text) as Json) : {};
  } catch {
    // keep empty
  }
  const error = body.error && typeof body.error === "object" && body.error.code !== "ok" ? body.error : null;
  if (!response.ok || error) {
    const message = String(error?.message ?? `HTTP ${response.status}`);
    throw Object.assign(new Error(message), { status: response.status, expired: response.status === 401 || error?.code === 190 || error?.code === "access_token_invalid" });
  }
  return body;
}
// A read the account may not be allowed (a permission it hasn't granted): null instead of an
// error. An expired login still stops the whole read.
const tryOr = async <T>(fn: () => Promise<T>): Promise<T | null> => fn().catch((error) => (error?.expired ? Promise.reject(error) : null));

// Meta insights: data[] of { name, values: [{ value }] } or { name, total_value: { value } };
// a series (values per day) is added up.
function insightValues(body: Json) {
  const out: Record<string, number> = {};
  for (const item of (body.data ?? []) as Array<{ name: string; values?: Array<{ value: unknown }>; total_value?: { value: unknown } }>) {
    const total = num(item.total_value?.value);
    const series = (item.values ?? []).map((v) => num(v.value)).filter((v): v is number => v !== undefined);
    const value = total ?? (series.length ? series.reduce((a, b) => a + b, 0) : undefined);
    if (value !== undefined) out[item.name] = value;
  }
  return out;
}

// Meta's demographic insights: total_value.breakdowns[0].results[] of { dimension_values, value }.
function breakdownOf(body: Json): Breakdown | null {
  const results = body.data?.[0]?.total_value?.breakdowns?.[0]?.results as Array<{ dimension_values?: unknown[]; value?: unknown }> | undefined;
  if (!Array.isArray(results)) return null;
  const list = results
    .map((r) => ({ label: String(r.dimension_values?.[0] ?? ""), value: num(r.value) ?? 0 }))
    .filter((r) => r.label && r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
  return list.length ? list : null;
}

const sinceUnix = (ctx: ReadContext) => Math.floor((ctx.now - LOOKBACK_DAYS * DAY) / 1000);
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
// Account numbers are read for yesterday (UTC), a whole day the platform has finished counting.
const yesterday = (ctx: ReadContext) => {
  const start = Date.UTC(new Date(ctx.now).getUTCFullYear(), new Date(ctx.now).getUTCMonth(), new Date(ctx.now).getUTCDate()) - DAY;
  return { day: isoDay(start), since: Math.floor(start / 1000), until: Math.floor((start + DAY) / 1000) };
};
const recent = (ctx: ReadContext, publishedAt: string) => ctx.now - Date.parse(publishedAt) < INSIGHT_DAYS * DAY;

// Follows a Graph list's paging.next until it reaches the lookback window or MAX_POSTS.
async function graphList(ctx: ReadContext, firstUrl: string, dateField: string): Promise<Json[]> {
  const out: Json[] = [];
  let url: string | null = firstUrl;
  const oldest = ctx.now - LOOKBACK_DAYS * DAY;
  while (url && out.length < MAX_POSTS) {
    const page: Json = await getJson(ctx.http, url);
    const items = (page.data ?? []) as Json[];
    for (const item of items) {
      if (Date.parse(String(item[dateField])) < oldest) return out;
      out.push(item);
      if (out.length >= MAX_POSTS) return out;
    }
    url = items.length ? (page.paging?.next ?? null) : null;
  }
  return out;
}

// ---------- Instagram (Instagram login, graph.instagram.com) ----------
const IG = "https://graph.instagram.com/v25.0";
const igFormat = (type: unknown, product: unknown): Format =>
  type === "CAROUSEL_ALBUM" ? "carousel" : type === "VIDEO" || product === "REELS" ? "video" : type === "IMAGE" ? "photo" : "photo";

async function instagram(ctx: ReadContext): Promise<AccountRead> {
  const token = await ctx.token();
  const media = await graphList(ctx, withToken(`${IG}/me/media?fields=id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count&limit=50`, token), "timestamp");
  const posts: AccountPost[] = [];
  let insightCalls = 0;
  for (const m of media) {
    const post: AccountPost = {
      platformPostId: String(m.id),
      publishedAt: new Date(String(m.timestamp)).toISOString(),
      caption: clip(m.caption),
      permalink: typeof m.permalink === "string" ? m.permalink : null,
      format: igFormat(m.media_type, m.media_product_type),
      likes: num(m.like_count),
      comments: num(m.comments_count),
    };
    // Views, reach, shares and saves need instagram_business_manage_insights.
    if (recent(ctx, post.publishedAt) && insightCalls < INSIGHT_POSTS) {
      insightCalls++;
      const insights = await tryOr(() => getJson(ctx.http, withToken(`${IG}/${post.platformPostId}/insights?metric=views,reach,shares,saved`, token)));
      if (insights) {
        const v = insightValues(insights);
        Object.assign(post, { views: v.views, reach: v.reach, shares: v.shares, saves: v.saved });
      }
    }
    posts.push(post);
  }
  const profile = await tryOr(() => getJson(ctx.http, withToken(`${IG}/me?fields=followers_count`, token)));
  const y = yesterday(ctx);
  const daily = await tryOr(() =>
    getJson(ctx.http, withToken(`${IG}/me/insights?metric=reach,views,profile_views,total_interactions,accounts_engaged&period=day&metric_type=total_value&since=${y.since}&until=${y.until}`, token)),
  );
  const v = daily ? insightValues(daily) : null;
  let audience: Audience | null = null;
  if (ctx.withAudience) {
    audience = {};
    for (const breakdown of ["age", "gender", "country", "city"] as const) {
      const body = await tryOr(() => getJson(ctx.http, withToken(`${IG}/me/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=${breakdown}`, token)));
      const list = body ? breakdownOf(body) : null;
      if (list) audience[breakdown] = list;
    }
    if (!Object.keys(audience).length) audience = null;
  }
  return {
    posts,
    followers: num(profile?.followers_count) ?? null,
    insights: v && Object.keys(v).length ? { day: y.day, reach: v.reach, views: v.views, profileViews: v.profile_views, interactions: v.total_interactions, engaged: v.accounts_engaged } : null,
    audience,
  };
}

// ---------- Facebook Pages (graph.facebook.com, the Page's own access) ----------
const FB = "https://graph.facebook.com/v25.0";
const fbFormat = (type: unknown): Format => {
  const t = String(type ?? "").toLowerCase();
  return t.includes("video") || t.includes("reel") ? "video" : t === "album" ? "carousel" : t.includes("photo") ? "photo" : "text";
};

// Meta keeps renaming Page metrics, so each is tried by its current name, then the old one.
async function fbMetric(ctx: ReadContext, token: string, path: string, names: string[], query = "") {
  for (const name of names) {
    const body = await tryOr(() => getJson(ctx.http, withToken(`${FB}/${path}/insights?metric=${name}${query}`, token)));
    const value = body ? insightValues(body)[name] : undefined;
    if (value !== undefined) return value;
  }
  return undefined;
}

async function facebook(ctx: ReadContext): Promise<AccountRead> {
  const token = await ctx.token();
  const items = await graphList(
    ctx,
    withToken(
      `${FB}/${ctx.externalId}/published_posts?fields=id,message,created_time,permalink_url,attachments{media_type},reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares&since=${sinceUnix(ctx)}&limit=50`,
      token,
    ),
    "created_time",
  );
  const posts: AccountPost[] = [];
  let insightCalls = 0;
  for (const p of items) {
    const post: AccountPost = {
      platformPostId: String(p.id),
      publishedAt: new Date(String(p.created_time)).toISOString(),
      caption: clip(p.message),
      permalink: typeof p.permalink_url === "string" ? p.permalink_url : null,
      format: fbFormat(p.attachments?.data?.[0]?.media_type),
      likes: num(p.reactions?.summary?.total_count),
      comments: num(p.comments?.summary?.total_count),
      shares: num(p.shares?.count) ?? 0, // Facebook leaves `shares` out when there are none
    };
    // Views and reach need read_insights.
    if (recent(ctx, post.publishedAt) && insightCalls < INSIGHT_POSTS) {
      insightCalls++;
      post.views = await fbMetric(ctx, token, post.platformPostId, ["post_media_view", "post_impressions"]);
      if (post.views !== undefined) post.reach = await fbMetric(ctx, token, post.platformPostId, ["post_total_media_view_unique", "post_impressions_unique"]);
    }
    posts.push(post);
  }
  const page = await tryOr(() => getJson(ctx.http, withToken(`${FB}/${ctx.externalId}?fields=followers_count`, token)));
  const y = yesterday(ctx);
  const range = `&period=day&since=${y.since}&until=${y.until}`;
  const views = await fbMetric(ctx, token, ctx.externalId, ["page_media_view", "page_impressions"], range);
  const reach = await fbMetric(ctx, token, ctx.externalId, ["page_total_media_view_unique", "page_impressions_unique"], range);
  const interactions = await fbMetric(ctx, token, ctx.externalId, ["page_post_engagements"], range);
  const profileViews = await fbMetric(ctx, token, ctx.externalId, ["page_views_total"], range);
  const any = [views, reach, interactions, profileViews].some((v) => v !== undefined);
  // Meta no longer gives Pages an audience breakdown, so Facebook has none.
  return { posts, followers: num(page?.followers_count) ?? null, insights: any ? { day: y.day, views, reach, interactions, profileViews } : null, audience: null };
}

// ---------- Threads (graph.threads.net) ----------
const TH = "https://graph.threads.net/v1.0";
const thFormat = (type: unknown): Format => (type === "VIDEO" ? "video" : type === "CAROUSEL_ALBUM" ? "carousel" : type === "IMAGE" ? "photo" : "text");

async function threads(ctx: ReadContext): Promise<AccountRead> {
  const token = await ctx.token();
  const items = await graphList(ctx, withToken(`${TH}/me/threads?fields=id,text,media_type,permalink,timestamp&since=${sinceUnix(ctx)}&limit=50`, token), "timestamp");
  const posts: AccountPost[] = [];
  let insightCalls = 0;
  for (const t of items) {
    if (t.media_type === "REPOST_FACADE") continue; // someone else's post, reposted
    const post: AccountPost = {
      platformPostId: String(t.id),
      publishedAt: new Date(String(t.timestamp)).toISOString(),
      caption: clip(t.text),
      permalink: typeof t.permalink === "string" ? t.permalink : null,
      format: thFormat(t.media_type),
    };
    // Every Threads number needs threads_manage_insights.
    if (recent(ctx, post.publishedAt) && insightCalls < INSIGHT_POSTS) {
      insightCalls++;
      const insights = await tryOr(() => getJson(ctx.http, withToken(`${TH}/${post.platformPostId}/insights?metric=views,likes,replies,reposts,quotes,shares`, token)));
      if (insights) {
        const v = insightValues(insights);
        Object.assign(post, { views: v.views, likes: v.likes, comments: v.replies, reposts: v.reposts, quotes: v.quotes, shares: v.shares });
      }
    }
    posts.push(post);
  }
  const followersBody = await tryOr(() => getJson(ctx.http, withToken(`${TH}/me/threads_insights?metric=followers_count`, token)));
  const y = yesterday(ctx);
  const daily = await tryOr(() => getJson(ctx.http, withToken(`${TH}/me/threads_insights?metric=views,likes,replies,reposts,quotes&since=${y.since}&until=${y.until}`, token)));
  const v = daily ? insightValues(daily) : null;
  const interactions = v ? ["likes", "replies", "reposts", "quotes"].reduce((t, k) => t + (v[k] ?? 0), 0) : undefined;
  let audience: Audience | null = null;
  if (ctx.withAudience) {
    audience = {};
    for (const breakdown of ["age", "gender", "country", "city"] as const) {
      const body = await tryOr(() => getJson(ctx.http, withToken(`${TH}/me/threads_insights?metric=follower_demographics&breakdown=${breakdown}`, token)));
      const list = body ? breakdownOf(body) : null;
      if (list) audience[breakdown] = list;
    }
    if (!Object.keys(audience).length) audience = null;
  }
  return {
    posts,
    followers: followersBody ? (insightValues(followersBody).followers_count ?? null) : null,
    insights: v && Object.keys(v).length ? { day: y.day, views: v.views, interactions } : null,
    audience,
  };
}

// ---------- TikTok (video.list) ----------
async function tiktok(ctx: ReadContext): Promise<AccountRead> {
  const token = await ctx.token();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" };
  const fields = "id,title,video_description,create_time,share_url,view_count,like_count,comment_count,share_count";
  const posts: AccountPost[] = [];
  const oldest = ctx.now - LOOKBACK_DAYS * DAY;
  let cursor: number | undefined;
  for (let page = 0; page < 5 && posts.length < MAX_POSTS; page++) {
    // Needs video.list; accounts connected before it was approved can't read it yet.
    const body = await tryOr(() => getJson(ctx.http, `https://open.tiktokapis.com/v2/video/list/?fields=${fields}`, { method: "POST", headers, body: JSON.stringify({ max_count: 20, ...(cursor ? { cursor } : {}) }) }));
    if (!body) break;
    const videos = (body.data?.videos ?? []) as Json[];
    let reachedOldest = false;
    for (const v of videos) {
      const at = Number(v.create_time) * 1000;
      if (at < oldest) {
        reachedOldest = true;
        break;
      }
      posts.push({
        platformPostId: String(v.id),
        publishedAt: new Date(at).toISOString(),
        caption: clip(v.video_description ?? v.title),
        permalink: typeof v.share_url === "string" ? v.share_url : null,
        format: "video",
        views: num(v.view_count),
        likes: num(v.like_count),
        comments: num(v.comment_count),
        shares: num(v.share_count),
      });
    }
    if (reachedOldest || !body.data?.has_more) break;
    cursor = num(body.data?.cursor);
  }
  // TikTok's follower count needs user.info.stats (not approved yet), so it keeps coming from
  // the follower sweep.
  return { posts, insights: null, audience: null, followers: null };
}

// ---------- Bluesky (public API, free, no permission) ----------
async function bluesky(ctx: ReadContext): Promise<AccountRead> {
  const posts: AccountPost[] = [];
  const oldest = ctx.now - LOOKBACK_DAYS * DAY;
  let cursor: string | undefined;
  for (let page = 0; page < 2 && posts.length < MAX_POSTS; page++) {
    const body = await getJson(ctx.http, `${BLUESKY_APPVIEW}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(ctx.externalId)}&filter=posts_no_replies&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    const feed = (body.feed ?? []) as Json[];
    let reachedOldest = false;
    for (const item of feed) {
      if (item.reason) continue; // a repost of someone else's post
      const post = item.post ?? {};
      const at = Date.parse(String(post.record?.createdAt ?? post.indexedAt));
      if (at < oldest) {
        reachedOldest = true;
        break;
      }
      const uri = String(post.uri ?? "");
      const embed = String(post.embed?.$type ?? "");
      const images = Array.isArray(post.embed?.images) ? post.embed.images.length : 0;
      posts.push({
        platformPostId: uri,
        publishedAt: new Date(at).toISOString(),
        caption: clip(post.record?.text),
        permalink: uri ? `https://bsky.app/profile/${encodeURIComponent(ctx.externalId)}/post/${uri.split("/").pop()}` : null,
        format: embed.includes("video") ? "video" : images > 1 ? "carousel" : embed.includes("images") ? "photo" : "text",
        likes: num(post.likeCount),
        comments: num(post.replyCount),
        reposts: num(post.repostCount),
        quotes: num(post.quoteCount),
        saves: num(post.bookmarkCount),
      });
      if (posts.length >= MAX_POSTS) break;
    }
    cursor = typeof body.cursor === "string" ? body.cursor : undefined;
    if (reachedOldest || !cursor) break;
  }
  // Bluesky's follower count is already read officially by the follower sweep.
  return { posts, insights: null, audience: null, followers: null };
}

export const ACCOUNT_READERS: Partial<Record<Platform, (ctx: ReadContext) => Promise<AccountRead>>> = { instagram, facebook, threads, tiktok, bluesky };

// ---------- The sweep ----------
export type AccountDeps = {
  sql: Sql;
  setting: Settings;
  platforms: Platform[]; // read through their own API here (ANALYTICS_PLATFORMS)
  http?: typeof fetch;
  token?: (accountId: string) => Promise<string>; // tests; otherwise the account's saved access
  readers?: Partial<Record<Platform, (ctx: ReadContext) => Promise<AccountRead>>>;
  onlyWorkspace?: string;
  now?: () => number;
  log?: (message: string, details?: Record<string, unknown>) => void;
};

type Claimed = { connected_account_id: string; workspace_id: string; platform: Platform; external_account_id: string; display_name: string; audience_synced_at: string | null };

const SYNC_EVERY = 12 * HOUR;
const AUDIENCE_EVERY = 7 * DAY;

export async function runAccountSweep(deps: AccountDeps): Promise<number> {
  const platforms = WHOLE_ACCOUNT_PLATFORMS.filter((p) => deps.platforms.includes(p));
  if (!platforms.length) return 0;
  const now = deps.now ?? Date.now;
  // New accounts get a schedule row, then up to 10 due accounts are leased for 10 minutes.
  await deps.sql(
    `INSERT INTO public.account_stats_syncs (connected_account_id)
     SELECT a.id FROM public.connected_accounts a
     WHERE a.platform = ANY($1::text[]) AND a.health <> 'disconnected'
     ON CONFLICT (connected_account_id) DO NOTHING`,
    [platforms],
  );
  const claimed = await deps.sql<Claimed>(
    `UPDATE public.account_stats_syncs s SET lease_until = now() + interval '10 minutes'
     FROM public.connected_accounts a
     WHERE s.connected_account_id = a.id AND s.connected_account_id IN (
       SELECT s2.connected_account_id FROM public.account_stats_syncs s2
       JOIN public.connected_accounts a2 ON a2.id = s2.connected_account_id
       JOIN public.workspaces w ON w.id = a2.workspace_id
       WHERE a2.platform = ANY($1::text[]) AND a2.health <> 'disconnected'
         AND (CASE WHEN $2::uuid IS NULL THEN NOT w.publishing_paused ELSE a2.workspace_id = $2 END)
         AND s2.next_sync_at <= now() AND (s2.lease_until IS NULL OR s2.lease_until < now())
       ORDER BY s2.next_sync_at LIMIT 10
       FOR UPDATE OF s2 SKIP LOCKED)
     RETURNING s.connected_account_id, a.workspace_id, a.platform, a.external_account_id, a.display_name, s.audience_synced_at`,
    [platforms, deps.onlyWorkspace ?? null],
  );
  let done = 0;
  for (const account of claimed) {
    try {
      await syncAccount(deps, account, now);
      done++;
    } catch (error) {
      const message = String((error as Error)?.message ?? error).slice(0, 500);
      const expired = Boolean((error as { expired?: boolean })?.expired);
      // A login that stopped working waits for the account to be reconnected (a day); any
      // other failure is tried again in a few hours.
      await deps.sql(`UPDATE public.account_stats_syncs SET lease_until = NULL, last_error = $2, next_sync_at = $3 WHERE connected_account_id = $1`, [
        account.connected_account_id,
        message,
        new Date(now() + (expired ? 24 : 6) * HOUR).toISOString(),
      ]);
      deps.log?.("account stats error", { account: account.connected_account_id, message });
    }
  }
  return done;
}

async function syncAccount(deps: AccountDeps, account: Claimed, now: () => number) {
  const reader = (deps.readers ?? ACCOUNT_READERS)[account.platform];
  if (!reader) return;
  const withAudience = !account.audience_synced_at || now() - Date.parse(account.audience_synced_at) > AUDIENCE_EVERY;
  const read = await reader({
    externalId: account.external_account_id,
    http: deps.http ?? fetch,
    now: now(),
    withAudience,
    token: () => (deps.token ? deps.token(account.connected_account_id) : accountToken(deps, { id: account.connected_account_id, platform: account.platform, displayName: account.display_name }, now)),
  });

  // Posts Post Social published are already in post_metrics (by the platform's id for them),
  // so they're left out here.
  if (read.posts.length) {
    await deps.sql(
      `INSERT INTO public.account_posts (connected_account_id, workspace_id, platform, platform_post_id, published_at, caption, permalink, format,
         views, likes, comments, shares, saves, reposts, quotes, reach, source, fetched_at)
       SELECT $1, $2, $3, p->>'platformPostId', (p->>'publishedAt')::timestamptz, p->>'caption', p->>'permalink', p->>'format',
         (p->>'views')::bigint, (p->>'likes')::bigint, (p->>'comments')::bigint, (p->>'shares')::bigint, (p->>'saves')::bigint,
         (p->>'reposts')::bigint, (p->>'quotes')::bigint, (p->>'reach')::bigint, 'official', now()
       FROM jsonb_array_elements($4::jsonb) p
       WHERE NOT EXISTS (SELECT 1 FROM public.destinations d WHERE d.connected_account_id = $1 AND d.platform_request_id = p->>'platformPostId')
       ON CONFLICT (connected_account_id, platform_post_id) DO UPDATE SET
         caption = EXCLUDED.caption, permalink = EXCLUDED.permalink, format = EXCLUDED.format,
         views = coalesce(EXCLUDED.views, account_posts.views), likes = coalesce(EXCLUDED.likes, account_posts.likes),
         comments = coalesce(EXCLUDED.comments, account_posts.comments), shares = coalesce(EXCLUDED.shares, account_posts.shares),
         saves = coalesce(EXCLUDED.saves, account_posts.saves), reposts = coalesce(EXCLUDED.reposts, account_posts.reposts),
         quotes = coalesce(EXCLUDED.quotes, account_posts.quotes), reach = coalesce(EXCLUDED.reach, account_posts.reach),
         fetched_at = now()`,
      [account.connected_account_id, account.workspace_id, account.platform, JSON.stringify(read.posts)],
    );
  }
  const i = read.insights;
  if (i) {
    await deps.sql(
      `INSERT INTO public.account_insight_days (connected_account_id, workspace_id, day, views, reach, profile_views, interactions, engaged)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8)
       ON CONFLICT (connected_account_id, day) DO UPDATE SET views = EXCLUDED.views, reach = EXCLUDED.reach, profile_views = EXCLUDED.profile_views,
         interactions = EXCLUDED.interactions, engaged = EXCLUDED.engaged, fetched_at = now()`,
      [account.connected_account_id, account.workspace_id, i.day, i.views ?? null, i.reach ?? null, i.profileViews ?? null, i.interactions ?? null, i.engaged ?? null],
    );
  }
  if (read.audience) {
    await deps.sql(
      `INSERT INTO public.account_audiences (connected_account_id, workspace_id, breakdowns) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (connected_account_id) DO UPDATE SET breakdowns = EXCLUDED.breakdowns, fetched_at = now()`,
      [account.connected_account_id, account.workspace_id, JSON.stringify(read.audience)],
    );
  }
  // The platform's own follower count replaces a public one for today.
  if (read.followers !== null && read.followers !== undefined && read.followers >= 0) {
    await deps.sql(
      `INSERT INTO public.account_follower_days (connected_account_id, workspace_id, day, followers, source)
       VALUES ($1, $2, (now() AT TIME ZONE 'UTC')::date, $3, 'official')
       ON CONFLICT (connected_account_id, day) DO UPDATE SET followers = EXCLUDED.followers, source = 'official', fetched_at = now()`,
      [account.connected_account_id, account.workspace_id, read.followers],
    );
  }
  await deps.sql(
    `UPDATE public.account_stats_syncs SET lease_until = NULL, last_error = NULL, last_synced_at = now(), next_sync_at = $2,
       audience_synced_at = CASE WHEN $3::boolean THEN now() ELSE audience_synced_at END
     WHERE connected_account_id = $1`,
    [account.connected_account_id, new Date(now() + SYNC_EVERY).toISOString(), withAudience],
  );
}
