-- Whole-account analytics (PEN-29 to PEN-32): an account's own posts made outside Post Social,
-- its daily account-level numbers, and its audience, read through each platform's own API
-- with the permissions it approved (Instagram, Facebook Pages, Threads, TikTok, Bluesky).
-- Only the server writes them; workspace members can read their own.

-- Posts on a connected account that weren't published through Post Social, with their
-- current numbers. Posts Post Social published stay in post_metrics; these never repeat them.
CREATE TABLE public.account_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connected_account_id uuid NOT NULL REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('tiktok', 'instagram', 'facebook', 'threads', 'youtube', 'linkedin', 'x', 'bluesky')),
  platform_post_id text NOT NULL,
  published_at timestamptz NOT NULL,
  caption text,      -- the first 200 characters
  permalink text,
  format text NOT NULL CHECK (format IN ('video', 'carousel', 'photo', 'text')),
  views bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  saves bigint,
  reposts bigint,
  quotes bigint,
  reach bigint,
  source text NOT NULL DEFAULT 'official' CHECK (source IN ('official', 'public')),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connected_account_id, platform_post_id)
);
CREATE INDEX account_posts_workspace_published_idx ON public.account_posts (workspace_id, published_at DESC);

-- One row of account-level numbers per account per day (UTC). A number the platform
-- doesn't report, or the account can't read yet, stays NULL.
CREATE TABLE public.account_insight_days (
  connected_account_id uuid NOT NULL REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  day date NOT NULL,
  views bigint,          -- times the account's content was seen
  reach bigint,          -- people reached that day
  profile_views bigint,
  interactions bigint,   -- likes, comments, shares, saves and replies on the account's content
  engaged bigint,        -- people who interacted
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connected_account_id, day)
);
CREATE INDEX account_insight_days_workspace_day_idx ON public.account_insight_days (workspace_id, day);

-- The account's latest audience breakdowns (age, gender, country, city), as the platform
-- reports them: { "age": [{ "label": "25-34", "value": 120 }], ... }.
CREATE TABLE public.account_audiences (
  connected_account_id uuid PRIMARY KEY REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  breakdowns jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_audiences_workspace_idx ON public.account_audiences (workspace_id);

-- When each account's whole-account numbers are read next (server only), leased so two
-- workers never read the same account at once.
CREATE TABLE public.account_stats_syncs (
  connected_account_id uuid PRIMARY KEY REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
  next_sync_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  last_synced_at timestamptz,
  audience_synced_at timestamptz,
  last_error text
);
CREATE INDEX account_stats_syncs_due_idx ON public.account_stats_syncs (next_sync_at);

ALTER TABLE public.account_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_insight_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_audiences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_stats_syncs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_posts, public.account_insight_days, public.account_audiences, public.account_stats_syncs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.account_posts, public.account_insight_days, public.account_audiences TO authenticated;
CREATE POLICY account_posts_member_read ON public.account_posts
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY account_insight_days_member_read ON public.account_insight_days
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY account_audiences_member_read ON public.account_audiences
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
