import { describe, expect, it } from "vitest";
import { FETCHERS, type FetchContext } from "./platforms";
import { nextFetchAt } from "./runner";

type Route = (url: URL, init: RequestInit) => Response | undefined;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const denied = () => json({ error: { code: 10, message: "(#10) Application does not have permission for this action" } }, 400);

function ctx(platformId: string, routes: Route[], mediaType?: string): FetchContext & { calls: string[] } {
  const calls: string[] = [];
  return {
    platformId,
    mediaType,
    token: async () => "tok",
    calls,
    http: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      calls.push(`${init.method ?? "GET"} ${url.pathname}`);
      for (const route of routes) {
        const hit = route(url, init);
        if (hit) return hit;
      }
      return json({ error: { message: `unexpected ${url}` } }, 500);
    }) as typeof fetch,
  };
}

describe("Instagram stats", () => {
  it("reads likes and comments, plus views, shares and saves with the insights permission", async () => {
    const c = ctx("ig1", [
      (u) => (u.pathname === "/v25.0/ig1" ? json({ like_count: 12, comments_count: 3 }) : undefined),
      (u) => (u.pathname === "/v25.0/ig1/insights" ? json({ data: [{ name: "views", values: [{ value: 900 }] }, { name: "shares", values: [{ value: 4 }] }, { name: "saved", values: [{ value: 7 }] }, { name: "reach", values: [{ value: 700 }] }] }) : undefined),
    ]);
    expect(await FETCHERS.instagram(c)).toEqual({ likes: 12, comments: 3, views: 900, shares: 4, saves: 7, extra: { reach: 700 }, unavailable: [] });
  });

  it("without the insights permission, says which numbers are missing instead of guessing", async () => {
    const c = ctx("ig1", [(u) => (u.pathname === "/v25.0/ig1" ? json({ like_count: 12, comments_count: 3 }) : undefined), (u) => (u.pathname.endsWith("/insights") ? denied() : undefined)]);
    expect(await FETCHERS.instagram(c)).toEqual({ likes: 12, comments: 3, extra: {}, unavailable: ["views", "shares", "saves"] });
  });
});

describe("Facebook stats", () => {
  it("reads reactions, comments and shares on a post, and views when allowed", async () => {
    const c = ctx("p_1", [
      (u) => (u.pathname === "/v25.0/p_1" ? json({ reactions: { summary: { total_count: 20 } }, comments: { summary: { total_count: 5 } }, shares: { count: 2 } }) : undefined),
      (u) => (u.pathname === "/v25.0/p_1/insights" && u.searchParams.get("metric") === "post_media_view" ? denied() : undefined),
      (u) => (u.pathname === "/v25.0/p_1/insights" ? json({ data: [{ name: "post_impressions", values: [{ value: 400 }] }] }) : undefined),
    ]);
    expect(await FETCHERS.facebook(c)).toEqual({ likes: 20, comments: 5, shares: 2, views: 400, extra: {}, unavailable: [] });
  });

  it("reads Reel plays from video insights", async () => {
    const c = ctx("v9", [
      (u) => (u.pathname === "/v25.0/v9" ? json({ likes: { summary: { total_count: 8 } }, comments: { summary: { total_count: 1 } } }) : undefined),
      (u) => (u.pathname === "/v25.0/v9/video_insights" ? json({ data: [{ name: "blue_reels_play_count", values: [{ value: 1500 }] }] }) : undefined),
    ], "reel");
    expect(await FETCHERS.facebook(c)).toMatchObject({ likes: 8, comments: 1, views: 1500, unavailable: [] });
  });
});

describe("Threads, YouTube and TikTok stats", () => {
  it("Threads maps replies to comments and keeps reposts and quotes", async () => {
    const c = ctx("th1", [(u) => (u.pathname === "/v1.0/th1/insights" ? json({ data: ["views", "likes", "replies", "reposts", "quotes", "shares"].map((name, i) => ({ name, values: [{ value: (i + 1) * 10 }] })) }) : undefined)]);
    expect(await FETCHERS.threads(c)).toEqual({ views: 10, likes: 20, comments: 30, reposts: 40, quotes: 50, shares: 60, extra: {}, unavailable: [] });
  });

  it("YouTube reads public statistics, or reports them unavailable without the read permission", async () => {
    const ok = ctx("yt1", [(u) => (u.pathname === "/youtube/v3/videos" ? json({ items: [{ statistics: { viewCount: "321", likeCount: "9", commentCount: "2" } }] }) : undefined)]);
    expect(await FETCHERS.youtube(ok)).toEqual({ views: 321, likes: 9, comments: 2, extra: {}, unavailable: [] });
    const no = ctx("yt1", [() => json({ error: { code: 403, message: "Request had insufficient authentication scopes." } }, 403)]);
    expect(await FETCHERS.youtube(no)).toEqual({ extra: {}, unavailable: ["views", "likes", "comments"] });
  });

  it("TikTok waits for an inbox post to be posted, then reads its stats by the real video id", async () => {
    const waiting = ctx("v_inbox_file~1", [(u) => (u.pathname === "/v2/post/publish/status/fetch/" ? json({ data: { status: "SEND_TO_USER_INBOX" }, error: { code: "ok" } }) : undefined)]);
    expect(await FETCHERS.tiktok(waiting)).toEqual({ extra: {}, unavailable: [], notYetPosted: true });
    const posted = ctx("v_inbox_file~1", [
      (u) => (u.pathname === "/v2/post/publish/status/fetch/" ? json({ data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [7123] }, error: { code: "ok" } }) : undefined),
      (u, i) => (u.pathname === "/v2/video/query/" && JSON.parse(String(i.body)).filters.video_ids[0] === "7123" ? json({ data: { videos: [{ id: "7123", view_count: 50, like_count: 5, comment_count: 1, share_count: 2 }] }, error: { code: "ok" } }) : undefined),
    ]);
    expect(await FETCHERS.tiktok(posted)).toEqual({ views: 50, likes: 5, comments: 1, shares: 2, extra: {}, unavailable: [], resolvedId: "7123" });
  });
});

describe("refresh schedule", () => {
  const h = 3600_000;
  it("checks new posts hourly, then less often, and stops after 90 days", () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    expect(nextFetchAt(now - 2 * h, now)!.getTime()).toBe(now + h);
    expect(nextFetchAt(now - 3 * 24 * h, now)!.getTime()).toBe(now + 6 * h);
    expect(nextFetchAt(now - 10 * 24 * h, now)!.getTime()).toBe(now + 24 * h);
    expect(nextFetchAt(now - 60 * 24 * h, now)!.getTime()).toBe(now + 7 * 24 * h);
    expect(nextFetchAt(now - 91 * 24 * h, now)).toBeNull();
  });
});
