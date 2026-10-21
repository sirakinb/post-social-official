-- Open sign-up: anyone can create an account, and their first visit to the app creates a
-- workspace for them on the Free plan. Free covers 2 connected accounts; adding a card
-- moves the workspace to Paid, billed per account (Stripe, added separately). Workspaces
-- made by the admin account script stay on Tester.

INSERT INTO public.plans
  (id, name, max_connected_accounts, max_posts_per_month, max_media_storage_bytes, max_api_calls_per_day)
VALUES
  ('free', 'Free', 2, 3000, 5368709120, 5000),
  ('paid', 'Paid', 2000, 3000, 107374182400, 50000)
ON CONFLICT (id) DO NOTHING;

-- Creates the person's own workspace on the Free plan, unless they already belong to one.
-- One call per person at a time (advisory lock), so two tabs opening the app at once
-- cannot create two workspaces. Returns the workspace they should land in.
CREATE OR REPLACE FUNCTION public.provision_owner_workspace(
  target_user uuid,
  workspace_name text,
  workspace_slug text,
  display_name text,
  summary text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  existing uuid;
  created uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('provision:' || target_user::text, 0));

  SELECT m.workspace_id INTO existing
  FROM public.workspace_members m
  WHERE m.user_id = target_user
  ORDER BY m.created_at
  LIMIT 1;
  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;

  INSERT INTO public.workspaces (name, slug, created_by) VALUES (workspace_name, workspace_slug, target_user)
  RETURNING id INTO created;
  INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (created, target_user, 'owner');
  INSERT INTO public.actors (workspace_id, kind, user_id, display_name) VALUES (created, 'user', target_user, display_name);
  INSERT INTO public.workspace_plans (workspace_id, plan_id) VALUES (created, 'free');
  INSERT INTO public.audit_events (workspace_id, entry_point, event_type, entity_type, entity_id, summary)
  VALUES (created, 'system', 'workspace.created', 'workspace', created, summary);
  RETURN created;
END;
$$;

REVOKE ALL ON FUNCTION public.provision_owner_workspace(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
