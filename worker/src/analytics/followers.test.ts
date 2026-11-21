import { describe, expect, it } from "vitest";
import type { Sql } from "../../../backend/lib/access";
import { linkedinCountable, runFollowerSweep } from "./followers";

type Account = { id: string; workspace_id: string; platform: string; handle: string | null; external_account_id: string; display_name?: string; scopes?: string[] };

function fakeSql(accounts: Account[]) {
  const saved: unknown[][] = [];
  let asked: unknown[] = [];
  let lastQuery = "";
  let lastParams: unknown[] = [];
  const sql = (async (query: string, params: unknown[]) => {
    if (query.includes("FROM public.connected_accounts")) {
      asked = params[0] as unknown[];
      lastQuery = query;
      lastParams = params;
      return accounts;
    }
    saved.push(params);
    return [];
  }) as Sql;
  return { sql, saved, asked: () => asked, query: () => lastQuery, params: () => lastParams };
}

describe("daily follower counts", () => {
  it("reads Bluesky from its own API and the rest from public profiles", async () => {
    const db = fakeSql([
      { id: "b", workspace_id: "w", platform: "bluesky", handle: "maker.bsky.social", external_account_id: "did:plc:1" },
      { id: "t", workspace_id: "w", platform: "tiktok", handle: "maker", external_account_id: "9" },
    ]);
    const http = (async (url: string) => {
      expect(String(url)).toContain("app.bsky.actor.getProfile?actor=did%3Aplc%3A1");
      return new Response(JSON.stringify({ followersCount: 321 }));
    }) as unknown as typeof fetch;
    const n = await runFollowerSweep({
      sql: db.sql,
      platforms: ["bluesky"],
      publicPlatforms: ["tiktok"],
      publicApiKey: "k",
      http,
      readPublic: async (_c, target) => (target.platform === "tiktok" ? 4500 : null),
    });
    expect(n).toBe(2);
    expect(db.asked()).toEqual(["tiktok", "bluesky"]);
    expect(db.saved).toEqual([["b", "w", 321, "official"], ["t", "w", 4500, "public"]]);
  });

  it("reads X from X's API with the account's own access when X is switched on", async () => {
    const db = fakeSql([{ id: "x1", workspace_id: "w", platform: "x", handle: "maker", external_account_id: "42", display_name: "Maker" }]);
    const http = (async (url: string, init: RequestInit) => {
      expect(String(url)).toBe("https://api.x.com/2/users/me?user.fields=public_metrics");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer xtok");
      return new Response(JSON.stringify({ data: { id: "42", public_metrics: { followers_count: 777 } } }));
    }) as unknown as typeof fetch;
    const n = await runFollowerSweep({
      sql: db.sql,
      platforms: ["x"],
      publicPlatforms: ["x"],
      publicApiKey: "k",
      http,
      token: async (id) => (id === "x1" ? "xtok" : "nope"),
      readPublic: async () => {
        throw new Error("public read should not be used for X when X is official");
      },
    });
    expect(n).toBe(1);
    expect(db.saved).toEqual([["x1", "w", 777, "official"]]);
    // Only for workspaces that pay (Paid with a working card, or comped).
    expect(db.query()).toContain("pl.plan NOT IN ('free', 'paid')");
    expect(db.params()[2]).toBe(true);
  });

  it("does nothing without a source switched on", async () => {
    const db = fakeSql([]);
    expect(await runFollowerSweep({ sql: db.sql, platforms: ["instagram"], publicPlatforms: ["tiktok"], publicApiKey: null })).toBe(0);
  });

  it("leaves an account alone for a while after its profile read failed", async () => {
    const db = fakeSql([{ id: "acct-backoff", workspace_id: "w", platform: "x", handle: "maker", external_account_id: "1" }]);
    let reads = 0;
    let now = Date.parse("2026-10-16T00:00:00Z");
    const run = () => runFollowerSweep({ sql: db.sql, platforms: [], publicPlatforms: ["x"], publicApiKey: "k", now: () => now, readPublic: async () => { reads++; throw new Error("The profile shows no follower count."); } });
    await run();
    await run();
    expect(reads).toBe(1);
    now += 7 * 3600_000;
    await run();
    expect(reads).toBe(2);
    expect(db.saved).toEqual([]);
  });

  it("keeps trying an account that can't be looked up yet, so a YouTube channel learned from a post is counted on the next sweep", async () => {
    const account = { id: "acct-yt", workspace_id: "w", platform: "youtube", handle: "youtube", external_account_id: "workspace:w" };
    const db = fakeSql([account]);
    const readPublic = async (_c: unknown, target: { handle: string | null }) => (target.handle === "youtube" ? null : 2910);
    await runFollowerSweep({ sql: db.sql, platforms: [], publicPlatforms: ["youtube"], publicApiKey: "k", readPublic });
    expect(db.saved).toEqual([]);
    account.handle = "sirakinb";
    await runFollowerSweep({ sql: db.sql, platforms: [], publicPlatforms: ["youtube"], publicApiKey: "k", readPublic });
    expect(db.saved).toEqual([["acct-yt", "w", 2910, "public"]]);
  });
});

describe("LinkedIn follower counts", () => {
  it("reads a Page's followers and the member's own, with the Community Management permissions", async () => {
    const db = fakeSql([
      { id: "p", workspace_id: "w", platform: "linkedin", handle: "pentridge", external_account_id: "organization:101", scopes: ["rw_organization_admin"] },
      { id: "m", workspace_id: "w", platform: "linkedin", handle: "Aki B", external_account_id: "m1", scopes: ["r_member_profileAnalytics"] },
    ]);
    const asked: string[] = [];
    const http = (async (url: string) => {
      asked.push(String(url));
      return String(url).includes("networkSizes")
        ? new Response(JSON.stringify({ firstDegreeSize: 1200 }))
        : new Response(JSON.stringify({ elements: [{ memberFollowersCount: 345 }] }));
    }) as unknown as typeof fetch;
    const n = await runFollowerSweep({ sql: db.sql, platforms: ["linkedin"], publicPlatforms: [], http, token: async () => "tok" });
    expect(n).toBe(2);
    expect(asked[0]).toContain("/rest/networkSizes/urn%3Ali%3Aorganization%3A101?edgeType=COMPANY_FOLLOWED_BY_MEMBER");
    expect(asked[1]).toContain("/rest/memberFollowersCount?q=me");
    expect(db.saved.map((p) => [p[0], p[2], p[3]])).toEqual([["p", 1200, "official"], ["m", 345, "official"]]);
    // Accounts from the original app, which can't read their count, aren't even picked.
    expect(db.query()).toContain("'r_member_profileAnalytics' = ANY(a.scopes)");
    expect(db.params()[3]).toBe(false);
  });

  it("knows which LinkedIn accounts can read their own count", () => {
    expect(linkedinCountable({ external_account_id: "organization:1", scopes: ["rw_organization_admin"] })).toBe(true);
    expect(linkedinCountable({ external_account_id: "m1", scopes: ["openid", "profile", "w_member_social"] })).toBe(false);
    expect(linkedinCountable({ external_account_id: "m1", scopes: null })).toBe(false);
  });

  it("leaves Instagram and Facebook to the whole-account sweep where their stats are official, so they cost no public read", async () => {
    const db = fakeSql([]);
    await runFollowerSweep({ sql: db.sql, platforms: ["instagram", "facebook", "threads"], publicPlatforms: ["instagram", "facebook", "threads", "tiktok"], publicApiKey: "k" });
    expect(db.asked()).toEqual(["threads", "tiktok"]);
    await runFollowerSweep({ sql: db.sql, platforms: [], publicPlatforms: ["instagram", "facebook"], publicApiKey: "k" });
    expect(db.asked()).toEqual(["instagram", "facebook"]);
  });
});
