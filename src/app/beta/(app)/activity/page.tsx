import Link from "next/link";
import { ActivityFeed } from "@/components/beta/activity-feed";
import { Card } from "@/components/beta/ui";
import type { ActorKind } from "@/components/beta/marks";
import { loadActivity } from "@/lib/beta/home";
import { loadViewer } from "@/lib/beta/workspace";

export const metadata = { title: "Activity · Post Social" };

const PAGE = 50;
const UUID = /^[0-9a-f-]{36}$/i;

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ who?: string; before?: string }> }) {
  const params = await searchParams;
  const { workspace, client } = await loadViewer("/beta/activity");
  if (!workspace) return <p className="p-8 text-ps-muted">You are not a member of any workspace yet.</p>;
  const who = params.who && UUID.test(params.who) ? params.who : null;
  const before = params.before && !Number.isNaN(Date.parse(params.before)) ? params.before : null;

  const [{ activity, hasMore }, { data: actors }] = await Promise.all([
    loadActivity(client, workspace.id, { limit: PAGE, actorId: who, before }),
    client.database.from("actors").select("id, kind, display_name").eq("workspace_id", workspace.id).in("kind", ["user", "api_key", "oauth_grant"]),
  ]);
  const href = (actorId: string | null) => (actorId ? `/beta/activity?who=${actorId}` : "/beta/activity");
  const older = hasMore && activity.length ? `/beta/activity?${new URLSearchParams({ ...(who ? { who } : {}), before: activity[activity.length - 1].at })}` : null;

  return (
    <div className="flex w-full max-w-[1100px] flex-col gap-5 px-8 pb-12 pt-6">
      <div>
        <h1 className="m-0 text-lg font-medium">Activity</h1>
        <p className="mt-1 text-ps-muted">Everything you and your AIs did, newest first.</p>
      </div>
      <Card>
        <ActivityFeed rows={activity} actors={(actors ?? []) as Array<{ id: string; kind: ActorKind; display_name: string }>} filterPath="/beta/activity" activeActor={who} />
      </Card>
      <div className="flex justify-between text-xs">
        {before ? <Link href={href(who)} className="text-ps-plum-soft hover:text-ps-text">Back to newest</Link> : <span />}
        {older && <Link href={older} className="text-ps-plum-soft hover:text-ps-text">Older</Link>}
      </div>
    </div>
  );
}
