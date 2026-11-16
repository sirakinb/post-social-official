-- A sign-in waiting for the person to choose which accounts to connect.
--
-- A LinkedIn sign-in through the Community Management app brings the member's profile and
-- every Company Page they can post for. Accounts the workspace already has are reconnected
-- straight away; new ones are only connected once the person ticks them, because each
-- connected account is billed. Until then the sign-in waits here, its tokens encrypted the
-- same way as credentials. Server-only, single use, and gone after 15 minutes.
CREATE TABLE public.pending_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('linkedin')),
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  return_to text,
  -- What the person chooses from: external id, name, kind and picture. No tokens.
  choices jsonb NOT NULL,
  encrypted_payload text NOT NULL,
  initialization_vector text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pending_connections_workspace_idx ON public.pending_connections (workspace_id);
CREATE INDEX pending_connections_user_idx ON public.pending_connections (user_id);
CREATE INDEX pending_connections_profile_idx ON public.pending_connections (profile_id);
CREATE INDEX pending_connections_expires_idx ON public.pending_connections (expires_at);

REVOKE ALL ON public.pending_connections FROM anon, authenticated;
ALTER TABLE public.pending_connections ENABLE ROW LEVEL SECURITY;
