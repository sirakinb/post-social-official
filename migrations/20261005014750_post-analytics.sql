-- Phase 5D: per-post stats. One current row per published destination (refreshed by the
-- worker: often while a post is new, then less often, then not at all), plus one row per
-- day for history. Counters a platform does not report (or has not approved yet) stay
-- NULL; never invented zeros.

CREATE TABLE public.post_metrics (
  destination_id uuid PRIMARY KEY REFERENCES public.destinations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  connected_account_id uuid NOT NULL REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('tiktok', 'instagram', 'facebook', 'threads', 'youtube', 'linkedin', 'x', 'bluesky')),
  views bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  saves bigint,
  reposts bigint,
  quotes bigint,
  extra jsonb NOT NULL DEFAULT '{}',       -- platform-specific numbers (reach, watch time...)
  unavailable text[] NOT NULL DEFAULT '{}', -- counters this account cannot read yet
  published_at timestamptz NOT NULL,
  fetched_at timestamptz,
  next_fetch_at timestamptz,               -- NULL once the post is too old to keep checking
  fetch_lease_until timestamptz,
  refresh_requested_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX post_metrics_due_idx ON public.post_metrics (next_fetch_at) WHERE next_fetch_at IS NOT NULL;
CREATE INDEX post_metrics_workspace_published_idx ON public.post_metrics (workspace_id, published_at DESC);

CREATE TABLE public.post_metric_days (
  destination_id uuid NOT NULL REFERENCES public.destinations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  day date NOT NULL,
  views bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  saves bigint,
  reposts bigint,
  quotes bigint,
  PRIMARY KEY (destination_id, day)
);

-- Members can read their workspace's stats; only the server writes them.
ALTER TABLE public.post_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_metric_days ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.post_metrics, public.post_metric_days FROM PUBLIC, anon, authenticated;
GRANT SELECT (destination_id, workspace_id, post_id, connected_account_id, platform, views, likes, comments, shares, saves,
  reposts, quotes, extra, unavailable, published_at, fetched_at, last_error) ON public.post_metrics TO authenticated;
GRANT SELECT ON public.post_metric_days TO authenticated;
CREATE POLICY post_metrics_member_read ON public.post_metrics
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY post_metric_days_member_read ON public.post_metric_days
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));

-- Hands up to max_rows due stats rows to a worker, leased so two workers never fetch the
-- same post at once. New published destinations of enabled platforms are added first.
CREATE OR REPLACE FUNCTION public.claim_metrics_to_fetch(platforms text[], max_rows integer DEFAULT 20, lease_seconds integer DEFAULT 300)
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
    AND NOT EXISTS (SELECT 1 FROM public.post_metrics m WHERE m.destination_id = d.id)
  ON CONFLICT (destination_id) DO NOTHING;

  RETURN QUERY
  UPDATE public.post_metrics m
  SET fetch_lease_until = now() + make_interval(secs => lease_seconds)
  WHERE m.destination_id IN (
    SELECT pm.destination_id FROM public.post_metrics pm
    JOIN public.connected_accounts a ON a.id = pm.connected_account_id
    WHERE pm.platform = ANY(platforms) AND a.health <> 'disconnected'
      AND pm.next_fetch_at IS NOT NULL AND pm.next_fetch_at <= now()
      AND (pm.fetch_lease_until IS NULL OR pm.fetch_lease_until < now())
    ORDER BY pm.next_fetch_at
    LIMIT max_rows
    FOR UPDATE OF pm SKIP LOCKED
  )
  RETURNING m.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_metrics_to_fetch(text[], integer, integer) FROM PUBLIC, anon, authenticated;
