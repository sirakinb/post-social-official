-- Workspace integrity fixes from review:
-- 1. Every reference between workspace-scoped rows must stay inside one workspace.
--    Parents get UNIQUE (id, workspace_id) and children reference both columns.
-- 2. Deleting a workspace must never depend on the order child rows are removed:
--    references that used ON DELETE RESTRICT now use NO ACTION (checked at the end of
--    the statement), so a cascade can remove both sides.
-- 3. Actors must point at a real identity when created, and can never be re-pointed.
-- 4. Plan-limit checks take a per-workspace lock so concurrent writes cannot both pass.

-- ===== 1 and 2: same-workspace references =====

ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_id_workspace_key UNIQUE (id, workspace_id);
ALTER TABLE public.oauth_grants ADD CONSTRAINT oauth_grants_id_workspace_key UNIQUE (id, workspace_id);
ALTER TABLE public.actors ADD CONSTRAINT actors_id_workspace_key UNIQUE (id, workspace_id);
ALTER TABLE public.connected_accounts ADD CONSTRAINT connected_accounts_id_workspace_key UNIQUE (id, workspace_id);
ALTER TABLE public.media_assets ADD CONSTRAINT media_assets_id_workspace_key UNIQUE (id, workspace_id);
ALTER TABLE public.posts ADD CONSTRAINT posts_id_workspace_key UNIQUE (id, workspace_id);
ALTER TABLE public.destinations ADD CONSTRAINT destinations_id_workspace_key UNIQUE (id, workspace_id);
ALTER TABLE public.approval_requests ADD CONSTRAINT approval_requests_id_workspace_key UNIQUE (id, workspace_id);
ALTER TABLE public.webhook_endpoints ADD CONSTRAINT webhook_endpoints_id_workspace_key UNIQUE (id, workspace_id);

-- actors -> api_keys, oauth_grants
ALTER TABLE public.actors
  DROP CONSTRAINT actors_api_key_id_fkey,
  ADD CONSTRAINT actors_api_key_id_fkey FOREIGN KEY (api_key_id, workspace_id)
    REFERENCES public.api_keys (id, workspace_id) ON DELETE SET NULL (api_key_id),
  DROP CONSTRAINT actors_oauth_grant_id_fkey,
  ADD CONSTRAINT actors_oauth_grant_id_fkey FOREIGN KEY (oauth_grant_id, workspace_id)
    REFERENCES public.oauth_grants (id, workspace_id) ON DELETE SET NULL (oauth_grant_id);

-- connected_accounts -> actors
ALTER TABLE public.connected_accounts
  DROP CONSTRAINT connected_accounts_connected_by_actor_id_fkey,
  ADD CONSTRAINT connected_accounts_connected_by_actor_id_fkey FOREIGN KEY (connected_by_actor_id, workspace_id)
    REFERENCES public.actors (id, workspace_id) ON DELETE SET NULL (connected_by_actor_id);

-- credentials, platform_rate_limits -> connected_accounts
ALTER TABLE public.credentials
  DROP CONSTRAINT credentials_connected_account_id_fkey,
  ADD CONSTRAINT credentials_connected_account_id_fkey FOREIGN KEY (connected_account_id, workspace_id)
    REFERENCES public.connected_accounts (id, workspace_id) ON DELETE CASCADE;
ALTER TABLE public.platform_rate_limits
  DROP CONSTRAINT platform_rate_limits_connected_account_id_fkey,
  ADD CONSTRAINT platform_rate_limits_connected_account_id_fkey FOREIGN KEY (connected_account_id, workspace_id)
    REFERENCES public.connected_accounts (id, workspace_id) ON DELETE CASCADE;

-- media_assets, posts -> actors
ALTER TABLE public.media_assets
  DROP CONSTRAINT media_assets_uploaded_by_actor_id_fkey,
  ADD CONSTRAINT media_assets_uploaded_by_actor_id_fkey FOREIGN KEY (uploaded_by_actor_id, workspace_id)
    REFERENCES public.actors (id, workspace_id) ON DELETE SET NULL (uploaded_by_actor_id);
ALTER TABLE public.posts
  DROP CONSTRAINT posts_actor_id_fkey,
  ADD CONSTRAINT posts_actor_id_fkey FOREIGN KEY (actor_id, workspace_id)
    REFERENCES public.actors (id, workspace_id) ON DELETE SET NULL (actor_id);

-- post_media -> posts, media_assets (media in use cannot be deleted on its own)
ALTER TABLE public.post_media
  DROP CONSTRAINT post_media_post_id_fkey,
  ADD CONSTRAINT post_media_post_id_fkey FOREIGN KEY (post_id, workspace_id)
    REFERENCES public.posts (id, workspace_id) ON DELETE CASCADE,
  DROP CONSTRAINT post_media_media_asset_id_fkey,
  ADD CONSTRAINT post_media_media_asset_id_fkey FOREIGN KEY (media_asset_id, workspace_id)
    REFERENCES public.media_assets (id, workspace_id);

-- destinations -> posts, connected_accounts (accounts with posts cannot be deleted on
-- their own; they are marked disconnected instead), actors
ALTER TABLE public.destinations
  DROP CONSTRAINT destinations_post_id_fkey,
  ADD CONSTRAINT destinations_post_id_fkey FOREIGN KEY (post_id, workspace_id)
    REFERENCES public.posts (id, workspace_id) ON DELETE CASCADE,
  DROP CONSTRAINT destinations_connected_account_id_fkey,
  ADD CONSTRAINT destinations_connected_account_id_fkey FOREIGN KEY (connected_account_id, workspace_id)
    REFERENCES public.connected_accounts (id, workspace_id),
  DROP CONSTRAINT destinations_actor_id_fkey,
  ADD CONSTRAINT destinations_actor_id_fkey FOREIGN KEY (actor_id, workspace_id)
    REFERENCES public.actors (id, workspace_id) ON DELETE SET NULL (actor_id);

-- publish_jobs -> posts, destinations
ALTER TABLE public.publish_jobs
  DROP CONSTRAINT publish_jobs_post_id_fkey,
  ADD CONSTRAINT publish_jobs_post_id_fkey FOREIGN KEY (post_id, workspace_id)
    REFERENCES public.posts (id, workspace_id) ON DELETE CASCADE,
  DROP CONSTRAINT publish_jobs_destination_id_fkey,
  ADD CONSTRAINT publish_jobs_destination_id_fkey FOREIGN KEY (destination_id, workspace_id)
    REFERENCES public.destinations (id, workspace_id) ON DELETE CASCADE;

-- approval_requests -> posts, actors
ALTER TABLE public.approval_requests
  DROP CONSTRAINT approval_requests_post_id_fkey,
  ADD CONSTRAINT approval_requests_post_id_fkey FOREIGN KEY (post_id, workspace_id)
    REFERENCES public.posts (id, workspace_id) ON DELETE CASCADE,
  DROP CONSTRAINT approval_requests_requested_by_actor_id_fkey,
  ADD CONSTRAINT approval_requests_requested_by_actor_id_fkey FOREIGN KEY (requested_by_actor_id, workspace_id)
    REFERENCES public.actors (id, workspace_id) ON DELETE SET NULL (requested_by_actor_id);

-- approvals -> posts, approval_requests, actors
ALTER TABLE public.approvals
  DROP CONSTRAINT approvals_post_id_fkey,
  ADD CONSTRAINT approvals_post_id_fkey FOREIGN KEY (post_id, workspace_id)
    REFERENCES public.posts (id, workspace_id) ON DELETE CASCADE,
  DROP CONSTRAINT approvals_approval_request_id_fkey,
  ADD CONSTRAINT approvals_approval_request_id_fkey FOREIGN KEY (approval_request_id, workspace_id)
    REFERENCES public.approval_requests (id, workspace_id) ON DELETE CASCADE,
  DROP CONSTRAINT approvals_actor_id_fkey,
  ADD CONSTRAINT approvals_actor_id_fkey FOREIGN KEY (actor_id, workspace_id)
    REFERENCES public.actors (id, workspace_id) ON DELETE SET NULL (actor_id);

-- webhook_endpoints -> actors; webhook_deliveries -> webhook_endpoints
ALTER TABLE public.webhook_endpoints
  DROP CONSTRAINT webhook_endpoints_created_by_actor_id_fkey,
  ADD CONSTRAINT webhook_endpoints_created_by_actor_id_fkey FOREIGN KEY (created_by_actor_id, workspace_id)
    REFERENCES public.actors (id, workspace_id) ON DELETE SET NULL (created_by_actor_id);
ALTER TABLE public.webhook_deliveries
  DROP CONSTRAINT webhook_deliveries_endpoint_id_fkey,
  ADD CONSTRAINT webhook_deliveries_endpoint_id_fkey FOREIGN KEY (endpoint_id, workspace_id)
    REFERENCES public.webhook_endpoints (id, workspace_id) ON DELETE CASCADE;

-- audit_events, usage_events -> actors
ALTER TABLE public.audit_events
  DROP CONSTRAINT audit_events_actor_id_fkey,
  ADD CONSTRAINT audit_events_actor_id_fkey FOREIGN KEY (actor_id, workspace_id)
    REFERENCES public.actors (id, workspace_id);
ALTER TABLE public.usage_events
  DROP CONSTRAINT usage_events_actor_id_fkey,
  ADD CONSTRAINT usage_events_actor_id_fkey FOREIGN KEY (actor_id, workspace_id)
    REFERENCES public.actors (id, workspace_id) ON DELETE SET NULL (actor_id);

-- ===== 3: actor identities =====

-- The person who authorized an AI app is recorded on the grant, not the actor.
ALTER TABLE public.actors
  ADD CONSTRAINT actors_oauth_grant_has_no_user CHECK (kind <> 'oauth_grant' OR user_id IS NULL);

CREATE OR REPLACE FUNCTION public.validate_actor_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (NEW.kind = 'user' AND NEW.user_id IS NULL)
       OR (NEW.kind = 'api_key' AND NEW.api_key_id IS NULL)
       OR (NEW.kind = 'oauth_grant' AND NEW.oauth_grant_id IS NULL) THEN
      RAISE EXCEPTION 'A % actor must point at its %', NEW.kind,
        CASE NEW.kind WHEN 'user' THEN 'user' WHEN 'api_key' THEN 'API key' ELSE 'OAuth grant' END
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- Updates may only clear an identity (its key, grant or user was deleted).
  IF NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR (NEW.user_id IS DISTINCT FROM OLD.user_id AND NEW.user_id IS NOT NULL)
     OR (NEW.api_key_id IS DISTINCT FROM OLD.api_key_id AND NEW.api_key_id IS NOT NULL)
     OR (NEW.oauth_grant_id IS DISTINCT FROM OLD.oauth_grant_id AND NEW.oauth_grant_id IS NOT NULL) THEN
    RAISE EXCEPTION 'An actor cannot be re-pointed at a different identity'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER actors_validate_identity BEFORE INSERT OR UPDATE ON public.actors
  FOR EACH ROW EXECUTE FUNCTION public.validate_actor_identity();

-- ===== 4: concurrency-safe limit checks =====

-- Same check as before, now VOLATILE and holding a transaction-scoped lock per workspace
-- and limit. Call it in the SAME transaction as the write it authorizes; a second caller
-- for the same workspace and limit then waits until the first commits, and sees its write.
CREATE OR REPLACE FUNCTION public.assert_within_limit(
  target_workspace uuid,
  limit_name text,
  adding bigint DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  plan public.plans%ROWTYPE;
  current_amount bigint;
  allowed bigint;
  label text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(target_workspace::text || ':' || limit_name, 0));

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

REVOKE ALL ON FUNCTION public.assert_within_limit(uuid, text, bigint) FROM PUBLIC;
