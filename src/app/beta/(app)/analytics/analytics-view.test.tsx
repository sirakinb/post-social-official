import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildDashboard, type PostRow } from "../../../../../backend/lib/analytics-dashboard";
import { AccountTable, AnalyticsView, type AnalyticsData, type Tab } from "./analytics-view";

const NOW = Date.parse("2026-10-16T12:00:00Z");
const DAY = 86_400_000;
const row = (id: string, over: Partial<PostRow>): PostRow => ({
  destination_id: id,
  post_id: `p-${id}`,
  platform: "instagram",
  connected_account_id: "ig",
  published_at: new Date(NOW - 2 * DAY).toISOString(),
  caption: `Caption ${id}`,
  live_url: "https://instagram.com/p/1",
  account: "Maker",
  format: "photo",
  source: "public",
  fetched_at: new Date(NOW).toISOString(),
  next_fetch_at: null,
  ...over,
});

const dashboard = buildDashboard({
  now: NOW,
  days: 30,
  refreshesUsed: 0,
  history: [],
  accounts: [
    { id: "ig", platform: "instagram", display_name: "Maker IG", handle: "maker", avatar_url: null },
    { id: "x", platform: "x", display_name: "Maker X", handle: "@makerx", avatar_url: null },
  ],
  followers: [
    { connected_account_id: "ig", day: "2026-10-01", followers: 900, source: "public" },
    { connected_account_id: "ig", day: "2026-10-16", followers: 1000, source: "public" },
  ],
  posts: [
    row("ig1", { likes: 40, comments: 10 }),
    row("x1", { platform: "x", connected_account_id: "x", account: "Maker X", format: "text", views: 900, likes: 4, comments: 1, reposts: 2, quotes: 0, saves: 3 }),
  ],
});
const data: AnalyticsData = { ...dashboard, period: "last_30_days", platforms: [{ platform: "instagram", platform_name: "Instagram" }, { platform: "x", platform_name: "X" }] };

const view = (tab: Tab, showSources = false) =>
  render(<AnalyticsView data={{ ...data, posts: [] }} postCount={data.posts.length} tab={tab} query={tab === "overview" ? {} : { tab }} posts={data.posts} topPosts={data.posts} showSources={showSources} />);

describe("Analytics page", () => {
  it("has four tabs and platform filters that keep the current tab", () => {
    view("posts");
    const tabs = screen.getByRole("navigation", { name: "Analytics sections" });
    expect(within(tabs).getAllByRole("link").map((l) => l.textContent)).toEqual(["Overview", "Posts", "Growth", "Best times"]);
    expect(within(tabs).getByRole("link", { name: "Posts" })).toHaveAttribute("aria-current", "page");
    const x = screen.getAllByRole("link").find((l) => l.textContent === "X");
    expect(x).toHaveAttribute("href", "/beta/analytics?tab=posts&platform=x");
  });

  it("overview shows totals and every account, with no dashes for missing numbers", () => {
    const { container } = view("overview");
    expect(screen.getAllByText("Engagement rate")[0]).toBeInTheDocument();
    expect(screen.getByText("Maker IG")).toBeInTheDocument();
    expect(screen.getByText("@makerx")).toBeInTheDocument();
    expect(screen.getByText("Counting")).toBeInTheDocument(); // X has no follower count yet
    expect(container.textContent).not.toMatch(/—/);
  });

  it("labels follower change as such, and says when it counts from under 30 days of history", () => {
    view("overview");
    expect(dashboard.summary.follower_change_since).toBe("2026-10-01");
    expect(screen.getByText("+100 since Oct 1")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Follower change" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Last 30 days" })).toBeNull();
    expect(screen.getByText("since Oct 1")).toBeInTheDocument();
  });

  it("says a YouTube channel is counted after its first video, until its channel is known", () => {
    const yt = { ...data.accounts.find((a) => a.id === "x")!, id: "yt", platform: "youtube" as const, handle: null, followers: null };
    render(<AccountTable accounts={[yt]} showSources={false} />);
    expect(screen.getByText("After your first video")).toBeInTheDocument();
  });

  it("hides where numbers came from unless the viewer may see it", () => {
    view("overview");
    expect(screen.queryByRole("columnheader", { name: "Data" })).toBeNull();
    expect(screen.queryByText(/Public/)).toBeNull();
  });

  it("shows the Data column on dev and to admins", () => {
    view("overview", true);
    expect(screen.getByRole("columnheader", { name: "Data" })).toBeInTheDocument();
  });

  it("each post lists only its own platform's results", () => {
    view("posts");
    const lists = screen.getAllByRole("list", { name: "Results" });
    const ig = lists.find((l) => l.textContent?.includes("comments"))!;
    const x = lists.find((l) => l.textContent?.includes("views"))!;
    expect(within(ig).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["40 likes", "10 comments"]);
    expect(within(x).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["900 views", "4 likes", "1 replies", "2 reposts", "3 bookmarks"]);
  });

  it("engagement shows one measure at a time as weekly bars, split by type", () => {
    view("overview");
    const measures = screen.getByRole("group", { name: "Measure" });
    expect(within(measures).getAllByRole("button").map((b) => b.textContent)).toEqual(["Engagements", "Views", "Engagement rate"]);
    expect(within(measures).getByRole("button", { name: "Engagements" })).toHaveAttribute("aria-pressed", "true");
    const chart = screen.getByRole("img", { name: "Engagements by week" });
    // This week: Instagram 40 likes + 10 comments, X 4 likes + 1 reply + 2 reposts + 3 bookmarks.
    expect(within(chart).getByLabelText(/^Week of Oct 12: 44 likes, 11 comments, 2 reposts & shares, 3 saves$/)).toBeInTheDocument();
    fireEvent.click(within(measures).getByRole("button", { name: "Views" }));
    expect(screen.getByRole("img", { name: "Views by week" })).toBeInTheDocument();
    expect(screen.getByText("Highest week 900")).toBeInTheDocument();
  });

  it("growth shows accounts with counts, and best times fills in from rated posts", () => {
    view("growth");
    expect(screen.getByText("Maker IG")).toBeInTheDocument();
    expect(screen.queryByText("Maker X")).toBeNull();
  });

  it("best times shows the best slot so far", () => {
    view("best-times");
    expect(screen.getByText(/Your best slot so far is/)).toBeInTheDocument();
  });
});
