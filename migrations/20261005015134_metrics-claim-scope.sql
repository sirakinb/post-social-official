-- Stats fetching skips paused workspaces (no platform calls at all there), and can be
-- limited to one workspace (tests, manual runs).
DROP FUNCTION public.claim_metrics_to_fetch(text[], integer, integer);

CREATE OR REPLACE FUNCTION public.claim_metrics_to_fetch(platforms text[], max_rows integer DEFAULT 20, lease_seconds integer DEFAULT 300, only_workspace uuid DEFAULT NULL)
RETURNS SETOF public.post_metrics
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  INSERT INTO public.post_metrics (destination_id, workspace_id, post_id, connected_account_id, platform, published_at, next_fetch_at)
  SELECT d.id, d.workspace_id, d.post_id, d.connected_account_id, d.platform, d.updated_at, now()
  FROM public.destinations d
  JOIN public.connected_accounts a ON a.id = d.connected_account_id
  WHERE d.status = 'published' AND d.platform = ANY(platforms) AND a.health <> 'disconnected'
    AND d.updated_at > now() - interval '90 days'
    AND (only_workspace IS NULL OR d.workspace_id = only_workspace)
    AND NOT EXISTS (SELECT 1 FROM public.post_metrics m WHERE m.destination_id = d.id)
  ON CONFLICT (destination_id) DO NOTHING;

  RETURN QUERY
  UPDATE public.post_metrics m
  SET fetch_lease_until = now() + make_interval(secs => lease_seconds)
  WHERE m.destination_id IN (
    SELECT pm.destination_id FROM public.post_metrics pm
    JOIN public.connected_accounts a ON a.id = pm.connected_account_id
    JOIN public.workspaces w ON w.id = pm.workspace_id
    WHERE pm.platform = ANY(platforms) AND a.health <> 'disconnected'
      AND pm.next_fetch_at IS NOT NULL AND pm.next_fetch_at <= now()
      AND (pm.fetch_lease_until IS NULL OR pm.fetch_lease_until < now())
      AND (CASE WHEN only_workspace IS NULL THEN NOT w.publishing_paused ELSE pm.workspace_id = only_workspace END)
    ORDER BY pm.next_fetch_at
    LIMIT max_rows
    FOR UPDATE OF pm SKIP LOCKED
  )
  RETURNING m.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_metrics_to_fetch(text[], integer, integer, uuid) FROM PUBLIC, anon, authenticated;
