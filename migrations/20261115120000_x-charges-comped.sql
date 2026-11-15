-- X posts on comped plans (Tester) aren't billed: they're recorded at 0 cents, so they still
-- count as posts but no invoice can ever pick them up (for example if a Tester workspace is
-- later moved to Free or Paid). Free and Paid are unchanged from 20261021100000_billing.sql:
-- without a working card, nothing past the free allowance (none today), so X needs a card.
CREATE OR REPLACE FUNCTION public.reserve_x_charge(target_destination uuid, target_workspace uuid, charge_cents integer, has_link boolean, free_cents integer)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  plan text;
  cap integer;
  billable boolean;
  used integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('x_charges:' || target_workspace::text, 0));
  IF EXISTS (SELECT 1 FROM public.x_charges WHERE destination_id = target_destination) THEN
    RETURN 'ok';
  END IF;
  SELECT coalesce((SELECT plan_id FROM public.workspace_plans WHERE workspace_id = target_workspace), 'tester') INTO plan;
  IF plan NOT IN ('free', 'paid') THEN
    INSERT INTO public.x_charges (destination_id, workspace_id, cents, with_link) VALUES (target_destination, target_workspace, 0, has_link);
    RETURN 'ok';
  END IF;
  SELECT coalesce(b.x_monthly_cap_cents, 1000), coalesce(b.subscription_status IN ('active', 'trialing', 'past_due'), false)
    INTO cap, billable
    FROM (SELECT 1) one LEFT JOIN public.workspace_billing b ON b.workspace_id = target_workspace;
  IF NOT (plan = 'paid' AND billable) THEN
    cap := least(cap, free_cents);
  END IF;
  SELECT coalesce(sum(cents), 0) INTO used FROM public.x_charges
    WHERE workspace_id = target_workspace AND created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  IF used + charge_cents > cap THEN
    RETURN 'over_cap';
  END IF;
  INSERT INTO public.x_charges (destination_id, workspace_id, cents, with_link) VALUES (target_destination, target_workspace, charge_cents, has_link);
  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_x_charge(uuid, uuid, integer, boolean, integer) FROM PUBLIC, anon, authenticated;
