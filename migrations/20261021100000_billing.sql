-- Billing: one Stripe customer and subscription per workspace. The subscription holds one
-- item, "Post Social accounts", whose quantity is the workspace's connected accounts; the
-- price is graduated (first 2 free, $5, $2.50, $1) and Stripe prorates quantity changes by
-- the day. While the subscription is active the workspace is on the Paid plan; without
-- one it is on Free (2 accounts). X posts are added to each invoice separately.
-- Server-only: the web app reads it through the api function.

CREATE TABLE public.workspace_billing (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  stripe_customer_id text UNIQUE,
  stripe_subscription_id text UNIQUE,
  subscription_status text,
  billed_quantity integer CHECK (billed_quantity >= 0),
  x_monthly_cap_cents integer NOT NULL DEFAULT 1000 CHECK (x_monthly_cap_cents BETWEEN 0 AND 1000000),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_billing ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_billing FROM PUBLIC, anon, authenticated;

-- Moves a workspace between Free and Paid as its subscription changes. Tester (and any
-- other comped plan set by hand) is left alone, as is a workspace with no plan row
-- (treated as Tester).
CREATE OR REPLACE FUNCTION public.set_billing_plan(target_workspace uuid, paid boolean)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  UPDATE public.workspace_plans
  SET plan_id = CASE WHEN paid THEN 'paid' ELSE 'free' END, started_at = now()
  WHERE workspace_id = target_workspace
    AND plan_id IN ('free', 'paid')
    AND plan_id <> CASE WHEN paid THEN 'paid' ELSE 'free' END;
$$;

REVOKE ALL ON FUNCTION public.set_billing_plan(uuid, boolean) FROM PUBLIC, anon, authenticated;

-- X posts: X bills Post Social for every post, so each one is charged to the workspace
-- (2 cents, 25 with a link) against a monthly cap the workspace sets. One row per
-- destination, so a retried post is never charged twice. The first $1 each month is free;
-- a workspace without a card can't go past it.
CREATE TABLE public.x_charges (
  destination_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  cents integer NOT NULL CHECK (cents >= 0),
  with_link boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX x_charges_workspace_month ON public.x_charges (workspace_id, created_at);
ALTER TABLE public.x_charges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.x_charges FROM PUBLIC, anon, authenticated;

-- What each Stripe invoice already billed for a month's X posts, so a month split across
-- two invoices gets its free $1 once.
CREATE TABLE public.x_invoice_lines (
  stripe_invoice_id text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  month date NOT NULL,
  cents integer NOT NULL CHECK (cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (stripe_invoice_id, month)
);
CREATE INDEX x_invoice_lines_workspace ON public.x_invoice_lines (workspace_id, month);
ALTER TABLE public.x_invoice_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.x_invoice_lines FROM PUBLIC, anon, authenticated;

-- Reserves one X post's charge before it is sent. Returns 'ok', or 'over_cap' when it
-- would pass this month's cap (UTC months). Comped plans (Tester) are recorded but never
-- capped. Free workspaces, and Paid ones whose card stopped working, stop at the free $1.
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
  SELECT coalesce(b.x_monthly_cap_cents, 1000), coalesce(b.subscription_status IN ('active', 'trialing', 'past_due'), false)
    INTO cap, billable
    FROM (SELECT 1) one LEFT JOIN public.workspace_billing b ON b.workspace_id = target_workspace;
  IF plan IN ('free', 'paid') THEN
    IF NOT (plan = 'paid' AND billable) THEN
      cap := least(cap, free_cents);
    END IF;
    SELECT coalesce(sum(cents), 0) INTO used FROM public.x_charges
      WHERE workspace_id = target_workspace AND created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    IF used + charge_cents > cap THEN
      RETURN 'over_cap';
    END IF;
  END IF;
  INSERT INTO public.x_charges (destination_id, workspace_id, cents, with_link) VALUES (target_destination, target_workspace, charge_cents, has_link);
  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_x_charge(uuid, uuid, integer, boolean, integer) FROM PUBLIC, anon, authenticated;
