-- Phase 5A: repeat-safe API writes. A write sent with an Idempotency-Key is recorded with
-- the hash of its request and, once finished, its response; repeating it within 24 hours
-- returns the stored response instead of acting twice. Server-only.
CREATE TABLE public.api_idempotency (
  api_key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 255),
  request_hash text NOT NULL,
  status_code integer, -- NULL while the first request is still running
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (api_key_id, idempotency_key)
);
CREATE INDEX api_idempotency_created_idx ON public.api_idempotency (created_at);

ALTER TABLE public.api_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_idempotency FROM PUBLIC, anon, authenticated;
