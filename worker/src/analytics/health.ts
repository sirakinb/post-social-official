// Daily stats health check. Stats can stop for every user at once (a platform changes its
// pages, the ScrapeCreators credits run out) without any one post saying so, so once a day
// the worker checks each platform that is switched on, independent of who has connected
// what, and alerts the admin when something is wrong:
//   1. reads one well-known public profile per platform (a canary: proves reads work today);
//   2. looks across every user's posts for a platform where many reads are failing;
//   3. warns before the ScrapeCreators credits run out.
import type { Sql } from "../../../backend/lib/access";
import { DISPLAY_NAMES, type Platform } from "../../../backend/lib/connections/platforms";
import { blueskyFollowers } from "./followers";
import { publicFollowers, type FollowerTarget, type PublicContext } from "./public";

// Large public profiles that won't disappear (not the platforms' own accounts: a handle equal
// to the platform's name counts as a placeholder and is never read). LinkedIn has none:
// members share no public address, so its counts come from posts only and the post check
// below covers it.
export const CANARY_PROFILES: Partial<Record<Platform, FollowerTarget>> = {
  instagram: { platform: "instagram", handle: "nasa", externalId: "" },
  tiktok: { platform: "tiktok", handle: "nasa", externalId: "" },
  threads: { platform: "threads", handle: "zuck", externalId: "" },
  x: { platform: "x", handle: "NASA", externalId: "" },
  youtube: { platform: "youtube", handle: "NASA", externalId: "" },
  facebook: { platform: "facebook", handle: null, externalId: "NASA" },
  bluesky: { platform: "bluesky", handle: "bsky.app", externalId: "bsky.app" },
};

// Reasons a post stops being read on purpose; not failures.
const EXPECTED_STOPS = /no longer on|privately|Waiting for TikTok|didn't publish|never made this post public/i;

export type HealthDeps = {
  sql: Sql;
  platforms: Platform[]; // read through the platform's own API (ANALYTICS_PLATFORMS)
  publicPlatforms: Platform[]; // read from public pages (ANALYTICS_PUBLIC_PLATFORMS)
  publicApiKey: string | null;
  creditsWarnBelow?: number;
  http?: typeof fetch;
  readProfile?: (ctx: PublicContext, target: FollowerTarget) => Promise<number | null>;
  alert: (subject: string, lines: string[]) => Promise<void>;
  record?: (properties: Record<string, unknown>) => Promise<void>;
};

export type HealthResult = { checked: Platform[]; problems: string[]; creditsLeft: number | null };

export async function runStatsHealthCheck(deps: HealthDeps): Promise<HealthResult> {
  const http = deps.http ?? fetch;
  const publicOn = deps.publicApiKey ? deps.publicPlatforms : [];
  const checked = [...new Set([...publicOn, ...(deps.platforms.includes("bluesky") ? ["bluesky" as const] : [])])];
  const problems: string[] = [];
  let creditsLeft: number | null = null;
  const ctx: PublicContext = {
    apiKey: deps.publicApiKey ?? "",
    http,
    onCredits: (n) => (creditsLeft = creditsLeft === null ? n : Math.min(creditsLeft, n)),
  };

  // 1. One known public profile per platform.
  for (const platform of checked) {
    const target = CANARY_PROFILES[platform];
    if (!target) continue;
    try {
      const official = platform === "bluesky" && deps.platforms.includes("bluesky");
      const n = official ? await blueskyFollowers(http, target.externalId) : await (deps.readProfile ?? publicFollowers)(ctx, target);
      if (!n) problems.push(`${DISPLAY_NAMES[platform]}: reading a public profile (@${target.handle ?? target.externalId}) returned no follower count.`);
    } catch (error) {
      problems.push(`${DISPLAY_NAMES[platform]}: reading a public profile failed: ${message(error)}`);
    }
  }
  // Without the ScrapeCreators key, every public platform is silently off.
  if (!deps.publicApiKey && deps.publicPlatforms.length) {
    problems.push(`Public stats are switched on for ${deps.publicPlatforms.map((p) => DISPLAY_NAMES[p]).join(", ")}, but the ScrapeCreators key is missing, so none are read.`);
  }

  // 2. Every user's posts from the last 30 days, by platform.
  const rows = await deps.sql<{ platform: Platform; tracked: number | string; failing: number | string; example: string | null }>(
    `SELECT platform, count(*) AS tracked,
       count(*) FILTER (WHERE last_error IS NOT NULL AND last_error !~* $1) AS failing,
       min(last_error) FILTER (WHERE last_error IS NOT NULL AND last_error !~* $1) AS example
     FROM public.post_metrics WHERE published_at > now() - interval '30 days' GROUP BY platform`,
    [EXPECTED_STOPS.source],
  );
  for (const row of rows) {
    const tracked = Number(row.tracked);
    const failing = Number(row.failing);
    if (failing >= 3 && failing / tracked >= 0.25) {
      problems.push(`${DISPLAY_NAMES[row.platform]}: ${failing} of ${tracked} recent posts can't be read. Example: ${(row.example ?? "").slice(0, 200)}`);
    }
  }

  // 3. Credits.
  const warnBelow = deps.creditsWarnBelow ?? 1000;
  if (creditsLeft !== null && creditsLeft < warnBelow) {
    problems.push(`ScrapeCreators credits are low: ${creditsLeft} left. Stats stop for every user when they reach 0.`);
  }

  await deps.record?.({ ok: problems.length === 0, problems: problems.length, platforms: checked, credits_left: creditsLeft });
  if (problems.length) {
    await deps.alert(`Post Social stats: ${problems.length} problem${problems.length === 1 ? "" : "s"} found`, [
      "The daily stats check found:",
      "",
      ...problems.map((p) => `- ${p}`),
      "",
      `Checked: ${checked.map((p) => DISPLAY_NAMES[p]).join(", ") || "nothing (no stats switched on)"}.`,
    ]);
  }
  return { checked, problems, creditsLeft };
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 200);
