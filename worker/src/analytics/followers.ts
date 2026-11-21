// Saves each account's follower count once a day, from the day it's first seen; the Growth
// tab and engagement rates are built from these. Bluesky's count comes from its own free
// public API and X's from X's API with the account's own access (a paid user read, $0.01 a
// day per account, so only for workspaces that pay; see PAYING_WORKSPACE), where they're
// switched on in ANALYTICS_PLATFORMS; other platforms' from their public profile page
// through ScrapeCreators, where that's switched on. LinkedIn accounts connected through the
// Community Management app read their own count (a Page's followers, or a member's); others
// have no public profile address, so their count is saved from their posts' pages instead
// (see runner.ts).
import type { Sql } from "../../../backend/lib/access";
import type { Platform, Settings } from "../../../backend/lib/connections/platforms";
import { accountToken } from "../credentials";
import { LINKEDIN_API, LINKEDIN_VERSION, isLinkedInPage, linkedinAuthor } from "../../../backend/lib/connections/linkedin";
import { BLUESKY_APPVIEW, X_API } from "./platforms";
import { publicFollowers, type FollowerTarget, type PublicContext } from "./public";

export type FollowerDeps = {
  sql: Sql;
  platforms: Platform[]; // read through the platform's own API (ANALYTICS_PLATFORMS)
  publicPlatforms: Platform[]; // read from public pages (ANALYTICS_PUBLIC_PLATFORMS)
  publicApiKey?: string | null;
  setting?: Settings; // for the account's saved access (X)
  token?: (accountId: string) => Promise<string>; // tests; otherwise the account's saved access
  http?: typeof fetch;
  onlyWorkspace?: string;
  readPublic?: (ctx: PublicContext, target: FollowerTarget) => Promise<number | null>;
  now?: () => number;
  log?: (message: string, details?: Record<string, unknown>) => void;
};

type Account = { id: string; workspace_id: string; platform: Platform; handle: string | null; external_account_id: string; display_name: string; scopes: string[] | null };

// Platforms whose follower count is read through their own API when switched on there.
const OFFICIAL_FOLLOWERS: Platform[] = ["bluesky", "x", "linkedin"];
// Read officially by the whole-account sweep (account.ts) with every account's basic access,
// so they never cost a public read where their stats are switched on. Threads' count needs
// its insights permission, which older connections lack, so its public read stays as the
// fallback (the official count replaces it for the day when there is one).
const COUNTED_BY_ACCOUNT_SWEEP: Platform[] = ["instagram", "facebook"];

// A LinkedIn account may read its own follower count only with the Community Management
// app's permissions; accounts from the original app go on as before.
export const linkedinCountable = (account: Pick<Account, "external_account_id" | "scopes">) =>
  (account.scopes ?? []).includes(isLinkedInPage(account.external_account_id) ? "rw_organization_admin" : "r_member_profileAnalytics");

// SQL (for a row `a` of connected_accounts): the account's workspace pays, so its X follower
// count (about $0.30 a month) is covered by at least one paid account ($5): a Paid plan with
// a working card, or a comped plan (Tester). Free workspaces without a card get none.
export const PAYING_WORKSPACE = `EXISTS (
  SELECT 1 FROM (SELECT coalesce((SELECT p.plan_id FROM public.workspace_plans p WHERE p.workspace_id = a.workspace_id), 'tester') AS plan) pl
  LEFT JOIN public.workspace_billing b ON b.workspace_id = a.workspace_id
  WHERE pl.plan NOT IN ('free', 'paid') OR (pl.plan = 'paid' AND b.subscription_status IN ('active', 'trialing', 'past_due')))`;

const HOUR = 3600_000;
// Accounts whose profile read failed are left alone for a while, so a broken profile
// doesn't cost a read every few minutes. Kept in memory: a restart just tries once more.
const lastFailure = new Map<string, number>();

export async function runFollowerSweep(deps: FollowerDeps): Promise<number> {
  const now = deps.now ?? Date.now;
  const publicOn = (deps.publicApiKey ? deps.publicPlatforms : []).filter((p) => !(COUNTED_BY_ACCOUNT_SWEEP.includes(p) && deps.platforms.includes(p)));
  const officialOn = OFFICIAL_FOLLOWERS.filter((p) => deps.platforms.includes(p));
  const platforms = [...new Set([...publicOn, ...officialOn])];
  if (!platforms.length) return 0;
  const accounts = await deps.sql<Account>(
    `SELECT a.id, a.workspace_id, a.platform, nullif(a.handle, '') AS handle, a.external_account_id, a.display_name, a.scopes
     FROM public.connected_accounts a JOIN public.workspaces w ON w.id = a.workspace_id
     WHERE a.platform = ANY($1::text[]) AND a.health <> 'disconnected'
       AND (CASE WHEN $2::uuid IS NULL THEN NOT w.publishing_paused ELSE a.workspace_id = $2 END)
       AND NOT EXISTS (SELECT 1 FROM public.account_follower_days f WHERE f.connected_account_id = a.id AND f.day = (now() AT TIME ZONE 'UTC')::date)
       AND (a.platform <> 'x' OR NOT $3::boolean OR ${PAYING_WORKSPACE})
       -- LinkedIn accounts that can't read their own count wait for the public reads, if on.
       AND (a.platform <> 'linkedin' OR $4::boolean
            OR (a.external_account_id LIKE 'organization:%' AND 'rw_organization_admin' = ANY(a.scopes))
            OR (a.external_account_id NOT LIKE 'organization:%' AND 'r_member_profileAnalytics' = ANY(a.scopes)))
     ORDER BY a.created_at LIMIT 40`,
    [platforms, deps.onlyWorkspace ?? null, officialOn.includes("x"), publicOn.includes("linkedin")],
  );
  let saved = 0;
  for (const account of accounts) {
    if (now() - (lastFailure.get(account.id) ?? -Infinity) < 6 * HOUR) continue;
    try {
      const official = officialOn.includes(account.platform) && (account.platform !== "linkedin" || linkedinCountable(account));
      if (!official && !publicOn.includes(account.platform)) continue;
      const followers = !official
        ? await (deps.readPublic ?? publicFollowers)({ apiKey: deps.publicApiKey!, http: deps.http ?? fetch }, { platform: account.platform, handle: account.handle, externalId: account.external_account_id })
        : account.platform === "bluesky"
          ? await blueskyFollowers(deps.http ?? fetch, account.external_account_id)
          : account.platform === "linkedin"
            ? await linkedinFollowers(deps.http ?? fetch, await tokenFor(deps, account), account.external_account_id)
            : await xFollowers(deps.http ?? fetch, await tokenFor(deps, account));
      // Can't be looked up yet (nothing was read): try again on the next sweep, since what's
      // missing (such as a YouTube channel's handle) can be learned at any time.
      if (followers === null) continue;
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

export async function blueskyFollowers(http: typeof fetch, did: string): Promise<number | null> {
  const response = await http(`${BLUESKY_APPVIEW}/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`);
  if (!response.ok) throw new Error(`Bluesky profile: HTTP ${response.status}`);
  const body = (await response.json()) as { followersCount?: unknown };
  const n = Number(body.followersCount);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// X: the connected account's own profile, with its access (tweet.read, users.read).
export async function xFollowers(http: typeof fetch, token: string): Promise<number | null> {
  const response = await http(`${X_API}/users/me?user.fields=public_metrics`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`X profile: HTTP ${response.status}`);
  const body = (await response.json()) as { data?: { public_metrics?: { followers_count?: unknown } } };
  const n = Number(body.data?.public_metrics?.followers_count);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// LinkedIn: a Page's follower count (its network size), or the member's own followers.
export async function linkedinFollowers(http: typeof fetch, token: string, externalId: string): Promise<number | null> {
  const headers = { Authorization: `Bearer ${token}`, "LinkedIn-Version": LINKEDIN_VERSION, "X-Restli-Protocol-Version": "2.0.0" };
  const page = isLinkedInPage(externalId);
  const url = page
    ? `${LINKEDIN_API}/networkSizes/${encodeURIComponent(linkedinAuthor(externalId))}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`
    : `${LINKEDIN_API}/memberFollowersCount?q=me`;
  const response = await http(url, { headers });
  if (!response.ok) throw new Error(`LinkedIn followers: HTTP ${response.status}`);
  const body = (await response.json()) as { firstDegreeSize?: unknown; elements?: Array<{ memberFollowersCount?: unknown }> };
  const n = Number(page ? body.firstDegreeSize : body.elements?.[0]?.memberFollowersCount);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function tokenFor(deps: FollowerDeps, account: Account) {
  if (deps.token) return deps.token(account.id);
  if (!deps.setting) throw new Error("No settings to open the account's saved access.");
  return accountToken({ sql: deps.sql, setting: deps.setting }, { id: account.id, platform: account.platform, displayName: account.display_name });
}
