import { describe, expect, it } from "vitest";
import { accountInsights, buildDashboard, buildUpCurve, cadenceBucket, weekStart, type AccountRow, type FollowerRow, type InsightRow, type PostRow } from "./analytics-dashboard";

const NOW = Date.parse("2026-10-16T12:00:00Z"); // a Friday
const DAY = 86_400_000;

const post = (id: string, over: Partial<PostRow>): PostRow => ({
  destination_id: id,
  post_id: `p-${id}`,
  platform: "instagram",
  connected_account_id: "ig",
  published_at: new Date(NOW - 2 * DAY).toISOString(),
  caption: "hello",
  live_url: null,
  account: "Maker",
  format: "photo",
  source: "public",
  fetched_at: new Date(NOW - 3600_000).toISOString(),
  next_fetch_at: new Date(NOW + 3600_000).toISOString(),
  ...over,
});
const accounts: AccountRow[] = [
  { id: "ig", platform: "instagram", display_name: "Maker", handle: "maker", avatar_url: null },
  { id: "li", platform: "linkedin", display_name: "Maker", handle: null, avatar_url: null },
];
const followers: FollowerRow[] = [
  { connected_account_id: "ig", day: "2026-09-10", followers: 900, source: "public" },
  { connected_account_id: "ig", day: "2026-10-09", followers: 950, source: "public" },
  { connected_account_id: "ig", day: "2026-10-16", followers: "1000", source: "public" },
];

describe("buildDashboard", () => {
  it("says an X account's followers need a card, instead of counting forever", () => {
    const x: AccountRow = { id: "x", platform: "x", display_name: "Maker", handle: "maker", avatar_url: null };
    const locked = buildDashboard({ now: NOW, days: 30, accounts: [x], followers: [], history: [], refreshesUsed: 0, posts: [], followersNeedCard: ["x"] });
    expect(locked.accounts[0]).toMatchObject({ followers: null, followers_note: "needs_card" });
    const open = buildDashboard({ now: NOW, days: 30, accounts: [x], followers: [], history: [], refreshesUsed: 0, posts: [] });
    expect(open.accounts[0].followers_note).toBeNull();
  });

  const dash = buildDashboard({
    now: NOW,
    days: 30,
    accounts,
    followers,
    history: [],
    refreshesUsed: 1,
    posts: [
      post("a", { likes: 40, comments: 10, views: null }),
      post("b", { likes: 80, comments: 20, published_at: new Date(NOW - 9 * DAY).toISOString(), format: "video", views: "3000" }),
      post("c", { platform: "linkedin", connected_account_id: "li", likes: 5, comments: 1 }),
      post("never-read", { fetched_at: null, likes: null }),
    ],
  });

  it("adds up only numbers that exist, with no invented views", () => {
    expect(dash.summary).toMatchObject({ posts: 3, likes: 125, comments: 31, engagements: 156, views: 3000, followers: 1000 });
    expect(dash.refreshes_left).toBe(2);
  });

  it("has no reach unless a platform's own API reported it", () => {
    expect(dash.summary.reach).toBeNull();
    expect(dash.posts.every((p) => p.reach === null)).toBe(true);
    const withReach = buildDashboard({
      now: NOW, days: 30, accounts, followers, history: [], refreshesUsed: 0,
      posts: [post("r1", { likes: 4, reach: "320", source: "official" }), post("r2", { likes: 2, reach: 80, source: "official" }), post("r3", { likes: 1 })],
    });
    // r3 has no reach, so a total would leave it out: no total, but each post keeps its own.
    expect(withReach.summary.reach).toBeNull();
    expect(withReach.posts.find((p) => p.destination_id === "r1")).toMatchObject({ reach: 320, source: "official" });
    expect(withReach.posts.find((p) => p.destination_id === "r3")!.reach).toBeNull();
    const allReach = buildDashboard({
      now: NOW, days: 30, accounts, followers, history: [], refreshesUsed: 0,
      posts: [post("r1", { likes: 4, reach: "320", source: "official" }), post("r2", { likes: 2, reach: 80, source: "official" })],
    });
    expect(allReach.summary.reach).toBe(400);
  });

  it("rates a post by its engagements over its account's latest followers, and leaves it unrated without a count", () => {
    const a = dash.posts.find((p) => p.destination_id === "a")!;
    expect(a.engagement_rate).toBe(0.05);
    expect(dash.posts.find((p) => p.destination_id === "c")!.engagement_rate).toBeNull();
    expect(dash.summary.engagement_rate).toBe(0.075); // mean of 5% and 10%
  });

  it("lists every account with growth, and an account without counts still shows its posts", () => {
    const ig = dash.accounts.find((a) => a.id === "ig")!;
    expect(ig).toMatchObject({ followers: 1000, change_7_days: 50, change_30_days: 100, posts: 2, engagements: 150, source: "public" });
    const li = dash.accounts.find((a) => a.id === "li")!;
    expect(li).toMatchObject({ followers: null, change_30_days: null, posts: 1, engagements: 6 });
  });

  it("groups by week, platform, format, hour and posting cadence", () => {
    expect(dash.weekly.at(-1)!.posts_by_platform).toEqual({ instagram: 1, linkedin: 1 });
    expect(dash.posts_by_platform[0]).toMatchObject({ platform: "instagram", posts: 2 });
    expect(dash.formats.map((f) => f.format)).toEqual(["video", "photo"]);
    expect(dash.best_times).toEqual([{ hour_of_week_utc: 60, posts: 2, engagement_rate: 0.075 }]); // both went out Wednesday noon UTC
    expect(dash.cadence[0]).toMatchObject({ platform: "instagram", buckets: [{ bucket: "1-2", weeks: 2 }] });
  });

  it("knows when numbers were last read and next due", () => {
    expect(dash.updated_at).toBe(new Date(NOW - 3600_000).toISOString());
    expect(dash.next_update_at).toBe(new Date(NOW + 3600_000).toISOString());
  });
});

describe("helpers", () => {
  it("weeks start on Monday (UTC) and cadence falls in buckets", () => {
    expect(new Date(weekStart(NOW)).toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect([1, 3, 6, 11].map(cadenceBucket)).toEqual(["1-2", "3-5", "6-10", "11+"]);
  });
});

describe("buildUpCurve", () => {
  it("shows the share of 30-day engagements reached by each day, only from posts with 30 days of numbers", () => {
    const published = "2026-08-01T10:00:00.000Z";
    const history = [
      { destination_id: "old", day: "2026-08-01", likes: 50 },
      { destination_id: "old", day: "2026-08-02", likes: 70 },
      { destination_id: "old", day: "2026-08-03", likes: 80 },
      { destination_id: "old", day: "2026-08-07", likes: 90 },
      { destination_id: "old", day: "2026-08-14", likes: 95 },
      { destination_id: "old", day: "2026-08-30", likes: 100 },
      { destination_id: "young", day: "2026-08-01", likes: 5 },
    ];
    const curve = buildUpCurve([{ destination_id: "old", published_at: published }, { destination_id: "young", published_at: published }], history);
    expect(curve).toEqual([
      { day: 1, share: 0.5 },
      { day: 2, share: 0.7 },
      { day: 3, share: 0.8 },
      { day: 7, share: 0.9 },
      { day: 14, share: 0.95 },
      { day: 30, share: 1 },
    ]);
  });

  it("is empty until a post has 30 days of numbers", () => {
    expect(buildUpCurve([{ destination_id: "x", published_at: "2026-10-10T00:00:00Z" }], [{ destination_id: "x", day: "2026-10-10", likes: 1 }])).toBeNull();
  });
});

describe("whole-account analytics", () => {
  const insight = (day: string, over: Partial<InsightRow>): InsightRow => ({ connected_account_id: "ig", day, views: null, reach: null, profile_views: null, interactions: null, engaged: null, ...over });

  it("adds posts made outside Post Social to the totals and marks them", () => {
    const dash = buildDashboard({
      now: NOW,
      days: 30,
      accounts,
      followers,
      history: [],
      refreshesUsed: 0,
      posts: [post("ours", { likes: 10 }), post("outside:1", { post_id: "", likes: 30, source: "official", outside: true, live_url: "https://instagram.com/p/1" })],
    });
    expect(dash.posts.map((p) => [p.destination_id, p.outside])).toEqual([["ours", false], ["outside:1", true]]);
    expect(dash.summary.posts).toBe(2);
    expect(dash.summary.engagements).toBe(40);
    expect(dash.accounts.find((a) => a.id === "ig")).toMatchObject({ posts: 2, outside_posts: 1 });
  });

  it("totals an account's own numbers and averages its reach per day", () => {
    expect(accountInsights([])).toBeNull();
    expect(accountInsights([insight("2026-10-14", {})])).toBeNull();
    expect(accountInsights([insight("2026-10-15", { views: 100, reach: 40, profile_views: 3, interactions: "12" }), insight("2026-10-14", { views: "50", reach: 20 })])).toEqual({
      days: 2,
      views: 150,
      profile_views: 3,
      interactions: 12,
      engaged: null,
      reach_per_day: 30,
      since: "2026-10-14",
    });
  });

  it("gives each account its insights for the period and its audience", () => {
    const dash = buildDashboard({
      now: NOW,
      days: 7,
      accounts,
      followers,
      history: [],
      refreshesUsed: 0,
      posts: [],
      insights: [insight("2026-10-15", { views: 100 }), insight("2026-09-01", { views: 999 })],
      audiences: [{ connected_account_id: "ig", breakdowns: { country: [{ label: "US", value: 5 }] }, fetched_at: "2026-10-15T00:00:00Z" }],
    });
    const ig = dash.accounts.find((a) => a.id === "ig")!;
    expect(ig.insights).toMatchObject({ days: 1, views: 100 });
    expect(ig.audience).toEqual({ country: [{ label: "US", value: 5 }] });
    expect(dash.accounts.find((a) => a.id === "li")).toMatchObject({ insights: null, audience: null });
  });
});
