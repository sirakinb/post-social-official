-- Phase 8: rate limits. One counter per (key, time window); the key names what is limited
-- and for whom, e.g. "waitlist:ip:<hash>" or "api:cred:<id>". Identifiers that could be
-- personal (addresses, emails) are hashed by the caller. Server-only.
CREATE TABLE public.rate_limits (
  key text NOT NULL CHECK (length(key) BETWEEN 1 AND 200),
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (key, window_start)
);
CREATE INDEX rate_limits_window_idx ON public.rate_limits (window_start);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limits FROM PUBLIC, anon, authenticated;

-- Counts one hit and answers how long to wait: 0 means allowed, otherwise the seconds until
-- the window resets. Fixed windows aligned to the epoch, so every server agrees.
CREATE FUNCTION public.take_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  w timestamptz := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);
  c integer;
BEGIN
  IF p_limit < 1 OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'rate limit and window must be positive';
  END IF;
  INSERT INTO public.rate_limits AS r (key, window_start, count) VALUES (p_key, w, 1)
  ON CONFLICT (key, window_start) DO UPDATE SET count = r.count + 1
  RETURNING r.count INTO c;
  IF c <= p_limit THEN
    RETURN 0;
  END IF;
  RETURN GREATEST(1, ceil(extract(epoch FROM (w + make_interval(secs => p_window_seconds) - now())))::integer);
END;
$$;
REVOKE ALL ON FUNCTION public.take_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
