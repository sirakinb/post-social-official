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
