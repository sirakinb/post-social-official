import { describe, expect, it } from "vitest";
import { canSeeSources, count, localSlot, percent, resultsOf, signed, sortPosts } from "./analytics-view";

describe("who sees where numbers came from", () => {
  it("everyone on dev; on production only the admins listed", () => {
    expect(canSeeSources("anyone@example.com", "development", "")).toBe(true);
    expect(canSeeSources("anyone@example.com", "production", "aki@example.com")).toBe(false);
    expect(canSeeSources("Aki@Example.com", "production", "ops@example.com, aki@example.com")).toBe(true);
    expect(canSeeSources(null, "production", "aki@example.com")).toBe(false);
    expect(canSeeSources("", "production", "")).toBe(false);
  });
});

describe("number formatting", () => {
  it("shows exact counts below 100K and short ones above", () => {
    expect(count(48_210)).toBe("48,210");
    expect(count(310_940)).toBe("310.9K");
    expect(signed(1200)).toBe("+1,200");
    expect(signed(-40)).toBe("−40");
    expect(signed(0)).toBe("0");
    expect(percent(0.064)).toBe("6.4%");
    expect(percent(0.25)).toBe("25%");
  });
});

describe("a post's results", () => {
  it("lists only the numbers the platform reported, in its own words", () => {
    expect(resultsOf("instagram", { likes: 10, comments: 2 })).toEqual([{ label: "likes", value: 10 }, { label: "comments", value: 2 }]);
    expect(resultsOf("x", { views: 900, likes: 4, comments: 1, reposts: 2, quotes: 1, saves: 3 })).toEqual([
      { label: "views", value: 900 },
      { label: "likes", value: 4 },
      { label: "replies", value: 1 },
      { label: "reposts", value: 3 },
      { label: "bookmarks", value: 3 },
    ]);
    expect(resultsOf("facebook", { likes: 7, shares: 1 }).map((r) => r.label)).toEqual(["reactions", "shares"]);
  });
});

describe("best times", () => {
  it("moves a UTC hour of the week into the viewer's weekday and 3-hour slot", () => {
    expect(localSlot(0, 0)).toEqual({ weekday: 0, slot: 0 }); // Monday midnight UTC
    expect(localSlot(0, -240)).toEqual({ weekday: 6, slot: 6 }); // Sunday 8pm in New York
    expect(localSlot(167, 60)).toEqual({ weekday: 0, slot: 0 }); // wraps into Monday
  });
});

describe("sorting posts", () => {
  const posts = [
    { id: "old", published_at: "2026-10-01T00:00:00Z", engagements: 90, engagement_rate: null },
    { id: "new", published_at: "2026-10-10T00:00:00Z", engagements: 10, engagement_rate: 0.02 },
    { id: "mid", published_at: "2026-10-05T00:00:00Z", engagements: 40, engagement_rate: 0.08 },
  ];
  it("by newest, engagements, or rate with unrated posts last", () => {
    expect(sortPosts(posts, "newest").map((p) => p.id)).toEqual(["new", "mid", "old"]);
    expect(sortPosts(posts, "engagements").map((p) => p.id)).toEqual(["old", "mid", "new"]);
    expect(sortPosts(posts, "rate").map((p) => p.id)).toEqual(["mid", "new", "old"]);
  });
});
