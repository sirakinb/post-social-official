-- Defense in depth: server-only functions are explicitly closed to app clients, so they stay
-- closed even if the platform's default function privileges ever change. Today the defaults
-- already grant EXECUTE only to project_admin.
REVOKE ALL ON FUNCTION public.claim_media_job(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.media_due_for_cleanup(interval, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_within_limit(uuid, text, bigint) FROM PUBLIC, anon, authenticated;

-- Callable by signed-in people on purpose (RLS helper and their own usage); never by anon.
REVOKE ALL ON FUNCTION public.is_workspace_member(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.workspace_usage(uuid, timestamptz, timestamptz) FROM anon;
