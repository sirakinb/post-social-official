-- Phase 6D: a still frame for each video (stored next to it), so the web app can show
-- videos as pictures everywhere. Made by the worker after a video is ready.
ALTER TABLE public.media_assets
  ADD COLUMN poster_key text,
  ADD COLUMN poster_attempted_at timestamptz;
CREATE INDEX media_assets_needs_poster_idx ON public.media_assets (created_at)
  WHERE media_type = 'video' AND status = 'ready' AND poster_key IS NULL;
