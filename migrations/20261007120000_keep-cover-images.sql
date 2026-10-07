-- Covers: a post's destinations can name a library image as the video cover
-- (options.cover_media_id). Like the post's own media, a cover is kept while the post can
-- still be sent; it isn't in post_media, so the retention sweep checks destinations too.
CREATE OR REPLACE FUNCTION public.media_due_for_cleanup(retention interval DEFAULT interval '30 days', max_rows integer DEFAULT 100)
RETURNS TABLE (id uuid, workspace_id uuid, storage_key text, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT m.id, m.workspace_id, m.storage_key, m.status
  FROM public.media_assets m
  WHERE (
      m.status IN ('ready', 'failed') AND m.last_used_at < now() - retention
      AND NOT EXISTS (
        SELECT 1 FROM public.post_media pm
        JOIN public.posts p ON p.id = pm.post_id
        WHERE pm.media_asset_id = m.id
          AND p.status NOT IN ('published', 'partially_published', 'failed', 'cancelled')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.destinations d
        JOIN public.posts p ON p.id = d.post_id
        WHERE d.workspace_id = m.workspace_id
          AND d.options->>'cover_media_id' = m.id::text
          AND p.status NOT IN ('published', 'partially_published', 'failed', 'cancelled')
      )
    )
    OR (m.status = 'uploading' AND m.created_at < now() - interval '1 day')
  ORDER BY m.last_used_at
  LIMIT max_rows;
$$;
REVOKE ALL ON FUNCTION public.media_due_for_cleanup(interval, integer) FROM PUBLIC, anon, authenticated;
