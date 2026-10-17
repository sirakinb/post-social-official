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
