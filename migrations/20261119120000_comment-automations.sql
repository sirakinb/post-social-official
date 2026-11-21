-- Comment-to-DM automations (backend/lib/inbox, worker/src/inbox): someone comments a keyword
-- on an Instagram post and gets a DM, plus an optional public reply.
-- Server-only: the api function manages automations, the connections function stores
-- Meta's webhook events, and the worker sends the messages.

-- Meta names an Instagram account in its webhooks by its professional account id, not the
-- id we saved at sign-in. The worker looks it up and subscribes the account to webhooks.
CREATE TABLE public.inbox_accounts (
  connected_account_id uuid PRIMARY KEY REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  webhook_id text,
  subscribed_fields text[] NOT NULL DEFAULT '{}',
  subscribed_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX inbox_accounts_webhook_id_idx ON public.inbox_accounts (webhook_id) WHERE webhook_id IS NOT NULL;
CREATE INDEX inbox_accounts_workspace_idx ON public.inbox_accounts (workspace_id);
CREATE TRIGGER inbox_accounts_updated_at BEFORE UPDATE ON public.inbox_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.comment_automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  connected_account_id uuid NOT NULL REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  -- One post (the platform's media id), or every post when null.
  platform_post_id text,
  post_id uuid REFERENCES public.posts(id) ON DELETE SET NULL,
  keywords text[] NOT NULL DEFAULT '{}',
  match_mode text NOT NULL DEFAULT 'word' CHECK (match_mode IN ('word', 'contains', 'exact')),
  exclude_keywords text[] NOT NULL DEFAULT '{}',
  dm_message text NOT NULL CHECK (char_length(dm_message) BETWEEN 1 AND 640),
  dm_variations text[] NOT NULL DEFAULT '{}',
  dm_buttons jsonb NOT NULL DEFAULT '[]',
  comment_reply text,
  comment_reply_variations text[] NOT NULL DEFAULT '{}',
  repeat_mode text NOT NULL DEFAULT 'once' CHECK (repeat_mode IN ('once', 'every_comment')),
  is_active boolean NOT NULL DEFAULT true,
  created_by_actor_id uuid REFERENCES public.actors(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comment_automations_workspace_idx ON public.comment_automations (workspace_id, created_at DESC);
CREATE INDEX comment_automations_account_idx ON public.comment_automations (connected_account_id) WHERE is_active;
CREATE INDEX comment_automations_post_idx ON public.comment_automations (post_id) WHERE post_id IS NOT NULL;
CREATE INDEX comment_automations_actor_idx ON public.comment_automations (created_by_actor_id) WHERE created_by_actor_id IS NOT NULL;
CREATE TRIGGER comment_automations_updated_at BEFORE UPDATE ON public.comment_automations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Every comment an automation matched, and what happened: the activity list and the stats.
CREATE TABLE public.automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  automation_id uuid NOT NULL REFERENCES public.comment_automations(id) ON DELETE CASCADE,
  connected_account_id uuid NOT NULL REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
  platform_comment_id text NOT NULL,
  platform_post_id text,
  commenter_id text,
  commenter_username text,
  comment_text text,
  status text NOT NULL CHECK (status IN ('sent', 'skipped', 'failed')),
  reason text,
  dm_text text,
  reply_status text CHECK (reply_status IN ('sent', 'failed', 'none')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (automation_id, platform_comment_id)
);
CREATE INDEX automation_runs_automation_idx ON public.automation_runs (automation_id, created_at DESC);
CREATE INDEX automation_runs_commenter_idx ON public.automation_runs (automation_id, commenter_id) WHERE status = 'sent';
CREATE INDEX automation_runs_workspace_idx ON public.automation_runs (workspace_id);
CREATE INDEX automation_runs_account_idx ON public.automation_runs (connected_account_id);

-- One short link per button per DM, so clicks are counted per person.
CREATE TABLE public.tracked_links (
  code text PRIMARY KEY CHECK (code ~ '^[A-Za-z0-9]{10}$'),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  automation_id uuid NOT NULL REFERENCES public.comment_automations(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.automation_runs(id) ON DELETE CASCADE,
  url text NOT NULL,
  clicks integer NOT NULL DEFAULT 0,
  first_clicked_at timestamptz,
  last_clicked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tracked_links_automation_idx ON public.tracked_links (automation_id);
CREATE INDEX tracked_links_run_idx ON public.tracked_links (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX tracked_links_workspace_idx ON public.tracked_links (workspace_id);

-- Meta's webhook deliveries, stored as they arrive and handled by the worker.
CREATE TABLE public.inbox_webhook_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform text NOT NULL CHECK (platform IN ('instagram', 'facebook')),
  entry_id text NOT NULL,
  field text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  processed_at timestamptz,
  error text
);
CREATE INDEX inbox_webhook_events_pending_idx ON public.inbox_webhook_events (received_at) WHERE processed_at IS NULL;

ALTER TABLE public.inbox_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comment_automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracked_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbox_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inbox_accounts, public.comment_automations, public.automation_runs, public.tracked_links, public.inbox_webhook_events FROM PUBLIC, anon, authenticated;

-- Hands the worker a batch of unhandled webhook events, each leased so two workers never
-- take the same one. Gives up on an event after 5 tries.
CREATE OR REPLACE FUNCTION public.claim_inbox_events(max_rows integer DEFAULT 20, lease_seconds integer DEFAULT 120)
RETURNS SETOF public.inbox_webhook_events
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  UPDATE public.inbox_webhook_events e
  SET lease_until = now() + make_interval(secs => lease_seconds), attempts = e.attempts + 1
  WHERE e.id IN (
    SELECT id FROM public.inbox_webhook_events
    WHERE processed_at IS NULL AND attempts < 5 AND (lease_until IS NULL OR lease_until < now())
    ORDER BY received_at
    LIMIT max_rows
    FOR UPDATE SKIP LOCKED
  )
  RETURNING e.*;
$$;
REVOKE ALL ON FUNCTION public.claim_inbox_events(integer, integer) FROM PUBLIC, anon, authenticated;

-- A click on a tracked link: counts it and returns where to send the person.
CREATE OR REPLACE FUNCTION public.record_link_click(link_code text)
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  UPDATE public.tracked_links
  SET clicks = clicks + 1, first_clicked_at = coalesce(first_clicked_at, now()), last_clicked_at = now()
  WHERE code = link_code
  RETURNING url;
$$;
REVOKE ALL ON FUNCTION public.record_link_click(text) FROM PUBLIC, anon, authenticated;
