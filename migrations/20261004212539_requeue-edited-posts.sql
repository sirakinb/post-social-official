-- An edited scheduled post on an autonomous account goes straight back into the queue:
-- allow scheduled -> approved (it is re-queued right after). Otherwise unchanged.
CREATE OR REPLACE FUNCTION public.enforce_post_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  allowed text[];
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  allowed := CASE OLD.status
    WHEN 'draft' THEN ARRAY['awaiting_approval', 'approved', 'cancelled']
    WHEN 'awaiting_approval' THEN ARRAY['approved', 'draft', 'cancelled']
    WHEN 'approved' THEN ARRAY['scheduled', 'processing', 'awaiting_approval', 'cancelled']
    WHEN 'scheduled' THEN ARRAY['processing', 'awaiting_approval', 'approved', 'cancelled']
    WHEN 'processing' THEN ARRAY['published', 'partially_published', 'failed']
    ELSE ARRAY[]::text[]
  END;
  IF NOT (NEW.status = ANY (allowed)) THEN
    RAISE EXCEPTION 'Invalid post transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
