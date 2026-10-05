-- People direct their AI ("post this now", "schedule these over the week"), so Post
-- Social carries out what the AI is told instead of holding AI posts for approval. Every
-- workspace and account now publishes AI posts as directed. (The approval machinery
-- stays for later opt-in use; TikTok's creator confirmation is handled by sending AI
-- posts to the creator's TikTok inbox.)
ALTER TABLE public.workspaces ALTER COLUMN default_approval_policy SET DEFAULT 'autonomous';
UPDATE public.workspaces SET default_approval_policy = 'autonomous' WHERE default_approval_policy <> 'autonomous';
UPDATE public.connected_accounts SET approval_policy_override = NULL WHERE approval_policy_override IS NOT NULL;
