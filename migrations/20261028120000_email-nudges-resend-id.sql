-- The id Resend gave each nudge email, so a delivery can be looked up in Resend exactly
-- (backend/lib/nudges.ts records it after sending). Empty for emails sent before this.

ALTER TABLE public.email_nudges ADD COLUMN resend_id text;
