// Public numbers: what anyone can see on a post's or profile's public page, read through
// ScrapeCreators (one credit per read). Used for a platform until it approves Post Social's
// own read permissions, and to fill gaps the official numbers leave. Only numbers the page
// actually shows are returned; nothing is guessed.
import type { Platform } from "../../../backend/lib/connections/platforms";
import type { Counters, MetricsResult } from "./platforms";

export const SCRAPECREATORS_BASE = "https://api.scrapecreators.com";

export type PublicContext = {
  apiKey: string;
  http: typeof fetch;
};

export type PublicPostResult = MetricsResult & { followers?: number };

export type FollowerTarget = { platform: Platform; handle: string | null; externalId: string };

// "1,234", 1234, "1234" -> 1234; anything else -> undefined.
const num = (value: unknown) => {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(typeof value === "string" ? value.replace(/,/g, "") : value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

async function read(ctx: PublicContext, path: string, params: Record<string, string>) {
  const url = `${SCRAPECREATORS_BASE}${path}?${new URLSearchParams(params)}`;
  const response = await ctx.http(url, { headers: { "x-api-key": ctx.apiKey } });
  const text = await response.text();
  let body: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // keep empty
  }
  if (!response.ok || body.success === false) {
    const message = String(body.message ?? body.error ?? `HTTP ${response.status}`);
    // A post that's gone (deleted or made private) reads as "not found".
    throw Object.assign(new Error(response.status === 404 ? `Post not found: ${message}` : message), { status: response.status });
  }
  return body;
}

// Drops counters the page did not show, and lists them as unavailable.
function result(values: Counters, followers?: number): PublicPostResult {
  const out: PublicPostResult = { extra: {}, unavailable: [] };
  for (const [key, value] of Object.entries(values) as Array<[keyof Counters, number | undefined]>) {
    if (value === undefined) out.unavailable.push(key);
    else out[key] = value;
  }
  if (followers !== undefined) out.followers = followers;
  return out;
}

// The numbers each platform's public post page shows, so a gap is only filled (one credit)
// when the page can actually fill it.
export const PUBLIC_POST_FIELDS: Partial<Record<Platform, Array<keyof Counters>>> = {
  tiktok: ["views", "likes", "comments", "shares", "saves"],
  instagram: ["views", "likes", "comments"],
  facebook: ["views", "likes", "comments", "shares"],
  threads: ["likes", "comments", "reposts", "quotes", "shares"],
  youtube: ["views", "likes", "comments"],
  linkedin: ["likes", "comments"],
  x: ["views", "likes", "comments", "reposts", "quotes", "saves"],
};

type PostReader = (ctx: PublicContext, url: string) => Promise<PublicPostResult>;

// Bluesky has none: its own public API is free and needs no approval, so it's read directly.
export const PUBLIC_POST_READERS: Partial<Record<Platform, PostReader>> = {
  async tiktok(ctx, url) {
    const body = await read(ctx, "/v2/tiktok/video", { url });
    const s = body.aweme_detail?.statistics ?? {};
    return result({ views: num(s.play_count), likes: num(s.digg_count), comments: num(s.comment_count), shares: num(s.share_count), saves: num(s.collect_count) }, num(body.aweme_detail?.author?.follower_count));
  },
  async instagram(ctx, url) {
    const body = await read(ctx, "/v1/instagram/post", { url });
    const m = body.data?.xdt_shortcode_media ?? {};
    // Views are public on videos (Reels) only; shares and saves never are.
    return result({
      views: m.is_video ? num(m.video_play_count ?? m.video_view_count) : undefined,
      likes: num(m.edge_media_preview_like?.count ?? m.edge_liked_by?.count),
      comments: num(m.edge_media_to_parent_comment?.count ?? m.comment_count),
    }, num(m.owner?.edge_followed_by?.count));
  },
  async facebook(ctx, url) {
    const body = await read(ctx, "/v1/facebook/post", { url });
    return result({ views: num(body.view_count), likes: num(body.like_count), comments: num(body.comment_count), shares: num(body.share_count) });
  },
  async threads(ctx, url) {
    const body = await read(ctx, "/v1/threads/post", { url });
    const p = body.post ?? {};
    const info = p.text_post_app_info ?? {};
    return result({ likes: num(p.like_count), comments: num(info.direct_reply_count), reposts: num(info.repost_count), quotes: num(info.quote_count), shares: num(info.reshare_count) }, num(p.user?.follower_count));
  },
  async youtube(ctx, url) {
    const body = await read(ctx, "/v1/youtube/video", { url });
    return result({ views: num(body.viewCountInt), likes: num(body.likeCountInt), comments: num(body.commentCountInt) });
  },
  async linkedin(ctx, url) {
    const body = await read(ctx, "/v1/linkedin/post", { url });
    return result({ likes: num(body.likeCount), comments: num(body.commentCount) }, num(body.author?.followers));
  },
  async x(ctx, url) {
    const body = await read(ctx, "/v1/twitter/tweet", { url });
    const l = body.legacy ?? {};
    return result(
      { views: num(body.views?.count), likes: num(l.favorite_count), comments: num(l.reply_count), reposts: num(l.retweet_count), quotes: num(l.quote_count), saves: num(l.bookmark_count) },
      num(body.core?.user_results?.result?.legacy?.followers_count),
    );
  },
};

// An account's follower count from its public profile. null: this platform's profile can't
// be looked up from what Post Social knows (LinkedIn members share no public address; their
// count is saved from their posts instead).
export async function publicFollowers(ctx: PublicContext, target: FollowerTarget): Promise<number | null> {
  const handle = target.handle?.replace(/^@/, "").trim() || null;
  switch (target.platform) {
    case "tiktok": {
      if (!handle) return null;
      const body = await read(ctx, "/v1/tiktok/profile", { handle });
      return num(body.statsV2?.followerCount ?? body.stats?.followerCount) ?? null;
    }
    case "instagram": {
      if (!handle) return null;
      const body = await read(ctx, "/v1/instagram/profile", { handle });
      return num(body.data?.user?.edge_followed_by?.count) ?? null;
    }
    case "threads": {
      if (!handle) return null;
      const body = await read(ctx, "/v1/threads/profile", { handle });
      return num(body.follower_count) ?? null;
    }
    case "x": {
      if (!handle) return null;
      const body = await read(ctx, "/v1/twitter/profile", { handle });
      return num(body.legacy?.followers_count) ?? null;
    }
    case "youtube": {
      const body = await read(ctx, "/v1/youtube/channel", { channelId: target.externalId });
      return num(body.subscriberCount) ?? null;
    }
    case "facebook": {
      const body = await read(ctx, "/v1/facebook/profile", { url: `https://www.facebook.com/${target.externalId}` });
      return num(body.followerCount) ?? null;
    }
    case "bluesky": {
      const body = await read(ctx, "/v1/bluesky/profile", { handle: handle ?? target.externalId });
      return num(body.followersCount) ?? null;
    }
    case "linkedin":
      return null;
  }
}
