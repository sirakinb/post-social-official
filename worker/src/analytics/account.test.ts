import { describe, expect, it } from "vitest";
import type { Sql } from "../../../backend/lib/access";
import { ACCOUNT_READERS, runAccountSweep, type AccountRead, type ReadContext } from "./account";

const NOW = Date.UTC(2026, 10, 21, 12, 0, 0); // Nov 21, 2026 12:00 UTC
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

// A fake platform: answers by the first route whose pattern matches the URL; unmatched URLs
// fail like a permission the account hasn't granted (HTTP 400).
function fakeHttp(routes: Array<[RegExp, unknown, number?]>) {
  const calls: string[] = [];
  const http = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) return new Response(JSON.stringify({ error: { message: "(#10) Application does not have permission", code: 10 } }), { status: 400 });
    return new Response(JSON.stringify(route[1]), { status: route[2] ?? 200 });
  }) as typeof fetch;
  return { http, calls };
}
const ctx = (http: typeof fetch, externalId = "acct", withAudience = false): ReadContext => ({ externalId, token: async () => "tok", http, now: NOW, withAudience });

describe("reading a whole Instagram account", () => {
  it("brings every recent post with its numbers, the account's day and its audience", async () => {
    const { http, calls } = fakeHttp([
      [/\/me\/media\?/, { data: [
        { id: "m1", caption: "Launch day", media_type: "VIDEO", media_product_type: "REELS", permalink: "https://instagram.com/p/m1", timestamp: ago(2), like_count: 40, comments_count: 5 },
        { id: "m2", caption: "Old carousel", media_type: "CAROUSEL_ALBUM", permalink: "https://instagram.com/p/m2", timestamp: ago(60), like_count: 9, comments_count: 1 },
        { id: "m3", caption: "Too old", media_type: "IMAGE", timestamp: ago(120) },
      ] }],
      [/\/m1\/insights/, { data: [{ name: "views", values: [{ value: 1200 }] }, { name: "reach", values: [{ value: 900 }] }, { name: "shares", values: [{ value: 7 }] }, { name: "saved", values: [{ value: 3 }] }] }],
      [/\/me\?fields=followers_count/, { followers_count: 5100 }],
      [/metric=reach,views,profile_views/, { data: [{ name: "reach", total_value: { value: 800 } }, { name: "views", total_value: { value: 2500 } }, { name: "profile_views", total_value: { value: 41 } }, { name: "total_interactions", total_value: { value: 120 } }, { name: "accounts_engaged", total_value: { value: 60 } }] }],
      [/breakdown=country/, { data: [{ total_value: { breakdowns: [{ results: [{ dimension_values: ["US"], value: 300 }, { dimension_values: ["NG"], value: 120 }] }] } }] }],
      [/breakdown=gender/, { data: [{ total_value: { breakdowns: [{ results: [{ dimension_values: ["F"], value: 200 }, { dimension_values: ["M"], value: 180 }] }] } }] }],
    ]);
    const read = await ACCOUNT_READERS.instagram!(ctx(http, "ig1", true));
    expect(read.posts.map((p) => [p.platformPostId, p.format, p.likes, p.views, p.reach, p.shares, p.saves])).toEqual([
      ["m1", "video", 40, 1200, 900, 7, 3],
      // Older than 30 days: basic numbers only, no insights call.
      ["m2", "carousel", 9, undefined, undefined, undefined, undefined],
    ]);
    expect(calls.some((c) => c.includes("/m2/insights"))).toBe(false);
    expect(read.followers).toBe(5100);
    expect(read.insights).toEqual({ day: "2026-11-20", reach: 800, views: 2500, profileViews: 41, interactions: 120, engaged: 60 });
    expect(read.audience).toEqual({ country: [{ label: "US", value: 300 }, { label: "NG", value: 120 }], gender: [{ label: "F", value: 200 }, { label: "M", value: 180 }] });
  });

  it("still brings posts when the account hasn't granted the insights permission", async () => {
    const { http } = fakeHttp([
      [/\/me\/media\?/, { data: [{ id: "m1", media_type: "IMAGE", timestamp: ago(1), like_count: 3, comments_count: 0 }] }],
      [/\/me\?fields=followers_count/, { followers_count: 10 }],
    ]);
    const read = await ACCOUNT_READERS.instagram!(ctx(http));
    expect(read.posts).toHaveLength(1);
    expect(read.posts[0]).toMatchObject({ likes: 3, comments: 0 });
    expect(read.posts[0].views).toBeUndefined();
    expect(read.insights).toBeNull();
    expect(read.audience).toBeNull();
  });

  it("stops the whole read when the login has expired", async () => {
    const { http } = fakeHttp([[/\/me\/media\?/, { error: { message: "Session has expired", code: 190 } }, 400]]);
    await expect(ACCOUNT_READERS.instagram!(ctx(http))).rejects.toMatchObject({ expired: true });
  });
});

describe("reading a whole Facebook Page", () => {
  it("reads the Page's posts, tries Meta's new metric names then the old ones, and its day", async () => {
    const { http } = fakeHttp([
      [/published_posts/, { data: [
        { id: "pg_1", message: "Hello", created_time: ago(1), permalink_url: "https://facebook.com/pg_1", attachments: { data: [{ media_type: "photo" }] }, reactions: { summary: { total_count: 12 } }, comments: { summary: { total_count: 2 } } },
        { id: "pg_2", created_time: ago(3), attachments: { data: [{ media_type: "video_inline" }] }, reactions: { summary: { total_count: 4 } }, comments: { summary: { total_count: 0 } }, shares: { count: 1 } },
      ] }],
      // New names only on pg_1; pg_2 answers to the old ones.
      [/pg_1\/insights\?metric=post_media_view/, { data: [{ name: "post_media_view", values: [{ value: 300 }] }] }],
      [/pg_1\/insights\?metric=post_total_media_view_unique/, { data: [{ name: "post_total_media_view_unique", values: [{ value: 200 }] }] }],
      [/pg_2\/insights\?metric=post_impressions&/, { data: [{ name: "post_impressions", values: [{ value: 80 }] }] }],
      [/pg_2\/insights\?metric=post_impressions_unique/, { data: [{ name: "post_impressions_unique", values: [{ value: 60 }] }] }],
      [/page1\?fields=followers_count/, { followers_count: 900 }],
      [/page1\/insights\?metric=page_media_view&/, { data: [{ name: "page_media_view", values: [{ value: 1500 }] }] }],
      [/page1\/insights\?metric=page_post_engagements&/, { data: [{ name: "page_post_engagements", values: [{ value: 70 }] }] }],
    ]);
    const read = await ACCOUNT_READERS.facebook!(ctx(http, "page1"));
    expect(read.posts.map((p) => [p.platformPostId, p.format, p.likes, p.comments, p.shares, p.views, p.reach])).toEqual([
      ["pg_1", "photo", 12, 2, 0, 300, 200],
      ["pg_2", "video", 4, 0, 1, 80, 60],
    ]);
    expect(read.followers).toBe(900);
    expect(read.insights).toEqual({ day: "2026-11-20", views: 1500, reach: undefined, interactions: 70, profileViews: undefined });
    expect(read.audience).toBeNull();
  });
});

describe("reading a whole Threads account", () => {
  it("skips reposts, reads recent posts' insights, the account's day and followers", async () => {
    const { http } = fakeHttp([
      [/\/me\/threads\?/, { data: [
        { id: "t1", text: "Thought", media_type: "TEXT_POST", permalink: "https://threads.net/t1", timestamp: ago(1) },
        { id: "t2", media_type: "REPOST_FACADE", timestamp: ago(1) },
      ] }],
      [/t1\/insights/, { data: [{ name: "views", values: [{ value: 400 }] }, { name: "likes", values: [{ value: 20 }] }, { name: "replies", values: [{ value: 4 }] }, { name: "reposts", values: [{ value: 2 }] }, { name: "quotes", values: [{ value: 1 }] }, { name: "shares", values: [{ value: 0 }] }] }],
      [/threads_insights\?metric=followers_count/, { data: [{ name: "followers_count", total_value: { value: 250 } }] }],
      [/threads_insights\?metric=views,likes/, { data: [{ name: "views", values: [{ value: 100 }, { value: 50 }] }, { name: "likes", total_value: { value: 9 } }, { name: "replies", total_value: { value: 3 } }] }],
    ]);
    const read = await ACCOUNT_READERS.threads!(ctx(http));
    expect(read.posts).toEqual([{ platformPostId: "t1", publishedAt: ago(1), caption: "Thought", permalink: "https://threads.net/t1", format: "text", views: 400, likes: 20, comments: 4, reposts: 2, quotes: 1, shares: 0 }]);
    expect(read.followers).toBe(250);
    expect(read.insights).toEqual({ day: "2026-11-20", views: 150, interactions: 12 });
  });
});

describe("reading every TikTok video", () => {
  it("pages through video.list until 90 days back", async () => {
    let page = 0;
    const http = (async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toContain("/v2/video/list/");
      expect(JSON.parse(String(init?.body)).max_count).toBe(20);
      page++;
      const body = page === 1
        ? { data: { videos: [{ id: "v1", video_description: "Clip", create_time: Math.floor(Date.parse(ago(5)) / 1000), share_url: "https://tiktok.com/v1", view_count: 1000, like_count: 50, comment_count: 4, share_count: 2 }], has_more: true, cursor: 123 }, error: { code: "ok" } }
        : { data: { videos: [{ id: "v0", create_time: Math.floor(Date.parse(ago(100)) / 1000) }], has_more: true, cursor: 99 }, error: { code: "ok" } };
      return new Response(JSON.stringify(body));
    }) as typeof fetch;
    const read = await ACCOUNT_READERS.tiktok!(ctx(http));
    expect(read.posts).toEqual([{ platformPostId: "v1", publishedAt: ago(5), caption: "Clip", permalink: "https://tiktok.com/v1", format: "video", views: 1000, likes: 50, comments: 4, shares: 2 }]);
    expect(page).toBe(2);
    expect(read.followers).toBeNull();
  });

  it("brings nothing (no error) when the account can't read video.list yet", async () => {
    const { http } = fakeHttp([]);
    expect((await ACCOUNT_READERS.tiktok!(ctx(http))).posts).toEqual([]);
  });
});

describe("reading a whole Bluesky account", () => {
  it("reads the author feed, leaving out reposts of other people's posts", async () => {
    const { http } = fakeHttp([
      [/getAuthorFeed\?actor=did%3Aplc%3Aabc/, { feed: [
        { post: { uri: "at://did:plc:abc/app.bsky.feed.post/3k1", record: { text: "Hi sky", createdAt: ago(2) }, likeCount: 8, replyCount: 1, repostCount: 2, quoteCount: 0, embed: { $type: "app.bsky.embed.images#view", images: [{}] } } },
        { reason: { $type: "app.bsky.feed.defs#reasonRepost" }, post: { uri: "at://did:plc:other/app.bsky.feed.post/9", record: { createdAt: ago(1) } } },
      ] }],
    ]);
    const read = await ACCOUNT_READERS.bluesky!(ctx(http, "did:plc:abc"));
    expect(read.posts).toEqual([{ platformPostId: "at://did:plc:abc/app.bsky.feed.post/3k1", publishedAt: ago(2), caption: "Hi sky", permalink: "https://bsky.app/profile/did%3Aplc%3Aabc/post/3k1", format: "photo", likes: 8, comments: 1, reposts: 2, quotes: 0, saves: undefined }]);
  });
});

// A stand-in for the database: the claimed accounts and every write.
function fakeDb(claimed: Array<Record<string, unknown>>) {
  const writes: Array<{ query: string; params: unknown[] }> = [];
  const sql = (async (query: string, params: unknown[] = []) => {
    if (query.includes("RETURNING s.connected_account_id")) return claimed;
    writes.push({ query, params });
    return [];
  }) as unknown as Sql;
  return { sql, writes };
}
const ACCOUNT = { connected_account_id: "a1", workspace_id: "w1", platform: "instagram", external_account_id: "ig1", display_name: "Maker", audience_synced_at: null };

describe("the whole-account sweep", () => {
  it("saves posts (never ones Post Social published), the day's numbers, the audience and the official follower count", async () => {
    const db = fakeDb([ACCOUNT]);
    const read: AccountRead = {
      posts: [{ platformPostId: "m1", publishedAt: ago(1), caption: "x", permalink: null, format: "photo", likes: 3 }],
      insights: { day: "2026-11-20", views: 10, reach: 5 },
      audience: { age: [{ label: "25-34", value: 10 }] },
      followers: 77,
    };
    let askedAudience: boolean | undefined;
    const n = await runAccountSweep({
      sql: db.sql,
      setting: () => "",
      platforms: ["instagram", "x"],
      readers: { instagram: async (c) => ((askedAudience = c.withAudience), read) },
      token: async () => "tok",
      now: () => NOW,
    });
    expect(n).toBe(1);
    expect(askedAudience).toBe(true);
    const posts = db.writes.find((w) => w.query.includes("INSERT INTO public.account_posts"))!;
    expect(posts.query).toContain("NOT EXISTS (SELECT 1 FROM public.destinations d WHERE d.connected_account_id = $1 AND d.platform_request_id = p->>'platformPostId')");
    expect(JSON.parse(String(posts.params[3]))).toEqual(read.posts);
    expect(db.writes.find((w) => w.query.includes("account_insight_days"))!.params).toEqual(["a1", "w1", "2026-11-20", 10, 5, null, null, null]);
    expect(db.writes.find((w) => w.query.includes("account_audiences"))!.params[2]).toBe(JSON.stringify(read.audience));
    const followers = db.writes.find((w) => w.query.includes("account_follower_days"))!;
    expect(followers.query).toContain("source = 'official'");
    expect(followers.params).toEqual(["a1", "w1", 77]);
    const done = db.writes.at(-1)!;
    expect(done.query).toContain("last_synced_at = now()");
    expect(done.params[1]).toBe(new Date(NOW + 12 * 3600_000).toISOString());
  });

  it("does nothing where no whole-account platform is switched on", async () => {
    const db = fakeDb([ACCOUNT]);
    expect(await runAccountSweep({ sql: db.sql, setting: () => "", platforms: ["x", "linkedin"], now: () => NOW })).toBe(0);
    expect(db.writes).toHaveLength(0);
  });

  it("waits a day after an expired login, a few hours after any other failure", async () => {
    for (const [error, hours] of [[Object.assign(new Error("expired"), { expired: true }), 24], [new Error("HTTP 500"), 6]] as const) {
      const db = fakeDb([ACCOUNT]);
      const n = await runAccountSweep({ sql: db.sql, setting: () => "", platforms: ["instagram"], readers: { instagram: async () => Promise.reject(error) }, token: async () => "t", now: () => NOW });
      expect(n).toBe(0);
      const update = db.writes.at(-1)!;
      expect(update.query).toContain("last_error = $2");
      expect(update.params).toEqual(["a1", error.message, new Date(NOW + hours * 3600_000).toISOString()]);
    }
  });
});
