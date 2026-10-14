import { Card } from "@/components/beta/ui";
import { DRAFTS_LIMIT, firstMedia, loadDrafts, savedBy } from "@/lib/beta/drafts";
import { loadViewer } from "@/lib/beta/workspace";
import { getMediaLinks } from "../create/actions";
import { DraftsList, type DraftItem } from "./drafts-list";

export const metadata = { title: "Drafts · Post Social" };

export default async function DraftsPage() {
  const { workspace, client } = await loadViewer("/beta/drafts");
  if (!workspace) return <p className="p-8 text-ps-muted">You are not a member of any workspace yet.</p>;

  const { rows, hasMore, failed } = await loadDrafts(client, workspace.id);
  const media = rows.map(firstMedia);
  const { links, posters } = await getMediaLinks(workspace.id, media.filter((m) => m?.status === "ready").map((m) => m!.id));

  const drafts: DraftItem[] = rows.map((r, i) => {
    const m = media[i];
    return {
      id: r.id,
      caption: r.caption,
      plannedAt: r.scheduled_at,
      updatedAt: r.updated_at,
      by: savedBy(r.actors, r.entry_point),
      thumb: m ? { url: (m.media_type === "video" ? posters : links)[m.id] ?? null, isVideo: m.media_type === "video" } : null,
      destinations: r.destinations.map((d) => ({ platform: d.platform, account: d.connected_accounts?.display_name ?? "" })),
    };
  });

  return (
    <div className="flex w-full max-w-[900px] flex-col gap-5 px-8 pb-12 pt-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-lg font-medium">Drafts</h1>
          <p className="mt-1 text-ps-muted">Posts that are saved but not scheduled yet, including ones your AI apps saved.</p>
        </div>
        {!failed && rows.length > 0 && <span className="flex-none text-ps-subtle">{hasMore ? `Newest ${DRAFTS_LIMIT}` : `${rows.length} ${rows.length === 1 ? "draft" : "drafts"}`}</span>}
      </div>

      <Card>
        {failed ? (
          <p role="alert" className="m-0 px-4 py-3 text-ps-failed-text">The drafts could not be loaded. Refresh the page to try again.</p>
        ) : (
          <DraftsList drafts={drafts} canEdit={workspace.role !== "reviewer"} />
        )}
      </Card>
    </div>
  );
}
