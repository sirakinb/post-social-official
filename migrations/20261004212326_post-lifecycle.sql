-- Post lifecycle steps that must happen all at once: queue an approved post for
-- publishing (now or at its scheduled time), and pull a post back out of the queue.

-- Approved post -> scheduled (future time) or processing (now), with one publish job per
-- destination. Each job gets a fresh idempotency key: destination id + attempt group.
CREATE OR REPLACE FUNCTION public.start_publishing(target_post uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  p public.posts%ROWTYPE;
  run_at timestamptz;
  next_status text;
BEGIN
  SELECT * INTO p FROM public.posts WHERE id = target_post FOR UPDATE;
  IF p.status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved posts can be queued (this post is %).', p.status USING ERRCODE = 'check_violation';
  END IF;

  -- More than 30 seconds out counts as scheduled; otherwise it goes now.
  IF p.scheduled_at IS NOT NULL AND p.scheduled_at > now() + interval '30 seconds' THEN
    run_at := p.scheduled_at;
    next_status := 'scheduled';
  ELSE
    run_at := now();
    next_status := 'processing';
  END IF;

  UPDATE public.posts SET status = next_status WHERE id = target_post;
  UPDATE public.destinations
  SET status = CASE WHEN next_status = 'scheduled' THEN 'scheduled' ELSE 'queued' END,
      error_code = NULL, error_message = NULL
  WHERE post_id = target_post AND status NOT IN ('published', 'cancelled');

  INSERT INTO public.publish_jobs (workspace_id, post_id, destination_id, idempotency_key, next_attempt_at)
  SELECT d.workspace_id, d.post_id, d.id,
         d.id::text || ':' || (SELECT count(*) + 1 FROM public.publish_jobs j WHERE j.destination_id = d.id),
         run_at
  FROM public.destinations d
  WHERE d.post_id = target_post AND d.status IN ('scheduled', 'queued');

  RETURN next_status;
END;
$$;

-- Takes a post's jobs out of the queue if none has started. Returns false (and changes
-- nothing) when a job is already sending, because that cannot be stopped safely.
CREATE OR REPLACE FUNCTION public.unqueue_post(target_post uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM 1 FROM public.publish_jobs
  WHERE post_id = target_post AND (state IN ('running', 'polling') OR (state = 'retry_wait' AND attempt_count > 0))
  FOR UPDATE;
  IF FOUND THEN
    RETURN false;
  END IF;
  UPDATE public.publish_jobs SET state = 'cancelled', finished_at = now()
  WHERE post_id = target_post AND state IN ('queued', 'retry_wait');
  RETURN true;
END;
$$;

-- When the worker starts the first job of a scheduled post, the post moves to processing.
CREATE OR REPLACE FUNCTION public.mark_post_sending(target_post uuid)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  UPDATE public.posts SET status = 'processing' WHERE id = target_post AND status = 'scheduled';
$$;

REVOKE ALL ON FUNCTION public.start_publishing(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unqueue_post(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_post_sending(uuid) FROM PUBLIC, anon, authenticated;
