-- Profiles: named groups of connected accounts (a business, an organisation, a client), so
-- people can organise and filter their accounts. An account sits in at most one profile;
-- accounts with no profile show as "No profile". Changes go through the connections
-- function (audited), so app clients only read.

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  description text CHECK (description IS NULL OR length(description) <= 280),
  color text NOT NULL DEFAULT '#9B6CFF' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  -- An IANA time zone (e.g. America/New_York), checked by the function before it is saved.
  timezone text CHECK (timezone IS NULL OR length(timezone) BETWEEN 1 AND 64),
  created_by_actor_id uuid REFERENCES public.actors(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Lets connected_accounts reference a profile in its own workspace only.
  UNIQUE (workspace_id, id)
);
CREATE UNIQUE INDEX profiles_workspace_name_idx ON public.profiles (workspace_id, lower(trim(name)));
CREATE INDEX profiles_created_by_actor_id_idx ON public.profiles (created_by_actor_id);
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- The composite key keeps an account and its profile in the same workspace. Deleting a
-- profile first moves its accounts to no profile (see the connections function).
ALTER TABLE public.connected_accounts ADD COLUMN profile_id uuid;
ALTER TABLE public.connected_accounts
  ADD CONSTRAINT connected_accounts_profile_fk FOREIGN KEY (workspace_id, profile_id)
  REFERENCES public.profiles (workspace_id, id);
CREATE INDEX connected_accounts_profile_idx ON public.connected_accounts (workspace_id, profile_id);

-- The profile a new connection goes into, chosen when the sign-in starts.
ALTER TABLE public.oauth_states ADD COLUMN profile_id uuid;

REVOKE ALL ON public.profiles FROM anon, authenticated;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.profiles TO authenticated;
CREATE POLICY profiles_member_read ON public.profiles
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));

-- Profile changes are audited like everything else.
ALTER TABLE public.audit_events DROP CONSTRAINT audit_events_entity_type_check;
ALTER TABLE public.audit_events ADD CONSTRAINT audit_events_entity_type_check CHECK (entity_type IN (
  'workspace', 'account', 'post', 'destination', 'approval', 'publish_job',
  'media', 'api_key', 'oauth_grant', 'webhook', 'rule', 'profile'));
