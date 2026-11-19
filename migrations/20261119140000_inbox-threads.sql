-- Threads in the inbox: its replies are kept as comments, and its automations answer with a
-- public reply only (Threads has no DMs), so an automation's DM may be empty there.
ALTER TABLE public.inbox_webhook_events DROP CONSTRAINT inbox_webhook_events_platform_check;
ALTER TABLE public.inbox_webhook_events ADD CONSTRAINT inbox_webhook_events_platform_check CHECK (platform IN ('instagram', 'facebook', 'threads'));

ALTER TABLE public.contacts DROP CONSTRAINT contacts_platform_check;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_platform_check CHECK (platform IN ('instagram', 'facebook', 'threads'));

ALTER TABLE public.comment_automations DROP CONSTRAINT comment_automations_dm_message_check;
ALTER TABLE public.comment_automations ADD CONSTRAINT comment_automations_dm_message_check CHECK (char_length(dm_message) <= 640);
