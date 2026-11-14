import { describe, expect, it } from "vitest";
import type { Sql } from "../../../backend/lib/access";
import { runFollowerSweep } from "./followers";

type Account = { id: string; workspace_id: string; platform: string; handle: string | null; external_account_id: string };

function fakeSql(accounts: Account[]) {
  const saved: unknown[][] = [];
  let asked: unknown[] = [];
  const sql = (async (query: string, params: unknown[]) => {
    if (query.includes("FROM public.connected_accounts")) {
      asked = params[0] as unknown[];
      return accounts;
    }
    saved.push(params);
    return [];
  }) as Sql;
  return { sql, saved, asked: () => asked };
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
