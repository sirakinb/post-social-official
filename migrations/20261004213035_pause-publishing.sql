-- Pause publishing per workspace (an operational switch; also keeps test workspaces away
-- from the shared worker). A paused workspace's jobs stay queued until it is unpaused.
ALTER TABLE public.workspaces ADD COLUMN publishing_paused boolean NOT NULL DEFAULT false;

DROP FUNCTION public.claim_publish_job(integer);

-- only_workspace: claim just that workspace's jobs, even if paused (used by tests and
-- for draining one workspace by hand). Otherwise paused workspaces are skipped.
CREATE OR REPLACE FUNCTION public.claim_publish_job(lease_seconds integer DEFAULT 600, only_workspace uuid DEFAULT NULL)
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
    SELECT pj.id FROM public.publish_jobs pj
    JOIN public.workspaces w ON w.id = pj.workspace_id
    WHERE ((pj.state IN ('queued', 'retry_wait', 'polling') AND pj.next_attempt_at <= now())
        OR (pj.state = 'running' AND pj.lease_expires_at < now()))
      AND (CASE WHEN only_workspace IS NULL THEN NOT w.publishing_paused ELSE pj.workspace_id = only_workspace END)
    ORDER BY pj.next_attempt_at
    LIMIT 1
    FOR UPDATE OF pj SKIP LOCKED
  )
  RETURNING j.*;
$$;

REVOKE ALL ON FUNCTION public.claim_publish_job(integer, uuid) FROM PUBLIC, anon, authenticated;
