// Reads one published post's stats from its platform. Each platform reports different
// numbers, and some need a read permission the account may not have granted yet; those
// are listed in `unavailable` and left out, never reported as zero.
import type { Platform } from "../../../backend/lib/connections/platforms";

export type Counters = { views?: number; likes?: number; comments?: number; shares?: number; saves?: number; reposts?: number; quotes?: number };
export type MetricsResult = Counters & {
  extra: Record<string, number>;
  unavailable: Array<keyof Counters>;
  // The platform's id for the post, when it was only known later (TikTok inbox posts).
  resolvedId?: string;
  // The post is not live on the platform yet (e.g. still in the TikTok inbox).
  notYetPosted?: boolean;
};

export type FetchContext = {
  platformId: string;
  mediaType?: string; // from the destination's options
  token: () => Promise<string>;
  http: typeof fetch;
};

const num = (value: unknown) => (value === undefined || value === null || value === "" || Number.isNaN(Number(value)) ? undefined : Number(value));

async function getJson(ctx: FetchContext, url: string, init: RequestInit = {}) {
  const response = await ctx.http(url, init);
  const text = await response.text();
  let body: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // keep empty
  }
  const error = body.error && typeof body.error === "object" && body.error.code !== "ok" ? body.error : null;
  if (!response.ok || error) {
    const message = error?.message ?? `HTTP ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status, expired: response.status === 401 || error?.code === 190 || error?.code === "access_token_invalid" });
  }
  return body;
}

// Meta insights: data[] of { name, values: [{ value }] } or { name, total_value: { value } }.
function insightValues(body: Record<string, any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: Record<string, number> = {};
  for (const item of (body.data ?? []) as Array<{ name: string; values?: Array<{ value: unknown }>; total_value?: { value: unknown } }>) {
    const value = num(item.total_value?.value ?? item.values?.[0]?.value);
    if (value !== undefined) out[item.name] = value;
  }
  return out;
}

const withToken = (url: string, token: string) => `${url}${url.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
const tryOr = async <T>(fn: () => Promise<T>): Promise<T | null> => fn().catch((error) => (error?.expired ? Promise.reject(error) : null));

async function instagram(ctx: FetchContext): Promise<MetricsResult> {
  const base = "https://graph.instagram.com/v25.0";
  const token = await ctx.token();
  const basic = await getJson(ctx, withToken(`${base}/${ctx.platformId}?fields=like_count,comments_count`, token));
  const result: MetricsResult = { likes: num(basic.like_count), comments: num(basic.comments_count), extra: {}, unavailable: [] };
  // Views, shares and saves need instagram_business_manage_insights.
  const insights = await tryOr(() => getJson(ctx, withToken(`${base}/${ctx.platformId}/insights?metric=views,reach,shares,saved,total_interactions`, token)));
  if (!insights) return { ...result, unavailable: ["views", "shares", "saves"] };
  const v = insightValues(insights);
  return {
    ...result,
    views: v.views,
    shares: v.shares,
    saves: v.saved,
    extra: { ...(v.reach !== undefined ? { reach: v.reach } : {}), ...(v.total_interactions !== undefined ? { total_interactions: v.total_interactions } : {}) },
  };
}

async function facebook(ctx: FetchContext): Promise<MetricsResult> {
  const base = "https://graph.facebook.com/v25.0";
  const token = await ctx.token();
  const video = ctx.mediaType === "reel" || ctx.mediaType === "video";
  if (video) {
    const basic = await getJson(ctx, withToken(`${base}/${ctx.platformId}?fields=likes.summary(true).limit(0),comments.summary(true).limit(0)`, token));
    const result: MetricsResult = { likes: num(basic.likes?.summary?.total_count), comments: num(basic.comments?.summary?.total_count), extra: {}, unavailable: [] };
    // Plays need read_insights.
    const metric = ctx.mediaType === "reel" ? "blue_reels_play_count" : "total_video_views";
    const insights = await tryOr(() => getJson(ctx, withToken(`${base}/${ctx.platformId}/video_insights?metric=${metric}`, token)));
    if (!insights) return { ...result, unavailable: ["views"] };
    return { ...result, views: insightValues(insights)[metric] };
  }
  const basic = await getJson(ctx, withToken(`${base}/${ctx.platformId}?fields=reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares`, token));
  const result: MetricsResult = {
    likes: num(basic.reactions?.summary?.total_count),
    comments: num(basic.comments?.summary?.total_count),
    shares: num(basic.shares?.count) ?? 0, // Facebook omits `shares` when there are none
    extra: {},
    unavailable: [],
  };
  // Views need read_insights. Meta has been renaming this metric, so try both names.
  for (const metric of ["post_media_view", "post_impressions"]) {
    const insights = await tryOr(() => getJson(ctx, withToken(`${base}/${ctx.platformId}/insights?metric=${metric}`, token)));
    const value = insights ? insightValues(insights)[metric] : undefined;
    if (value !== undefined) return { ...result, views: value };
  }
  return { ...result, unavailable: ["views"] };
}

async function threads(ctx: FetchContext): Promise<MetricsResult> {
  const token = await ctx.token();
  // Every Threads number needs threads_manage_insights.
  const insights = await tryOr(() => getJson(ctx, withToken(`https://graph.threads.net/v1.0/${ctx.platformId}/insights?metric=views,likes,replies,reposts,quotes,shares`, token)));
  if (!insights) return { extra: {}, unavailable: ["views", "likes", "comments", "reposts", "quotes", "shares"] };
  const v = insightValues(insights);
  return { views: v.views, likes: v.likes, comments: v.replies, reposts: v.reposts, quotes: v.quotes, shares: v.shares, extra: {}, unavailable: [] };
}

async function youtube(ctx: FetchContext): Promise<MetricsResult> {
  const token = await ctx.token();
  // Needs youtube.readonly; the upload permission alone cannot read statistics.
  const body = await tryOr(() => getJson(ctx, `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(ctx.platformId)}`, { headers: { Authorization: `Bearer ${token}` } }));
  if (!body) return { extra: {}, unavailable: ["views", "likes", "comments"] };
  const stats = body.items?.[0]?.statistics ?? {};
  return { views: num(stats.viewCount), likes: num(stats.likeCount), comments: num(stats.commentCount), extra: {}, unavailable: [] };
}

async function tiktok(ctx: FetchContext): Promise<MetricsResult> {
  const api = "https://open.tiktokapis.com/v2";
  const token = await ctx.token();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" };
  let videoId = ctx.platformId;
  let resolvedId: string | undefined;
  // Inbox posts are known by their publish id until the creator posts them from TikTok.
  if (!/^\d+$/.test(videoId)) {
    const status = await getJson(ctx, `${api}/post/publish/status/fetch/`, { method: "POST", headers, body: JSON.stringify({ publish_id: videoId }) });
    const posted = (status.data?.publicaly_available_post_id ?? []) as Array<string | number>;
    if (!posted.length) return { extra: {}, unavailable: [], notYetPosted: true };
    videoId = String(posted[0]);
    resolvedId = videoId;
  }
  // Needs video.list.
  const body = await tryOr(() =>
    getJson(ctx, `${api}/video/query/?fields=id,view_count,like_count,comment_count,share_count`, { method: "POST", headers, body: JSON.stringify({ filters: { video_ids: [videoId] } }) }),
  );
  if (!body) return { extra: {}, unavailable: ["views", "likes", "comments", "shares"], resolvedId };
  const video = body.data?.videos?.[0] ?? {};
  return { views: num(video.view_count), likes: num(video.like_count), comments: num(video.comment_count), shares: num(video.share_count), extra: {}, unavailable: [], resolvedId };
}

// Reading a member's post stats needs r_member_social, which LinkedIn grants only to
// approved partners, so none are fetched.
async function linkedin(): Promise<MetricsResult> {
  return { extra: {}, unavailable: ["views", "likes", "comments", "shares"] };
}

export const FETCHERS: Record<Platform, (ctx: FetchContext) => Promise<MetricsResult>> = { instagram, facebook, threads, youtube, tiktok, linkedin };
