// Small rules the Analytics page shares between its tabs.
import { resolveAppEnv } from "@/components/environment-badge";
import type { Platform } from "../../../backend/lib/connections/platforms";

// The page reads these on the server and the tabs on the client, so they live here: values
// exported from a "use client" file reach server code only as client references.
export type Tab = "overview" | "posts" | "growth" | "best-times";
export const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "posts", label: "Posts" },
  { id: "growth", label: "Growth" },
  { id: "best-times", label: "Best times" },
];
export const PERIODS = [
  { id: "last_7_days", label: "7 days" },
  { id: "last_30_days", label: "30 days" },
  { id: "last_90_days", label: "90 days" },
];
export const POST_SORTS = [
  { id: "newest", label: "Newest" },
  { id: "engagements", label: "Engagements" },
  { id: "rate", label: "Engagement rate" },
];

// Where each number came from (the platform's own API, or its public page) is shown on dev,
// and on production only to the people named in ADMIN_EMAILS; customers never see it.
export function canSeeSources(email: string | null | undefined, appEnv = resolveAppEnv(), admins = process.env.ADMIN_EMAILS ?? "") {
  if (appEnv !== "production") return true;
  if (!email) return false;
  return admins.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean).includes(email.trim().toLowerCase());
}

// 1,234 below 100,000; 310.9K, 1.2M above.
export function count(n: number) {
  if (Math.abs(n) < 100_000) return n.toLocaleString("en-US");
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${count(Math.abs(n))}`;
export const percent = (rate: number) => `${(rate * 100).toFixed(rate < 0.1 ? 1 : 0)}%`;

// Colors for each platform in charts (legends also show the platform's logo).
export const PLATFORM_COLORS: Record<Platform, string> = {
  instagram: "#E4579B",
  tiktok: "#2FC6B8",
  youtube: "#F2884B",
  x: "#8F88A6",
  linkedin: "#4C8DF6",
  bluesky: "#9B6CFF",
  facebook: "#3B6FD8",
  threads: "#C9A227",
};

// What a post's platform calls each number, in the order the Posts tab lists them.
export function resultsOf(platform: Platform, stats: Partial<Record<"views" | "likes" | "comments" | "shares" | "saves" | "reposts" | "quotes", number>>) {
  const reposts = (stats.reposts ?? 0) + (stats.quotes ?? 0);
  const out: Array<{ label: string; value: number }> = [];
  if (stats.views !== undefined) out.push({ label: "views", value: stats.views });
  if (stats.likes !== undefined) out.push({ label: platform === "facebook" ? "reactions" : "likes", value: stats.likes });
  if (stats.comments !== undefined) out.push({ label: platform === "x" || platform === "threads" || platform === "bluesky" ? "replies" : "comments", value: stats.comments });
  if (stats.reposts !== undefined || stats.quotes !== undefined) out.push({ label: "reposts", value: reposts });
  if (stats.shares !== undefined) out.push({ label: "shares", value: stats.shares });
  if (stats.saves !== undefined) out.push({ label: platform === "x" || platform === "bluesky" ? "bookmarks" : "saves", value: stats.saves });
  return out;
}

export const FORMAT_LABELS = { video: "Video", carousel: "Carousel", photo: "Photo", text: "Text" } as const;

// Best times: a UTC hour of the week (0 = Monday 00:00 UTC) moved into the viewer's time
// zone, as a weekday (0 = Monday) and 3-hour slot (0 = midnight to 3 AM).
export function localSlot(hourOfWeekUtc: number, offsetMinutes: number) {
  const local = (((hourOfWeekUtc * 60 + offsetMinutes) % (168 * 60)) + 168 * 60) % (168 * 60);
  const hour = Math.floor(local / 60);
  return { weekday: Math.floor(hour / 24), slot: Math.floor((hour % 24) / 3) };
}

// The Posts tab's order: newest first, or by engagements or engagement rate (posts without
// a rate go last).
export function sortPosts<T extends { published_at: string; engagements: number; engagement_rate: number | null }>(posts: T[], sort: string) {
  const list = [...posts];
  if (sort === "engagements") list.sort((a, b) => b.engagements - a.engagements);
  else if (sort === "rate") list.sort((a, b) => (b.engagement_rate ?? -1) - (a.engagement_rate ?? -1));
  else list.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
  return list;
}
