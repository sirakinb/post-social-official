-- Storage limits count only files that still exist. Expired and failed media keep their
-- records (and recorded size) for history, but their files are gone from storage.
-- Otherwise unchanged from 20261004035159_workspace-integrity.sql.

CREATE OR REPLACE FUNCTION public.assert_within_limit(
  target_workspace uuid,
  limit_name text,
  adding bigint DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  plan public.plans%ROWTYPE;
  current_amount bigint;
  allowed bigint;
  label text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(target_workspace::text || ':' || limit_name, 0));

  SELECT p.* INTO plan
  FROM public.plans p
  WHERE p.id = coalesce(
    (SELECT wp.plan_id FROM public.workspace_plans wp WHERE wp.workspace_id = target_workspace),
    'tester');

  CASE limit_name
    WHEN 'connected_accounts' THEN
      allowed := plan.max_connected_accounts;
      label := 'connected accounts';
      SELECT count(*) INTO current_amount FROM public.connected_accounts
      WHERE workspace_id = target_workspace AND health <> 'disconnected';
    WHEN 'posts_per_month' THEN
      allowed := plan.max_posts_per_month;
      label := 'published posts this month';
      SELECT coalesce(sum(quantity), 0) INTO current_amount FROM public.usage_events
      WHERE workspace_id = target_workspace AND event_type = 'post_published'
        AND occurred_at >= date_trunc('month', now());
    WHEN 'media_storage_bytes' THEN
      allowed := plan.max_media_storage_bytes;
      label := 'bytes of media storage';
      -- Only files that exist: expired and failed files have been removed from storage.
      SELECT coalesce(sum(size_bytes), 0) INTO current_amount FROM public.media_assets
      WHERE workspace_id = target_workspace AND status IN ('uploading', 'processing', 'ready');
    WHEN 'api_calls_per_day' THEN
      allowed := plan.max_api_calls_per_day;
      label := 'API calls today';
      SELECT coalesce(sum(quantity), 0) INTO current_amount FROM public.usage_events
      WHERE workspace_id = target_workspace AND event_type = 'api_call'
        AND occurred_at >= date_trunc('day', now());
    ELSE
      RAISE EXCEPTION 'Unknown limit: %', limit_name;
  END CASE;

  IF current_amount + adding > allowed THEN
    RAISE EXCEPTION 'Your % plan allows % %. You have used %, so this would go over the limit.',
      plan.name, allowed, label, current_amount
      USING ERRCODE = 'P0001', HINT = 'plan_limit_exceeded';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_within_limit(uuid, text, bigint) FROM PUBLIC, anon, authenticated;
