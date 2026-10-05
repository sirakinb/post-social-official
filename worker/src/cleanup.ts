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
    await r2.delete(item.storage_key.replace(/\/[^/]*$/, "/poster.jpg")); // its poster frame, if any
    await r2.delete(item.storage_key.replace(/\/[^/]*$/, "/tiktok.jpg")); // its TikTok copy, if any
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

// Sign-in leftovers for AI apps: used or expired one-time codes, expired access tokens,
// finished repeat-safe request records, and app registrations nobody ever approved.
export async function removeExpiredSignIns(sql: Sql) {
  const removed = await sql(
    `WITH codes AS (DELETE FROM public.oauth_codes WHERE expires_at < now() - interval '1 hour'),
     tokens AS (DELETE FROM public.oauth_access_tokens WHERE expires_at < now() - interval '1 hour'),
     replays AS (DELETE FROM public.api_idempotency WHERE created_at < now() - interval '25 hours'),
     limits AS (DELETE FROM public.rate_limits WHERE window_start < now() - interval '1 day')
     DELETE FROM public.oauth_clients c
     WHERE c.created_at < now() - interval '30 days'
       AND NOT EXISTS (SELECT 1 FROM public.oauth_grants g WHERE g.oauth_client_id = c.id)
     RETURNING c.id`,
    [],
  );
  return removed.length;
}
