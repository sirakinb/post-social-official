import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildDashboard, type PostRow } from "../../../../../backend/lib/analytics-dashboard";
import { AnalyticsView, type AnalyticsData, type Tab } from "./analytics-view";

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
    expect(screen.getByText("Engagement rate")).toBeInTheDocument();
    expect(screen.getByText("Maker IG")).toBeInTheDocument();
    expect(screen.getByText("@makerx")).toBeInTheDocument();
    expect(screen.getByText("Counting")).toBeInTheDocument(); // X has no follower count yet
    expect(container.textContent).not.toMatch(/—/);
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

  it("the weekly chart shows one measure at a time, engagements split into their parts", () => {
    view("overview");
    const engagements = screen.getByRole("button", { name: "Engagements" });
    expect(engagements).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: "Engagements by week" })).toBeInTheDocument();
    expect(screen.getByLabelText("Parts")).toHaveTextContent(/Likes.*Comments.*Reposts & shares.*Saves/);
    const bars = screen.getAllByTestId("week-bar");
    expect(bars.at(-1)!.getAttribute("title")).toMatch(/Likes: \d[\s\S]*Total: \d/);
    fireEvent.click(screen.getByRole("button", { name: "Views" }));
    expect(screen.getByRole("button", { name: "Views" })).toHaveAttribute("aria-pressed", "true");
    expect(engagements).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("img", { name: "Views by week" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Parts")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Rate" }));
    expect(screen.getByRole("img", { name: "Engagement rate by week" })).toBeInTheDocument();
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
