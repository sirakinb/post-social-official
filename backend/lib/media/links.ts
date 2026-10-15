// Short-lived view links for media in the web app (thumbnails, previews). Storage is
// private, so the page asks for links to the items it shows; only ready items in the
// caller's workspace.
import { membership, requireUuid, type Caller, type Sql } from "../access";
import type { R2 } from "./r2";

const MAX = 60;
const SECONDS = 3600;

export async function mediaLinks(sql: Sql, r2: R2, caller: Caller, input: { workspace_id?: unknown; media_ids?: unknown }) {
  const workspaceId = requireUuid(input.workspace_id, "Workspace");
  await membership(sql, caller, workspaceId, false);
  const ids = Array.isArray(input.media_ids) ? [...new Set(input.media_ids.slice(0, MAX))].map((id) => requireUuid(id, "Media")) : [];
  if (!ids.length) return { links: {} };
  const rows = await sql<{ id: string; storage_key: string; media_type: string; status: string; poster_key: string | null }>(
    `SELECT id, storage_key, media_type, status, poster_key FROM public.media_assets WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
    [workspaceId, ids],
  );
  const links: Record<string, string> = {};
  const posters: Record<string, string> = {};
  for (const row of rows) {
    if (row.status !== "ready") continue;
    links[row.id] = await r2.presignGet(row.storage_key, SECONDS);
    if (row.poster_key) posters[row.id] = await r2.presignGet(row.poster_key, SECONDS);
  }
  return { links, posters, expires_in_seconds: SECONDS };
}

export type PostMedia = {
  id: string;
  media_type: string;
  mime_type: string;
  name: string;
  status: string;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  url: string | null; // temporary view link (1 hour), ready items only
  thumbnail_url: string | null; // the image itself, or a video's poster frame
};

// The media on each post, in order, with view links. Only posts and media in this
// workspace: callers must already have checked the caller belongs to it.
export async function mediaForPosts(sql: Sql, r2: Pick<R2, "presignGet">, workspaceId: string, postIds: string[]): Promise<Map<string, PostMedia[]>> {
  const byPost = new Map<string, PostMedia[]>();
  if (!postIds.length) return byPost;
  const rows = await sql<{ post_id: string; id: string; media_type: string; mime_type: string; name: string; status: string; width: number | null; height: number | null; duration_seconds: number | string | null; storage_key: string; poster_key: string | null }>(
    `SELECT pm.post_id, m.id, m.media_type, m.mime_type, coalesce(m.display_name, m.file_name) AS name, m.status,
            m.width, m.height, m.duration_seconds, m.storage_key, m.poster_key
     FROM public.post_media pm JOIN public.media_assets m ON m.id = pm.media_asset_id
     WHERE pm.workspace_id = $1 AND m.workspace_id = $1 AND pm.post_id = ANY($2::uuid[])
     ORDER BY pm.post_id, pm.position`,
    [workspaceId, postIds],
  );
  for (const row of rows) {
    const ready = row.status === "ready";
    const url = ready ? await r2.presignGet(row.storage_key, SECONDS) : null;
    const thumbnail = !ready ? null : row.media_type === "image" ? url : row.poster_key ? await r2.presignGet(row.poster_key, SECONDS) : null;
    const list = byPost.get(row.post_id) ?? [];
    list.push({
      id: row.id,
      media_type: row.media_type,
      mime_type: row.mime_type,
      name: row.name,
      status: row.status,
      width: row.width,
      height: row.height,
      duration_seconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
      url,
      thumbnail_url: thumbnail,
    });
    byPost.set(row.post_id, list);
  }
  return byPost;
}
