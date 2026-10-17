import { describe, expect, it } from "vitest";
import { PUBLIC_POST_READERS, publicFollowers, type PublicContext } from "./public";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function ctx(body: unknown, status = 200): PublicContext & { calls: Array<{ url: URL; key: string | null }> } {
  const calls: Array<{ url: URL; key: string | null }> = [];
  return {
    apiKey: "sc-key",
    calls,
    http: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ url: new URL(String(input)), key: new Headers(init.headers).get("x-api-key") });
      return json(body, status);
    }) as typeof fetch,
  };
}

describe("public post numbers", () => {
  it("TikTok: views, likes, comments, shares, saves and the author's followers, sent with the key", async () => {
    const c = ctx({ aweme_detail: { statistics: { play_count: 1200, digg_count: 80, comment_count: 4, share_count: 3, collect_count: 9 }, author: { follower_count: 5100 } } });
    const r = await PUBLIC_POST_READERS.tiktok!(c, "https://www.tiktok.com/@a/video/1");
    expect(r).toMatchObject({ views: 1200, likes: 80, comments: 4, shares: 3, saves: 9, followers: 5100, unavailable: [] });
    expect(c.calls[0].url.pathname).toBe("/v2/tiktok/video");
    expect(c.calls[0].url.searchParams.get("url")).toBe("https://www.tiktok.com/@a/video/1");
    expect(c.calls[0].key).toBe("sc-key");
  });

  it("Instagram: views only on videos; shares and saves are never public", async () => {
    const photo = await PUBLIC_POST_READERS.instagram!(ctx({ data: { xdt_shortcode_media: { is_video: false, edge_media_preview_like: { count: 50 }, edge_media_to_parent_comment: { count: 2 } } } }), "u");
    expect(photo).toMatchObject({ likes: 50, comments: 2 });
    expect(photo.views).toBeUndefined();
    expect(photo.unavailable).toEqual(["views"]);
    const reel = await PUBLIC_POST_READERS.instagram!(ctx({ data: { xdt_shortcode_media: { is_video: true, video_play_count: 900, edge_media_preview_like: { count: 5 }, edge_media_to_parent_comment: { count: 1 } } } }), "u");
    expect(reel.views).toBe(900);
  });

  it("Threads: replies, reposts, quotes and reshares; X: bookmarks as saves and views", async () => {
    const t = await PUBLIC_POST_READERS.threads!(ctx({ post: { like_count: 7, text_post_app_info: { direct_reply_count: 2, repost_count: 1, quote_count: 0, reshare_count: 3 } } }), "u");
    expect(t).toMatchObject({ likes: 7, comments: 2, reposts: 1, quotes: 0, shares: 3 });
    const x = await PUBLIC_POST_READERS.x!(ctx({ views: { count: "4321" }, legacy: { favorite_count: 10, reply_count: 1, retweet_count: 2, quote_count: 0, bookmark_count: 5 }, core: { user_results: { result: { legacy: { followers_count: 300 } } } } }), "u");
    expect(x).toMatchObject({ views: 4321, likes: 10, comments: 1, reposts: 2, quotes: 0, saves: 5, followers: 300 });
  });

  it("YouTube, Facebook and LinkedIn read what their pages show", async () => {
    expect(await PUBLIC_POST_READERS.youtube!(ctx({ viewCountInt: 100, likeCountInt: 9, commentCountInt: 1 }), "u")).toMatchObject({ views: 100, likes: 9, comments: 1 });
    expect(await PUBLIC_POST_READERS.facebook!(ctx({ like_count: 4, comment_count: 1, share_count: 2 }), "u")).toMatchObject({ likes: 4, comments: 1, shares: 2, unavailable: ["views"] });
    expect(await PUBLIC_POST_READERS.linkedin!(ctx({ likeCount: 12, commentCount: 3, author: { followers: 880 } }), "u")).toMatchObject({ likes: 12, comments: 3, followers: 880 });
  });

  it("YouTube: a video names its channel's @handle and name", async () => {
    const r = await PUBLIC_POST_READERS.youtube!(ctx({ viewCountInt: 5, channel: { id: "UCabc", handle: "@makerchannel", title: "Maker Channel" } }), "u");
    expect(r.channel).toEqual({ handle: "makerchannel", name: "Maker Channel" });
    expect((await PUBLIC_POST_READERS.youtube!(ctx({ viewCountInt: 5 }), "u")).channel).toBeUndefined();
  });

  it("has no Bluesky reader (its own API is free and read directly)", () => {
    expect(PUBLIC_POST_READERS.bluesky).toBeUndefined();
  });

  it("a missing post reads as not found, and other failures pass their message on", async () => {
    await expect(PUBLIC_POST_READERS.youtube!(ctx({ message: "Video unavailable" }, 404), "u")).rejects.toThrow(/Post not found/);
    await expect(PUBLIC_POST_READERS.youtube!(ctx({ success: false, message: "Out of credits" }), "u")).rejects.toThrow("Out of credits");
  });
});

describe("public follower counts", () => {
  it("looks profiles up by handle (without the @) or by id", async () => {
    const c = ctx({ statsV2: { followerCount: "12000" } });
    expect(await publicFollowers(c, { platform: "tiktok", handle: "@maker", externalId: "1" })).toBe(12000);
    expect(c.calls[0].url.searchParams.get("handle")).toBe("maker");
    const y = ctx({ subscriberCount: 450 });
    expect(await publicFollowers(y, { platform: "youtube", handle: null, externalId: "UCWH3hing1Qb4LnkRfQdxsxQ" })).toBe(450);
    expect(y.calls[0].url.searchParams.get("channelId")).toBe("UCWH3hing1Qb4LnkRfQdxsxQ");
    const f = ctx({ followerCount: 77 });
    expect(await publicFollowers(f, { platform: "facebook", handle: null, externalId: "999" })).toBe(77);
    expect(f.calls[0].url.searchParams.get("url")).toBe("https://www.facebook.com/999");
  });

  it("looks a YouTube channel up by the @handle learned from its videos", async () => {
    const y = ctx({ subscriberCount: 1200 });
    expect(await publicFollowers(y, { platform: "youtube", handle: "makerchannel", externalId: "workspace-grant-key" })).toBe(1200);
    expect(y.calls[0].url.searchParams.get("handle")).toBe("makerchannel");
    expect(y.calls[0].url.searchParams.get("channelId")).toBeNull();
  });

  it("returns null when the profile can't be looked up, without spending a read", async () => {
    const c = ctx({});
    // Upload-only YouTube: a placeholder handle and no channel id.
    expect(await publicFollowers(c, { platform: "youtube", handle: "youtube", externalId: "workspace-grant-key" })).toBeNull();
    expect(await publicFollowers(c, { platform: "tiktok", handle: "tiktok", externalId: "1" })).toBeNull();
    expect(await publicFollowers(c, { platform: "linkedin", handle: "x", externalId: "1" })).toBeNull();
    expect(await publicFollowers(c, { platform: "instagram", handle: null, externalId: "1" })).toBeNull();
    expect(c.calls).toHaveLength(0);
  });
});
