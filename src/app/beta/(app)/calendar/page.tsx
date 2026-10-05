import { loadViewer } from "@/lib/beta/workspace";
import { getMediaLinks } from "../create/actions";
import { CalendarView, type CalendarPost } from "./calendar-view";

export const metadata = { title: "Calendar · Post Social" };

const DAY = 86_400_000;
const now = () => Date.now();

type Row = {
  id: string;
  status: string;
  caption: string;
  scheduled_at: string | null;
  created_at: string;
  entry_point: string;
  actors: { kind: string; display_name: string } | null;
  destinations: Array<{ platform: string; status: string; live_url: string | null; connected_accounts: { display_name: string } | null }>;
  post_media: Array<{ position: number; media_assets: { id: string; media_type: string; status: string } | null }>;
};

const SELECT = "id, status, caption, scheduled_at, created_at, entry_point, actors(kind, display_name), destinations(platform, status, live_url, connected_accounts(display_name)), post_media(position, media_assets(id, media_type, status))";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const params = await searchParams;
  const { workspace, client } = await loadViewer("/beta/calendar");
  if (!workspace) return <p className="p-8 text-ps-muted">You are not a member of any workspace yet.</p>;

  // A generous window around the dates shown; the view itself is drawn in the viewer's
  // time zone in the browser.
  const anchor = params.from && /^\d{4}-\d{2}-\d{2}$/.test(params.from) ? Date.parse(`${params.from}T12:00:00Z`) : now();
  const from = new Date(anchor - 10 * DAY).toISOString();
  const to = new Date(anchor + 45 * DAY).toISOString();

  const [scheduled, immediate] = await Promise.all([
    client.database.from("posts").select(SELECT).eq("workspace_id", workspace.id).gte("scheduled_at", from).lt("scheduled_at", to).neq("status", "draft").limit(400),
    client.database.from("posts").select(SELECT).eq("workspace_id", workspace.id).is("scheduled_at", null).gte("created_at", from).lt("created_at", to).neq("status", "draft").limit(400),
  ]);
  const rows = [...((scheduled.data ?? []) as unknown as Row[]), ...((immediate.data ?? []) as unknown as Row[])];

  const firstMedia = rows.map((r) => [...r.post_media].sort((a, b) => a.position - b.position)[0]?.media_assets ?? null);
  const imageIds = firstMedia.filter((m) => m && m.status === "ready" && m.media_type === "image").map((m) => m!.id);
  const links = await getMediaLinks(workspace.id, imageIds.slice(0, 60));

  const posts: CalendarPost[] = rows.map((r, i) => ({
    id: r.id,
    status: r.status,
    caption: r.caption,
    at: r.scheduled_at ?? r.created_at,
    scheduled: Boolean(r.scheduled_at),
    by: r.actors ? { kind: r.actors.kind, name: r.actors.display_name } : null,
    via: r.entry_point,
    thumb: firstMedia[i] ? { url: links[firstMedia[i]!.id] ?? null, isVideo: firstMedia[i]!.media_type === "video" } : null,
    destinations: r.destinations.map((d) => ({ platform: d.platform, status: d.status, account: d.connected_accounts?.display_name ?? "", liveUrl: d.live_url })),
  }));

  return <CalendarView posts={posts} anchor={new Date(anchor).toISOString()} canEdit={workspace.role !== "reviewer"} />;
}
