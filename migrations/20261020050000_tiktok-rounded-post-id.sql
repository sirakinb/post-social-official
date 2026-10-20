-- TikTok sends post ids as 19-digit bare numbers, and the worker used to round them, so a
-- post got another post's id: a broken link, and stats said the post was deleted and
-- stopped checking. One live post was hit (2026-10-19, @adzoai); put its real id back
-- (confirmed on its TikTok profile) and check its stats again. Matches nothing elsewhere.
UPDATE public.destinations
SET platform_request_id = '7698502021669784846',
    live_url = 'https://www.tiktok.com/@adzoai/video/7698502021669784846'
WHERE platform = 'tiktok' AND platform_request_id = '7698502021669785000';

UPDATE public.post_metrics m
SET next_fetch_at = now(), last_error = NULL
FROM public.destinations d
WHERE d.id = m.destination_id AND d.platform_request_id = '7698502021669784846'
  AND m.fetched_at IS NULL AND m.next_fetch_at IS NULL;
