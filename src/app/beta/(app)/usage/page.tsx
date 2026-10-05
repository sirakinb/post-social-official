import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAccessTokenCookieName } from "@insforge/sdk/ssr";
import { BETA_LOGIN } from "@/lib/insforge/auth-rules";
import { currentUser, insforgeServerClient } from "@/lib/insforge/server";

export const metadata = { title: "Usage · Post Social beta" };

type Limit = { used: number; limit: number; unit: string; percent: number | null };
type Report = {
  period: { name: string; start: string; end: string };
  plan: { name: string; limits: Record<"posts_per_month" | "api_calls_per_day" | "media_storage_bytes" | "connected_accounts", Limit> };
  totals: { posts_published: number; publishes_failed: number; posts_created: number; posts_created_by_ai: number; api_calls: number };
  by_account: Array<{ account_id: string; platform: string; account: string; posts_published: number; publishes_failed: number }>;
  by_connection: Array<{ actor_id: string; name: string; kind: string; key_mode?: string; active: boolean; api_calls: number; posts_created: number; posts_published: number }>;
  daily: Array<{ day: string; posts_published: number; api_calls: number }>;
};

const PERIODS = [
  { id: "today", label: "Today" },
  { id: "last_7_days", label: "7 days" },
  { id: "last_30_days", label: "30 days" },
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
];

const PLATFORM_NAMES: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", threads: "Threads", youtube: "YouTube", tiktok: "TikTok" };
const count = (n: number) => n.toLocaleString("en-US");
function bytes(n: number) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// The report comes from the same function the REST API and MCP tool use.
async function loadReport(workspaceId: string, period: string): Promise<Report | null> {
  const base = process.env.API_BASE_URL;
  const token = (await cookies()).get(getAccessTokenCookieName())?.value;
  if (!base || !token) return null;
  const response = await fetch(`${base}/keys`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "usage", workspace_id: workspaceId, period }),
    cache: "no-store",
  }).catch(() => null);
  if (!response?.ok) return null;
  return (await response.json()) as Report;
}

function LimitCard({ title, limit, format }: { title: string; limit: Limit; format: (n: number) => string }) {
  const percent = Math.min(100, limit.percent ?? 0);
  const tone = percent >= 90 ? "bg-error" : percent >= 70 ? "bg-warning" : "bg-accent";
  return (
    <div className="grooved-surface rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-medium text-ink-muted">{title}</p>
      <p className="mt-1 text-lg font-semibold text-ink">
        {format(limit.used)} <span className="text-sm font-normal text-ink-subtle">of {format(limit.limit)}</span>
      </p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={title}>
        <div className={`h-full ${tone}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-ink">{value}</p>
      {note && <p className="mt-1 text-xs text-ink-subtle">{note}</p>}
    </div>
  );
}

export default async function BetaUsagePage({ searchParams }: { searchParams: Promise<{ workspace?: string; period?: string }> }) {
  const user = await currentUser();
  if (!user) redirect(`${BETA_LOGIN}?next=/beta/usage`);
  const { workspace: slug, period: rawPeriod } = await searchParams;
  const period = PERIODS.some((p) => p.id === rawPeriod) ? rawPeriod! : "this_month";

  const client = await insforgeServerClient();
  const { data } = await client.database.from("workspace_members").select("workspace_id, workspaces(name, slug)").eq("user_id", user.id);
  const memberships = (data ?? []) as unknown as Array<{ workspace_id: string; workspaces: { name: string; slug: string } | null }>;
  const current = memberships.find((m) => m.workspaces?.slug === slug) ?? memberships[0];
  const report = current ? await loadReport(current.workspace_id, period) : null;
  const peak = report ? Math.max(1, ...report.daily.map((d) => d.posts_published)) : 1;
  const peakCalls = report ? Math.max(1, ...report.daily.map((d) => d.api_calls)) : 1;

  return (
    <div className="flex flex-col">
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 md:px-8">
        {!current ? (
          <p className="text-sm text-ink-muted">You are not a member of any workspace yet.</p>
        ) : !report ? (
          <p role="alert" className="text-sm text-error">Usage could not be loaded. Refresh the page to try again.</p>
        ) : (
          <>
            <p className="utility-label text-accent">{current.workspaces?.name ?? "Workspace"} / Usage</p>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-[-0.035em] text-ink">Usage</h1>
                <p className="mt-1 text-sm text-ink-muted">{report.plan.name} plan · times in UTC · your AIs can read this too with the get_usage tool.</p>
              </div>
              <nav aria-label="Period" className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface p-1 text-sm">
                {PERIODS.map((p) => (
                  <Link
                    key={p.id}
                    href={`/beta/usage?period=${p.id}${slug ? `&workspace=${encodeURIComponent(slug)}` : ""}`}
                    aria-current={p.id === period ? "page" : undefined}
                    className={`rounded-md px-3 py-1 ${p.id === period ? "bg-accent text-white" : "text-ink-muted hover:text-ink"}`}
                  >
                    {p.label}
                  </Link>
                ))}
              </nav>
            </div>

            <section className="mt-8" aria-label="Plan limits">
              <h2 className="text-sm font-semibold text-ink">Plan limits</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <LimitCard title="Posts published this month" limit={report.plan.limits.posts_per_month} format={count} />
                <LimitCard title="API calls today" limit={report.plan.limits.api_calls_per_day} format={count} />
                <LimitCard title="Media storage" limit={report.plan.limits.media_storage_bytes} format={bytes} />
                <LimitCard title="Connected accounts" limit={report.plan.limits.connected_accounts} format={count} />
              </div>
            </section>

            <section className="mt-8" aria-label="Totals">
              <h2 className="text-sm font-semibold text-ink">This period</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Posts published" value={count(report.totals.posts_published)} note={report.totals.publishes_failed ? `${count(report.totals.publishes_failed)} failed` : "None failed"} />
                <Stat label="Posts created" value={count(report.totals.posts_created)} note={`${count(report.totals.posts_created_by_ai)} by AI`} />
                <Stat label="API and MCP calls" value={count(report.totals.api_calls)} />
                <Stat label="Accounts posted to" value={count(report.by_account.filter((a) => a.posts_published > 0).length)} />
              </div>
            </section>

            <section className="mt-8" aria-label="By day">
              <h2 className="text-sm font-semibold text-ink">By day</h2>
              <div className="mt-3 rounded-xl border border-border bg-surface p-4">
                <div className="flex h-36 items-end gap-1" role="img" aria-label="Posts published and API calls per day">
                  {report.daily.map((d) => (
                    <div key={d.day} className="flex h-full flex-1 flex-col justify-end gap-0.5" title={`${day(d.day)}: ${d.posts_published} published, ${d.api_calls} API calls`}>
                      <div className="w-full rounded-sm bg-accent/30" style={{ height: `${(d.api_calls / peakCalls) * 45}%` }} />
                      <div className="w-full rounded-sm bg-accent" style={{ height: `${(d.posts_published / peak) * 55}%` }} />
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex justify-between text-[11px] text-ink-subtle">
                  <span>{day(report.daily[0]?.day ?? report.period.start.slice(0, 10))}</span>
                  <span className="flex gap-3">
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-accent" /> Published</span>
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-accent/30" /> API calls</span>
                  </span>
                  <span>{day(report.daily.at(-1)?.day ?? report.period.start.slice(0, 10))}</span>
                </div>
              </div>
            </section>

            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              <section aria-label="By account">
                <h2 className="text-sm font-semibold text-ink">By account</h2>
                {report.by_account.length === 0 ? (
                  <p className="mt-3 rounded-xl border border-border bg-surface p-6 text-center text-sm text-ink-muted">No accounts yet.</p>
                ) : (
                  <table className="mt-3 w-full overflow-hidden rounded-xl border border-border bg-surface text-sm">
                    <thead><tr className="text-left text-xs text-ink-subtle"><th className="px-4 py-2 font-medium">Account</th><th className="px-4 py-2 text-right font-medium">Published</th><th className="px-4 py-2 text-right font-medium">Failed</th></tr></thead>
                    <tbody className="divide-y divide-border">
                      {report.by_account.map((a) => (
                        <tr key={a.account_id}>
                          <td className="px-4 py-2"><span className="text-ink">{a.account}</span> <span className="text-xs text-ink-subtle">{PLATFORM_NAMES[a.platform] ?? a.platform}</span></td>
                          <td className="px-4 py-2 text-right text-ink">{count(a.posts_published)}</td>
                          <td className="px-4 py-2 text-right text-ink-muted">{count(a.publishes_failed)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section aria-label="By who">
                <h2 className="text-sm font-semibold text-ink">By person, key and app</h2>
                {report.by_connection.length === 0 ? (
                  <p className="mt-3 rounded-xl border border-border bg-surface p-6 text-center text-sm text-ink-muted">No activity in this period.</p>
                ) : (
                  <table className="mt-3 w-full overflow-hidden rounded-xl border border-border bg-surface text-sm">
                    <thead><tr className="text-left text-xs text-ink-subtle"><th className="px-4 py-2 font-medium">Who</th><th className="px-4 py-2 text-right font-medium">Calls</th><th className="px-4 py-2 text-right font-medium">Created</th><th className="px-4 py-2 text-right font-medium">Published</th></tr></thead>
                    <tbody className="divide-y divide-border">
                      {report.by_connection.map((c) => (
                        <tr key={c.actor_id}>
                          <td className="px-4 py-2">
                            <span className="text-ink">{c.name}</span>{" "}
                            <span className="text-xs text-ink-subtle">{c.kind}{c.key_mode === "test" ? " (test)" : ""}{c.active ? "" : " · revoked"}</span>
                          </td>
                          <td className="px-4 py-2 text-right text-ink">{count(c.api_calls)}</td>
                          <td className="px-4 py-2 text-right text-ink">{count(c.posts_created)}</td>
                          <td className="px-4 py-2 text-right text-ink">{count(c.posts_published)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
