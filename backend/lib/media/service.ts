// Media actions behind the `media` function (and later the v1 API and MCP tools). Every
// change checks workspace membership, runs the plan-limit check in the same statement as
// the write, and records an audit event naming the actor.
import type { R2 } from "./r2";
import {
  UPLOAD_LINK_SECONDS,
  importUrlProblem,
  mediaTypeFor,
  normalizeMimeType,
  partLength,
  planParts,
  safeFileName,
  storageKey,
  uploadProblem,
} from "./rules";

export class MediaError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type Sql = <T = Record<string, unknown>>(query: string, params: unknown[]) => Promise<T[]>;

export type Caller = { userId: string; displayName: string; entryPoint: "ui" | "api" | "mcp" };

export type MediaDeps = { sql: Sql; r2: R2; newId: () => string };

type Membership = { role: string; actor_id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new MediaError(400, `${label} is missing or not valid.`);
  return value;
}

// Finds the caller's role and their actor in the workspace, creating the actor on first use.
async function membership(deps: MediaDeps, caller: Caller, workspaceId: string, write: boolean): Promise<Membership> {
  const rows = await deps.sql<Membership>(
    `WITH member AS (
       SELECT m.workspace_id, m.user_id, m.role
       FROM public.workspace_members m
       WHERE m.workspace_id = $1 AND m.user_id = $2
     ), inserted AS (
       INSERT INTO public.actors (workspace_id, kind, user_id, display_name)
       SELECT workspace_id, 'user', user_id, $3 FROM member
       ON CONFLICT (workspace_id, user_id) WHERE kind = 'user' DO NOTHING
       RETURNING id
     )
     SELECT member.role,
            coalesce((SELECT id FROM inserted),
                     (SELECT a.id FROM public.actors a
                      WHERE a.workspace_id = $1 AND a.user_id = $2 AND a.kind = 'user')) AS actor_id
     FROM member`,
    [workspaceId, caller.userId, caller.displayName],
  );
  const found = rows[0];
  // Same answer for "no such workspace" and "not a member", so ids cannot be probed.
  if (!found) throw new MediaError(404, "That workspace was not found.");
  if (write && found.role === "reviewer") throw new MediaError(403, "Reviewers can view media but not change it.");
  return found;
}

type AssetRow = {
  id: string;
  workspace_id: string;
  storage_key: string;
  status: string;
  size_bytes: number;
  mime_type: string;
  file_name: string;
  display_name: string | null;
  media_type: string;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  failure_reason: string | null;
  hidden_from_library_at: string | null;
  created_at: string;
};

async function loadAsset(deps: MediaDeps, caller: Caller, mediaId: string, write: boolean) {
  const rows = await deps.sql<AssetRow>(`SELECT * FROM public.media_assets WHERE id = $1`, [mediaId]);
  const asset = rows[0];
  if (!asset) throw new MediaError(404, "That media was not found.");
  const member = await membership(deps, caller, asset.workspace_id, write).catch((error) => {
    // Do not reveal that media exists in a workspace the caller cannot see.
    if (error instanceof MediaError && error.status === 404) throw new MediaError(404, "That media was not found.");
    throw error;
  });
  return { asset, member };
}

function publicAsset(asset: AssetRow) {
  return {
    id: asset.id,
    workspace_id: asset.workspace_id,
    status: asset.status,
    name: asset.display_name ?? asset.file_name,
    file_name: asset.file_name,
    media_type: asset.media_type,
    mime_type: asset.mime_type,
    size_bytes: Number(asset.size_bytes),
    width: asset.width,
    height: asset.height,
    duration_seconds: asset.duration_seconds === null ? null : Number(asset.duration_seconds),
    failure_reason: asset.failure_reason,
    hidden: asset.hidden_from_library_at !== null,
    created_at: asset.created_at,
  };
}

function limitError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const plain = message.match(/Your .* plan allows .*?limit\./)?.[0];
  if (plain) throw new MediaError(402, plain);
  throw error;
}

export async function createUpload(
  deps: MediaDeps,
  caller: Caller,
  input: { workspace_id?: unknown; file_name?: unknown; mime_type?: unknown; size_bytes?: unknown },
) {
  const workspaceId = requireUuid(input.workspace_id, "Workspace");
  const request = {
    fileName: String(input.file_name ?? ""),
    mimeType: normalizeMimeType(String(input.mime_type ?? "")),
    sizeBytes: Number(input.size_bytes),
  };
  const problem = uploadProblem(request);
  if (problem) throw new MediaError(400, problem);
  const member = await membership(deps, caller, workspaceId, true);

  const mediaId = deps.newId();
  const key = storageKey(workspaceId, mediaId, request.fileName);
  const { partSize, partCount } = planParts(request.sizeBytes);

  await deps
    .sql(
      `WITH lim AS (SELECT public.assert_within_limit($1, 'media_storage_bytes', $2))
       INSERT INTO public.media_assets
         (id, workspace_id, uploaded_by_actor_id, storage_key, file_name, display_name,
          mime_type, media_type, size_bytes, status)
       SELECT $3, $1, $4, $5, $6, $6, $7, $8, $2, 'uploading' FROM lim`,
      [workspaceId, request.sizeBytes, mediaId, member.actor_id, key, safeFileName(request.fileName), request.mimeType, mediaTypeFor(request.mimeType)],
    )
    .catch(limitError);

  let uploadId: string;
  try {
    uploadId = await deps.r2.createMultipartUpload(key, request.mimeType);
  } catch (error) {
    await deps.sql(`UPDATE public.media_assets SET status = 'failed', failure_reason = $2 WHERE id = $1`, [
      mediaId,
      "The upload could not be started. Try again.",
    ]);
    throw error;
  }

  await deps.sql(
    `INSERT INTO public.media_uploads (media_asset_id, workspace_id, multipart_upload_id, part_size, part_count, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
    [mediaId, workspaceId, uploadId, partSize, partCount, UPLOAD_LINK_SECONDS],
  );

  const parts = await Promise.all(
    Array.from({ length: partCount }, async (_, index) => ({
      part_number: index + 1,
      url: await deps.r2.presignPart(key, uploadId, index + 1, UPLOAD_LINK_SECONDS, partLength(request.sizeBytes, partSize, index + 1)),
    })),
  );
  return { media_id: mediaId, part_size: partSize, parts, expires_in_seconds: UPLOAD_LINK_SECONDS };
}

type UploadRow = AssetRow & { multipart_upload_id: string; part_count: number; expired: boolean };

async function loadUpload(deps: MediaDeps, caller: Caller, mediaId: string) {
  const { asset, member } = await loadAsset(deps, caller, mediaId, true);
  const rows = await deps.sql<UploadRow>(
    `SELECT m.*, u.multipart_upload_id, u.part_count, u.expires_at < now() AS expired
     FROM public.media_assets m JOIN public.media_uploads u ON u.media_asset_id = m.id
     WHERE m.id = $1`,
    [asset.id],
  );
  const upload = rows[0];
  if (!upload || asset.status !== "uploading") throw new MediaError(409, "This upload is already finished or was cancelled.");
  return { upload, member };
}

export async function completeUpload(
  deps: MediaDeps,
  caller: Caller,
  input: { media_id?: unknown; parts?: unknown },
) {
  const mediaId = requireUuid(input.media_id, "Media");
  const { upload, member } = await loadUpload(deps, caller, mediaId);
  const parts = Array.isArray(input.parts) ? input.parts : [];
  const cleaned = parts.map((p) => ({
    partNumber: Number((p as { part_number?: unknown }).part_number),
    etag: String((p as { etag?: unknown }).etag ?? ""),
  }));
  const numbers = new Set(cleaned.map((p) => p.partNumber));
  if (
    cleaned.length !== upload.part_count ||
    numbers.size !== upload.part_count ||
    cleaned.some((p) => !Number.isInteger(p.partNumber) || p.partNumber < 1 || p.partNumber > upload.part_count || !p.etag)
  ) {
    throw new MediaError(400, `Expected ${upload.part_count} uploaded parts with their ETags.`);
  }

  try {
    await deps.r2.completeMultipartUpload(upload.storage_key, upload.multipart_upload_id, cleaned);
  } catch {
    throw new MediaError(409, "The upload is incomplete. Upload every part again, then finish.");
  }

  const stored = await deps.r2.head(upload.storage_key);
  if (!stored || stored.sizeBytes !== Number(upload.size_bytes)) {
    await deps.r2.delete(upload.storage_key);
    await deps.sql(
      `WITH up AS (DELETE FROM public.media_uploads WHERE media_asset_id = $1)
       UPDATE public.media_assets SET status = 'failed', failure_reason = $2 WHERE id = $1`,
      [mediaId, "The uploaded file did not match the size that was announced. Upload it again."],
    );
    throw new MediaError(400, "The uploaded file did not match the size that was announced. Upload it again.");
  }

  const rows = await deps.sql<AssetRow>(
    `WITH up AS (DELETE FROM public.media_uploads WHERE media_asset_id = $1),
     job AS (
       INSERT INTO public.media_jobs (workspace_id, media_asset_id, kind) VALUES ($2, $1, 'probe')
     ),
     audit AS (
       INSERT INTO public.audit_events (workspace_id, actor_id, entry_point, event_type, entity_type, entity_id, summary, after_values)
       VALUES ($2, $3, $4, 'media.uploaded', 'media', $1, $5, jsonb_build_object('size_bytes', $6::bigint))
     )
     UPDATE public.media_assets SET status = 'processing', last_used_at = now() WHERE id = $1
     RETURNING *`,
    [mediaId, upload.workspace_id, member.actor_id, caller.entryPoint, `Uploaded ${upload.file_name}`, stored.sizeBytes],
  );
  return publicAsset(rows[0]);
}

export async function abortUpload(deps: MediaDeps, caller: Caller, input: { media_id?: unknown }) {
  const mediaId = requireUuid(input.media_id, "Media");
  const { upload } = await loadUpload(deps, caller, mediaId);
  await deps.r2.abortMultipartUpload(upload.storage_key, upload.multipart_upload_id);
  // Cancelled uploads leave no trace in the library.
  await deps.sql(`DELETE FROM public.media_assets WHERE id = $1`, [mediaId]);
  return { media_id: mediaId, status: "cancelled" };
}

export async function importMedia(
  deps: MediaDeps,
  caller: Caller,
  input: { workspace_id?: unknown; url?: unknown; name?: unknown },
) {
  const workspaceId = requireUuid(input.workspace_id, "Workspace");
  const url = String(input.url ?? "").trim();
  const problem = importUrlProblem(url);
  if (problem) throw new MediaError(400, problem);
  const member = await membership(deps, caller, workspaceId, true);

  const mediaId = deps.newId();
  const lastSegment = new URL(url).pathname.split("/").pop() ?? "";
  let fromPath = lastSegment;
  try {
    fromPath = decodeURIComponent(lastSegment);
  } catch {
    // Malformed escapes like %zz: keep the raw segment; safeFileName cleans it.
  }
  fromPath = fromPath || "imported-file";
  const fileName = safeFileName(typeof input.name === "string" && input.name.trim() ? input.name : fromPath);
  const rows = await deps.sql<AssetRow>(
    `WITH asset AS (
       INSERT INTO public.media_assets
         (id, workspace_id, uploaded_by_actor_id, storage_key, file_name, display_name, mime_type,
          media_type, size_bytes, status, source_url)
       VALUES ($1, $2, $3, $4, $5, $5, 'application/octet-stream', 'video', 0, 'processing', $6)
       RETURNING *
     ), job AS (
       INSERT INTO public.media_jobs (workspace_id, media_asset_id, kind) SELECT workspace_id, id, 'import' FROM asset
     ), audit AS (
       INSERT INTO public.audit_events (workspace_id, actor_id, entry_point, event_type, entity_type, entity_id, summary, after_values)
       SELECT workspace_id, $3, $7, 'media.import_requested', 'media', id, $8, jsonb_build_object('url', $6::text) FROM asset
     )
     SELECT * FROM asset`,
    [mediaId, workspaceId, member.actor_id, storageKey(workspaceId, mediaId, fileName), fileName, url, caller.entryPoint, `Asked to import ${fileName} from a link`],
  );
  return publicAsset(rows[0]);
}

export async function renameMedia(deps: MediaDeps, caller: Caller, input: { media_id?: unknown; name?: unknown }) {
  const mediaId = requireUuid(input.media_id, "Media");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 200) throw new MediaError(400, "Names must be 1 to 200 characters.");
  const { asset, member } = await loadAsset(deps, caller, mediaId, true);
  const rows = await deps.sql<AssetRow>(
    `WITH audit AS (
       INSERT INTO public.audit_events (workspace_id, actor_id, entry_point, event_type, entity_type, entity_id, summary, before_values, after_values)
       VALUES ($2, $3, $4, 'media.renamed', 'media', $1, $5, jsonb_build_object('name', $6::text), jsonb_build_object('name', $7::text))
     )
     UPDATE public.media_assets SET display_name = $7 WHERE id = $1 RETURNING *`,
    [mediaId, asset.workspace_id, member.actor_id, caller.entryPoint, `Renamed media to ${name}`, asset.display_name ?? asset.file_name, name],
  );
  return publicAsset(rows[0]);
}

export async function setHidden(deps: MediaDeps, caller: Caller, input: { media_id?: unknown; hidden?: unknown }) {
  const mediaId = requireUuid(input.media_id, "Media");
  if (typeof input.hidden !== "boolean") throw new MediaError(400, "Say whether the media should be hidden (true or false).");
  const { asset, member } = await loadAsset(deps, caller, mediaId, true);
  const rows = await deps.sql<AssetRow>(
    `WITH audit AS (
       INSERT INTO public.audit_events (workspace_id, actor_id, entry_point, event_type, entity_type, entity_id, summary)
       VALUES ($2, $3, $4, $5, 'media', $1, $6)
     )
     UPDATE public.media_assets
     SET hidden_from_library_at = CASE WHEN $7::boolean THEN coalesce(hidden_from_library_at, now()) ELSE NULL END
     WHERE id = $1 RETURNING *`,
    [
      mediaId,
      asset.workspace_id,
      member.actor_id,
      caller.entryPoint,
      input.hidden ? "media.hidden" : "media.unhidden",
      `${input.hidden ? "Hid" : "Restored"} ${asset.display_name ?? asset.file_name} ${input.hidden ? "from" : "to"} the library`,
      input.hidden,
    ],
  );
  return publicAsset(rows[0]);
}

export async function getMedia(deps: MediaDeps, caller: Caller, input: { media_id?: unknown }) {
  const mediaId = requireUuid(input.media_id, "Media");
  const { asset } = await loadAsset(deps, caller, mediaId, false);
  return publicAsset(asset);
}

export const mediaActions = {
  create_upload: createUpload,
  complete_upload: completeUpload,
  abort_upload: abortUpload,
  import: importMedia,
  rename: renameMedia,
  set_hidden: setHidden,
  get: getMedia,
} as const;
