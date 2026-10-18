import { describe, expect, it } from "vitest";
import type { Sql } from "../../../backend/lib/access";
import { createAdminAlert } from "../alerts";
import { runStatsHealthCheck, type HealthDeps } from "./health";
import { publicFollowers } from "./public";

type PostRow = { platform: string; tracked: number; failing: number; example: string | null };

function setup(extra: Partial<HealthDeps> & { posts?: PostRow[] } = {}) {
  const alerts: Array<{ subject: string; lines: string[] }> = [];
  const recorded: Array<Record<string, unknown>> = [];
  const queries: Array<{ query: string; params: unknown[] }> = [];
  const sql = (async (query: string, params: unknown[]) => {
    queries.push({ query, params });
    return extra.posts ?? [];
  }) as Sql;
  const deps: HealthDeps = {
    sql,
    platforms: [],
    publicPlatforms: ["instagram", "tiktok", "linkedin"],
    publicApiKey: "sc-key",
    readProfile: async () => 1000,
    alert: async (subject, lines) => void alerts.push({ subject, lines }),
    record: async (p) => void recorded.push(p),
    ...extra,
  };
  return { deps, alerts, recorded, queries };
}

describe("daily stats health check", () => {
  it("checks every switched-on platform on a known public profile, not on users' accounts, and stays quiet when all is well", async () => {
    const seen: string[] = [];
    const { deps, alerts, recorded } = setup({ readProfile: async (_c, t) => (seen.push(`${t.platform}:${t.handle}`), 5000) });
    const result = await runStatsHealthCheck(deps);
    expect(seen).toEqual(["instagram:nasa", "tiktok:nasa"]); // LinkedIn has no public profiles
    expect(result.problems).toEqual([]);
    expect(alerts).toEqual([]);
    expect(recorded[0]).toMatchObject({ ok: true, problems: 0, platforms: ["instagram", "tiktok", "linkedin"] });
  });

  it("alerts when a platform's profile read breaks or comes back empty", async () => {
    const { deps, alerts } = setup({
      readProfile: async (_c, t) => {
        if (t.platform === "tiktok") throw new Error("Looks like you're out of credits");
        return 0;
      },
    });
    const result = await runStatsHealthCheck(deps);
    expect(result.problems).toEqual([
      "Instagram: reading a public profile (@nasa) returned no follower count.",
      "TikTok: reading a public profile failed: Looks like you're out of credits",
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].subject).toBe("Post Social stats: 2 problems found");
    expect(alerts[0].lines.join("\n")).toContain("Checked: Instagram, TikTok, LinkedIn.");
  });

  it("alerts when many of every user's recent posts on a platform can't be read, ignoring deliberate stops", async () => {
    const { deps, alerts, queries } = setup({
      posts: [
        { platform: "tiktok", tracked: 12, failing: 12, example: "This post has no public address, so its stats cannot be read." },
        { platform: "instagram", tracked: 40, failing: 2, example: "HTTP 500" }, // a few blips: fine
      ],
    });
    const result = await runStatsHealthCheck(deps);
    expect(result.problems).toEqual(["TikTok: 12 of 12 recent posts can't be read. Example: This post has no public address, so its stats cannot be read."]);
    expect(alerts).toHaveLength(1);
    // Deliberate stops (deleted, private, still in TikTok's review) aren't counted as failing.
    expect(new RegExp(String(queries[0].params[0]), "i").test("This post is no longer on TikTok; it may have been deleted.")).toBe(true);
    expect(new RegExp(String(queries[0].params[0]), "i").test("Waiting for TikTok to make this post public.")).toBe(true);
    expect(new RegExp(String(queries[0].params[0]), "i").test("Looks like you're out of credits")).toBe(false);
  });

  it("warns before the ScrapeCreators credits run out, from what each read reports", async () => {
    const http = (async () => new Response(JSON.stringify({ credits_remaining: 240, data: { user: { edge_followed_by: { count: 9 } } }, statsV2: { followerCount: 9 } }))) as typeof fetch;
    const { deps, alerts } = setup({ http, readProfile: publicFollowers, creditsWarnBelow: 500 });
    const result = await runStatsHealthCheck(deps);
    expect(result.creditsLeft).toBe(240);
    expect(result.problems).toEqual(["ScrapeCreators credits are low: 240 left. Stats stop for every user when they reach 0."]);
    expect(alerts).toHaveLength(1);
  });

  it("never uses a profile the readers would skip as a placeholder", async () => {
    const { CANARY_PROFILES } = await import("./health");
    const { realHandle } = await import("./public");
    for (const target of Object.values(CANARY_PROFILES)) if (target!.handle) expect(realHandle(target!.platform, target!.handle)).toBeTruthy();
  });

  it("says so when public stats are on but the ScrapeCreators key is missing", async () => {
    const { deps } = setup({ publicApiKey: null });
    const result = await runStatsHealthCheck(deps);
    expect(result.checked).toEqual([]);
    expect(result.problems[0]).toMatch(/ScrapeCreators key is missing/);
  });
});

describe("admin alerts", () => {
  function telemetry() {
    const errors: Array<{ error: unknown; context: unknown }> = [];
    return { errors, telemetry: { captureException: async (error: unknown, context?: unknown) => void errors.push({ error, context }), capture: async () => {} } };
  }

  it("go to PostHog and by email to the admin address only", async () => {
    const t = telemetry();
    const sent: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = [];
    const http = (async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get("Authorization") });
      return new Response(JSON.stringify({ id: "e1" }));
    }) as unknown as typeof fetch;
    await createAdminAlert({ to: "admin@example.com", resendKey: "re_key", environment: "production", telemetry: t.telemetry, http })("Subject", ["line 1", "line 2"]);
    expect(t.errors).toHaveLength(1);
    expect(String((t.errors[0].error as Error).message)).toBe("Subject");
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://api.resend.com/emails");
    expect(sent[0].auth).toBe("Bearer re_key");
    expect(sent[0].body).toMatchObject({ to: ["admin@example.com"], subject: "Subject", text: "line 1\nline 2" });
  });

  it("marks dev alerts, and only logs to PostHog without an address or key; never throws", async () => {
    const t = telemetry();
    let calls = 0;
    const http = (async () => (calls++, Promise.reject(new Error("network down")))) as unknown as typeof fetch;
    await createAdminAlert({ to: null, resendKey: "re_key", environment: "dev", telemetry: t.telemetry, http })("Subject", []);
    expect(calls).toBe(0);
    expect((t.errors[0].error as Error).message).toBe("[Dev] Subject");
    await expect(createAdminAlert({ to: "admin@example.com", resendKey: "re_key", environment: "dev", telemetry: t.telemetry, http })("Subject", [])).resolves.toBeUndefined();
    expect(calls).toBe(1);
  });
});
