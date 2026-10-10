-- Which AI app is behind an API key or connected app: MCP clients name themselves when
-- they connect (clientInfo, e.g. "claude-code" or "codex"), and the logs show that app's
-- name and logo instead of only the key's name. The latest app to connect wins.
ALTER TABLE public.actors
  ADD COLUMN client_name text CHECK (char_length(client_name) BETWEEN 1 AND 80);
