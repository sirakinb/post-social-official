import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getAccessTokenCookieName } from "@insforge/sdk/ssr";
import { PlatformCardIcon } from "@/components/platform-logos";
import { BETA_LOGIN } from "@/lib/insforge/auth-rules";
import { currentUser, insforgeServerClient } from "@/lib/insforge/server";
import { analyticsEnabled } from "../stats-switch";
import { RefreshButton } from "./refresh-button";

export const metadata = { title: "Stats · Post Social" };

type Stats = Partial<Record<"views" | "likes" | "comments" | "shares" | "saves" | "reposts" | "quotes", number>>;
type Report = {
  period: string;
  platforms: string[];
  totals_by_platform: Array<{ platform: string; platform_name: string; posts: number; stats: Stats }>;
  posts: Array<{ destination_id: string; post_id: string; platform: string; platform_name: string; account: string; caption: string; live_url: string | null; published_at: string; stats: Stats; updated_at: string | null; note?: string }>;
};

const PERIODS = [
  { id: "last_7_days", label: "7 days" },
  { id: "last_30_days", label: "30 days" },
  { id: "last_90_days", label: "90 days" },
];
const SORTS = [
  { id: "published_at", label: "Newest" },
  { id: "views", label: "Views" },
  { id: "likes", label: "Likes" },
  { id: "comments", label: "Comments" },
  { id: "shares", label: "Shares" },
];
const COLUMNS: Array<[keyof Stats, string]> = [["views", "Views"], ["likes", "Likes"], ["comments", "Comments"], ["shares", "Shares"], ["saves", "Saves"], ["reposts", "Reposts"]];
const show = (n: number | undefined) => (n === undefined ? "—" : n.toLocaleString("en-US"));
const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

async function loadReport(workspaceId: string, period: string, sort: string): Promise<Report | null> {
  const base = process.env.API_BASE_URL;
  const token = (await cookies()).get(getAccessTokenCookieName())?.value;
  if (!base || !token) return null;
  const response = await fetch(`${base}/keys`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "analytics", workspace_id: workspaceId, period, sort, limit: 50 }),
    cache: "no-store",
  }).catch(() => null);
  if (!response?.ok) return null;
  return (await response.json()) as Report;
}

export default async function BetaStatsPage({ searchParams }: { searchParams: Promise<{ workspace?: string; period?: string; sort?: string }> }) {
  // Stats appear only where they are switched on, so nothing half-available is ever shown.
  if (!analyticsEnabled()) notFound();
  const user = await currentUser();
  if (!user) redirect(`${BETA_LOGIN}?next=/beta/stats`);
  const params = await searchParams;
  const period = PERIODS.some((p) => p.id === params.period) ? params.period! : "last_30_days";
  const sort = SORTS.some((s) => s.id === params.sort) ? params.sort! : "published_at";

  const client = await insforgeServerClient();
  const { data } = await client.database.from("workspace_members").select("workspace_id, workspaces(name, slug)").eq("user_id", user.id);
  const memberships = (data ?? []) as unknown as Array<{ workspace_id: string; workspaces: { name: string; slug: string } | null }>;
  const current = memberships.find((m) => m.workspaces?.slug === params.workspace) ?? memberships[0];
  const report = current ? await loadReport(current.workspace_id, period, sort) : null;
  const link = (next: Record<string, string>) => {
    const q = new URLSearchParams({ period, sort, ...(params.workspace ? { workspace: params.workspace } : {}), ...next });
    return `/beta/stats?${q}`;
  };

  return (
    <div className="flex flex-col">
      <main className="w-full max-w-[1100px] flex-1 px-8 pb-12 pt-5">
        {!current ? (
          <p className="text-sm text-ps-muted">You are not a member of any workspace yet.</p>
        ) : !report ? (
          <p role="alert" className="text-sm text-[#FF8A8E]">Stats could not be loaded. Refresh the page to try again.</p>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="m-0 text-lg font-medium text-ps-text">Post stats</h1>
                <p className="mt-1 text-sm text-ps-muted">How your published posts are doing on {report.platforms.join(", ")}. Updated automatically; newer posts more often.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <nav aria-label="Period" className="flex gap-1 rounded-lg border border-ps-line bg-ps-surface p-1 text-sm">
                  {PERIODS.map((p) => (
                    <Link key={p.id} href={link({ period: p.id })} aria-current={p.id === period ? "page" : undefined} className={`rounded-md px-3 py-1 ${p.id === period ? "bg-[#2A2142] text-ps-text" : "text-ps-muted hover:text-ps-text"}`}>{p.label}</Link>
                  ))}
                </nav>
                <RefreshButton workspaceId={current.workspace_id} />
              </div>
            </div>

            <section className="mt-8" aria-label="By platform">
              {report.totals_by_platform.length === 0 ? (
                <p className="rounded-xl border border-ps-line bg-ps-surface p-8 text-center text-sm text-ps-muted">No published posts in this period yet. Stats appear a few minutes after a post goes live.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {report.totals_by_platform.map((t) => (
                    <div key={t.platform} className="grooved-surface rounded-xl border border-ps-line bg-ps-surface p-4">
                      <div className="flex items-center gap-2">
                        <PlatformCardIcon platform={t.platform as "instagram"} size="sm" />
                        <p className="text-sm font-medium text-ps-text">{t.platform_name}</p>
                        <span className="ml-auto text-xs text-ps-subtle">{t.posts} post{t.posts === 1 ? "" : "s"}</span>
                      </div>
                      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                        {COLUMNS.filter(([key]) => t.stats[key] !== undefined).slice(0, 6).map(([key, label]) => (
                          <div key={key}>
                            <dt className="text-[11px] text-ps-subtle">{label}</dt>
                            <dd className="text-lg font-semibold text-ps-text">{show(t.stats[key])}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {report.posts.length > 0 && (
              <section className="mt-8" aria-label="Posts">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-ps-text">Posts</h2>
                  <nav aria-label="Sort" className="flex gap-3 text-xs">
                    {SORTS.map((s) => (
                      <Link key={s.id} href={link({ sort: s.id })} aria-current={s.id === sort ? "page" : undefined} className={s.id === sort ? "font-semibold text-ps-plum-soft" : "text-ps-muted hover:text-ps-text"}>{s.label}</Link>
                    ))}
                  </nav>
                </div>
                <div className="mt-3 overflow-x-auto rounded-xl border border-ps-line bg-ps-surface">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className="text-left text-xs text-ps-subtle">
                        <th className="px-4 py-2 font-medium">Post</th>
                        {COLUMNS.map(([key, label]) => <th key={key} className="px-3 py-2 text-right font-medium">{label}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {report.posts.map((p) => (
                        <tr key={p.destination_id} className="align-top">
                          <td className="max-w-[320px] px-4 py-3">
                            <div className="flex items-start gap-2">
                              <PlatformCardIcon platform={p.platform as "instagram"} size="sm" />
                              <div className="min-w-0">
                                <p className="truncate text-ps-text">{p.caption || "(no caption)"}</p>
                                <p className="text-xs text-ps-subtle">
                                  {p.account} · {when(p.published_at)}
                                  {p.live_url && <> · <a className="text-ps-plum-soft hover:underline" href={p.live_url} target="_blank" rel="noreferrer">View</a></>}
                                </p>
                                {p.note && <p className="mt-1 text-xs text-ps-attention">{p.note}</p>}
                              </div>
                            </div>
                          </td>
                          {COLUMNS.map(([key]) => <td key={key} className="px-3 py-3 text-right tabular-nums text-ps-text">{show(p.stats[key])}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-ps-subtle">“—” means the platform doesn&apos;t report that number for this post.</p>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
