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
  const rows = await sql<{ id: string; storage_key: string; media_type: string; status: string }>(
    `SELECT id, storage_key, media_type, status FROM public.media_assets WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
    [workspaceId, ids],
  );
  const links: Record<string, string> = {};
  for (const row of rows) {
    if (row.status === "ready") links[row.id] = await r2.presignGet(row.storage_key, SECONDS);
  }
  return { links, expires_in_seconds: SECONDS };
}
