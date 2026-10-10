-- Profile pictures: platforms hand out signed picture links that expire within days, so
-- the worker saves its own copy in storage (avatar_key) and avatar_url then points at our
-- address (/api/avatars/<account id>/<version>). The copy is refreshed weekly
-- (avatar_synced_at); avatar_attempted_at keeps a failing account from being retried
-- more than every few hours.
ALTER TABLE public.connected_accounts
  ADD COLUMN avatar_key text,
  ADD COLUMN avatar_synced_at timestamptz,
  ADD COLUMN avatar_attempted_at timestamptz;

CREATE INDEX connected_accounts_avatar_due_idx ON public.connected_accounts (avatar_synced_at NULLS FIRST)
  WHERE health <> 'disconnected';
