import { describe, expect, it } from "vitest";
import type { Sql } from "../../../backend/lib/access";
import type { MetricsResult } from "./platforms";
import type { PublicPostResult } from "./public";
import { fillGaps, runMetricsSweep, type MetricsDeps } from "./runner";

const NOW = Date.parse("2026-10-16T12:00:00Z");
const row = (platform: string) => ({ destination_id: "d1", workspace_id: "w1", connected_account_id: "a1", platform, published_at: new Date(NOW - 2 * 3600_000).toISOString() });

// A stand-in database: answers the sweep's reads and records its writes.
function fakeSql(platform: string, target: { platform_request_id: string | null; live_url: string | null }) {
  const writes: Array<{ query: string; params: unknown[] }> = [];
  let claimed: unknown[] = [];
  const sql = (async (query: string, params: unknown[]) => {
    if (query.includes("claim_metrics_to_fetch")) {
      claimed = params[0] as unknown[];
      return [row(platform)];
    }
    if (query.includes("FROM public.destinations d JOIN")) return [{ ...target, media_type: null, display_name: "Maker" }];
    if (query.includes("reserve_platform_call")) return [{ reserve_platform_call: null }];
    writes.push({ query, params });
    return [];
  }) as Sql;
  return { sql, writes, claimed: () => claimed };
}

const saved = (writes: Array<{ query: string; params: unknown[] }>) => writes.find((w) => w.query.includes("UPDATE public.post_metrics SET views"));
const officialResult = (r: Partial<MetricsResult>): MetricsResult => ({ extra: {}, unavailable: [], ...r });
const publicResult = (r: Partial<PublicPostResult>): PublicPostResult => ({ extra: {}, unavailable: [], ...r });

function deps(db: ReturnType<typeof fakeSql>, extra: Partial<MetricsDeps>): MetricsDeps {
  return { sql: db.sql, setting: () => undefined as never, platforms: [], now: () => NOW, ...extra } as MetricsDeps;
}

describe("stats sweep sources", () => {
  it("reads a public-only platform from its public page and saves the author's followers", async () => {
    const db = fakeSql("instagram", { platform_request_id: "ig1", live_url: "https://instagram.com/p/1" });
    let readUrl = "";
    await runMetricsSweep(deps(db, {
      publicPlatforms: ["instagram"],
      publicApiKey: "k",
      publicReaders: { instagram: async (_c, url) => ((readUrl = url), publicResult({ likes: 10, comments: 2, followers: 900 })) },
    }));
    expect(db.claimed()).toEqual(["instagram"]);
    expect(readUrl).toBe("https://instagram.com/p/1");
    const w = saved(db.writes)!;
    expect(w.params[2]).toBe(10);
    expect(w.params.at(-1)).toBe("public");
    // Public cadence: 3 hours on the first day.
    expect(w.params[10]).toBe(new Date(NOW + 3 * 3600_000).toISOString());
    const followers = db.writes.find((x) => x.query.includes("account_follower_days"))!;
    expect(followers.params).toEqual(["a1", "w1", 900]);
  });

  it("learns a YouTube channel's handle from its post's page, replacing only the placeholder", async () => {
    const db = fakeSql("youtube", { platform_request_id: "v1", live_url: "https://www.youtube.com/shorts/v1" });
    await runMetricsSweep(deps(db, {
      publicPlatforms: ["youtube"],
      publicApiKey: "k",
      publicReaders: { youtube: async () => publicResult({ views: 300, likes: 9, comments: 1, handle: "maker" }) },
    }));
    const learned = db.writes.find((w) => w.query.includes("UPDATE public.connected_accounts SET handle"))!;
    expect(learned.params).toEqual(["a1", "maker"]);
    expect(learned.query).toContain("IN ('', 'youtube')");
  });

  it("without the ScrapeCreators key, public platforms aren't claimed at all", async () => {
    const db = fakeSql("instagram", { platform_request_id: "ig1", live_url: "u" });
    const n = await runMetricsSweep(deps(db, { publicPlatforms: ["instagram"], publicApiKey: null }));
    expect(n).toBe(0);
    expect(db.claimed()).toEqual([]);
  });

  it("falls back to the public page when the official read fails", async () => {
    const db = fakeSql("tiktok", { platform_request_id: "v1", live_url: "https://tiktok.com/v/1" });
    await runMetricsSweep(deps(db, {
      platforms: ["tiktok"],
      publicPlatforms: ["tiktok"],
      publicApiKey: "k",
      fetchers: { tiktok: async () => { throw new Error("access_token_invalid"); } },
      publicReaders: { tiktok: async () => publicResult({ views: 500, likes: 20 }) },
    }));
    const w = saved(db.writes)!;
    expect(w.params[1]).toBe(500);
    expect(w.params.at(-1)).toBe("public");
  });

  it("doesn't fall back for a deleted post: it stops checking and says so", async () => {
    const db = fakeSql("tiktok", { platform_request_id: "v1", live_url: "u" });
    let publicReads = 0;
    await runMetricsSweep(deps(db, {
      platforms: ["tiktok"],
      publicPlatforms: ["tiktok"],
      publicApiKey: "k",
      fetchers: { tiktok: async () => { throw new Error("video_not_found"); } },
      publicReaders: { tiktok: async () => ((publicReads++), publicResult({})) },
    }));
    expect(publicReads).toBe(0);
    const later = db.writes.find((w) => w.query.includes("next_fetch_at = $2"))!;
    expect(later.params[1]).toBeNull();
    expect(String(later.params[2])).toMatch(/no longer on TikTok/);
  });

  it("fills numbers the official read lacks from the public page, marked mixed", async () => {
    const db = fakeSql("facebook", { platform_request_id: "p1", live_url: "u" });
    await runMetricsSweep(deps(db, {
      platforms: ["facebook"],
      publicPlatforms: ["facebook"],
      publicApiKey: "k",
      fetchers: { facebook: async () => officialResult({ likes: 5, comments: 1, shares: 0, unavailable: ["views"] }) },
      publicReaders: { facebook: async () => publicResult({ views: 70, likes: 99 }) },
    }));
    const w = saved(db.writes)!;
    expect(w.params[1]).toBe(70); // views from the public page
    expect(w.params[2]).toBe(5); // likes stay official
    expect(w.params.at(-1)).toBe("mixed");
    // Official cadence: hourly on the first day.
    expect(w.params[10]).toBe(new Date(NOW + 3600_000).toISOString());
  });

  it("doesn't spend a public read on gaps the public page can't fill", async () => {
    const db = fakeSql("instagram", { platform_request_id: "ig1", live_url: "u" });
    let publicReads = 0;
    await runMetricsSweep(deps(db, {
      platforms: ["instagram"],
      publicPlatforms: ["instagram"],
      publicApiKey: "k",
      fetchers: { instagram: async () => officialResult({ likes: 5, comments: 1, unavailable: ["shares", "saves"] }) },
      publicReaders: { instagram: async () => ((publicReads++), publicResult({})) },
    }));
    expect(publicReads).toBe(0);
    expect(saved(db.writes)!.params.at(-1)).toBe("official");
  });
});

describe("fillGaps", () => {
  it("keeps official numbers and only fills missing ones", () => {
    const { result, filled } = fillGaps(officialResult({ likes: 1, unavailable: ["views", "saves"] }), publicResult({ likes: 50, views: 9 }));
    expect(filled).toBe(true);
    expect(result).toMatchObject({ likes: 1, views: 9, unavailable: ["saves"] });
  });
});

describe("TikTok posts without a public link yet", () => {
  const statusHttp = (data: Record<string, unknown>) => {
    const calls: string[] = [];
    const http = (async (url: string, init?: RequestInit) => {
      calls.push(`${url} ${init?.body ?? ""}`);
      return new Response(JSON.stringify({ data, error: { code: "ok" } }), { status: 200 });
    }) as typeof fetch;
    return { http, calls };
  };
  const base = { publicPlatforms: ["tiktok"] as never, publicApiKey: "k", token: async () => "tok" };

  it("asks TikTok for the post's id, saves its link, then reads its stats", async () => {
    const db = fakeSql("tiktok", { platform_request_id: "v_pub_file~v2-1", live_url: null });
    const sql = db.sql;
    db.sql = (async (q: string, p: unknown[]) => (q.includes("FROM public.destinations d JOIN") ? [{ platform_request_id: "v_pub_file~v2-1", live_url: null, media_type: null, display_name: "Maker", privacy_level: "PUBLIC_TO_EVERYONE", handle: "maker" }] : sql(q, p))) as Sql;
    const { http, calls } = statusHttp({ status: "PUBLISH_COMPLETE", publicaly_available_post_id: [7123] });
    let readUrl = "";
    await runMetricsSweep(deps(db, { ...base, http, publicReaders: { tiktok: async (_c, url) => ((readUrl = url), publicResult({ views: 9 })) } }));
    expect(calls[0]).toContain("/post/publish/status/fetch/");
    expect(calls[0]).toContain("v_pub_file~v2-1");
    expect(readUrl).toBe("https://www.tiktok.com/@maker/video/7123");
    const link = db.writes.find((w) => w.query.includes("SET live_url"));
    expect(link?.params).toEqual(["d1", "https://www.tiktok.com/@maker/video/7123", "7123"]);
    expect(saved(db.writes)?.params[1]).toBe(9);
  });

  it("keeps TikTok's 19-digit post id exact when saving the link", async () => {
    const db = fakeSql("tiktok", { platform_request_id: "v_pub_file~v2-1", live_url: null });
    const sql = db.sql;
    db.sql = (async (q: string, p: unknown[]) => (q.includes("FROM public.destinations d JOIN") ? [{ platform_request_id: "v_pub_file~v2-1", live_url: null, media_type: null, display_name: "Maker", privacy_level: "PUBLIC_TO_EVERYONE", handle: "maker" }] : sql(q, p))) as Sql;
    const http = (async () => new Response('{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7698502021669784846]},"error":{"code":"ok"}}')) as unknown as typeof fetch;
    await runMetricsSweep(deps(db, { ...base, http, publicReaders: { tiktok: async () => publicResult({ views: 9 }) } }));
    const link = db.writes.find((w) => w.query.includes("SET live_url"));
    expect(link?.params).toEqual(["d1", "https://www.tiktok.com/@maker/video/7698502021669784846", "7698502021669784846"]);
  });

  const stub = (target: Record<string, unknown>) => {
    const db = fakeSql("tiktok", { platform_request_id: null, live_url: null });
    const sql = db.sql;
    db.sql = (async (q: string, p: unknown[]) => (q.includes("FROM public.destinations d JOIN") ? [{ platform_request_id: "v_inbox_file~1", live_url: null, media_type: null, display_name: "Maker", privacy_level: null, handle: "maker", ...target }] : sql(q, p))) as Sql;
    return db;
  };
  const stopped = (db: ReturnType<typeof fakeSql>) => db.writes.find((w) => w.query.includes("SET next_fetch_at"))?.params;

  it("keeps checking an inbox draft until the creator posts it", async () => {
    const db = stub({});
    await runMetricsSweep(deps(db, { ...base, http: statusHttp({ status: "SEND_TO_USER_INBOX" }).http, publicReaders: { tiktok: async () => { throw new Error("should not read"); } } }));
    const [, at, error] = stopped(db)!;
    expect(at).toBe(new Date(NOW + 6 * 3600_000).toISOString());
    expect(error).toBe("Waiting for TikTok to make this post public.");
  });

  it("stops for private posts and placeholder usernames without asking TikTok", async () => {
    for (const target of [{ privacy_level: "SELF_ONLY" }, { handle: "tiktok" }]) {
      const db = stub(target);
      const { http, calls } = statusHttp({});
      await runMetricsSweep(deps(db, { ...base, http }));
      expect(calls).toHaveLength(0);
      expect(stopped(db)?.[1]).toBeNull();
    }
  });
});
