-- Automation changes are audited like everything else (backend/lib/inbox/automations.ts).
ALTER TABLE public.audit_events DROP CONSTRAINT audit_events_entity_type_check;
ALTER TABLE public.audit_events ADD CONSTRAINT audit_events_entity_type_check CHECK (entity_type IN (
  'workspace', 'account', 'post', 'destination', 'approval', 'publish_job',
  'media', 'api_key', 'oauth_grant', 'webhook', 'rule', 'profile', 'automation'));
