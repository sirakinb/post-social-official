// Everything the Analytics page shows, in one read: headline numbers, engagement over time,
// posting volume, each account's followers and growth, each post's results, the best times
// and formats, how often to post, and how engagement builds up after posting.
//
// Only numbers a platform reported are used: a post or account with no number for
// something adds nothing to it (no invented zeros), so totals cover what exists.
import { ApiError, membership, type Caller, type Sql } from "./access";
import { publicHandle } from "./connections/handles";
import { DISPLAY_NAMES, type Platform } from "./connections/platforms";

export const DASHBOARD_PERIODS = { last_7_days: 7, last_30_days: 30, last_90_days: 90 } as const;
export const REFRESHES_PER_DAY = 3;
const COUNTERS = ["views", "likes", "comments", "shares", "saves", "reposts", "quotes"] as const;
type Counter = (typeof COUNTERS)[number];
export type Stats = Partial<Record<Counter, number>>;
export type Source = "official" | "public" | "mixed";
export type Format = "video" | "carousel" | "photo" | "text";

export type PostRow = {
  destination_id: string;
  post_id: string;
  platform: Platform;
  connected_account_id: string;
  published_at: string;
  caption: string | null;
  live_url: string | null;
  account: string;
  format: Format;
  source: Source | null;
  fetched_at: string | null;
  next_fetch_at: string | null;
} & Partial<Record<Counter, number | string | null>>;

export type AccountRow = { id: string; platform: Platform; display_name: string; handle: string | null; avatar_url: string | null };
export type FollowerRow = { connected_account_id: string; day: string; followers: number | string; source: "official" | "public" };
export type DayRow = { destination_id: string; day: string } & Partial<Record<Counter, number | string | null>>;

const DAY = 86_400_000;
const round = (n: number, digits = 4) => Math.round(n * 10 ** digits) / 10 ** digits;

export function statsOf(row: Partial<Record<Counter, number | string | null>>): Stats {
  const out: Stats = {};
  for (const key of COUNTERS) if (row[key] !== null && row[key] !== undefined) out[key] = Number(row[key]);
  return out;
}

// Every interaction the platform reported: likes, comments, shares, reposts, quotes, saves.
export const engagementsOf = (s: Stats) => (s.likes ?? 0) + (s.comments ?? 0) + (s.shares ?? 0) + (s.reposts ?? 0) + (s.quotes ?? 0) + (s.saves ?? 0);
const hasEngagement = (s: Stats) => ["likes", "comments", "shares", "reposts", "quotes", "saves"].some((k) => s[k as Counter] !== undefined);

// Monday 00:00 UTC of the week holding `ms`.
export function weekStart(ms: number) {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function cadenceBucket(postsInWeek: number) {
  if (postsInWeek <= 2) return "1-2";
  if (postsInWeek <= 5) return "3-5";
  if (postsInWeek <= 10) return "6-10";
  return "11+";
}
export const CADENCE_BUCKETS = ["1-2", "3-5", "6-10", "11+"] as const;
// Points on the build-up curve, in days after posting.
export const BUILD_UP_DAYS = [1, 2, 3, 7, 14, 30] as const;

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

export function buildDashboard(input: {
  now: number;
  days: number;
  posts: PostRow[];
  accounts: AccountRow[];
  followers: FollowerRow[];
  history: DayRow[]; // day-by-day numbers for the build-up curve
  refreshesUsed: number;
}) {
  const { now, days } = input;
  const since = now - days * DAY;

  // Each account's follower counts, oldest first.
  const series = new Map<string, Array<{ day: string; followers: number; source: string }>>();
  for (const f of [...input.followers].sort((a, b) => a.day.localeCompare(b.day))) {
    const list = series.get(f.connected_account_id) ?? [];
    list.push({ day: f.day, followers: Number(f.followers), source: f.source });
    series.set(f.connected_account_id, list);
  }
  const latestFollowers = (id: string) => series.get(id)?.at(-1)?.followers;
  const followersOn = (id: string, dayIso: string) => {
    const list = series.get(id);
    if (!list?.length) return undefined;
    let found = list[0].followers;
    for (const point of list) if (point.day <= dayIso) found = point.followers;
    return found;
  };

  // Posts with numbers; a post's rate is its engagements over its account's followers.
  const posts = input.posts
    .filter((p) => p.fetched_at)
    .map((p) => {
      const stats = statsOf(p);
      const engagements = engagementsOf(stats);
      const followers = latestFollowers(p.connected_account_id);
      const rate = followers && hasEngagement(stats) ? engagements / followers : null;
      return {
        destination_id: p.destination_id,
        post_id: p.post_id,
        platform: p.platform,
        platform_name: DISPLAY_NAMES[p.platform],
        account_id: p.connected_account_id,
        account: p.account,
        caption: p.caption ?? "",
        live_url: p.live_url,
        format: p.format,
        published_at: p.published_at,
        stats,
        engagements,
        engagement_rate: rate === null ? null : round(rate),
        source: (p.source ?? "official") as Source,
      };
    })
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));

  const rates = posts.map((p) => p.engagement_rate).filter((r): r is number => r !== null);
  const sum = (key: Counter) => posts.reduce((total, p) => total + (p.stats[key] ?? 0), 0);
  const anyViews = posts.some((p) => p.stats.views !== undefined);

  // Weeks in the period, oldest first.
  const weeks: number[] = [];
  for (let w = weekStart(since); w <= now; w += 7 * DAY) weeks.push(w);
  const weekly = weeks.map((w) => {
    const inWeek = posts.filter((p) => weekStart(Date.parse(p.published_at)) === w);
    const total = (key: Counter) => inWeek.reduce((t, p) => t + (p.stats[key] ?? 0), 0);
    return {
      week_start: isoDay(w),
      likes: total("likes"),
      comments: total("comments"),
      shares: total("shares") + total("reposts") + total("quotes"),
      views: total("views"),
      posts_by_platform: inWeek.reduce<Record<string, number>>((acc, p) => ((acc[p.platform] = (acc[p.platform] ?? 0) + 1), acc), {}),
    };
  });

  const postsByPlatform = Object.entries(posts.reduce<Record<string, number>>((acc, p) => ((acc[p.platform] = (acc[p.platform] ?? 0) + 1), acc), {}))
    .map(([platform, count]) => ({ platform: platform as Platform, platform_name: DISPLAY_NAMES[platform as Platform], posts: count }))
    .sort((a, b) => b.posts - a.posts);

  // Accounts: followers now, growth, and how their posts did. Accounts with no follower
  // count yet still list their posts; the page shows what each has.
  const accounts = input.accounts.map((a) => {
    const list = series.get(a.id) ?? [];
    const now7 = isoDay(now - 7 * DAY);
    const now30 = isoDay(now - 30 * DAY);
    const current = list.at(-1)?.followers;
    const change = (fromIso: string) => {
      if (current === undefined || !list.length || list[0].day > fromIso) return null;
      const before = followersOn(a.id, fromIso);
      return before === undefined ? null : current - before;
    };
    const mine = posts.filter((p) => p.account_id === a.id);
    const myRates = mine.map((p) => p.engagement_rate).filter((r): r is number => r !== null);
    return {
      id: a.id,
      platform: a.platform,
      platform_name: DISPLAY_NAMES[a.platform],
      name: a.display_name,
      handle: publicHandle(a.platform, a.handle),
      avatar_url: a.avatar_url,
      followers: current ?? null,
      change_7_days: change(now7),
      change_30_days: change(now30),
      // Since the first saved count, when there's less than 30 days of history.
      change_since_start: current !== undefined && list.length > 1 ? current - list[0].followers : null,
      tracking_since: list[0]?.day ?? null,
      posts: mine.length,
      engagements: mine.reduce((t, p) => t + p.engagements, 0),
      engagement_rate: myRates.length ? round(mean(myRates)!) : null,
      source: list.at(-1)?.source ?? (mine[0]?.source ?? null),
      history: list.filter((point) => point.day >= isoDay(since)).map((point) => ({ day: point.day, followers: point.followers })),
    };
  });
  const followersTotal = accounts.reduce((t, a) => t + (a.followers ?? 0), 0);
  const followerChange = accounts.reduce((t, a) => t + (a.change_30_days ?? a.change_since_start ?? 0), 0);

  // Best times: average rate by hour of the week (UTC; the page shifts it to local time).
  const hours = new Map<number, number[]>();
  for (const p of posts) {
    if (p.engagement_rate === null) continue;
    const d = new Date(p.published_at);
    const slot = ((d.getUTCDay() + 6) % 7) * 24 + d.getUTCHours();
    hours.set(slot, [...(hours.get(slot) ?? []), p.engagement_rate]);
  }
  const bestTimes = [...hours.entries()].map(([hour, list]) => ({ hour_of_week_utc: hour, posts: list.length, engagement_rate: round(mean(list)!) })).sort((a, b) => a.hour_of_week_utc - b.hour_of_week_utc);

  const formatRates = new Map<Format, number[]>();
  for (const p of posts) if (p.engagement_rate !== null) formatRates.set(p.format, [...(formatRates.get(p.format) ?? []), p.engagement_rate]);
  const formats = [...formatRates.entries()].map(([format, list]) => ({ format, posts: list.length, engagement_rate: round(mean(list)!) })).sort((a, b) => b.engagement_rate - a.engagement_rate);

  // How often to post: weeks grouped by how many posts went out on a platform that week.
  const cadence = postsByPlatform.map(({ platform, platform_name }) => {
    const byWeek = new Map<number, number[]>();
    for (const p of posts) {
      if (p.platform !== platform || p.engagement_rate === null) continue;
      const w = weekStart(Date.parse(p.published_at));
      byWeek.set(w, [...(byWeek.get(w) ?? []), p.engagement_rate]);
    }
    const buckets = new Map<string, number[]>();
    for (const list of byWeek.values()) {
      const bucket = cadenceBucket(list.length);
      buckets.set(bucket, [...(buckets.get(bucket) ?? []), ...list]);
    }
    return {
      platform,
      platform_name,
      buckets: CADENCE_BUCKETS.filter((b) => buckets.has(b)).map((b) => ({ bucket: b, weeks: [...byWeek.values()].filter((l) => cadenceBucket(l.length) === b).length, engagement_rate: round(mean(buckets.get(b)!)!) })),
    };
  }).filter((c) => c.buckets.length);

  const fetched = input.posts.map((p) => p.fetched_at).filter(Boolean) as string[];
  const upcoming = input.posts.map((p) => p.next_fetch_at).filter(Boolean) as string[];
  return {
    days,
    updated_at: fetched.length ? fetched.sort().at(-1)! : null,
    next_update_at: upcoming.length ? upcoming.sort()[0] : null,
    refreshes_left: Math.max(0, REFRESHES_PER_DAY - input.refreshesUsed),
    summary: {
      engagement_rate: rates.length ? round(mean(rates)!) : null,
      engagements: posts.reduce((t, p) => t + p.engagements, 0),
      followers: accounts.some((a) => a.followers !== null) ? followersTotal : null,
      follower_change: accounts.some((a) => a.followers !== null) ? followerChange : null,
      posts: posts.length,
      views: anyViews ? sum("views") : null,
      likes: sum("likes"),
      comments: sum("comments"),
      shares: sum("shares") + sum("reposts") + sum("quotes"),
      saves: sum("saves"),
    },
    weekly,
    posts_by_platform: postsByPlatform,
    accounts,
    posts,
    best_times: bestTimes,
    formats,
    cadence,
    build_up: buildUpCurve(input.posts, input.history),
  };
}

// How engagement builds up: for posts with 30 days of history, the share of their 30-day
// engagements reached N days after posting. null until there are such posts.
export function buildUpCurve(posts: Array<{ destination_id: string; published_at: string }>, history: DayRow[]) {
  const byPost = new Map<string, DayRow[]>();
  for (const h of history) byPost.set(h.destination_id, [...(byPost.get(h.destination_id) ?? []), h]);
  const shares = BUILD_UP_DAYS.map(() => [] as number[]);
  for (const p of posts) {
    const rows = (byPost.get(p.destination_id) ?? []).sort((a, b) => a.day.localeCompare(b.day));
    const start = Date.parse(p.published_at.slice(0, 10));
    // The last saved total on or before day N (day 1 is the day it went out).
    const at = (n: number) => {
      let value: number | undefined;
      for (const r of rows) if (Date.parse(r.day) - start <= (n - 1) * DAY) value = engagementsOf(statsOf(r));
      return value;
    };
    const final = rows.length && Date.parse(rows.at(-1)!.day) - start >= 29 * DAY ? at(30) : undefined;
    if (!final) continue;
    BUILD_UP_DAYS.forEach((n, i) => {
      const value = at(n);
      if (value !== undefined) shares[i].push(Math.min(1, value / final));
    });
  }
  return shares.every((list) => list.length) ? BUILD_UP_DAYS.map((n, i) => ({ day: n, share: round(mean(shares[i])!, 3) })) : null;
}

export type Dashboard = ReturnType<typeof buildDashboard>;

export async function analyticsDashboard(sql: Sql, caller: Caller, platforms: Platform[], input: { workspace_id: string; period?: unknown; platform?: unknown }) {
  await membership(sql, caller, input.workspace_id, false);
  const period = (input.period || "last_30_days") as keyof typeof DASHBOARD_PERIODS;
  if (!Object.hasOwn(DASHBOARD_PERIODS, period)) throw new ApiError(400, `period must be one of: ${Object.keys(DASHBOARD_PERIODS).join(", ")}.`);
  const platform = input.platform ? String(input.platform) : null;
  if (platform && !platforms.includes(platform as Platform)) throw new ApiError(400, `Stats are available for: ${platforms.map((p) => DISPLAY_NAMES[p]).join(", ")}.`);
  const enabled = platforms.length ? platforms : ["none"];
  const days = DASHBOARD_PERIODS[period];

  const posts = await sql<PostRow>(
    `SELECT m.destination_id, m.post_id, m.platform, m.connected_account_id, m.published_at, m.views, m.likes, m.comments, m.shares,
       m.saves, m.reposts, m.quotes, m.source, m.fetched_at, m.next_fetch_at, left(p.caption, 200) AS caption, d.live_url,
       a.display_name AS account,
       CASE WHEN EXISTS (SELECT 1 FROM public.post_media pm JOIN public.media_assets ma ON ma.id = pm.media_asset_id WHERE pm.post_id = m.post_id AND ma.media_type = 'video') THEN 'video'
            WHEN (SELECT count(*) FROM public.post_media pm WHERE pm.post_id = m.post_id) > 1 THEN 'carousel'
            WHEN EXISTS (SELECT 1 FROM public.post_media pm WHERE pm.post_id = m.post_id) THEN 'photo'
            ELSE 'text' END AS format
     FROM public.post_metrics m
     JOIN public.posts p ON p.id = m.post_id
     JOIN public.destinations d ON d.id = m.destination_id
     JOIN public.connected_accounts a ON a.id = m.connected_account_id
     WHERE m.workspace_id = $1 AND m.platform = ANY($2::text[]) AND ($3::text IS NULL OR m.platform = $3)
       AND m.published_at >= now() - make_interval(days => $4)
     ORDER BY m.published_at DESC LIMIT 3000`,
    [input.workspace_id, enabled, platform, days],
  );
  const accounts = await sql<AccountRow>(
    `SELECT id, platform, display_name, nullif(handle, '') AS handle, avatar_url FROM public.connected_accounts
     WHERE workspace_id = $1 AND platform = ANY($2::text[]) AND ($3::text IS NULL OR platform = $3) AND health <> 'disconnected'
     ORDER BY created_at`,
    [input.workspace_id, enabled, platform],
  );
  const followers = await sql<FollowerRow>(
    `SELECT connected_account_id, to_char(day, 'YYYY-MM-DD') AS day, followers, source FROM public.account_follower_days
     WHERE workspace_id = $1 AND connected_account_id = ANY($2::uuid[]) AND day >= (now() - make_interval(days => $3))::date
     ORDER BY day`,
    [input.workspace_id, accounts.map((a) => a.id), Math.max(days, 30) + 1],
  );
  // Day-by-day numbers for the build-up curve, from the newest 300 posts old enough to have 30 days.
  const history = await sql<DayRow>(
    `SELECT h.destination_id, to_char(h.day, 'YYYY-MM-DD') AS day, h.views, h.likes, h.comments, h.shares, h.saves, h.reposts, h.quotes
     FROM public.post_metric_days h
     WHERE h.destination_id IN (
       SELECT m.destination_id FROM public.post_metrics m
       WHERE m.workspace_id = $1 AND m.platform = ANY($2::text[]) AND ($3::text IS NULL OR m.platform = $3)
         AND m.published_at < now() - interval '30 days' AND m.published_at >= now() - interval '120 days'
       ORDER BY m.published_at DESC LIMIT 300)
     ORDER BY h.destination_id, h.day`,
    [input.workspace_id, enabled, platform],
  );
  const [{ used }] = await sql<{ used: string }>(
    `SELECT count(*) AS used FROM public.analytics_refreshes WHERE workspace_id = $1 AND requested_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
    [input.workspace_id],
  );
  // The build-up curve needs those older posts' published times.
  const older = history.length
    ? await sql<{ destination_id: string; published_at: string }>(
        `SELECT destination_id, published_at FROM public.post_metrics WHERE destination_id = ANY($1::uuid[])`,
        [[...new Set(history.map((h) => h.destination_id))]],
      )
    : [];
  const dashboard = buildDashboard({ now: Date.now(), days, posts, accounts, followers, history: [], refreshesUsed: Number(used) });
  dashboard.build_up = buildUpCurve(older.map((o) => ({ ...o, published_at: new Date(o.published_at).toISOString() })), history);
  return { period, platforms: platforms.map((p) => ({ platform: p, platform_name: DISPLAY_NAMES[p] })), ...dashboard };
}
