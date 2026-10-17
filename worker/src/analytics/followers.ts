// Saves each account's follower count once a day, from the day it's first seen; the Growth
// tab and engagement rates are built from these. Bluesky's count comes from its own free
// public API; other platforms' from their public profile page through ScrapeCreators, where
// that's switched on. LinkedIn members have no public profile address, so their count is
// saved from their posts' pages instead (see runner.ts).
import type { Sql } from "../../../backend/lib/access";
import type { Platform } from "../../../backend/lib/connections/platforms";
import { BLUESKY_APPVIEW } from "./platforms";
import { publicFollowers, type FollowerTarget, type PublicContext } from "./public";

export type FollowerDeps = {
  sql: Sql;
  platforms: Platform[]; // read through the platform's own API (ANALYTICS_PLATFORMS)
  publicPlatforms: Platform[]; // read from public pages (ANALYTICS_PUBLIC_PLATFORMS)
  publicApiKey?: string | null;
  http?: typeof fetch;
  onlyWorkspace?: string;
  readPublic?: (ctx: PublicContext, target: FollowerTarget) => Promise<number | null>;
  now?: () => number;
  log?: (message: string, details?: Record<string, unknown>) => void;
};

type Account = { id: string; workspace_id: string; platform: Platform; handle: string | null; external_account_id: string };

const HOUR = 3600_000;
// Accounts whose count could not be read are left alone for a while, so a broken profile
// doesn't cost a read every few minutes. Kept in memory: a restart just tries once more.
const lastFailure = new Map<string, number>();

export async function runFollowerSweep(deps: FollowerDeps): Promise<number> {
  const now = deps.now ?? Date.now;
  const publicOn = deps.publicApiKey ? deps.publicPlatforms : [];
  const platforms = [...new Set([...publicOn, ...(deps.platforms.includes("bluesky") ? ["bluesky" as const] : [])])];
  if (!platforms.length) return 0;
  const accounts = await deps.sql<Account>(
    `SELECT a.id, a.workspace_id, a.platform, nullif(a.handle, '') AS handle, a.external_account_id
     FROM public.connected_accounts a JOIN public.workspaces w ON w.id = a.workspace_id
     WHERE a.platform = ANY($1::text[]) AND a.health <> 'disconnected'
       AND (CASE WHEN $2::uuid IS NULL THEN NOT w.publishing_paused ELSE a.workspace_id = $2 END)
       AND NOT EXISTS (SELECT 1 FROM public.account_follower_days f WHERE f.connected_account_id = a.id AND f.day = (now() AT TIME ZONE 'UTC')::date)
     ORDER BY a.created_at LIMIT 40`,
    [platforms, deps.onlyWorkspace ?? null],
  );
  let saved = 0;
  for (const account of accounts) {
    if (now() - (lastFailure.get(account.id) ?? -Infinity) < 6 * HOUR) continue;
    try {
      const official = account.platform === "bluesky" && deps.platforms.includes("bluesky");
      const followers = official
        ? await blueskyFollowers(deps.http ?? fetch, account.external_account_id)
        : await (deps.readPublic ?? publicFollowers)({ apiKey: deps.publicApiKey!, http: deps.http ?? fetch }, { platform: account.platform, handle: account.handle, externalId: account.external_account_id });
      if (followers === null) {
        lastFailure.set(account.id, now());
        continue;
      }
      await deps.sql(
        `INSERT INTO public.account_follower_days (connected_account_id, workspace_id, day, followers, source)
         VALUES ($1, $2, (now() AT TIME ZONE 'UTC')::date, $3, $4)
         ON CONFLICT (connected_account_id, day) DO UPDATE SET followers = EXCLUDED.followers, source = EXCLUDED.source, fetched_at = now()`,
        [account.id, account.workspace_id, followers, official ? "official" : "public"],
      );
      lastFailure.delete(account.id);
      saved++;
    } catch (error) {
      lastFailure.set(account.id, now());
      deps.log?.("followers error", { account: account.id, message: String((error as Error)?.message ?? error) });
    }
  }
  return saved;
}

async function blueskyFollowers(http: typeof fetch, did: string): Promise<number | null> {
  const response = await http(`${BLUESKY_APPVIEW}/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`);
  if (!response.ok) throw new Error(`Bluesky profile: HTTP ${response.status}`);
  const body = (await response.json()) as { followersCount?: unknown };
  const n = Number(body.followersCount);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
