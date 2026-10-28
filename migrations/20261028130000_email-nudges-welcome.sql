-- Two more emails from Aki (backend/lib/nudges.ts): a welcome once the email is confirmed, and a
-- note a week after sign-up. Only the list of allowed kinds changes; no rows are touched.

ALTER TABLE public.email_nudges DROP CONSTRAINT email_nudges_kind_check;
ALTER TABLE public.email_nudges ADD CONSTRAINT email_nudges_kind_check
  CHECK (kind IN ('welcome', 'no_account', 'no_ai', 'first_post_live', 'week_one'));
