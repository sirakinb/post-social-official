// The post list an automation is picked from: read live from the platform, any post on the
// account, with the access token kept on the server (PEN-40).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Caller, Sql } from "../access";

vi.mock("../../../worker/src/credentials", () => ({ accountToken: vi.fn(async () => "TOKEN") }));
vi.mock("../access", async (actual) => ({ ...(await actual<object>()), membership: vi.fn(async () => ({ role: "owner", actor_id: "actor" })) }));

const { decodeCursor, encodeCursor, liveAccountPosts, postOnAccount, PAGE_SIZE } = await import("./account-posts");
const { automationPosts } = await import("./automations");

const WORKSPACE = "00000000-0000-4000-8000-000000000002";
const ACCOUNT = "00000000-0000-4000-8000-0000000000aa";
const account = (platform: string) => ({ id: ACCOUNT, platform, display_name: "Still Meditation", external_account_id: "1234" });
const noSql = (async () => []) as unknown as Sql;
const setting = () => "";
const reply = (body: unknown, status = 200) => vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const called = (http: typeof fetch) => new URL(String((http as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]));

describe("paging cursor", () => {
  it("keeps only paging values, never the access token", () => {
    const cursor = encodeCursor("https://graph.instagram.com/v25.0/1/media?access_token=SECRET&fields=id&limit=24&after=QVFI");
    expect(decodeCursor(cursor)).toEqual([["after", "QVFI"]]);
    expect(atob(cursor!.replace(/-/g, "+").replace(/_/g, "/"))).not.toContain("SECRET");
    expect(encodeCursor("https://graph.facebook.com/v25.0/1/published_posts?until=170&__paging_token=enc_x&access_token=S")).not.toBeNull();
  });

  it("ignores anything that isn't one of our cursors", () => {
    expect(decodeCursor("not a cursor!")).toEqual([]);
    expect(decodeCursor(btoa(JSON.stringify([["access_token", "x"], ["fields", "id,secret"], ["after", "ok"]])))).toEqual([["after", "ok"]]);
    expect(decodeCursor(undefined)).toEqual([]);
    // Facebook's cursors are long (about 800 characters) and must survive the round trip.
    const long = "Q".repeat(802);
    expect(decodeCursor(encodeCursor(`https://graph.facebook.com/v25.0/1/published_posts?after=${long}&access_token=S`))).toEqual([["after", long]]);
    expect(encodeCursor(undefined)).toBeNull();
  });
});

describe("liveAccountPosts", () => {
  it("lists Instagram posts with a picture, whatever made them", async () => {
    const http = reply({
      data: [
        { id: "111", caption: "A reel", media_type: "VIDEO", media_product_type: "REELS", permalink: "https://www.instagram.com/reel/a/", thumbnail_url: "https://cdn.example/t.jpg", media_url: "https://cdn.example/v.mp4", timestamp: "2026-11-20T10:00:00+0000" },
        { id: "222", media_type: "CAROUSEL_ALBUM", permalink: "https://www.instagram.com/p/b/", media_url: "https://cdn.example/c.jpg", timestamp: "2026-11-19T10:00:00+0000" },
        { id: "bad id", media_type: "IMAGE", timestamp: "2026-11-18T10:00:00+0000" },
      ],
      paging: { next: "https://graph.instagram.com/v25.0/1/media?access_token=TOKEN&after=NEXT" },
    });
    const page = await liveAccountPosts({ sql: noSql, setting, http }, account("instagram"));
    expect(page.posts).toEqual([
      { platform_post_id: "111", caption: "A reel", published_at: "2026-11-20T10:00:00.000Z", live_url: "https://www.instagram.com/reel/a/", thumbnail_url: "https://cdn.example/t.jpg", format: "video" },
      { platform_post_id: "222", caption: null, published_at: "2026-11-19T10:00:00.000Z", live_url: "https://www.instagram.com/p/b/", thumbnail_url: "https://cdn.example/c.jpg", format: "carousel" },
    ]);
    expect(decodeCursor(page.next_cursor)).toEqual([["after", "NEXT"]]);
    const url = called(http);
    expect(url.origin + url.pathname).toBe("https://graph.instagram.com/v25.0/me/media");
    expect(url.searchParams.get("limit")).toBe(String(PAGE_SIZE));
    expect(url.searchParams.get("access_token")).toBe("TOKEN");
  });

  it("reads a Facebook Page's posts by its Page id and pages on with a cursor", async () => {
    const http = reply({ data: [{ id: "1234_9", message: "Hello", created_time: "2026-11-01T00:00:00+0000", permalink_url: "https://www.facebook.com/1234/posts/9", full_picture: "https://cdn.example/p.jpg", attachments: { data: [{ media_type: "photo" }] } }] });
    const page = await liveAccountPosts({ sql: noSql, setting, http }, account("facebook"), encodeCursor("https://x.example/?until=170&__paging_token=enc"));
    expect(page.posts[0]).toMatchObject({ platform_post_id: "1234_9", caption: "Hello", format: "photo", thumbnail_url: "https://cdn.example/p.jpg" });
    expect(page.next_cursor).toBeNull();
    const url = called(http);
    expect(url.pathname).toBe("/v25.0/1234/published_posts");
    expect(url.searchParams.get("until")).toBe("170");
    expect(url.searchParams.get("__paging_token")).toBe("enc");
  });

  it("leaves out Threads reposts, which can't carry an automation", async () => {
    const http = reply({ data: [{ id: "31", media_type: "REPOST_FACADE", timestamp: "2026-11-02T00:00:00+0000" }, { id: "32", text: "Mine", media_type: "TEXT_POST", permalink: "https://www.threads.net/@a/post/x", timestamp: "2026-11-01T00:00:00+0000" }] });
    const page = await liveAccountPosts({ sql: noSql, setting, http }, account("threads"));
    expect(page.posts.map((p) => [p.platform_post_id, p.format])).toEqual([["32", "text"]]);
  });

  it("throws when the platform refuses, so the caller can fall back", async () => {
    await expect(liveAccountPosts({ sql: noSql, setting, http: reply({ error: { message: "expired" } }, 400) }, account("instagram"))).rejects.toThrow();
    await expect(liveAccountPosts({ sql: noSql, setting, http: reply({}) }, account("linkedin"))).rejects.toThrow();
  });
});

describe("postOnAccount", () => {
  it("tells a Facebook post by its Page id without asking Facebook", async () => {
    const http = reply({});
    expect(await postOnAccount({ sql: noSql, setting, http }, account("facebook"), "1234_9")).toBe(true);
    expect(await postOnAccount({ sql: noSql, setting, http }, account("facebook"), "9999_9")).toBe(false);
    expect(http).not.toHaveBeenCalled();
  });

  it("says no only when the platform clearly says the post isn't there", async () => {
    expect(await postOnAccount({ sql: noSql, setting, http: reply({ id: "111" }) }, account("instagram"), "111")).toBe(true);
    expect(await postOnAccount({ sql: noSql, setting, http: reply({ error: { code: 100 } }, 400) }, account("instagram"), "999")).toBe(false);
    expect(await postOnAccount({ sql: noSql, setting, http: reply({ error: { code: 190 } }, 400) }, account("threads"), "999")).toBeNull();
    const down = vi.fn(async () => { throw new Error("timeout"); }) as unknown as typeof fetch;
    expect(await postOnAccount({ sql: noSql, setting, http: down }, account("instagram"), "999")).toBeNull();
  });
});

describe("automationPosts", () => {
  const caller: Caller = { userId: "u", displayName: "Owner", entryPoint: "ui" };
  const inbox = { all: true, workspaces: [] };
  let queries: string[];
  const sql = (destinations: unknown[], saved: unknown[] = []) =>
    (async (text: string) => {
      queries.push(text);
      if (text.includes("FROM public.connected_accounts")) return [{ id: ACCOUNT, platform: "instagram", health: "connected", display_name: "Still Meditation", external_account_id: "1234" }];
      if (text.includes("platform_request_id = ANY")) return destinations;
      return saved;
    }) as unknown as Sql;
  beforeEach(() => {
    queries = [];
  });

  it("returns the platform's own list, marking which posts went out through Post Social", async () => {
    const http = reply({ data: [{ id: "111", media_type: "IMAGE", media_url: "https://cdn.example/1.jpg", timestamp: "2026-11-20T10:00:00+0000" }, { id: "222", media_type: "IMAGE", timestamp: "2026-11-19T10:00:00+0000" }] });
    const result = await automationPosts({ sql: sql([{ platform_request_id: "222", post_id: "post-2" }]), inbox, setting, http }, caller, { workspace_id: WORKSPACE, account_id: ACCOUNT });
    expect(result.source).toBe("live");
    expect(result.posts.map((p) => [p.platform_post_id, p.post_id, p.outside])).toEqual([["111", null, true], ["222", "post-2", false]]);
  });

  it("falls back to the posts on file when the platform can't be read, or there are no secrets here", async () => {
    const saved = [{ platform_post_id: "5", post_id: null, outside: true }];
    const failing = await automationPosts({ sql: sql([], saved), inbox, setting, http: reply({ error: {} }, 500) }, caller, { workspace_id: WORKSPACE, account_id: ACCOUNT });
    expect(failing).toMatchObject({ source: "saved", posts: saved, next_cursor: null });
    const noSecrets = await automationPosts({ sql: sql([], saved), inbox }, caller, { workspace_id: WORKSPACE, account_id: ACCOUNT });
    expect(noSecrets.source).toBe("saved");
    const pastTheEnd = await automationPosts({ sql: sql([], saved), inbox }, caller, { workspace_id: WORKSPACE, account_id: ACCOUNT, cursor: "abc" });
    expect(pastTheEnd.posts).toEqual([]);
  });
});
