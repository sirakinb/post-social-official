-- How an AI's TikTok posts reach each account: posted directly (the default), or sent to
-- the creator's TikTok inbox first, where they finish the post and tap Post. The person
-- (or their AI, through the API/MCP) chooses per account; changes go through the API or
-- the connections function (audited), so app clients only read it.
ALTER TABLE public.connected_accounts
  ADD COLUMN tiktok_delivery text NOT NULL DEFAULT 'direct' CHECK (tiktok_delivery IN ('direct', 'inbox'));
