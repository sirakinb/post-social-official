import Link from "next/link";
import { LogsTable } from "@/components/beta/logs-table";
import { Card } from "@/components/beta/ui";
import { AREAS, SOURCES, loadLogs, type Area, type LogFilters, type Source } from "@/lib/beta/logs";
import { loadViewer } from "@/lib/beta/workspace";
import { cn } from "@/lib/utils";

export const metadata = { title: "Logs · Post Social" };

const PAGE = 50;
const UUID = /^[0-9a-f-]{36}$/i;

type Params = { level?: string; area?: string; source?: string; who?: string; before?: string };

export default async function LogsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const { workspace, client } = await loadViewer("/beta/activity");
  if (!workspace) return <p className="p-8 text-ps-muted">You are not a member of any workspace yet.</p>;

  const filters: LogFilters = {
    level: params.level === "errors" ? "errors" : "all",
    area: params.area && Object.hasOwn(AREAS, params.area) ? (params.area as Area) : null,
    source: params.source && Object.hasOwn(SOURCES, params.source) ? (params.source as Source) : null,
    actorId: params.who && UUID.test(params.who) ? params.who : null,
    before: params.before && !Number.isNaN(Date.parse(params.before)) ? params.before : null,
  };
  const [{ logs, hasMore, failed }, { data: actors }] = await Promise.all([
    loadLogs(client, workspace.id, filters, PAGE),
    client.database.from("actors").select("id, display_name").eq("workspace_id", workspace.id).in("kind", ["user", "api_key", "oauth_grant"]).order("display_name"),
  ]);

  // A link to this page with some filters changed (paging starts over unless given).
  const href = (change: Partial<Record<keyof Params, string | null>>) => {
    const next: Record<string, string> = {};
    const merged = { level: filters.level === "errors" ? "errors" : null, area: filters.area, source: filters.source, who: filters.actorId, ...change };
    for (const [key, value] of Object.entries(merged)) if (value) next[key] = value;
    const qs = new URLSearchParams(next).toString();
    return `/beta/activity${qs ? `?${qs}` : ""}`;
  };
  const chip = (active: boolean) => cn("inline-flex h-[28px] items-center rounded-lg border px-2.5 text-xs", active ? "border-ps-plum/60 bg-ps-plum/[0.14] text-ps-text" : "border-white/[0.08] text-ps-muted hover:border-white/20 hover:text-ps-text");
  const older = hasMore && logs.length ? href({ before: logs[logs.length - 1].at }) : null;

  return (
    <div className="flex w-full max-w-[1100px] flex-col gap-5 px-8 pb-12 pt-6">
      <div>
        <h1 className="m-0 text-lg font-medium">Logs</h1>
        <p className="mt-1 text-ps-muted">Everything that happened in this workspace: who did it, from where, and why anything failed.</p>
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Status">
          <Link href={href({ level: null })} className={chip(filters.level === "all")} aria-current={filters.level === "all" ? "true" : undefined}>Everything</Link>
          <Link href={href({ level: "errors" })} className={chip(filters.level === "errors")} aria-current={filters.level === "errors" ? "true" : undefined}>
            <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-ps-failed" />
            Errors and warnings
          </Link>
          <span className="mx-1.5 h-4 w-px bg-white/[0.08]" />
          <Link href={href({ area: null })} className={chip(!filters.area)}>All areas</Link>
          {Object.entries(AREAS).map(([id, a]) => (
            <Link key={id} href={href({ area: id })} className={chip(filters.area === id)}>{a.label}</Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Source and person">
          <Link href={href({ source: null })} className={chip(!filters.source)}>Any source</Link>
          {Object.entries(SOURCES).map(([id, label]) => (
            <Link key={id} href={href({ source: id })} className={chip(filters.source === id)}>{label}</Link>
          ))}
          {(actors ?? []).length > 1 && (
            <>
              <span className="mx-1.5 h-4 w-px bg-white/[0.08]" />
              <Link href={href({ who: null })} className={chip(!filters.actorId)}>Anyone</Link>
              {((actors ?? []) as Array<{ id: string; display_name: string }>).map((a) => (
                <Link key={a.id} href={href({ who: a.id })} className={chip(filters.actorId === a.id)}>{a.display_name}</Link>
              ))}
            </>
          )}
        </div>
      </div>

      <Card>
        {failed ? <p role="alert" className="m-0 px-4 py-3 text-[#FF8A8E]">The logs could not be loaded. Refresh the page to try again.</p> : <LogsTable rows={logs} />}
      </Card>
      <div className="flex justify-between text-xs">
        {filters.before ? <Link href={href({})} className="text-ps-plum-soft hover:text-ps-text">Back to newest</Link> : <span />}
        {older && <Link href={older} className="text-ps-plum-soft hover:text-ps-text">Older</Link>}
      </div>
    </div>
  );
}
