-- Retrying a failed post, and marking one that went live anyway as published.
--
-- A retry sends the post again to one account that failed. When the failed attempt may
-- already have reached the platform (may_be_live), the retry carries that attempt's saved
-- progress forward, so the publisher looks on the platform first, the same way it does
-- after a crash, and only posts again if the post is not there.

-- Set by the publisher when a post failed after the platform may have received it (it
-- could not confirm the post, or ran out of tries after the publish call started).
ALTER TABLE public.destinations ADD COLUMN may_be_live boolean NOT NULL DEFAULT false;

-- Failed and partly live posts can go back to processing (a retry), or be settled again
-- when an account is marked as published by hand. Otherwise unchanged from
-- 20261004212539_requeue-edited-posts.sql.
CREATE OR REPLACE FUNCTION public.enforce_post_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  allowed text[];
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  allowed := CASE OLD.status
    WHEN 'draft' THEN ARRAY['awaiting_approval', 'approved', 'cancelled']
    WHEN 'awaiting_approval' THEN ARRAY['approved', 'draft', 'cancelled']
    WHEN 'approved' THEN ARRAY['scheduled', 'processing', 'awaiting_approval', 'cancelled']
    WHEN 'scheduled' THEN ARRAY['processing', 'awaiting_approval', 'approved', 'cancelled']
    WHEN 'processing' THEN ARRAY['published', 'partially_published', 'failed']
    WHEN 'failed' THEN ARRAY['processing', 'partially_published', 'published']
    WHEN 'partially_published' THEN ARRAY['processing', 'published']
    ELSE ARRAY[]::text[]
  END;
  IF NOT (NEW.status = ANY (allowed)) THEN
    RAISE EXCEPTION 'Invalid post transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Queues one failed account of a post again. start_over skips the platform check and
-- begins a brand new attempt (the person checked the platform and the post isn't there).
-- Returns 'checking' when the retry looks on the platform first, otherwise 'fresh'.
CREATE OR REPLACE FUNCTION public.retry_destination(target_destination uuid, start_over boolean DEFAULT false)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  d public.destinations%ROWTYPE;
  p public.posts%ROWTYPE;
  carried jsonb := '{}';
BEGIN
  SELECT * INTO d FROM public.destinations WHERE id = target_destination FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That account is not on this post.' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO p FROM public.posts WHERE id = d.post_id FOR UPDATE;
  IF d.status <> 'failed' THEN
    RAISE EXCEPTION 'Only failed posts can be retried (this one is %).', replace(d.status, '_', ' ') USING ERRCODE = 'check_violation';
  END IF;
  IF p.status NOT IN ('failed', 'partially_published', 'processing') THEN
    RAISE EXCEPTION 'Only failed posts can be retried (this post is %).', replace(p.status, '_', ' ') USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.publish_jobs WHERE destination_id = d.id AND state IN ('queued', 'running', 'polling', 'retry_wait')) THEN
    RAISE EXCEPTION 'This post is already being sent again.' USING ERRCODE = 'check_violation';
  END IF;

  IF d.may_be_live AND NOT start_over THEN
    SELECT coalesce(j.checkpoint, '{}') INTO carried FROM public.publish_jobs j
    WHERE j.destination_id = d.id ORDER BY j.created_at DESC LIMIT 1;
    carried := coalesce(carried, '{}');
  END IF;

  IF p.status <> 'processing' THEN
    UPDATE public.posts SET status = 'processing' WHERE id = p.id;
  END IF;
  UPDATE public.destinations SET status = 'queued', error_code = NULL, error_message = NULL, may_be_live = false WHERE id = d.id;
  INSERT INTO public.publish_jobs (workspace_id, post_id, destination_id, idempotency_key, next_attempt_at, checkpoint)
  VALUES (d.workspace_id, d.post_id, d.id,
          d.id::text || ':' || (SELECT count(*) + 1 FROM public.publish_jobs j WHERE j.destination_id = d.id),
          now(), carried);

  RETURN CASE WHEN carried = '{}'::jsonb THEN 'fresh' ELSE 'checking' END;
END;
$$;

-- Marks a failed account as published: the post went live on the platform even though we
-- recorded a failure. Nothing is sent. Counted like any published post, and the post's
-- overall status is settled again.
CREATE OR REPLACE FUNCTION public.mark_destination_published(target_destination uuid, link text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  d public.destinations%ROWTYPE;
  p public.posts%ROWTYPE;
  total integer;
  ok integer;
  outcome text;
BEGIN
  SELECT * INTO d FROM public.destinations WHERE id = target_destination FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That account is not on this post.' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO p FROM public.posts WHERE id = d.post_id FOR UPDATE;
  IF d.status <> 'failed' OR p.status NOT IN ('failed', 'partially_published', 'processing') THEN
    RAISE EXCEPTION 'Only failed posts can be marked as published.' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.destinations
  SET status = 'published', live_url = link, error_code = NULL, error_message = 'Marked as published by hand.', may_be_live = false
  WHERE id = d.id;
  INSERT INTO public.usage_events (workspace_id, actor_id, connected_account_id, platform, event_type, quantity)
  VALUES (d.workspace_id, d.actor_id, d.connected_account_id, d.platform, 'post_published', 1);

  IF p.status = 'processing' THEN
    RETURN public.finalize_post(p.id);
  END IF;
  SELECT count(*), count(*) FILTER (WHERE status = 'published') INTO total, ok FROM public.destinations WHERE post_id = p.id;
  outcome := CASE WHEN ok = total THEN 'published' WHEN ok = 0 THEN 'failed' ELSE 'partially_published' END;
  UPDATE public.posts SET status = outcome WHERE id = p.id AND status <> outcome;
  RETURN outcome;
END;
$$;

REVOKE ALL ON FUNCTION public.retry_destination(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_destination_published(uuid, text) FROM PUBLIC, anon, authenticated;
