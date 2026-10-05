-- Phase 8: indexes on the columns used to join and to cascade deletes (InsForge advisor,
-- missing-fk-index / missing-rls-index). Small tables today; this keeps workspace deletes
-- and post/job lookups fast as data grows.
CREATE INDEX IF NOT EXISTS post_media_post_id_ws_idx ON public.post_media (post_id, workspace_id);
CREATE INDEX IF NOT EXISTS publish_jobs_destination_id_ws_idx ON public.publish_jobs (destination_id, workspace_id);
CREATE INDEX IF NOT EXISTS destinations_connected_account_id_ws_idx ON public.destinations (connected_account_id, workspace_id);
CREATE INDEX IF NOT EXISTS oauth_codes_ws_idx ON public.oauth_codes (workspace_id);
CREATE INDEX IF NOT EXISTS oauth_states_ws_idx ON public.oauth_states (workspace_id);
CREATE INDEX IF NOT EXISTS oauth_access_tokens_ws_idx ON public.oauth_access_tokens (workspace_id);
CREATE INDEX IF NOT EXISTS actors_api_key_id_ws_idx ON public.actors (api_key_id, workspace_id);
CREATE INDEX IF NOT EXISTS approval_requests_post_id_ws_idx ON public.approval_requests (post_id, workspace_id);
CREATE INDEX IF NOT EXISTS media_uploads_media_asset_id_ws_idx ON public.media_uploads (media_asset_id, workspace_id);
CREATE INDEX IF NOT EXISTS workspace_plans_plan_id_idx ON public.workspace_plans (plan_id);
CREATE INDEX IF NOT EXISTS platform_rate_limits_ws_idx ON public.platform_rate_limits (workspace_id);
CREATE INDEX IF NOT EXISTS webhook_deliveries_endpoint_id_ws_idx ON public.webhook_deliveries (endpoint_id, workspace_id);
CREATE INDEX IF NOT EXISTS oauth_codes_user_id_idx ON public.oauth_codes (user_id);
CREATE INDEX IF NOT EXISTS webhook_endpoints_created_by_actor_id_ws_idx ON public.webhook_endpoints (created_by_actor_id, workspace_id);
CREATE INDEX IF NOT EXISTS publish_jobs_post_id_ws_idx ON public.publish_jobs (post_id, workspace_id);
CREATE INDEX IF NOT EXISTS approval_requests_requested_by_actor_id_ws_idx ON public.approval_requests (requested_by_actor_id, workspace_id);
CREATE INDEX IF NOT EXISTS webhook_deliveries_ws_idx ON public.webhook_deliveries (workspace_id);
CREATE INDEX IF NOT EXISTS connected_accounts_connected_by_actor_id_ws_idx ON public.connected_accounts (connected_by_actor_id, workspace_id);
CREATE INDEX IF NOT EXISTS post_metric_days_ws_idx ON public.post_metric_days (workspace_id);
CREATE INDEX IF NOT EXISTS usage_events_actor_id_ws_idx ON public.usage_events (actor_id, workspace_id);
CREATE INDEX IF NOT EXISTS actors_oauth_grant_id_ws_idx ON public.actors (oauth_grant_id, workspace_id);
CREATE INDEX IF NOT EXISTS post_metrics_post_id_idx ON public.post_metrics (post_id);
CREATE INDEX IF NOT EXISTS actors_user_id_idx ON public.actors (user_id);
CREATE INDEX IF NOT EXISTS publish_jobs_ws_idx ON public.publish_jobs (workspace_id);
CREATE INDEX IF NOT EXISTS credentials_connected_account_id_ws_idx ON public.credentials (connected_account_id, workspace_id);
CREATE INDEX IF NOT EXISTS approvals_actor_id_ws_idx ON public.approvals (actor_id, workspace_id);
CREATE INDEX IF NOT EXISTS api_idempotency_ws_idx ON public.api_idempotency (workspace_id);
CREATE INDEX IF NOT EXISTS destinations_post_id_ws_idx ON public.destinations (post_id, workspace_id);
CREATE INDEX IF NOT EXISTS platform_rate_limits_connected_account_id_ws_idx ON public.platform_rate_limits (connected_account_id, workspace_id);
CREATE INDEX IF NOT EXISTS destinations_actor_id_ws_idx ON public.destinations (actor_id, workspace_id);
CREATE INDEX IF NOT EXISTS media_jobs_media_asset_id_ws_idx ON public.media_jobs (media_asset_id, workspace_id);
CREATE INDEX IF NOT EXISTS workspaces_created_by_idx ON public.workspaces (created_by);
CREATE INDEX IF NOT EXISTS approvals_approval_request_id_ws_idx ON public.approvals (approval_request_id, workspace_id);
CREATE INDEX IF NOT EXISTS usage_events_connected_account_id_idx ON public.usage_events (connected_account_id);
