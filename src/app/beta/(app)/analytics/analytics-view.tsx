"use client";

// The Analytics page's four tabs. Only numbers a platform reports are shown: a post lists
// just its own results, accounts compare on what every platform gives (followers, posts,
// engagements), and empty spots are left blank rather than filled with dashes.
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { PlatformCardIcon } from "@/components/platform-logos";
import { Card, CardHeader } from "@/components/beta/ui";
import { cn } from "@/lib/utils";
import { FORMAT_LABELS, PLATFORM_COLORS, POST_SORTS, TABS, count, localSlot, percent, resultsOf, signed, type Tab } from "@/lib/beta/analytics-view";
import type { Dashboard } from "../../../../../backend/lib/analytics-dashboard";
import type { Platform } from "../../../../../backend/lib/connections/platforms";

export type AnalyticsData = Dashboard & { period: string; platforms: Array<{ platform: Platform; platform_name: string }> };
export type { Tab };
type Post = Dashboard["posts"][number];
type Account = Dashboard["accounts"][number];

const SOURCE_LABELS = { official: "Official", public: "Public", mixed: "Official + public" } as const;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function AnalyticsView(props: {
  data: AnalyticsData; // without its posts list; those come trimmed below
  postCount: number;
  tab: Tab;
  query: Record<string, string>; // the page's current link settings (period, platform, sort, workspace)
  posts: Post[]; // the Posts tab's list, already sorted and trimmed
  topPosts: Post[];
  showSources: boolean;
}) {
  const { data, tab, query, showSources } = props;
  const href = (next: Record<string, string | null>) => {
    const q = new URLSearchParams(query);
    for (const [key, value] of Object.entries(next)) {
      if (value === null) q.delete(key);
      else q.set(key, value);
    }
    return `/beta/analytics?${q}`;
  };

  return (
    <>
      <nav aria-label="Analytics sections" className="mt-5 flex gap-5 border-b border-ps-line text-[13px]">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={href({ tab: t.id === "overview" ? null : t.id })}
            aria-current={t.id === tab ? "page" : undefined}
            className={cn("-mb-px border-b-2 pb-2.5", t.id === tab ? "border-ps-plum font-medium text-ps-text" : "border-transparent text-ps-muted hover:text-ps-text")}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="Platforms">
        <FilterChip href={href({ platform: null })} active={!query.platform}>All platforms</FilterChip>
        {data.platforms.map((p) => (
          <FilterChip key={p.platform} href={href({ platform: p.platform })} active={query.platform === p.platform}>
            <PlatformCardIcon platform={p.platform} size="sm" className="h-4 w-4" />
            {p.platform_name}
          </FilterChip>
        ))}
      </div>

      <div className="mt-5 flex flex-col gap-4">
        {tab === "overview" && <Overview data={data} topPosts={props.topPosts} showSources={showSources} />}
        {tab === "posts" && <PostsTab total={props.postCount} posts={props.posts} sort={query.sort ?? "newest"} href={href} showSources={showSources} />}
        {tab === "growth" && <Growth data={data} />}
        {tab === "best-times" && <BestTimes data={data} />}
      </div>
    </>
  );
}

function FilterChip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs", active ? "border-ps-line-strong bg-ps-segment text-ps-text" : "border-ps-line text-ps-muted hover:text-ps-text")}>
      {children}
    </Link>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-center text-ps-muted">{children}</p>;
}

// ---------- Overview ----------

function Overview({ data, topPosts, showSources }: { data: AnalyticsData; topPosts: Post[]; showSources: boolean }) {
  const s = data.summary;
  const tiles: Array<{ label: string; value: string; note?: string }> = [];
  if (s.engagement_rate !== null) tiles.push({ label: "Engagement rate", value: percent(s.engagement_rate), note: "Engagements per follower, on average" });
  tiles.push({ label: "Engagements", value: count(s.engagements), note: "Likes, comments, shares and saves" });
  if (s.followers !== null) tiles.push({ label: "Followers", value: count(s.followers), note: s.follower_change ? `${signed(s.follower_change)} ${s.follower_change_since ? `since ${day(s.follower_change_since)}` : "in the last 30 days"}` : "Across your accounts" });
  tiles.push({ label: "Posts", value: count(s.posts), note: `Published in the last ${data.days} days` });
  if (s.views !== null) tiles.push({ label: "Views", value: count(s.views), note: "Where the platform reports them" });

  if (s.posts === 0 && !data.accounts.length) {
    return (
      <Card>
        <Empty>No published posts in this period yet. Numbers appear a few minutes after a post goes live.</Empty>
      </Card>
    );
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {tiles.map((t) => (
          <Card key={t.label} className="p-4">
            <p className="text-xs text-ps-muted">{t.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-ps-text">{t.value}</p>
            {t.note && <p className="mt-1 text-[11px] text-ps-subtle">{t.note}</p>}
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title="Engagement by week" />
          <EngagementChart weekly={data.weekly} hasViews={s.views !== null} />
        </Card>
        <Card>
          <CardHeader title="Posts per week" />
          <PostsPerWeek data={data} />
        </Card>
      </div>

      <Card>
        <CardHeader title="Accounts" />
        {data.accounts.length ? <AccountTable accounts={data.accounts} showSources={showSources} /> : <Empty>No accounts connected for these platforms.</Empty>}
      </Card>

      {topPosts.length > 0 && (
        <Card>
          <CardHeader title="Top posts" />
          <ul className="divide-y divide-ps-fg/[0.06]">
            {topPosts.map((p) => <PostRow key={p.destination_id} post={p} showSources={showSources} />)}
          </ul>
        </Card>
      )}
    </>
  );
}

const PARTS = [
  { key: "likes", label: "Likes", color: "#E4579B" },
  { key: "comments", label: "Comments", color: "#4C8DF6" },
  { key: "shares", label: "Reposts & shares", color: "#2FC6B8" },
  { key: "saves", label: "Saves", color: "#9B7BF0" },
] as const;

type Week = AnalyticsData["weekly"][number];
type Measure = "engagements" | "views" | "rate";

// One measure at a time, as weekly bars on its own scale: likes are usually many times
// comments and shares, so on shared lines the smaller ones would flatten out. Engagement
// bars are split by type, so the total and its mix show together.
export function EngagementChart({ weekly, hasViews }: { weekly: AnalyticsData["weekly"]; hasViews: boolean }) {
  const hasRate = weekly.some((w) => w.engagement_rate !== null);
  const measures: Array<{ id: Measure; label: string }> = [
    { id: "engagements", label: "Engagements" },
    ...(hasViews ? [{ id: "views" as const, label: "Views" }] : []),
    ...(hasRate ? [{ id: "rate" as const, label: "Engagement rate" }] : []),
  ];
  const [measure, setMeasure] = useState<Measure>("engagements");
  const parts = PARTS.filter((p) => p.key !== "saves" || weekly.some((w) => w.saves > 0));
  const total = (w: Week) => (measure === "views" ? w.views : measure === "rate" ? (w.engagement_rate ?? 0) : parts.reduce((t, p) => t + w[p.key], 0));
  const max = Math.max(...weekly.map(total));
  const show = (n: number) => (measure === "rate" ? percent(n) : count(n));
  const label = (w: Week) =>
    `Week of ${day(w.week_start)}: ` +
    (measure === "engagements"
      ? parts.map((p) => `${count(w[p.key])} ${p.label.toLowerCase()}`).join(", ")
      : measure === "views"
        ? `${count(w.views)} views`
        : w.engagement_rate === null ? "no rated posts" : `${percent(w.engagement_rate)} engagement rate`);
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg border border-ps-line p-0.5 text-[11px]" role="group" aria-label="Measure">
          {measures.map((m) => (
            <button key={m.id} type="button" aria-pressed={measure === m.id} onClick={() => setMeasure(m.id)} className={cn("rounded-md px-2 py-0.5", measure === m.id ? "bg-ps-segment text-ps-text" : "text-ps-muted hover:text-ps-text")}>
              {m.label}
            </button>
          ))}
        </div>
        {max > 0 && <span className="text-[11px] tabular-nums text-ps-subtle">Highest week {show(max)}</span>}
      </div>
      {max > 0 ? (
        <div className="mt-3 flex h-36 items-end gap-1.5" role="img" aria-label={`${measures.find((m) => m.id === measure)!.label} by week`}>
          {weekly.map((w) => (
            <div key={w.week_start} className="flex h-full max-w-14 flex-1 flex-col justify-end mx-auto" title={label(w)} aria-label={label(w)}>
              {measure === "engagements" ? (
                parts.map((p) => (w[p.key] ? <div key={p.key} style={{ height: `${(w[p.key] / max) * 100}%`, background: p.color }} className="w-full first:rounded-t-sm" /> : null))
              ) : (
                <div style={{ height: `${(total(w) / max) * 100}%`, background: measure === "views" ? "#C9A227" : "#2FC6B8" }} className="w-full rounded-t-sm" />
              )}
            </div>
          ))}
        </div>
      ) : (
        <Empty>No engagement in this period yet.</Empty>
      )}
      <div className="mt-1 flex gap-1.5 text-[10px] text-ps-subtle">
        {weekly.map((w, i) => <span key={w.week_start} className="flex-1 text-center">{weekly.length <= 8 || i % 2 === 0 ? day(w.week_start) : ""}</span>)}
      </div>
      {measure === "engagements" && (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ps-muted">
          {parts.map((p) => (
            <li key={p.key} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
              {p.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PostsPerWeek({ data }: { data: AnalyticsData }) {
  const max = Math.max(1, ...data.weekly.map((w) => Object.values(w.posts_by_platform).reduce((a, b) => a + b, 0)));
  const platforms = data.posts_by_platform.map((p) => p.platform);
  if (!platforms.length) return <Empty>No posts in this period yet.</Empty>;
  return (
    <div className="px-4 py-3">
      <div className="flex h-36 items-end gap-1.5" role="img" aria-label="Posts per week by platform">
        {data.weekly.map((w) => (
          <div key={w.week_start} className="flex h-full flex-1 flex-col justify-end" title={`Week of ${day(w.week_start)}`}>
            {platforms.map((p) => w.posts_by_platform[p] ? <div key={p} style={{ height: `${(w.posts_by_platform[p] / max) * 100}%`, background: PLATFORM_COLORS[p] }} className="w-full first:rounded-t-sm" /> : null)}
          </div>
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ps-muted">
        {data.posts_by_platform.map((p) => (
          <li key={p.platform} className="inline-flex items-center gap-1.5">
            <PlatformCardIcon platform={p.platform} size="sm" className="h-4 w-4" />
            {p.platform_name} · {p.posts}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AccountTable({ accounts, showSources }: { accounts: Account[]; showSources: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-[13px]">
        <thead>
          <tr className="text-left text-xs text-ps-subtle">
            <th className="px-4 py-2 font-medium">Account</th>
            <th className="px-3 py-2 text-right font-medium">Followers</th>
            <th className="px-3 py-2 text-right font-medium" title="Followers gained or lost in the last 30 days, or since counting started">Follower change</th>
            <th className="px-3 py-2 text-right font-medium">Posts</th>
            <th className="px-3 py-2 text-right font-medium">Engagements</th>
            <th className="px-3 py-2 text-right font-medium">Eng. rate</th>
            {showSources && <th className="px-3 py-2 text-right font-medium">Data</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-ps-fg/[0.06]">
          {accounts.map((a) => {
            const change = a.change_30_days ?? a.change_since_start;
            return (
              <tr key={a.id}>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <PlatformCardIcon platform={a.platform} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate text-ps-text">{a.name}</span>
                      {a.handle && <span className="block truncate text-[11px] text-ps-subtle">@{a.handle.replace(/^@/, "")}</span>}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ps-text">{a.followers !== null ? count(a.followers) : <span className="text-[11px] text-ps-subtle">{a.platform === "youtube" && !a.handle ? "After your first video" : "Counting"}</span>}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {change !== null ? <span className={change > 0 ? "text-ps-live-text" : change < 0 ? "text-ps-failed-text" : "text-ps-muted"}>{signed(change)}</span> : <span className="text-[11px] text-ps-subtle">{a.tracking_since ? `Since ${day(a.tracking_since)}` : "Starting"}</span>}
                  {change !== null && a.change_30_days === null && a.tracking_since && <span className="block text-[11px] text-ps-subtle">since {day(a.tracking_since)}</span>}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ps-text">{a.posts}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ps-text">{count(a.engagements)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ps-text">{a.engagement_rate !== null ? percent(a.engagement_rate) : ""}</td>
                {showSources && <td className="px-3 py-2.5 text-right text-[11px] text-ps-muted">{a.source ? SOURCE_LABELS[a.source as keyof typeof SOURCE_LABELS] : ""}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Posts ----------

function PostsTab({ total, posts, sort, href, showSources }: { total: number; posts: Post[]; sort: string; href: (next: Record<string, string | null>) => string; showSources: boolean }) {
  return (
    <Card>
      <CardHeader
        title={`Posts · ${total}`}
        action={
          <nav aria-label="Sort" className="flex gap-3 text-xs">
            {POST_SORTS.map((s) => (
              <Link key={s.id} href={href({ sort: s.id === "newest" ? null : s.id })} aria-current={s.id === sort ? "page" : undefined} className={s.id === sort ? "font-medium text-ps-plum-soft" : "text-ps-muted hover:text-ps-text"}>{s.label}</Link>
            ))}
          </nav>
        }
      />
      {posts.length ? (
        <ul className="divide-y divide-ps-fg/[0.06]">
          {posts.map((p) => <PostRow key={p.destination_id} post={p} showSources={showSources} />)}
        </ul>
      ) : (
        <Empty>No published posts in this period yet. Numbers appear a few minutes after a post goes live.</Empty>
      )}
      {total > posts.length && <p className="border-t border-ps-fg/[0.06] px-4 py-2.5 text-[11px] text-ps-subtle">Showing the first {posts.length}.</p>}
    </Card>
  );
}

export function PostRow({ post, showSources }: { post: Post; showSources: boolean }) {
  const results = resultsOf(post.platform, post.stats);
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <PlatformCardIcon platform={post.platform} size="sm" className="mt-0.5 flex-none" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-ps-text">{post.caption || `${FORMAT_LABELS[post.format]} post`}</p>
        <p className="mt-0.5 text-[11px] text-ps-subtle">
          {post.account} · {day(post.published_at)} · {FORMAT_LABELS[post.format]}
          {post.live_url && <> · <a className="text-ps-plum-soft hover:underline" href={post.live_url} target="_blank" rel="noreferrer">View post</a></>}
          {showSources && <> · {SOURCE_LABELS[post.source]}</>}
        </p>
        <ul aria-label="Results" className="mt-2 flex flex-wrap gap-1.5">
          {results.map((r) => (
            <li key={r.label} className="rounded-full bg-ps-segment px-2 py-0.5 text-[11px] text-ps-muted">
              <span className="font-medium tabular-nums text-ps-text">{count(r.value)}</span> {r.label}
            </li>
          ))}
        </ul>
      </div>
      {post.engagement_rate !== null && (
        <div className="flex-none text-right">
          <p className="text-sm font-semibold tabular-nums text-ps-text">{percent(post.engagement_rate)}</p>
          <p className="text-[11px] text-ps-subtle">eng. rate</p>
        </div>
      )}
    </li>
  );
}

// ---------- Growth ----------

function Growth({ data }: { data: AnalyticsData }) {
  const counted = data.accounts.filter((a) => a.followers !== null);
  return (
    <>
      <Card>
        <CardHeader title="Followers" />
        {counted.length ? (
          <ul className="grid gap-px bg-ps-fg/[0.06] sm:grid-cols-2">
            {counted.map((a) => <GrowthCard key={a.id} account={a} />)}
          </ul>
        ) : (
          <Empty>Follower counts are saved once a day from when an account is connected. The first ones appear within a day.</Empty>
        )}
      </Card>
      {data.build_up && (
        <Card>
          <CardHeader title="How engagement builds up after posting" />
          <BuildUp curve={data.build_up} />
        </Card>
      )}
    </>
  );
}

function GrowthCard({ account: a }: { account: Account }) {
  const change = a.change_30_days ?? a.change_since_start;
  const points = a.history.map((h) => h.followers);
  const W = 260;
  const H = 56;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const path = points.map((v, i) => `${points.length === 1 ? W / 2 : (i * W) / (points.length - 1)},${max === min ? H / 2 : H - 4 - ((v - min) / (max - min)) * (H - 8)}`).join(" ");
  return (
    <li className="bg-ps-surface p-4">
      <div className="flex items-center gap-2">
        <PlatformCardIcon platform={a.platform} size="sm" />
        <span className="min-w-0 flex-1 truncate text-ps-text">{a.name}</span>
        <span className="text-lg font-semibold tabular-nums text-ps-text">{count(a.followers!)}</span>
      </div>
      {points.length > 1 && (
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-14 w-full" preserveAspectRatio="none" role="img" aria-label={`${a.name} followers over time`}>
          <polyline fill="none" stroke={PLATFORM_COLORS[a.platform]} strokeWidth={2} points={path} vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      <p className="mt-2 text-[11px] text-ps-subtle">
        {change !== null ? <span className={change > 0 ? "text-ps-live-text" : change < 0 ? "text-ps-failed-text" : ""}>{signed(change)} </span> : null}
        {a.change_30_days !== null ? "in the last 30 days" : a.tracking_since ? `since ${day(a.tracking_since)}, when counting started` : "Counting started today"}
        {a.change_7_days !== null && a.change_30_days !== null ? ` · ${signed(a.change_7_days)} this week` : ""}
      </p>
    </li>
  );
}

function BuildUp({ curve }: { curve: NonNullable<AnalyticsData["build_up"]> }) {
  return (
    <div className="px-4 py-4">
      <div className="flex items-end gap-3">
        {curve.map((c) => (
          <div key={c.day} className="flex flex-1 flex-col items-center gap-1.5">
            <span className="text-xs tabular-nums text-ps-text">{percent(c.share)}</span>
            <div className="flex h-28 w-full items-end rounded-md bg-ps-segment">
              <div className="w-full rounded-md bg-ps-plum" style={{ height: `${c.share * 100}%` }} />
            </div>
            <span className="text-[11px] text-ps-subtle">Day {c.day}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-ps-subtle">Share of a post&apos;s 30-day engagements it has reached by each day, from your posts with a full 30 days of numbers.</p>
    </div>
  );
}

// ---------- Best times ----------

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SLOTS = ["12–3a", "3–6a", "6–9a", "9a–12", "12–3p", "3–6p", "6–9p", "9p–12"];
const noSubscribe = () => () => {};

// The viewer's offset from UTC, in minutes (0 while the page renders on the server).
function useOffset() {
  return useSyncExternalStore(noSubscribe, () => -new Date().getTimezoneOffset(), () => 0);
}

export function bestTimeGrid(times: AnalyticsData["best_times"], offsetMinutes: number) {
  const cells = new Map<string, { posts: number; total: number }>();
  for (const t of times) {
    const { weekday, slot } = localSlot(t.hour_of_week_utc, offsetMinutes);
    const key = `${weekday}:${slot}`;
    const cell = cells.get(key) ?? { posts: 0, total: 0 };
    cell.posts += t.posts;
    cell.total += t.engagement_rate * t.posts;
    cells.set(key, cell);
  }
  return new Map([...cells].map(([key, c]) => [key, { posts: c.posts, rate: c.total / c.posts }]));
}

function BestTimes({ data }: { data: AnalyticsData }) {
  const offset = useOffset();
  const grid = bestTimeGrid(data.best_times, offset);
  const max = Math.max(0, ...[...grid.values()].map((c) => c.rate));
  const best = [...grid.entries()].sort((a, b) => b[1].rate - a[1].rate)[0];
  return (
    <>
      <Card>
        <CardHeader title="When your posts do best" />
        {grid.size ? (
          <div className="overflow-x-auto px-4 py-4">
            {best && <p className="mb-3 text-ps-muted">Your best slot so far is <span className="font-medium text-ps-text">{WEEKDAYS[Number(best[0].split(":")[0])]} {SLOTS[Number(best[0].split(":")[1])]}</span>, at {percent(best[1].rate)} engagement.</p>}
            <table className="w-full min-w-[520px] border-separate border-spacing-1 text-[11px]">
              <thead>
                <tr>
                  <th />
                  {SLOTS.map((s) => <th key={s} className="font-normal text-ps-subtle">{s}</th>)}
                </tr>
              </thead>
              <tbody>
                {WEEKDAYS.map((w, d) => (
                  <tr key={w}>
                    <th className="pr-2 text-left font-normal text-ps-subtle">{w}</th>
                    {SLOTS.map((s, slot) => {
                      const cell = grid.get(`${d}:${slot}`);
                      return (
                        <td key={s} title={cell ? `${cell.posts} post${cell.posts === 1 ? "" : "s"} · ${percent(cell.rate)}` : undefined} className="h-8 rounded-md bg-ps-segment text-center tabular-nums">
                          {cell && (
                            <span className="flex h-full w-full items-center justify-center rounded-md text-ps-text" style={{ background: `rgb(var(--ps-plum) / ${(0.2 + 0.7 * (max ? cell.rate / max : 0)).toFixed(2)})` }}>
                              {percent(cell.rate)}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-ps-subtle">Average engagement rate by when posts went out, in your time zone.</p>
          </div>
        ) : (
          <Empty>This fills in as your posts collect engagement and follower counts.</Empty>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {data.formats.length > 0 && (
          <Card>
            <CardHeader title="Formats" />
            <ul className="flex flex-col gap-2.5 px-4 py-4">
              {data.formats.map((f) => (
                <li key={f.format}>
                  <div className="flex justify-between text-xs"><span className="text-ps-text">{FORMAT_LABELS[f.format]}</span><span className="tabular-nums text-ps-muted">{percent(f.engagement_rate)} · {f.posts} post{f.posts === 1 ? "" : "s"}</span></div>
                  <div className="mt-1 h-2 rounded-full bg-ps-segment"><div className="h-2 rounded-full bg-ps-plum" style={{ width: `${(f.engagement_rate / data.formats[0].engagement_rate) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {data.cadence.length > 0 && (
          <Card>
            <CardHeader title="How often to post" />
            <ul className="flex flex-col gap-3 px-4 py-4">
              {data.cadence.map((c) => (
                <li key={c.platform}>
                  <div className="flex items-center gap-2 text-xs text-ps-text"><PlatformCardIcon platform={c.platform} size="sm" className="h-4 w-4" />{c.platform_name}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {c.buckets.map((b) => (
                      <span key={b.bucket} className="rounded-full bg-ps-segment px-2 py-0.5 text-[11px] text-ps-muted">
                        {b.bucket} a week: <span className="font-medium tabular-nums text-ps-text">{percent(b.engagement_rate)}</span>
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
