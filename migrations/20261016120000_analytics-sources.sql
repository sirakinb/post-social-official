-- Analytics page: where each post's numbers came from, daily follower counts, and a daily
-- cap on asking for fresh numbers by hand.
--
-- A platform's numbers come from its own API once it approves Post Social ("official"),
-- or until then from what anyone can see on the post's public page ("public", read through
-- ScrapeCreators). Both land in the same rows, so switching a platform over keeps its
-- history. "mixed": official numbers with the gaps filled from the public page.

ALTER TABLE public.post_metrics
  ADD COLUMN source text CHECK (source IN ('official', 'public', 'mixed'));
GRANT SELECT (source) ON public.post_metrics TO authenticated;

-- One follower count per account per day, saved from the day the account is first seen;
-- the Growth tab is built from these. Only the server writes them.
CREATE TABLE public.account_follower_days (
  connected_account_id uuid NOT NULL REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  day date NOT NULL,
  followers bigint NOT NULL CHECK (followers >= 0),
  source text NOT NULL CHECK (source IN ('official', 'public')),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connected_account_id, day)
);
CREATE INDEX account_follower_days_workspace_day_idx ON public.account_follower_days (workspace_id, day);

ALTER TABLE public.account_follower_days ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_follower_days FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.account_follower_days TO authenticated;
CREATE POLICY account_follower_days_member_read ON public.account_follower_days
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));

-- Each "Refresh now" press, so a workspace gets a few a day (each one costs platform reads).
CREATE TABLE public.analytics_refreshes (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_refreshes_workspace_idx ON public.analytics_refreshes (workspace_id, requested_at DESC);
ALTER TABLE public.analytics_refreshes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_refreshes FROM PUBLIC, anon, authenticated;
