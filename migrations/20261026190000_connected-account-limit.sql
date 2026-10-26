-- The plan's connected-account limit, enforced when an account is connected. Until now
-- nothing called assert_within_limit for accounts, so a Free workspace could connect a
-- third account without adding a card. The connect code already turns the refusal into
-- "Your first 2 accounts are free. To connect more, add a card..." (accountLimitMessage).
--
-- Counted: a new account, and a disconnected one coming back. Not counted: reconnecting an
-- account that is still connected, which the connect code does with INSERT ... ON CONFLICT
-- (so this BEFORE INSERT trigger fires for it too). Workspaces already over their limit keep
-- their accounts; they just can't add more.

CREATE OR REPLACE FUNCTION public.enforce_connected_account_limit()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.health = 'disconnected' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- The same account already has a row: ON CONFLICT turns this into an update, checked below.
    IF EXISTS (
      SELECT 1 FROM public.connected_accounts c
      WHERE c.workspace_id = NEW.workspace_id AND c.platform = NEW.platform AND c.external_account_id = NEW.external_account_id
    ) THEN
      RETURN NEW;
    END IF;
  ELSIF OLD.health <> 'disconnected' THEN
    RETURN NEW;
  END IF;
  PERFORM public.assert_within_limit(NEW.workspace_id, 'connected_accounts', 1);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_connected_account_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS connected_accounts_within_limit ON public.connected_accounts;
CREATE TRIGGER connected_accounts_within_limit
  BEFORE INSERT OR UPDATE OF health ON public.connected_accounts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_connected_account_limit();
