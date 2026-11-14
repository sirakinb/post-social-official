// Daily stats health check. Stats can stop for every user at once (a platform changes its
// pages, the ScrapeCreators credits run out) without any one post saying so, so once a day
// the worker checks each platform that is switched on, independent of who has connected
// what, and alerts the admin when something is wrong:
//   1. reads one well-known public profile per platform (a canary: proves reads work today);
//   2. looks across every user's posts for a platform where many reads are failing;
//   3. warns before the ScrapeCreators credits run out;
//   4. flags stats that stopped updating, and accounts with no follower count for two days.
import type { Sql } from "../../../backend/lib/access";
import { DISPLAY_NAMES, type Platform } from "../../../backend/lib/connections/platforms";
import { blueskyFollowers } from "./followers";
import { publicFollowers, realHandle, type FollowerTarget, type PublicContext } from "./public";

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
  // Paused workspaces are skipped by the stats sweep, so their posts aren't overdue.
  const rows = await deps.sql<{ platform: Platform; tracked: number | string; failing: number | string; example: string | null; overdue: number | string }>(
    `SELECT m.platform, count(*) AS tracked,
       count(*) FILTER (WHERE m.last_error IS NOT NULL AND m.last_error !~* $1) AS failing,
       min(m.last_error) FILTER (WHERE m.last_error IS NOT NULL AND m.last_error !~* $1) AS example,
       count(*) FILTER (WHERE m.next_fetch_at < now() - interval '6 hours' AND NOT w.publishing_paused) AS overdue
     FROM public.post_metrics m JOIN public.workspaces w ON w.id = m.workspace_id
     WHERE m.published_at > now() - interval '30 days' GROUP BY m.platform`,
    [EXPECTED_STOPS.source],
  );
  for (const row of rows) {
    const tracked = Number(row.tracked);
    const failing = Number(row.failing);
    const overdue = Number(row.overdue ?? 0);
    if (failing >= 3 && failing / tracked >= 0.25) {
      problems.push(`${DISPLAY_NAMES[row.platform]}: ${failing} of ${tracked} recent posts can't be read. Example: ${(row.example ?? "").slice(0, 200)}`);
    }
    if (overdue > 0) {
      problems.push(`${DISPLAY_NAMES[row.platform]}: stats for ${overdue} recent post${overdue === 1 ? "" : "s"} haven't updated in over 6 hours.`);
    }
  }

  // 4. Follower counts are saved once a day per account; none for today or yesterday means
  // the lookup keeps failing. LinkedIn has no public count, and accounts that can't be looked
  // up yet (no handle learned) are skipped, as the follower sweep does.
  const followerPlatforms = checked.filter((p) => p !== "linkedin");
  if (followerPlatforms.length) {
    const missing = await deps.sql<{ platform: Platform; handle: string | null; external_account_id: string }>(
      `SELECT a.platform, nullif(a.handle, '') AS handle, a.external_account_id
       FROM public.connected_accounts a JOIN public.workspaces w ON w.id = a.workspace_id
       WHERE a.platform = ANY($1::text[]) AND a.health <> 'disconnected' AND NOT w.publishing_paused
         AND a.created_at < now() - interval '36 hours'
         AND NOT EXISTS (SELECT 1 FROM public.account_follower_days f
           WHERE f.connected_account_id = a.id AND f.day >= (now() AT TIME ZONE 'UTC')::date - 1)`,
      [followerPlatforms],
    );
    const byPlatform = new Map<Platform, string[]>();
    for (const a of missing) {
      if (!canLookUp(a.platform, a.handle, a.external_account_id)) continue;
      byPlatform.set(a.platform, [...(byPlatform.get(a.platform) ?? []), realHandle(a.platform, a.handle) ? `@${realHandle(a.platform, a.handle)}` : `id ${a.external_account_id}`]);
    }
    for (const [platform, names] of byPlatform) {
      problems.push(`${DISPLAY_NAMES[platform]}: ${names.length} connected account${names.length === 1 ? " has" : "s have"} no follower count for 2 days (${names.slice(0, 3).join(", ")}).`);
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

// Mirrors publicFollowers: these platforms need a real handle (YouTube a channel id or handle).
function canLookUp(platform: Platform, handle: string | null, externalId: string): boolean {
  if (platform === "facebook" || platform === "bluesky") return true;
  if (platform === "youtube") return /^UC[\w-]+$/.test(externalId) || Boolean(realHandle(platform, handle));
  return Boolean(realHandle(platform, handle));
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 200);
