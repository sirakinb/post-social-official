-- A post waiting to retry can be cancelled unless a platform may already have received it
-- (the job's checkpoint records when an irreversible publish call started).
CREATE OR REPLACE FUNCTION public.unqueue_post(target_post uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM 1 FROM public.publish_jobs
  WHERE post_id = target_post
    AND (state IN ('running', 'polling') OR (state = 'retry_wait' AND checkpoint ? 'publish_started_at'))
  FOR UPDATE;
  IF FOUND THEN
    RETURN false;
  END IF;
  UPDATE public.publish_jobs SET state = 'cancelled', finished_at = now()
  WHERE post_id = target_post AND state IN ('queued', 'retry_wait');
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.unqueue_post(uuid) FROM PUBLIC, anon, authenticated;
