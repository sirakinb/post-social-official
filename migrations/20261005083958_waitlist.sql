-- Phase 7: the landing page's waitlist. Written only by the `api` function (admin key);
-- app clients can neither read nor write it.
CREATE TABLE public.waitlist (
  email text PRIMARY KEY CHECK (length(email) BETWEEN 3 AND 254 AND email = lower(email) AND email LIKE '%_@_%'),
  source text CHECK (source IS NULL OR length(source) <= 64),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX waitlist_created_idx ON public.waitlist (created_at);

ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.waitlist FROM PUBLIC, anon, authenticated;
