import Link from "next/link";
import { LogsTable } from "@/components/beta/logs-table";
import { Card } from "@/components/beta/ui";
import { AREAS, SOURCES, loadLogs, type Area, type LogFilters, type Source } from "@/lib/beta/logs";
import { loadViewer } from "@/lib/beta/workspace";
import { LogsFilters } from "./logs-filters";

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
  const older = hasMore && logs.length ? href({ before: logs[logs.length - 1].at }) : null;

  return (
    <div className="flex w-full max-w-[1100px] flex-col gap-5 px-4 sm:px-8 pb-12 pt-6">
      <div>
        <h1 className="m-0 text-lg font-medium">Logs</h1>
        <p className="mt-1 text-ps-muted">Everything that happened in this workspace: who did it, from where, and why anything failed.</p>
      </div>

      <Card>
        <LogsFilters
          values={{ level: filters.level, area: filters.area, source: filters.source, who: filters.actorId }}
          areas={Object.entries(AREAS).map(([value, a]) => ({ value, label: a.label }))}
          sources={Object.entries(SOURCES).map(([value, label]) => ({ value, label }))}
          people={((actors ?? []) as Array<{ id: string; display_name: string }>).map((a) => ({ value: a.id, label: a.display_name }))}
        />
        {failed ? <p role="alert" className="m-0 px-4 py-3 text-ps-failed-text">The logs could not be loaded. Refresh the page to try again.</p> : <LogsTable rows={logs} />}
      </Card>
      <div className="flex justify-between text-xs">
        {filters.before ? <Link href={href({})} className="text-ps-plum-soft hover:text-ps-text">Back to newest</Link> : <span />}
        {older && <Link href={older} className="text-ps-plum-soft hover:text-ps-text">Older</Link>}
      </div>
    </div>
  );
}
