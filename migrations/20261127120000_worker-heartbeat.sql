-- The worker's heartbeat: one row whose time the worker moves forward every half minute
-- while its job loop is alive. On AWS the worker has no address anyone can call, so the
-- uptime check asks the API instead, and the API reads this row (/readyz/worker).
-- Server-only.

CREATE TABLE public.worker_heartbeat (
  -- Always true: the table holds one row.
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  beat_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.worker_heartbeat ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.worker_heartbeat FROM PUBLIC, anon, authenticated;
