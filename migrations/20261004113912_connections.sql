-- Social account connections (Phase 3): where to send people after sign-in, safe token
-- refresh by several workers, disconnecting, and Meta data-deletion requests.

-- Where the person returns after the platform's sign-in (checked against allowed origins
-- before it is stored).
ALTER TABLE public.oauth_states ADD COLUMN return_to text;

-- A worker takes a short lease on a credential before refreshing it, so two workers never
-- refresh the same token at once (some platforms invalidate the old refresh token).
ALTER TABLE public.credentials ADD COLUMN refresh_lease_until timestamptz;

-- Hands up to max_rows credentials that expire within `within` to a worker, leased for
-- lease_seconds. Disconnected accounts are skipped.
CREATE OR REPLACE FUNCTION public.claim_credentials_to_refresh(within interval, lease_seconds integer DEFAULT 300, max_rows integer DEFAULT 20)
RETURNS SETOF public.credentials
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  UPDATE public.credentials c
  SET refresh_lease_until = now() + make_interval(secs => lease_seconds)
  WHERE c.id IN (
    SELECT cr.id
    FROM public.credentials cr
    JOIN public.connected_accounts a ON a.id = cr.connected_account_id
    WHERE a.health <> 'disconnected'
      AND cr.access_token_expires_at IS NOT NULL
      AND cr.access_token_expires_at < now() + within
      AND (cr.refresh_lease_until IS NULL OR cr.refresh_lease_until < now())
    ORDER BY cr.access_token_expires_at
    LIMIT max_rows
    FOR UPDATE OF cr SKIP LOCKED
  )
  RETURNING c.*;
$$;

-- Disconnects one account: deletes its stored tokens, marks it disconnected, cancels its
-- unpublished destinations and their jobs, and cancels posts left with nothing to publish.
-- The caller revokes the token at the platform first (it needs the token to do so).
CREATE OR REPLACE FUNCTION public.disconnect_account(target_account uuid, reason text)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  cancelled integer;
BEGIN
  DELETE FROM public.credentials WHERE connected_account_id = target_account;

  UPDATE public.connected_accounts
  SET health = 'disconnected', health_reason = reason, disconnected_at = now()
  WHERE id = target_account;

  WITH open_destinations AS (
    UPDATE public.destinations
    SET status = 'cancelled', error_message = reason
    WHERE connected_account_id = target_account
      AND status IN ('draft', 'awaiting_approval', 'approved', 'scheduled', 'queued')
    RETURNING id, post_id
  ), jobs AS (
    UPDATE public.publish_jobs SET state = 'cancelled'
    WHERE destination_id IN (SELECT id FROM open_destinations)
      AND state IN ('queued', 'retry_wait')
  ), emptied_posts AS (
    UPDATE public.posts p SET status = 'cancelled'
    WHERE p.id IN (SELECT post_id FROM open_destinations)
      AND p.status IN ('draft', 'awaiting_approval', 'approved', 'scheduled')
      AND NOT EXISTS (
        SELECT 1 FROM public.destinations d
        WHERE d.post_id = p.id AND d.status <> 'cancelled'
          AND d.id NOT IN (SELECT id FROM open_destinations)
      )
  )
  SELECT count(*) INTO cancelled FROM open_destinations;
  RETURN cancelled;
END;
$$;

-- Meta data-deletion callback: removes every account owned by that Meta user (Facebook
-- Pages they connected, their Instagram and Threads accounts), the posts that only went
-- to those accounts, and records a receipt. Returns how many accounts were removed.
CREATE OR REPLACE FUNCTION public.meta_delete_user_data(external_user_id text, external_user_hash text, receipt_code text)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  removed integer;
  account_ids uuid[];
  post_ids uuid[];
BEGIN
  SELECT coalesce(array_agg(id), '{}') INTO account_ids
  FROM public.connected_accounts
  WHERE platform IN ('facebook', 'instagram', 'threads')
    AND (owner_external_id = external_user_id OR external_account_id = external_user_id);

  SELECT coalesce(array_agg(DISTINCT post_id), '{}') INTO post_ids
  FROM public.destinations WHERE connected_account_id = ANY (account_ids);

  DELETE FROM public.destinations WHERE connected_account_id = ANY (account_ids);
  DELETE FROM public.connected_accounts WHERE id = ANY (account_ids);
  -- Posts that no longer go anywhere carry that person's content; remove them too.
  DELETE FROM public.posts p
  WHERE p.id = ANY (post_ids)
    AND NOT EXISTS (SELECT 1 FROM public.destinations d WHERE d.post_id = p.id);

  removed := cardinality(account_ids);
  INSERT INTO public.data_deletion_requests (provider, confirmation_code, external_user_hash, status, removed_accounts, completed_at)
  VALUES ('meta', receipt_code, external_user_hash, 'completed', removed, now());
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_credentials_to_refresh(interval, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.disconnect_account(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.meta_delete_user_data(text, text, text) FROM PUBLIC, anon, authenticated;
