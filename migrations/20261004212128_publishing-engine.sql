-- Publishing engine (Phase 4): checkpointed publish jobs that can resume after a crash
-- without posting twice, polling for platform processing, platform rate limits, and
-- rolling destination results up to the post.

-- ===== Jobs =====

-- 'polling' = waiting on the platform (processing a video, confirming a post). Polling
-- runs do not count as attempts.
ALTER TABLE public.publish_jobs DROP CONSTRAINT publish_jobs_state_check;
ALTER TABLE public.publish_jobs ADD CONSTRAINT publish_jobs_state_check
  CHECK (state IN ('queued', 'running', 'polling', 'retry_wait', 'complete', 'failed', 'cancelled'));

ALTER TABLE public.publish_jobs
  -- Progress saved between steps: container ids, upload session, publish id, and when an
  -- irreversible publish call was started. Server-only working data.
  ADD COLUMN checkpoint jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN poll_count integer NOT NULL DEFAULT 0 CHECK (poll_count >= 0),
  ADD COLUMN max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  ADD COLUMN started_at timestamptz,
  ADD COLUMN finished_at timestamptz;

-- The live-job uniqueness rule must also cover polling jobs.
DROP INDEX public.publish_jobs_one_active_per_destination_idx;
CREATE UNIQUE INDEX publish_jobs_one_active_per_destination_idx
  ON public.publish_jobs (destination_id) WHERE state IN ('queued', 'running', 'polling', 'retry_wait');

-- Hands one due job to a worker with a lease. SKIP LOCKED keeps two workers off the same
-- job; an expired lease (crashed worker) makes a running job due again. Only real
-- attempts count toward max_attempts; polling does not.
CREATE OR REPLACE FUNCTION public.claim_publish_job(lease_seconds integer DEFAULT 600)
RETURNS SETOF public.publish_jobs
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  UPDATE public.publish_jobs j
  SET attempt_count = j.attempt_count + CASE WHEN j.state = 'polling' THEN 0 ELSE 1 END,
      state = 'running',
      started_at = coalesce(j.started_at, now()),
      lease_expires_at = now() + make_interval(secs => lease_seconds)
  WHERE j.id = (
    SELECT id FROM public.publish_jobs
    WHERE (state IN ('queued', 'retry_wait', 'polling') AND next_attempt_at <= now())
       OR (state = 'running' AND lease_expires_at < now())
    ORDER BY next_attempt_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING j.*;
$$;

-- Platform rate limits: reserves one call in the current window, or returns the time the
-- window resets when the limit is reached.
CREATE OR REPLACE FUNCTION public.reserve_platform_call(target_account uuid, operation_name text, max_calls integer, window_seconds integer)
RETURNS timestamptz
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  window_begin timestamptz := to_timestamp(floor(extract(epoch FROM now()) / window_seconds) * window_seconds);
  workspace uuid;
  used integer;
BEGIN
  SELECT workspace_id INTO workspace FROM public.connected_accounts WHERE id = target_account;
  INSERT INTO public.platform_rate_limits (workspace_id, connected_account_id, operation, window_start, count)
  VALUES (workspace, target_account, operation_name, window_begin, 1)
  ON CONFLICT (connected_account_id, operation, window_start)
  DO UPDATE SET count = platform_rate_limits.count + 1, updated_at = now()
  WHERE platform_rate_limits.count < max_calls
  RETURNING count INTO used;
  IF used IS NULL THEN
    RETURN window_begin + make_interval(secs => window_seconds);
  END IF;
  RETURN NULL;
END;
$$;

-- ===== Rolling results up to the post =====

-- Once every destination of a post has finished, the post becomes published, partially
-- published or failed. Called by the worker after each destination finishes.
CREATE OR REPLACE FUNCTION public.finalize_post(target_post uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  total integer;
  done integer;
  ok integer;
  current_status text;
  outcome text;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE status IN ('published', 'failed', 'cancelled')),
         count(*) FILTER (WHERE status = 'published')
  INTO total, done, ok
  FROM public.destinations WHERE post_id = target_post;
  SELECT status INTO current_status FROM public.posts WHERE id = target_post;
  IF current_status <> 'processing' OR done < total THEN
    RETURN current_status;
  END IF;
  outcome := CASE WHEN ok = total THEN 'published' WHEN ok = 0 THEN 'failed' ELSE 'partially_published' END;
  UPDATE public.posts SET status = outcome WHERE id = target_post;
  RETURN outcome;
END;
$$;

-- ===== Access =====

-- Members may see job progress, but never the server's working checkpoint.
REVOKE SELECT ON public.publish_jobs FROM authenticated;
GRANT SELECT (id, workspace_id, post_id, destination_id, state, attempt_count, next_attempt_at,
  last_error, created_at, updated_at, started_at, finished_at) ON public.publish_jobs TO authenticated;

REVOKE ALL ON FUNCTION public.claim_publish_job(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_platform_call(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_post(uuid) FROM PUBLIC, anon, authenticated;
