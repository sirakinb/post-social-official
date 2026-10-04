// Retention and orphan sweeps for media storage.
import type { R2 } from "../../backend/lib/media/r2";
import type { Sql } from "../../backend/lib/media/service";

type Due = { id: string; workspace_id: string; storage_key: string; status: string };

// Media unused for `retentionDays` loses its file and shows as "expired"; abandoned
// uploads are cancelled and removed. Returns how many items were handled.
export async function expireUnusedMedia(sql: Sql, r2: R2, retentionDays: number) {
  const due = await sql<Due>(`SELECT * FROM public.media_due_for_cleanup(make_interval(days => $1), 100)`, [retentionDays]);
  for (const item of due) {
    if (item.status === "uploading") {
      const [upload] = await sql<{ multipart_upload_id: string }>(
        `SELECT multipart_upload_id FROM public.media_uploads WHERE media_asset_id = $1`,
        [item.id],
      );
      if (upload) await r2.abortMultipartUpload(item.storage_key, upload.multipart_upload_id).catch(() => undefined);
      await sql(`DELETE FROM public.media_assets WHERE id = $1 AND status = 'uploading'`, [item.id]);
      continue;
    }
    await r2.delete(item.storage_key);
    await sql(
      `WITH audit AS (
         INSERT INTO public.audit_events (workspace_id, entry_point, event_type, entity_type, entity_id, summary)
         VALUES ($2, 'worker', 'media.expired', 'media', $1, $3)
       )
       UPDATE public.media_assets SET status = 'expired' WHERE id = $1`,
      [item.id, item.workspace_id, `Media file removed after ${retentionDays} days without use`],
    );
  }
  return due.length;
}

// Deletes stored files whose workspace no longer exists (deleted accounts, data-deletion
// requests). Files live under workspaces/<workspace id>/.
export async function removeOrphanedFiles(sql: Sql, r2: R2) {
  let removed = 0;
  let token: string | undefined;
  do {
    const page = await r2.list("workspaces/", { delimiter: "/", continuationToken: token });
    const ids = page.prefixes.map((p) => p.split("/")[1]).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    if (ids.length) {
      const existing = await sql<{ id: string }>(`SELECT id FROM public.workspaces WHERE id = ANY($1::uuid[])`, [ids]);
      const live = new Set(existing.map((w) => w.id));
      for (const id of ids.filter((i) => !live.has(i))) removed += await deletePrefix(r2, `workspaces/${id}/`);
    }
    token = page.nextToken ?? undefined;
  } while (token);
  return removed;
}

async function deletePrefix(r2: R2, prefix: string) {
  let count = 0;
  let token: string | undefined;
  do {
    const page = await r2.list(prefix, { continuationToken: token });
    for (const key of page.keys) {
      await r2.delete(key);
      count++;
    }
    token = page.nextToken ?? undefined;
  } while (token);
  return count;
}
