import { loadViewer } from "@/lib/beta/workspace";
import { getMediaLinks } from "../create/actions";
import { MediaView, type LibraryItem } from "./media-view";

export const metadata = { title: "Media · Post Social" };

type Row = {
  id: string;
  status: string;
  display_name: string | null;
  file_name: string;
  media_type: "image" | "video";
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  failure_reason: string | null;
  hidden_from_library_at: string | null;
  created_at: string;
  actors: { kind: string; display_name: string } | null;
};

export default async function MediaPage({ searchParams }: { searchParams: Promise<{ hidden?: string }> }) {
  const { hidden } = await searchParams;
  const showHidden = hidden === "1";
  const { workspace, client } = await loadViewer("/beta/media");
  if (!workspace) return <p className="p-8 text-ps-muted">You are not a member of any workspace yet.</p>;

  let query = client.database
    .from("media_assets")
    .select("id, status, display_name, file_name, media_type, mime_type, size_bytes, width, height, duration_seconds, failure_reason, hidden_from_library_at, created_at, actors(kind, display_name)")
    .eq("workspace_id", workspace.id)
    .neq("status", "uploading")
    .order("created_at", { ascending: false })
    .limit(120);
  query = showHidden ? query.not("hidden_from_library_at", "is", null) : query.is("hidden_from_library_at", null);
  const { data, error } = await query;
  const rows = (data ?? []) as unknown as Row[];

  const ids = rows.map((r) => r.id);
  const [{ data: uses }, linkSet] = await Promise.all([
    ids.length ? client.database.from("post_media").select("media_asset_id, posts(status)").in("media_asset_id", ids) : Promise.resolve({ data: [] }),
    getMediaLinks(workspace.id, rows.filter((r) => r.status === "ready").map((r) => r.id)),
  ]);
  const used = new Map<string, number>();
  for (const u of (uses ?? []) as Array<{ media_asset_id: string }>) used.set(u.media_asset_id, (used.get(u.media_asset_id) ?? 0) + 1);

  const items: LibraryItem[] = rows.map((r) => ({
    id: r.id,
    status: r.status,
    name: r.display_name ?? r.file_name,
    type: r.media_type,
    mime: r.mime_type,
    size: Number(r.size_bytes),
    width: r.width,
    height: r.height,
    duration: r.duration_seconds === null ? null : Number(r.duration_seconds),
    failure: r.failure_reason,
    hidden: Boolean(r.hidden_from_library_at),
    createdAt: r.created_at,
    by: r.actors ? { kind: r.actors.kind, name: r.actors.display_name } : null,
    usedIn: used.get(r.id) ?? 0,
    url: linkSet.links[r.id] ?? null,
    poster: linkSet.posters[r.id] ?? null,
  }));

  return <MediaView workspaceId={workspace.id} items={items} showHidden={showHidden} loadError={Boolean(error)} canEdit={workspace.role !== "reviewer"} />;
}
