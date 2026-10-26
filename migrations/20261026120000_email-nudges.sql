-- Nudge emails for new customers (worker/src/nudges.ts, backend/lib/nudges.ts): one email per
-- person per kind, ever, and a way to say no to all of them.
-- Server-only: the worker sends and records them; the api function records unsubscribes.

CREATE TABLE public.email_nudges (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('no_account', 'no_ai', 'first_post_live')),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind)
);

ALTER TABLE public.email_nudges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_nudges FROM PUBLIC, anon, authenticated;

CREATE TABLE public.email_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nudges_off_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_preferences FROM PUBLIC, anon, authenticated;
