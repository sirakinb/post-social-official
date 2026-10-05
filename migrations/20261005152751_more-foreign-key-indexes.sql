-- Phase 8: the rest of the advisor missing-fk-index findings (the first pass covered the
-- composite keys; these are the remaining single- and two-column keys).
CREATE INDEX IF NOT EXISTS media_uploads_ws_idx ON public.media_uploads (workspace_id);
CREATE INDEX IF NOT EXISTS audit_events_actor_id_ws_idx ON public.audit_events (actor_id, workspace_id);
CREATE INDEX IF NOT EXISTS posts_actor_id_ws_idx ON public.posts (actor_id, workspace_id);
CREATE INDEX IF NOT EXISTS post_media_media_asset_id_ws_idx ON public.post_media (media_asset_id, workspace_id);
CREATE INDEX IF NOT EXISTS api_keys_created_by_idx ON public.api_keys (created_by);
CREATE INDEX IF NOT EXISTS post_media_ws_idx ON public.post_media (workspace_id);
CREATE INDEX IF NOT EXISTS approvals_post_id_ws_idx ON public.approvals (post_id, workspace_id);
CREATE INDEX IF NOT EXISTS oauth_grants_oauth_client_id_idx ON public.oauth_grants (oauth_client_id);
CREATE INDEX IF NOT EXISTS credentials_ws_idx ON public.credentials (workspace_id);
CREATE INDEX IF NOT EXISTS oauth_states_user_id_idx ON public.oauth_states (user_id);
CREATE INDEX IF NOT EXISTS post_metrics_connected_account_id_idx ON public.post_metrics (connected_account_id);
CREATE INDEX IF NOT EXISTS media_assets_uploaded_by_actor_id_ws_idx ON public.media_assets (uploaded_by_actor_id, workspace_id);
CREATE INDEX IF NOT EXISTS oauth_grants_user_id_idx ON public.oauth_grants (user_id);
CREATE INDEX IF NOT EXISTS media_jobs_ws_idx ON public.media_jobs (workspace_id);
CREATE INDEX IF NOT EXISTS oauth_codes_oauth_client_id_idx ON public.oauth_codes (oauth_client_id);
