-- Facebook sign-ins can wait for the person to choose too (PEN-5).
--
-- Meta returns every Page the person ever shared with Post Social, not only the ones ticked
-- in this sign-in, and each connected Page is billed. Like LinkedIn, two or more new Pages
-- now wait here until the person ticks the ones to add.
ALTER TABLE public.pending_connections DROP CONSTRAINT pending_connections_platform_check;
ALTER TABLE public.pending_connections
  ADD CONSTRAINT pending_connections_platform_check CHECK (platform IN ('linkedin', 'facebook'));
