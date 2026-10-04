// Runs background media jobs claimed from public.media_jobs.
import type { R2 } from "../../backend/lib/media/r2";
import type { Sql } from "../../backend/lib/media/service";
import type { ProbeOutcome } from "../../backend/lib/media/probe-result";
import { MAX_MEDIA_BYTES, mediaTypeFor, normalizeMimeType, type MediaType } from "../../backend/lib/media/rules";
import { ImportError } from "./safe-fetch";
import type { Response } from "undici";

export type WorkerDeps = {
  sql: Sql;
  r2: R2;
  probe: (key: string, sizeBytes: number, expected: MediaType | null) => Promise<ProbeOutcome>;
  download: (url: string, signal: AbortSignal) => Promise<Response>;
  log: (message: string, details?: Record<string, unknown>) => void;
};

type Job = { id: string; workspace_id: string; media_asset_id: string; kind: "probe" | "import"; attempt_count: number; max_attempts: number };
type Asset = { id: string; storage_key: string; size_bytes: string | number; media_type: MediaType; mime_type: string; source_url: string | null; file_name: string };

const IMPORT_TIMEOUT_MS = 30 * 60 * 1000;
const PART_BYTES = 16 * 1024 * 1024;

// Claims and runs one job. Returns false when nothing was due.
export async function runNextJob(deps: WorkerDeps, leaseSeconds = 45 * 60): Promise<boolean> {
  const [job] = await deps.sql<Job>(`SELECT * FROM public.claim_media_job($1)`, [leaseSeconds]);
  if (!job) return false;
  const [asset] = await deps.sql<Asset>(`SELECT * FROM public.media_assets WHERE id = $1`, [job.media_asset_id]);
  if (!asset) {
    await finishJob(deps, job, "complete", null);
    return true;
  }
  deps.log("job started", { job: job.id, kind: job.kind, attempt: job.attempt_count });
  try {
    if (job.kind === "import") await runImport(deps, job, asset);
    await runProbe(deps, job, { ...asset, ...(await reload(deps, asset.id)) });
    await finishJob(deps, job, "complete", null);
    deps.log("job finished", { job: job.id });
  } catch (error) {
    const permanent = error instanceof ImportError ? error.permanent : error instanceof PermanentError;
    const reason = error instanceof Error ? error.message : String(error);
    if (permanent || job.attempt_count >= job.max_attempts) {
      await failAsset(deps, job, asset, permanent ? reason : "Processing kept failing. Try uploading the file again.");
      await finishJob(deps, job, "failed", reason);
    } else {
      await finishJob(deps, job, "retry_wait", reason);
    }
    deps.log("job error", { job: job.id, permanent, reason });
  }
  return true;
}

class PermanentError extends Error {}

async function reload(deps: WorkerDeps, id: string) {
  const [fresh] = await deps.sql<Asset>(`SELECT * FROM public.media_assets WHERE id = $1`, [id]);
  return fresh;
}

async function finishJob(deps: WorkerDeps, job: Job, state: "complete" | "failed" | "retry_wait", error: string | null) {
  // Back off 1, 4, 9... minutes between retries.
  await deps.sql(
    `UPDATE public.media_jobs
     SET state = $2, last_error = $3, lease_expires_at = NULL,
         next_attempt_at = CASE WHEN $2 = 'retry_wait' THEN now() + make_interval(mins => attempt_count * attempt_count) ELSE next_attempt_at END
     WHERE id = $1`,
    [job.id, state, error],
  );
}

async function failAsset(deps: WorkerDeps, job: Job, asset: Asset, reason: string) {
  await deps.r2.delete(asset.storage_key).catch(() => undefined);
  await deps.sql(
    `WITH audit AS (
       INSERT INTO public.audit_events (workspace_id, entry_point, event_type, entity_type, entity_id, summary, after_values)
       VALUES ($2, 'worker', 'media.failed', 'media', $1, $3, jsonb_build_object('reason', $4::text))
     )
     UPDATE public.media_assets SET status = 'failed', failure_reason = $4 WHERE id = $1`,
    [asset.id, job.workspace_id, `Could not process ${asset.file_name}`, reason],
  );
}

async function runProbe(deps: WorkerDeps, job: Job, asset: Asset) {
  const size = Number(asset.size_bytes);
  const stored = await deps.r2.head(asset.storage_key);
  if (!stored) throw new PermanentError("The file is missing from storage. Upload it again.");
  const outcome = await deps.probe(asset.storage_key, size, job.kind === "import" ? null : asset.media_type);
  if (!outcome.ok) throw new PermanentError(outcome.reason);
  await deps.sql(
    `WITH audit AS (
       INSERT INTO public.audit_events (workspace_id, entry_point, event_type, entity_type, entity_id, summary, after_values)
       VALUES ($2, 'worker', 'media.ready', 'media', $1, $3,
               jsonb_build_object('width', $6::int, 'height', $7::int, 'duration_seconds', $8::numeric))
     )
     UPDATE public.media_assets
     SET status = 'ready', failure_reason = NULL, mime_type = $4, media_type = $5,
         width = $6, height = $7, duration_seconds = $8
     WHERE id = $1`,
    [asset.id, job.workspace_id, `${asset.file_name} is ready to use`, outcome.mimeType, outcome.mediaType, outcome.width, outcome.height, outcome.durationSeconds],
  );
}

async function runImport(deps: WorkerDeps, job: Job, asset: Asset) {
  if (!asset.source_url) throw new PermanentError("This import has no link.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_MS);
  let uploadId: string | null = null;
  try {
    const response = await deps.download(asset.source_url, controller.signal);
    const mimeType = normalizeMimeType(response.headers.get("content-type") ?? "");
    const mediaType = mediaTypeFor(mimeType);
    if (!mediaType) {
      await response.body?.cancel();
      throw new ImportError("The link is not a supported video or image. Use MP4, MOV or WebM video, or JPEG, PNG or WebP images.");
    }
    const announced = Number(response.headers.get("content-length") ?? NaN);
    if (Number.isFinite(announced) && announced > MAX_MEDIA_BYTES) {
      await response.body?.cancel();
      throw new ImportError("Files can be at most 1 GB.");
    }
    if (Number.isFinite(announced)) await assertStorage(deps, job.workspace_id, announced);
    if (!response.body) throw new ImportError("The link returned no file.");

    uploadId = await deps.r2.createMultipartUpload(asset.storage_key, mimeType);
    const parts: Array<{ partNumber: number; etag: string }> = [];
    let buffer = new Uint8Array(PART_BYTES);
    let filled = 0;
    let total = 0;
    const flush = async () => {
      if (filled === 0) return;
      parts.push({ partNumber: parts.length + 1, etag: await deps.r2.uploadPart(asset.storage_key, uploadId!, parts.length + 1, buffer.slice(0, filled)) });
      filled = 0;
    };
    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
      total += chunk.byteLength;
      if (total > MAX_MEDIA_BYTES) {
        controller.abort();
        throw new ImportError("Files can be at most 1 GB.");
      }
      let offset = 0;
      while (offset < chunk.byteLength) {
        const take = Math.min(PART_BYTES - filled, chunk.byteLength - offset);
        buffer.set(chunk.subarray(offset, offset + take), filled);
        filled += take;
        offset += take;
        if (filled === PART_BYTES) {
          await flush();
          buffer = new Uint8Array(PART_BYTES);
        }
      }
    }
    await flush();
    if (total === 0) throw new ImportError("The link returned an empty file.");
    await assertStorage(deps, job.workspace_id, total);
    await deps.r2.completeMultipartUpload(asset.storage_key, uploadId, parts);
    uploadId = null;

    await deps.sql(
      `UPDATE public.media_assets SET mime_type = $2, media_type = $3, size_bytes = $4, last_used_at = now() WHERE id = $1`,
      [asset.id, mimeType, mediaType, total],
    );
  } catch (error) {
    if (uploadId) await deps.r2.abortMultipartUpload(asset.storage_key, uploadId).catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function assertStorage(deps: WorkerDeps, workspaceId: string, adding: number) {
  try {
    await deps.sql(`SELECT public.assert_within_limit($1, 'media_storage_bytes', $2)`, [workspaceId, adding]);
  } catch (error) {
    const plain = String((error as Error).message).match(/Your .* plan allows .*?limit\./)?.[0];
    if (plain) throw new ImportError(plain);
    throw error;
  }
}
