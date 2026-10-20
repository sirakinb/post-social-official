-- Scheduled posts never left "scheduled": the worker's call that moves a post to processing
-- sat in a WITH query Postgres skipped, so finalize_post (which only acts on processing
-- posts) never marked them published. The worker now makes that call on its own. Put the
-- posts it already started where they belong, then let finalize_post settle each one:
-- published, partially published or failed once every destination is done; posts still
-- mid-send stay processing and the worker finishes them. Not-yet-due posts are untouched.
UPDATE public.posts p
SET status = 'processing'
WHERE p.status = 'scheduled'
  AND EXISTS (
    SELECT 1 FROM public.destinations d
    WHERE d.post_id = p.id AND d.status NOT IN ('queued', 'scheduled')
  );

DO $$
BEGIN
  PERFORM public.finalize_post(p.id) FROM public.posts p WHERE p.status = 'processing';
END;
$$;
