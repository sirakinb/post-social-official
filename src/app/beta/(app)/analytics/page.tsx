import Link from "next/link";
import { notFound } from "next/navigation";
import { PERIODS, POST_SORTS, TABS, canSeeSources, sortPosts, type Tab } from "@/lib/beta/analytics-view";
import { callServer, loadViewer } from "@/lib/beta/workspace";
import { cn } from "@/lib/utils";
import { analyticsEnabled } from "../stats-switch";
import { AnalyticsView, type AnalyticsData } from "./analytics-view";
import { RefreshButton } from "./refresh-button";

export const metadata = { title: "Analytics · Post Social" };

const POSTS_SHOWN = 100;

type Params = { workspace?: string; tab?: string; period?: string; platform?: string; sort?: string };

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Params> }) {
  // Analytics appear only where a source is switched on, so nothing half-available is shown.
  if (!analyticsEnabled()) notFound();
  const params = await searchParams;
  const { viewer, workspace } = await loadViewer("/beta/analytics", params.workspace);
  if (!workspace) return <p className="p-8 text-ps-muted">You are not a member of any workspace yet.</p>;

  const tab: Tab = TABS.some((t) => t.id === params.tab) ? (params.tab as Tab) : "overview";
  const period = PERIODS.some((p) => p.id === params.period) ? params.period! : "last_30_days";
  const sort = POST_SORTS.some((s) => s.id === params.sort) ? params.sort! : "newest";
  const data = await callServer<AnalyticsData>("analytics_dashboard", { workspace_id: workspace.id, period, ...(params.platform ? { platform: params.platform } : {}) });

  const query: Record<string, string> = {
    ...(params.workspace ? { workspace: params.workspace } : {}),
    ...(tab !== "overview" ? { tab } : {}),
    ...(period !== "last_30_days" ? { period } : {}),
    ...(data && params.platform && data.platforms.some((p) => p.platform === params.platform) ? { platform: params.platform } : {}),
    ...(sort !== "newest" ? { sort } : {}),
  };
  const periodLink = (id: string) => {
    const q = new URLSearchParams(query);
    if (id === "last_30_days") q.delete("period");
    else q.set("period", id);
    return `/beta/analytics?${q}`;
  };

  // Customers on production only learn that numbers came from the platform itself ("From
  // Facebook"); public-page numbers aren't labelled, not even in a hidden column.
  const showSources = canSeeSources(viewer.email);
  const strip = <T extends { source: unknown }>(item: T): T => (showSources ? item : { ...item, source: item.source === "public" ? null : item.source });
  const posts = (list: AnalyticsData["posts"]) => list.map(strip);

  return (
    <div className="flex w-full max-w-[1180px] flex-col px-4 sm:px-8 pb-12 pt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-lg font-medium">Analytics</h1>
          <p className="mt-1 text-ps-muted">How your posts and accounts are doing. Numbers update on their own, newer posts more often.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Period" className="flex gap-1 rounded-lg border border-ps-line bg-ps-surface p-1 text-xs">
            {PERIODS.map((p) => (
              <Link key={p.id} href={periodLink(p.id)} aria-current={p.id === period ? "page" : undefined} className={cn("rounded-md px-2.5 py-1", p.id === period ? "bg-ps-segment text-ps-text" : "text-ps-muted hover:text-ps-text")}>{p.label}</Link>
            ))}
          </nav>
          {data && <RefreshButton workspaceId={workspace.id} left={data.refreshes_left} />}
        </div>
      </div>

      {!data ? (
        <p role="alert" className="mt-6 text-ps-failed-text">Analytics could not be loaded. Refresh the page to try again.</p>
      ) : (
        <>
          <AnalyticsView
            data={{ ...data, posts: [], accounts: data.accounts.map(strip) }}
            postCount={data.posts.length}
            tab={tab}
            query={query}
            posts={tab === "posts" ? posts(sortPosts(data.posts, sort).slice(0, POSTS_SHOWN)) : []}
            topPosts={tab === "overview" ? posts(sortPosts(data.posts, "engagements").filter((p) => p.engagements > 0).slice(0, 5)) : []}
            showSources={showSources}
          />
          {data.updated_at && (
            <p className="mt-4 text-[11px] text-ps-subtle">
              Last updated {new Date(data.updated_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC.
            </p>
          )}
        </>
      )}
    </div>
  );
}
