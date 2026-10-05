-- Phase 5C-1: usage that can be broken down by social account and by AI connection, for
-- testing pricing models; and keys that end when the person who made them leaves.

-- Which account (and platform) a usage event was for, when it was for one.
ALTER TABLE public.usage_events
  ADD COLUMN connected_account_id uuid REFERENCES public.connected_accounts(id) ON DELETE SET NULL,
  ADD COLUMN platform text CHECK (platform IN ('tiktok', 'instagram', 'facebook', 'threads', 'youtube', 'linkedin', 'x', 'bluesky'));
CREATE INDEX usage_events_workspace_time_idx ON public.usage_events (workspace_id, occurred_at);
CREATE INDEX usage_events_actor_time_idx ON public.usage_events (actor_id, occurred_at);

-- Fill in the account for posts already published (their destination is in the audit log).
UPDATE public.usage_events u
SET connected_account_id = d.connected_account_id, platform = d.platform, actor_id = coalesce(u.actor_id, d.actor_id)
FROM public.audit_events e
JOIN public.destinations d ON d.id = e.entity_id
WHERE u.event_type = 'post_published' AND u.connected_account_id IS NULL
  AND e.event_type = 'destination.published' AND e.workspace_id = u.workspace_id
  AND e.occurred_at BETWEEN u.occurred_at - interval '1 second' AND u.occurred_at + interval '1 second';

-- API keys made by someone end when that person leaves the workspace or stops being an
-- owner or admin (only owners and admins may hold keys). Apps they signed in to stop
-- working on their own (each call checks membership); they are marked revoked too.
CREATE OR REPLACE FUNCTION public.revoke_departed_member_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.role NOT IN ('owner', 'admin') THEN
    UPDATE public.api_keys SET revoked_at = now()
    WHERE workspace_id = OLD.workspace_id AND created_by = OLD.user_id AND revoked_at IS NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    UPDATE public.oauth_grants SET revoked_at = now(), refresh_token_hash = NULL
    WHERE workspace_id = OLD.workspace_id AND user_id = OLD.user_id AND revoked_at IS NULL;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER workspace_members_revoke_access
  AFTER DELETE OR UPDATE OF role ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.revoke_departed_member_access();

REVOKE ALL ON FUNCTION public.revoke_departed_member_access() FROM PUBLIC, anon, authenticated;
