-- Post Social core schema (Phase 1).
--
-- Access model: people read their own workspace's data directly (row-level security).
-- Every change goes through the Post Social API (server functions and the worker, which
-- use the admin key), so each change is attributed to an actor and audited. App clients
-- (anon, authenticated) get no INSERT, UPDATE or DELETE on any table, and no access at
-- all to secrets such as encrypted tokens, key hashes and OAuth state.

-- ===== Shared helpers =====

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ===== Workspaces and membership (US-005) =====

CREATE TABLE public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  default_approval_policy text NOT NULL DEFAULT 'confirm_each'
    CHECK (default_approval_policy IN ('confirm_each', 'approve_after_draft', 'autonomous')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.workspace_members (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'reviewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX workspace_members_user_idx ON public.workspace_members (user_id);

-- RLS helper. SECURITY DEFINER so policies that call it do not re-enter RLS on
-- workspace_members (avoids recursive policies).
CREATE OR REPLACE FUNCTION public.is_workspace_member(target_workspace uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = target_workspace AND user_id = auth.uid()
  );
$$;

-- ===== API clients (US-009) =====

CREATE TABLE public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  mode text NOT NULL CHECK (mode IN ('test', 'live')),
  scopes text[] NOT NULL DEFAULT '{}',
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_workspace_idx ON public.api_keys (workspace_id);

-- AI apps that sign in with OAuth (dynamic client registration). Not workspace-scoped.
CREATE TABLE public.oauth_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL UNIQUE,
  client_name text NOT NULL,
  redirect_uris text[] NOT NULL CHECK (cardinality(redirect_uris) > 0),
  client_secret_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One person's authorization of one AI app for one workspace, e.g. "Claude, Aki's connection".
CREATE TABLE public.oauth_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  oauth_client_id uuid NOT NULL REFERENCES public.oauth_clients(id) ON DELETE CASCADE,
  label text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  refresh_token_hash text UNIQUE,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_grants_workspace_idx ON public.oauth_grants (workspace_id);

-- ===== Actors: who did it (US-008) =====

CREATE TABLE public.actors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('user', 'api_key', 'oauth_grant', 'system')),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  api_key_id uuid UNIQUE REFERENCES public.api_keys(id) ON DELETE SET NULL,
  oauth_grant_id uuid UNIQUE REFERENCES public.oauth_grants(id) ON DELETE SET NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- The identity column matching the kind is set when created; it may later become NULL
  -- if the key, grant or user is deleted, so history keeps the actor's name.
  CHECK (kind <> 'api_key' OR (user_id IS NULL AND oauth_grant_id IS NULL)),
  CHECK (kind <> 'oauth_grant' OR api_key_id IS NULL),
  CHECK (kind <> 'user' OR (api_key_id IS NULL AND oauth_grant_id IS NULL)),
  CHECK (kind <> 'system' OR (user_id IS NULL AND api_key_id IS NULL AND oauth_grant_id IS NULL))
);
CREATE UNIQUE INDEX actors_user_per_workspace_idx
  ON public.actors (workspace_id, user_id) WHERE kind = 'user';
CREATE INDEX actors_workspace_idx ON public.actors (workspace_id);

-- ===== Connected social accounts and credentials (US-006) =====

CREATE TABLE public.connected_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  platform text NOT NULL
    CHECK (platform IN ('tiktok', 'instagram', 'facebook', 'threads', 'youtube', 'linkedin', 'x', 'bluesky')),
  external_account_id text NOT NULL,
  handle text NOT NULL,
  display_name text NOT NULL,
  avatar_url text,
  scopes text[] NOT NULL DEFAULT '{}',
  capabilities jsonb NOT NULL DEFAULT '{}',
  health text NOT NULL DEFAULT 'connected'
    CHECK (health IN ('connected', 'needs_attention', 'disconnected')),
  health_reason text,
  approval_policy_override text
    CHECK (approval_policy_override IN ('confirm_each', 'approve_after_draft', 'autonomous')),
  owner_external_id text,
  linked_facebook_page_id text,
  connected_by_actor_id uuid REFERENCES public.actors(id) ON DELETE SET NULL,
  last_verified_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, platform, external_account_id)
);
CREATE INDEX connected_accounts_workspace_platform_idx ON public.connected_accounts (workspace_id, platform);
CREATE INDEX connected_accounts_platform_external_idx ON public.connected_accounts (platform, external_account_id);
CREATE INDEX connected_accounts_owner_external_idx ON public.connected_accounts (owner_external_id);

-- Encrypted platform tokens. Server-only: no app-client access at all.
CREATE TABLE public.credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  connected_account_id uuid NOT NULL UNIQUE REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
  encrypted_payload text NOT NULL,
  initialization_vector text NOT NULL,
  algorithm text NOT NULL DEFAULT 'AES-256-GCM' CHECK (algorithm = 'AES-256-GCM'),
  key_version integer NOT NULL CHECK (key_version > 0),
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credentials_access_expiry_idx ON public.credentials (access_token_expires_at);

-- In-flight social sign-in attempts (CSRF state). Server-only.
CREATE TABLE public.oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL
    CHECK (provider IN ('tiktok', 'instagram', 'facebook', 'threads', 'youtube', 'linkedin', 'x', 'bluesky')),
  state_hash text NOT NULL UNIQUE,
  code_verifier_encrypted text,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_states_expires_idx ON public.oauth_states (expires_at);

-- Per-account platform rate-limit windows. Server-only.
CREATE TABLE public.platform_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  connected_account_id uuid NOT NULL REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
  operation text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connected_account_id, operation, window_start)
);
CREATE INDEX platform_rate_limits_updated_idx ON public.platform_rate_limits (updated_at);

-- Meta data-deletion callbacks. Server-only.
CREATE TABLE public.data_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('meta')),
  confirmation_code text NOT NULL UNIQUE,
  external_user_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
  removed_accounts integer NOT NULL DEFAULT 0,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- ===== Media, posts, destinations, jobs and approvals (US-007) =====

CREATE TABLE public.media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  uploaded_by_actor_id uuid REFERENCES public.actors(id) ON DELETE SET NULL,
  storage_key text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('video', 'image')),
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  duration_seconds numeric CHECK (duration_seconds >= 0),
  width integer CHECK (width > 0),
  height integer CHECK (height > 0),
  checksum_sha256 text,
  hidden_from_library_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_assets_workspace_created_idx ON public.media_assets (workspace_id, created_at DESC);

CREATE TABLE public.posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.actors(id) ON DELETE SET NULL,
  entry_point text NOT NULL CHECK (entry_point IN ('ui', 'api', 'mcp')),
  caption text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'awaiting_approval', 'approved', 'scheduled', 'processing',
    'published', 'partially_published', 'failed', 'cancelled')),
  scheduled_at timestamptz,
  effective_approval_policy text NOT NULL
    CHECK (effective_approval_policy IN ('confirm_each', 'approve_after_draft', 'autonomous')),
  requested_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX posts_workspace_created_idx ON public.posts (workspace_id, created_at DESC);
CREATE INDEX posts_workspace_scheduled_idx ON public.posts (workspace_id, scheduled_at);
CREATE INDEX posts_workspace_status_idx ON public.posts (workspace_id, status);

-- Mirrors convex/lib/postState.ts. Approved and scheduled posts can return to
-- awaiting_approval when a human-approved caption is edited.
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
    WHEN 'scheduled' THEN ARRAY['processing', 'awaiting_approval', 'cancelled']
    WHEN 'processing' THEN ARRAY['published', 'partially_published', 'failed']
    ELSE ARRAY[]::text[]
  END;
  IF NOT (NEW.status = ANY (allowed)) THEN
    RAISE EXCEPTION 'Invalid post transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE public.post_media (
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  media_asset_id uuid NOT NULL REFERENCES public.media_assets(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (post_id, position),
  UNIQUE (post_id, media_asset_id)
);
CREATE INDEX post_media_asset_idx ON public.post_media (media_asset_id);

CREATE TABLE public.destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  connected_account_id uuid NOT NULL REFERENCES public.connected_accounts(id) ON DELETE RESTRICT,
  platform text NOT NULL
    CHECK (platform IN ('tiktok', 'instagram', 'facebook', 'threads', 'youtube', 'linkedin', 'x', 'bluesky')),
  actor_id uuid REFERENCES public.actors(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'awaiting_approval', 'approved', 'scheduled', 'queued', 'uploading',
    'processing', 'published', 'failed', 'cancelled')),
  effective_approval_policy text NOT NULL
    CHECK (effective_approval_policy IN ('confirm_each', 'approve_after_draft', 'autonomous')),
  -- Small per-platform options object (privacy, media type, title). Never filtered on.
  options jsonb NOT NULL DEFAULT '{}',
  consented_at timestamptz,
  platform_request_id text,
  live_url text,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, connected_account_id)
);
CREATE INDEX destinations_workspace_status_idx ON public.destinations (workspace_id, status);
CREATE INDEX destinations_account_idx ON public.destinations (connected_account_id);

CREATE TABLE public.publish_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  destination_id uuid NOT NULL REFERENCES public.destinations(id) ON DELETE CASCADE,
  -- Sent to platforms that accept one, and used by the worker to never publish the same
  -- destination twice for one publish request, even across retries and restarts.
  idempotency_key text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'running', 'retry_wait', 'complete', 'failed', 'cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- At most one live job per destination.
CREATE UNIQUE INDEX publish_jobs_one_active_per_destination_idx
  ON public.publish_jobs (destination_id) WHERE state IN ('queued', 'running', 'retry_wait');
CREATE INDEX publish_jobs_due_idx ON public.publish_jobs (state, next_attempt_at);

CREATE TABLE public.approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  policy text NOT NULL CHECK (policy IN ('confirm_each', 'approve_after_draft', 'autonomous')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'decided', 'cancelled')),
  requested_by_actor_id uuid REFERENCES public.actors(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE UNIQUE INDEX approval_requests_one_pending_per_post_idx
  ON public.approval_requests (post_id) WHERE status = 'pending';
CREATE INDEX approval_requests_workspace_status_idx ON public.approval_requests (workspace_id, status);

-- Each decision on an approval request.
CREATE TABLE public.approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  approval_request_id uuid NOT NULL REFERENCES public.approval_requests(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  actor_id uuid REFERENCES public.actors(id) ON DELETE SET NULL,
  note text,
  decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX approvals_post_idx ON public.approvals (post_id);
CREATE INDEX approvals_workspace_idx ON public.approvals (workspace_id, decided_at DESC);

-- ===== Webhooks (developer notifications) =====

CREATE TABLE public.webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by_actor_id uuid REFERENCES public.actors(id) ON DELETE SET NULL,
  url text NOT NULL CHECK (url ~ '^https://'),
  description text NOT NULL DEFAULT '',
  secret_hash text NOT NULL,
  secret_encrypted_payload text NOT NULL,
  secret_initialization_vector text NOT NULL,
  events text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  last_delivered_at timestamptz,
  last_status_code integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_endpoints_workspace_idx ON public.webhook_endpoints (workspace_id);

CREATE TABLE public.webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  endpoint_id uuid NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  event text NOT NULL,
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'delivered', 'retry_wait', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_status_code integer,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_deliveries_endpoint_idx ON public.webhook_deliveries (endpoint_id, created_at DESC);
CREATE INDEX webhook_deliveries_due_idx ON public.webhook_deliveries (state, next_attempt_at);

-- ===== Audit log (US-008) =====

CREATE TABLE public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.actors(id) ON DELETE SET NULL,
  entry_point text NOT NULL CHECK (entry_point IN ('ui', 'api', 'mcp', 'worker', 'system')),
  event_type text NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN (
    'workspace', 'account', 'post', 'destination', 'approval', 'publish_job',
    'media', 'api_key', 'oauth_grant', 'webhook', 'rule')),
  entity_id uuid,
  summary text NOT NULL,
  before_values jsonb,
  after_values jsonb,
  metadata jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_workspace_time_idx ON public.audit_events (workspace_id, occurred_at DESC);
CREATE INDEX audit_events_actor_time_idx ON public.audit_events (actor_id, occurred_at DESC);
CREATE INDEX audit_events_entity_idx ON public.audit_events (entity_type, entity_id);

-- The audit log is append-only, even for the server.
CREATE OR REPLACE FUNCTION public.prevent_audit_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;

-- ===== Usage metering and plan limits (US-010) =====

CREATE TABLE public.plans (
  id text PRIMARY KEY,
  name text NOT NULL,
  max_connected_accounts integer NOT NULL CHECK (max_connected_accounts >= 0),
  max_posts_per_month integer NOT NULL CHECK (max_posts_per_month >= 0),
  max_media_storage_bytes bigint NOT NULL CHECK (max_media_storage_bytes >= 0),
  max_api_calls_per_day integer NOT NULL CHECK (max_api_calls_per_day >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.plans
  (id, name, max_connected_accounts, max_posts_per_month, max_media_storage_bytes, max_api_calls_per_day)
VALUES
  ('tester', 'Tester', 50, 3000, 107374182400, 50000);

CREATE TABLE public.workspace_plans (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan_id text NOT NULL REFERENCES public.plans(id),
  started_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.actors(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'post_published', 'media_stored_bytes', 'media_transferred_bytes', 'api_call', 'account_connected')),
  quantity bigint NOT NULL CHECK (quantity >= 0),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usage_events_workspace_type_time_idx ON public.usage_events (workspace_id, event_type, occurred_at);

-- Usage totals for a workspace in [period_start, period_end).
CREATE OR REPLACE FUNCTION public.workspace_usage(
  target_workspace uuid,
  period_start timestamptz DEFAULT date_trunc('month', now()),
  period_end timestamptz DEFAULT date_trunc('month', now()) + interval '1 month'
)
RETURNS TABLE (event_type text, quantity bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT u.event_type, sum(u.quantity)::bigint
  FROM public.usage_events u
  WHERE u.workspace_id = target_workspace
    AND u.occurred_at >= period_start
    AND u.occurred_at < period_end
    -- Callers that are not the server may only ask about their own workspaces.
    AND (auth.uid() IS NULL OR public.is_workspace_member(target_workspace))
  GROUP BY u.event_type;
$$;

-- The one place limits are checked. Raises a plain-language error when `adding` more of
-- `limit_name` would go over the workspace's plan. Workspaces without a plan use 'tester'.
CREATE OR REPLACE FUNCTION public.assert_within_limit(
  target_workspace uuid,
  limit_name text,
  adding bigint DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  plan public.plans%ROWTYPE;
  current_amount bigint;
  allowed bigint;
  label text;
BEGIN
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
      SELECT coalesce(sum(size_bytes), 0) INTO current_amount FROM public.media_assets
      WHERE workspace_id = target_workspace;
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

-- ===== Triggers =====

CREATE TRIGGER workspaces_updated_at BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER connected_accounts_updated_at BEFORE UPDATE ON public.connected_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER credentials_updated_at BEFORE UPDATE ON public.credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER posts_updated_at BEFORE UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER posts_status_transition BEFORE UPDATE OF status ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_post_transition();
CREATE TRIGGER destinations_updated_at BEFORE UPDATE ON public.destinations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER publish_jobs_updated_at BEFORE UPDATE ON public.publish_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER webhook_endpoints_updated_at BEFORE UPDATE ON public.webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER webhook_deliveries_updated_at BEFORE UPDATE ON public.webhook_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_changes();

-- ===== Access control =====

-- Start from nothing for app clients on every table, then grant back reads.
REVOKE ALL ON
  public.workspaces, public.workspace_members, public.api_keys, public.oauth_clients,
  public.oauth_grants, public.actors, public.connected_accounts, public.credentials,
  public.oauth_states, public.platform_rate_limits, public.data_deletion_requests,
  public.media_assets, public.posts, public.post_media, public.destinations,
  public.publish_jobs, public.approval_requests, public.approvals,
  public.webhook_endpoints, public.webhook_deliveries, public.audit_events,
  public.plans, public.workspace_plans, public.usage_events
FROM anon, authenticated;

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.actors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connected_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publish_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO authenticated;

-- Full-row reads for workspace members.
GRANT SELECT ON
  public.workspaces, public.workspace_members, public.actors, public.connected_accounts,
  public.media_assets, public.posts, public.post_media, public.destinations,
  public.publish_jobs, public.approval_requests, public.approvals,
  public.webhook_deliveries, public.audit_events, public.workspace_plans,
  public.usage_events, public.plans
TO authenticated;

-- Column-limited reads: never the key hash, refresh-token hash or webhook secret.
GRANT SELECT (id, workspace_id, created_by, name, key_prefix, mode, scopes,
  last_used_at, revoked_at, created_at) ON public.api_keys TO authenticated;
GRANT SELECT (id, workspace_id, user_id, oauth_client_id, label, scopes, expires_at,
  last_used_at, revoked_at, created_at) ON public.oauth_grants TO authenticated;
GRANT SELECT (id, workspace_id, created_by_actor_id, url, description, events, active,
  last_delivered_at, last_status_code, created_at, updated_at) ON public.webhook_endpoints TO authenticated;

CREATE POLICY workspaces_member_read ON public.workspaces
  FOR SELECT TO authenticated USING (public.is_workspace_member(id));

CREATE POLICY workspace_members_member_read ON public.workspace_members
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));

CREATE POLICY plans_read ON public.plans
  FOR SELECT TO authenticated USING (true);

CREATE POLICY api_keys_member_read ON public.api_keys
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY oauth_grants_member_read ON public.oauth_grants
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY actors_member_read ON public.actors
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY connected_accounts_member_read ON public.connected_accounts
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY media_assets_member_read ON public.media_assets
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY posts_member_read ON public.posts
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY post_media_member_read ON public.post_media
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY destinations_member_read ON public.destinations
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY publish_jobs_member_read ON public.publish_jobs
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY approval_requests_member_read ON public.approval_requests
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY approvals_member_read ON public.approvals
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY webhook_endpoints_member_read ON public.webhook_endpoints
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY webhook_deliveries_member_read ON public.webhook_deliveries
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY audit_events_member_read ON public.audit_events
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY workspace_plans_member_read ON public.workspace_plans
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY usage_events_member_read ON public.usage_events
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));

-- credentials, oauth_clients, oauth_states, platform_rate_limits and
-- data_deletion_requests have RLS on, no policies and no grants: server-only.

REVOKE ALL ON FUNCTION public.is_workspace_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.workspace_usage(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.workspace_usage(uuid, timestamptz, timestamptz) TO authenticated;
REVOKE ALL ON FUNCTION public.assert_within_limit(uuid, text, bigint) FROM PUBLIC;
