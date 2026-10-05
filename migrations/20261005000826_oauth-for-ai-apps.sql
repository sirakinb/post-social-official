-- Phase 5B: OAuth 2.1 sign-in for AI apps (ChatGPT, the Claude app, Cursor...). An app
-- registers itself, the person approves it for one workspace, and the app gets short-lived
-- access tokens plus a rotating refresh token. Only hashes of codes and tokens are stored.
-- All server-only.

-- One-time authorization codes (10 minutes, single use, PKCE S256 required).
CREATE TABLE public.oauth_codes (
  code_hash text PRIMARY KEY,
  oauth_client_id uuid NOT NULL REFERENCES public.oauth_clients(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  resource text,
  scopes text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_codes_expires_idx ON public.oauth_codes (expires_at);

-- Access tokens (1 hour). Revoking the grant removes them.
CREATE TABLE public.oauth_access_tokens (
  token_hash text PRIMARY KEY,
  oauth_grant_id uuid NOT NULL REFERENCES public.oauth_grants(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_access_tokens_grant_idx ON public.oauth_access_tokens (oauth_grant_id);
CREATE INDEX oauth_access_tokens_expires_idx ON public.oauth_access_tokens (expires_at);

-- Refresh tokens rotate on every use. Presenting the previous one again means it leaked,
-- so the whole grant is revoked (after a short grace period for an app that sent two
-- refreshes at once).
ALTER TABLE public.oauth_grants
  ADD COLUMN previous_refresh_token_hash text,
  ADD COLUMN refresh_rotated_at timestamptz,
  ADD COLUMN refresh_expires_at timestamptz;
CREATE INDEX oauth_grants_previous_refresh_idx ON public.oauth_grants (previous_refresh_token_hash);

-- Registered apps: when they registered, so abandoned registrations can be cleaned up.
ALTER TABLE public.oauth_clients
  ADD COLUMN client_uri text,
  ADD COLUMN last_used_at timestamptz;

-- Repeat-safe writes now work for any AI identity (API key or signed-in app), so they are
-- keyed by actor instead of by API key.
DELETE FROM public.api_idempotency;
ALTER TABLE public.api_idempotency DROP CONSTRAINT api_idempotency_pkey;
ALTER TABLE public.api_idempotency DROP COLUMN api_key_id;
ALTER TABLE public.api_idempotency ADD COLUMN actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE CASCADE;
ALTER TABLE public.api_idempotency ADD PRIMARY KEY (actor_id, idempotency_key);

ALTER TABLE public.oauth_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_access_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.oauth_codes, public.oauth_access_tokens FROM PUBLIC, anon, authenticated;
