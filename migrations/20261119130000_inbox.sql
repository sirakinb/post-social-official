-- The inbox (backend/lib/inbox/inbox.ts, worker/src/inbox): Instagram DMs and comments in one
-- place, the people behind them (contacts), and replies queued for the worker to send.
-- Server-only, like the automations tables.

-- One person on one connected account: whoever commented or messaged it.
CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  connected_account_id uuid NOT NULL REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('instagram', 'facebook')),
  platform_user_id text NOT NULL,
  username text,
  name text,
  email text CHECK (email IS NULL OR char_length(email) <= 254),
  tags text[] NOT NULL DEFAULT '{}',
  notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  source text NOT NULL DEFAULT 'comment' CHECK (source IN ('comment', 'message')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  profile_checked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connected_account_id, platform_user_id)
);
CREATE INDEX contacts_workspace_idx ON public.contacts (workspace_id, last_seen_at DESC);
CREATE TRIGGER contacts_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- A DM thread with one contact. last_inbound_at decides whether a reply is allowed (Meta's
-- 24-hour window).
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  connected_account_id uuid NOT NULL REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_inbound_at timestamptz,
  last_preview text,
  unread integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connected_account_id, contact_id)
);
CREATE INDEX conversations_workspace_idx ON public.conversations (workspace_id, last_message_at DESC);
CREATE INDEX conversations_contact_idx ON public.conversations (contact_id);

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  platform_message_id text,
  text text,
  attachments jsonb NOT NULL DEFAULT '[]',
  -- Who sent an outgoing message: an automation, a person in Post Social, an AI agent, or
  -- the account itself from Instagram's own app.
  sent_by text NOT NULL DEFAULT 'contact' CHECK (sent_by IN ('contact', 'automation', 'person', 'agent', 'instagram')),
  actor_id uuid REFERENCES public.actors(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX messages_platform_id_idx ON public.messages (conversation_id, platform_message_id) WHERE platform_message_id IS NOT NULL;
CREATE INDEX messages_conversation_idx ON public.messages (conversation_id, created_at);
CREATE INDEX messages_workspace_idx ON public.messages (workspace_id);
CREATE INDEX messages_actor_idx ON public.messages (actor_id) WHERE actor_id IS NOT NULL;

-- Every comment on the account's posts, for the Comments tab.
CREATE TABLE public.inbox_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  connected_account_id uuid NOT NULL REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  platform_comment_id text NOT NULL,
  platform_post_id text,
  parent_comment_id text,
  commenter_id text,
  commenter_username text,
  text text,
  from_account boolean NOT NULL DEFAULT false,
  hidden boolean NOT NULL DEFAULT false,
  replied_at timestamptz,
  dm_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connected_account_id, platform_comment_id)
);
CREATE INDEX inbox_comments_workspace_idx ON public.inbox_comments (workspace_id, created_at DESC);
CREATE INDEX inbox_comments_contact_idx ON public.inbox_comments (contact_id) WHERE contact_id IS NOT NULL;

-- Replies waiting for the worker, which holds the accounts' access: a DM, a public comment
-- reply, a DM to a commenter (private reply) or hiding a comment.
CREATE TABLE public.inbox_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  connected_account_id uuid NOT NULL REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('message', 'comment_reply', 'private_reply', 'hide_comment', 'unhide_comment')),
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
  comment_id uuid REFERENCES public.inbox_comments(id) ON DELETE CASCADE,
  text text CHECK (text IS NULL OR char_length(text) <= 1000),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  error text,
  sent_by text NOT NULL CHECK (sent_by IN ('person', 'agent')),
  actor_id uuid REFERENCES public.actors(id) ON DELETE SET NULL,
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX inbox_outbox_queued_idx ON public.inbox_outbox (created_at) WHERE status = 'queued';
CREATE INDEX inbox_outbox_workspace_idx ON public.inbox_outbox (workspace_id);
CREATE INDEX inbox_outbox_account_idx ON public.inbox_outbox (connected_account_id);
CREATE INDEX inbox_outbox_conversation_idx ON public.inbox_outbox (conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX inbox_outbox_comment_idx ON public.inbox_outbox (comment_id) WHERE comment_id IS NOT NULL;
CREATE INDEX inbox_outbox_actor_idx ON public.inbox_outbox (actor_id) WHERE actor_id IS NOT NULL;

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbox_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbox_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contacts, public.conversations, public.messages, public.inbox_comments, public.inbox_outbox FROM PUBLIC, anon, authenticated;

-- Hands the worker queued replies, each leased; gives up after 3 tries.
CREATE OR REPLACE FUNCTION public.claim_inbox_outbox(max_rows integer DEFAULT 10, lease_seconds integer DEFAULT 120)
RETURNS SETOF public.inbox_outbox
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  UPDATE public.inbox_outbox o
  SET lease_until = now() + make_interval(secs => lease_seconds), attempts = o.attempts + 1
  WHERE o.id IN (
    SELECT id FROM public.inbox_outbox
    WHERE status = 'queued' AND attempts < 3 AND (lease_until IS NULL OR lease_until < now())
    ORDER BY created_at
    LIMIT max_rows
    FOR UPDATE SKIP LOCKED
  )
  RETURNING o.*;
$$;
REVOKE ALL ON FUNCTION public.claim_inbox_outbox(integer, integer) FROM PUBLIC, anon, authenticated;
