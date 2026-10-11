import Link from "next/link";
import { ActorMark, type ActorKind } from "@/components/beta/marks";
import { Card, PlatformMark, Thumb } from "@/components/beta/ui";
import { firstMedia, savedBy, type DraftRow } from "@/lib/beta/drafts";
import { loadViewer } from "@/lib/beta/workspace";
import { getMediaLinks } from "../create/actions";

export const metadata = { title: "Drafts · Post Social" };

const SELECT = "id, caption, updated_at, entry_point, actors(kind, display_name), destinations(platform, connected_accounts(display_name)), post_media(position, media_assets(id, media_type, status))";

export default async function DraftsPage() {
  const { workspace, client } = await loadViewer("/beta/drafts");
  if (!workspace) return <p className="p-8 text-ps-muted">You are not a member of any workspace yet.</p>;

  const { data, error } = await client.database.from("posts").select(SELECT).eq("workspace_id", workspace.id).eq("status", "draft").order("updated_at", { ascending: false }).limit(200);
  const rows = (data ?? []) as unknown as DraftRow[];

  const media = rows.map(firstMedia);
  const { links, posters } = await getMediaLinks(workspace.id, media.filter((m) => m?.status === "ready").map((m) => m!.id));
  const canEdit = workspace.role !== "reviewer";

  return (
    <div className="flex w-full max-w-[900px] flex-col gap-5 px-8 pb-12 pt-6">
      <div>
        <h1 className="m-0 text-lg font-medium">Drafts</h1>
        <p className="mt-1 text-ps-muted">Posts that are saved but not scheduled yet, including ones your AI apps saved.</p>
      </div>

      <Card>
        {error ? (
          <p role="alert" className="m-0 px-4 py-3 text-[#FF8A8E]">The drafts could not be loaded. Refresh the page to try again.</p>
        ) : rows.length === 0 ? (
          <p className="m-0 px-4 py-6 text-ps-muted">No drafts. Posts you or your AI apps save without scheduling show up here.</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {rows.map((r, i) => {
              const m = media[i];
              const body = (
                <>
                  <Thumb url={m ? (m.media_type === "video" ? posters : links)[m.id] ?? null : null} isVideo={m?.media_type === "video"} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 truncate">{r.caption || "No caption"}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ps-subtle">
                      <span className="flex items-center gap-1">
                        {r.destinations.map((d, j) => <PlatformMark key={j} platform={d.platform} size={16} className="rounded-[5px]" />)}
                        {r.destinations.length === 0 && "No accounts picked"}
                      </span>
                      <span className="flex items-center gap-1.5">
                        {r.actors && <ActorMark kind={r.actors.kind as ActorKind} name={r.actors.display_name} size={14} />}
                        {savedBy(r.actors, r.entry_point)}
                      </span>
                      <span className="font-mono">{new Date(r.updated_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                    </div>
                  </div>
                  {canEdit && <span className="flex-none text-xs text-ps-plum-soft">Open</span>}
                </>
              );
              return (
                <li key={r.id} className="border-b border-white/[0.05] last:border-b-0">
                  {canEdit ? (
                    <Link href={`/beta/create?post=${r.id}`} data-attr="open-draft" className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02]">{body}</Link>
                  ) : (
                    <div className="flex items-center gap-3 px-4 py-3">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
