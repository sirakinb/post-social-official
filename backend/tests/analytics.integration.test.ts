// @vitest-environment node
//
// Post stats on the dev database, with stand-in platforms: `npm run test:db`. The sweep is
// limited to the test workspace, so real dev posts are never touched.
import path from "node:path";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSql } from "../lib/insforge-admin";
import { importKey, seal } from "../lib/connections/crypto";
import { listAnalytics, postAnalytics, refreshAnalytics } from "../lib/analytics";
import { analyticsDashboard } from "../lib/analytics-dashboard";
import type { Caller } from "../lib/access";
import { runMetricsSweep } from "../../worker/src/analytics/runner";
import { runFollowerSweep } from "../../worker/src/analytics/followers";
import type { MetricsResult } from "../../worker/src/analytics/platforms";
import { createAccount, resolveTarget, type AccountResult } from "../../scripts/lib/accounts";
import { api, uniqueSuffix } from "./dev-backend";

const enabled = process.env.INSFORGE_INTEGRATION === "1";

describe.skipIf(!enabled)("post stats on the dev backend (US-068)", () => {
  const target = enabled ? resolveTarget("dev", path.resolve(__dirname, "../..")) : null!;
  const sql = enabled ? createSql(target.baseUrl, target.adminKey) : null!;
  const suffix = uniqueSuffix();
  const key = randomBytes(32).toString("base64");
  let owner: AccountResult;
  let facebook = "";
  let threads = "";
  let fbPost = "";
  let thPost = "";
  const person = (): Caller => ({ userId: owner.userId, displayName: "Owner", entryPoint: "ui" });
  let platformCalls = 0;
  const stats: Record<string, MetricsResult> = {
    facebook: { views: 400, likes: 20, comments: 5, shares: 2, extra: {}, unavailable: [] },
    threads: { likes: 9, comments: 1, extra: {}, unavailable: ["views"] },
  };
  const sweep = () =>
    runMetricsSweep({
      sql,
      setting: (name) => (name === "CREDENTIAL_ENCRYPTION_KEY" ? key : ""),
      platforms: ["facebook", "threads"],
      onlyWorkspace: owner.workspaceId,
      fetchers: {
        facebook: async (ctx) => (platformCalls++, expect(ctx.platformId).toBe("fb-123"), stats.facebook),
        threads: async () => (platformCalls++, stats.threads),
      },
    });

  beforeAll(async () => {
    owner = await createAccount(target, { role: "owner", email: `stats-${suffix}@postsocial.test`, displayName: "Owner", password: `Stats-${suffix}-pass-1`, workspaceName: `Stats Test ${suffix}` });
    await sql(`UPDATE public.workspaces SET publishing_paused = true WHERE id = $1`, [owner.workspaceId]);
    const sealed = await seal({ accessToken: "fake" }, await importKey(key));
    const account = async (platform: string) =>
      (await sql<{ id: string }>(
        `WITH a AS (
           INSERT INTO public.connected_accounts (workspace_id, platform, external_account_id, handle, display_name, capabilities)
           VALUES ($1, $2, $3, $3, $4, '{}') RETURNING id
         ), c AS (
           INSERT INTO public.credentials (workspace_id, connected_account_id, encrypted_payload, initialization_vector, key_version)
           SELECT $1, id, $5, $6, 1 FROM a
         ) SELECT id FROM a`,
        [owner.workspaceId, platform, `${platform}-stats-${suffix}`, `Test ${platform}`, sealed.encryptedPayload, sealed.initializationVector],
      ))[0].id;
    facebook = await account("facebook");
    threads = await account("threads");
    // A post published to both accounts.
    const published = async (accountId: string, platform: string, platformId: string, caption: string) => {
      const [row] = await sql<{ post_id: string }>(
        `WITH p AS (
           INSERT INTO public.posts (workspace_id, entry_point, caption, effective_approval_policy, status) VALUES ($1, 'mcp', $5, 'autonomous', 'published') RETURNING id
         )
         INSERT INTO public.destinations (workspace_id, post_id, connected_account_id, platform, effective_approval_policy, status, options, platform_request_id, live_url)
         SELECT $1, p.id, $2, $3, 'autonomous', 'published', '{"media_type":"text"}', $4, 'https://example.social/x' FROM p RETURNING post_id`,
        [owner.workspaceId, accountId, platform, platformId, caption],
      );
      return row.post_id;
    };
    fbPost = await published(facebook, "facebook", "fb-123", "Facebook post");
    thPost = await published(threads, "threads", "th-456", "Threads post");
  }, 120_000);

  afterAll(async () => {
    if (!owner) return;
    await api(target.baseUrl, target.adminKey, "DELETE", `/api/database/records/workspaces?id=eq.${owner.workspaceId}`);
    await api(target.baseUrl, target.adminKey, "DELETE", "/api/auth/users", { userIds: [owner.userId] });
  }, 60_000);

  it("collects stats for newly published posts and keeps a day-by-day history", async () => {
    expect(await sweep()).toBe(2);
    expect(platformCalls).toBe(2);
    const [fb] = await sql<{ views: string; likes: string; next_fetch_at: string }>(`SELECT views, likes, next_fetch_at FROM public.post_metrics WHERE post_id = $1`, [fbPost]);
    expect(fb).toMatchObject({ views: "400", likes: "20" });
    // New posts are checked again in about an hour.
    expect(Date.parse(fb.next_fetch_at) - Date.now()).toBeGreaterThan(50 * 60_000);
    // Nothing is due, so nothing is fetched again.
    expect(await sweep()).toBe(0);

    const day = await postAnalytics(sql, person(), ["facebook", "threads"], { post_id: fbPost });
    expect(day.destinations[0]).toMatchObject({ platform: "facebook", stats: { views: 400, likes: 20, comments: 5, shares: 2 } });
    expect(day.destinations[0].by_day).toHaveLength(1);
  });

  it("lists posts with stats, never shows zeros for numbers it cannot read, and explains how to get them", async () => {
    const list = await listAnalytics(sql, person(), ["facebook", "threads"], { workspace_id: owner.workspaceId, sort: "likes" });
    expect(list.posts.map((p) => p.platform)).toEqual(["facebook", "threads"]);
    const th = list.posts[1] as { stats: Record<string, number>; note?: string };
    expect(th.stats).toEqual({ likes: 9, comments: 1 });
    expect(th.note).toMatch(/^Reconnect Test threads on Threads to see views/);
    expect(list.totals_by_platform).toEqual(expect.arrayContaining([expect.objectContaining({ platform: "facebook", posts: 1, stats: expect.objectContaining({ views: 400 }) })]));
  });

  it("shows only platforms switched on in this environment", async () => {
    const onlyFacebook = await listAnalytics(sql, person(), ["facebook"], { workspace_id: owner.workspaceId });
    expect(onlyFacebook.posts.map((p) => p.platform)).toEqual(["facebook"]);
    const none = await listAnalytics(sql, person(), [], { workspace_id: owner.workspaceId });
    expect(none.posts).toEqual([]);
  });

  it("refresh now fetches again, but not more than every 30 minutes", async () => {
    const fresh = await refreshAnalytics(sql, person(), ["facebook", "threads"], { workspace_id: owner.workspaceId, post_id: thPost });
    expect(fresh).toMatchObject({ queued: 0, message: expect.stringMatching(/already fresh/) });
    await sql(`UPDATE public.post_metrics SET fetched_at = now() - interval '2 hours' WHERE post_id = $1`, [thPost]);
    stats.threads = { ...stats.threads, likes: 15 };
    const queued = await refreshAnalytics(sql, person(), ["facebook", "threads"], { workspace_id: owner.workspaceId, post_id: thPost });
    expect(queued.queued).toBe(1);
    expect(await sweep()).toBe(1);
    const [th] = await sql<{ likes: string }>(`SELECT likes FROM public.post_metrics WHERE post_id = $1`, [thPost]);
    expect(th.likes).toBe("15");
  });
  it("reads a platform from its public page when only the public source is on, and saves followers", async () => {
    await sql(`UPDATE public.post_metrics SET next_fetch_at = now() WHERE post_id = $1`, [thPost]);
    const n = await runMetricsSweep({
      sql,
      setting: () => "",
      platforms: [],
      publicPlatforms: ["threads"],
      publicApiKey: "test",
      onlyWorkspace: owner.workspaceId,
      publicReaders: { threads: async (_c, url) => (expect(url).toBe("https://example.social/x"), { likes: 30, comments: 2, reposts: 1, extra: {}, unavailable: [], followers: 600 }) },
    });
    expect(n).toBe(1);
    const [th] = await sql<{ likes: string; source: string }>(`SELECT likes, source FROM public.post_metrics WHERE post_id = $1`, [thPost]);
    expect(th).toMatchObject({ likes: "30", source: "public" });
    const [f] = await sql<{ followers: string; source: string }>(`SELECT followers, source FROM public.account_follower_days WHERE connected_account_id = $1`, [threads]);
    expect(f).toMatchObject({ followers: "600", source: "public" });
    // The daily follower sweep skips accounts already counted today.
    const counted = await runFollowerSweep({ sql, platforms: [], publicPlatforms: ["threads"], publicApiKey: "test", onlyWorkspace: owner.workspaceId, readPublic: async () => 999 });
    expect(counted).toBe(0);
  });

  it("builds the Analytics page's data for workspace members only", async () => {
    const dash = await analyticsDashboard(sql, person(), ["facebook", "threads"], { workspace_id: owner.workspaceId, period: "last_30_days" });
    expect(dash.summary.posts).toBe(2);
    expect(dash.accounts.find((a) => a.id === threads)).toMatchObject({ followers: 600, posts: 1, source: "public" });
    expect(dash.posts.find((p) => p.platform === "threads")!.engagement_rate).toBeCloseTo(33 / 600, 4);
    const stranger: Caller = { userId: "00000000-0000-0000-0000-000000000000", displayName: "Nobody", entryPoint: "ui" };
    await expect(analyticsDashboard(sql, stranger, ["facebook"], { workspace_id: owner.workspaceId })).rejects.toThrow();
    await expect(analyticsDashboard(sql, person(), ["facebook"], { workspace_id: owner.workspaceId, period: "forever" })).rejects.toThrow(/period/);
  });

  it("allows 3 hand refreshes a day per workspace", async () => {
    await sql(`DELETE FROM public.analytics_refreshes WHERE workspace_id = $1`, [owner.workspaceId]);
    for (let i = 0; i < 3; i++) {
      await sql(`UPDATE public.post_metrics SET fetched_at = now() - interval '2 hours' WHERE workspace_id = $1`, [owner.workspaceId]);
      const r = await refreshAnalytics(sql, person(), ["facebook", "threads"], { workspace_id: owner.workspaceId });
      expect(r.refreshes_left).toBe(2 - i);
    }
    await expect(refreshAnalytics(sql, person(), ["facebook", "threads"], { workspace_id: owner.workspaceId })).rejects.toThrow(/3 times a day/);
  });
});
