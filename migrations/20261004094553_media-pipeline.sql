-- Media pipeline (Phase 2): upload status, in-progress uploads, background media jobs and
-- retention. Files live in Cloudflare R2; these tables track them.

-- ===== Media status =====

ALTER TABLE public.media_assets
  ADD COLUMN status text NOT NULL DEFAULT 'ready'
    CHECK (status IN ('uploading', 'processing', 'ready', 'failed', 'expired')),
  ADD COLUMN display_name text,
  -- Plain-language reason shown when status is 'failed'.
  ADD COLUMN failure_reason text,
  -- Where an imported file came from (null for browser uploads).
  ADD COLUMN source_url text,
  -- Drives retention: set on upload and whenever a post starts using the media.
  ADD COLUMN last_used_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE TRIGGER media_assets_updated_at BEFORE UPDATE ON public.media_assets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX media_assets_status_last_used_idx ON public.media_assets (status, last_used_at);

-- ===== In-progress multipart uploads (server-only) =====

CREATE TABLE public.media_uploads (
  media_asset_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  multipart_upload_id text NOT NULL,
  part_size bigint NOT NULL CHECK (part_size > 0),
  part_count integer NOT NULL CHECK (part_count BETWEEN 1 AND 10000),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (media_asset_id, workspace_id)
    REFERENCES public.media_assets (id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX media_uploads_expires_idx ON public.media_uploads (expires_at);

-- ===== Background media jobs =====

-- 'probe' reads size, type, dimensions and duration of a stored file.
-- 'import' downloads a file from a link into R2, then probes it.
CREATE TABLE public.media_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  media_asset_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('probe', 'import')),
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'running', 'retry_wait', 'complete', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (media_asset_id, workspace_id)
    REFERENCES public.media_assets (id, workspace_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX media_jobs_one_active_per_asset_idx
  ON public.media_jobs (media_asset_id) WHERE state IN ('queued', 'running', 'retry_wait');
CREATE INDEX media_jobs_due_idx ON public.media_jobs (state, next_attempt_at);

CREATE TRIGGER media_jobs_updated_at BEFORE UPDATE ON public.media_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Hands one due job to a worker and leases it. SKIP LOCKED lets several workers run
-- without taking the same job; an expired lease (crashed worker) makes the job due again.
CREATE OR REPLACE FUNCTION public.claim_media_job(lease_seconds integer DEFAULT 300)
RETURNS SETOF public.media_jobs
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  UPDATE public.media_jobs j
  SET state = 'running',
      attempt_count = j.attempt_count + 1,
      lease_expires_at = now() + make_interval(secs => lease_seconds)
  WHERE j.id = (
    SELECT id FROM public.media_jobs
    WHERE (state IN ('queued', 'retry_wait') AND next_attempt_at <= now())
       OR (state = 'running' AND lease_expires_at < now())
    ORDER BY next_attempt_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING j.*;
$$;

-- Media whose retention has passed: not used by any post that has not finished, and not
-- used for `retention` since last_used_at. Also abandoned uploads older than a day.
CREATE OR REPLACE FUNCTION public.media_due_for_cleanup(retention interval DEFAULT interval '30 days', max_rows integer DEFAULT 100)
RETURNS TABLE (id uuid, workspace_id uuid, storage_key text, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT m.id, m.workspace_id, m.storage_key, m.status
  FROM public.media_assets m
  WHERE (
      m.status IN ('ready', 'failed') AND m.last_used_at < now() - retention
      AND NOT EXISTS (
        SELECT 1 FROM public.post_media pm
        JOIN public.posts p ON p.id = pm.post_id
        WHERE pm.media_asset_id = m.id
          AND p.status NOT IN ('published', 'partially_published', 'failed', 'cancelled')
      )
    )
    OR (m.status = 'uploading' AND m.created_at < now() - interval '1 day')
  ORDER BY m.last_used_at
  LIMIT max_rows;
$$;

-- ===== Access control =====

REVOKE ALL ON public.media_uploads, public.media_jobs FROM anon, authenticated;
ALTER TABLE public.media_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_jobs ENABLE ROW LEVEL SECURITY;
-- media_uploads: server-only (no policies, no grants).
-- media_jobs: members can see job progress for their workspace.
GRANT SELECT (id, workspace_id, media_asset_id, kind, state, attempt_count, next_attempt_at,
  created_at, updated_at) ON public.media_jobs TO authenticated;
CREATE POLICY media_jobs_member_read ON public.media_jobs
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));

-- The new media_assets columns are covered by the existing table-wide SELECT grant.

REVOKE ALL ON FUNCTION public.claim_media_job(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.media_due_for_cleanup(interval, integer) FROM PUBLIC;
