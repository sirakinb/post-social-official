-- Deleting comments (Instagram and Facebook only: Threads doesn't let apps delete other
-- people's replies) and archiving conversations. A deleted comment is kept, marked, so a
-- late webhook can't bring it back; an archived conversation reopens when they write again.
ALTER TABLE public.inbox_comments ADD COLUMN deleted_at timestamptz;

ALTER TABLE public.inbox_outbox DROP CONSTRAINT inbox_outbox_kind_check;
ALTER TABLE public.inbox_outbox ADD CONSTRAINT inbox_outbox_kind_check
  CHECK (kind IN ('message', 'comment_reply', 'private_reply', 'hide_comment', 'unhide_comment', 'delete_comment'));

ALTER TABLE public.conversations DROP CONSTRAINT conversations_status_check;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_status_check CHECK (status IN ('open', 'done', 'archived'));
