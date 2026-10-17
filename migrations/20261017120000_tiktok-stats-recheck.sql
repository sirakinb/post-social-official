-- TikTok posts that had no public link yet when they were published stopped being checked
-- for stats for good. The worker now asks TikTok for the post's link until it has one, so
-- look at those posts again.
UPDATE public.post_metrics
SET next_fetch_at = now(), last_error = NULL
WHERE platform = 'tiktok' AND next_fetch_at IS NULL
  AND last_error = 'This post has no public address, so its stats cannot be read.';
