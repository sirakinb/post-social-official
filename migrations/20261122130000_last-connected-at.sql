-- When each account last went through its platform's sign-in (PEN-11). A platform's new
-- permissions (Meta's Inbox and insights, TikTok's video.list) only reach accounts that sign
-- in after they're switched on, so the Accounts page asks older ones to reconnect once.
-- last_verified_at can't tell: token refreshes update it too.
ALTER TABLE public.connected_accounts ADD COLUMN last_connected_at timestamptz;

-- Existing accounts: their latest connect or reconnect in the audit log, else when added.
UPDATE public.connected_accounts a
SET last_connected_at = coalesce(
  (SELECT max(e.occurred_at) FROM public.audit_events e
   WHERE e.entity_type = 'account' AND e.entity_id = a.id AND e.event_type IN ('account.connected', 'account.reconnected')),
  a.created_at);
