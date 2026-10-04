-- The audit log stays append-only, but deleting a whole workspace must still remove its
-- history (for example a data-deletion request), and the workspace's actors with it.

-- Actors are never deleted on their own, so audit rows keep their actor. Checked at the end
-- of the statement, which lets a workspace delete remove both actors and audit rows.
ALTER TABLE public.audit_events DROP CONSTRAINT audit_events_actor_id_fkey;
ALTER TABLE public.audit_events
  ADD CONSTRAINT audit_events_actor_id_fkey
  FOREIGN KEY (actor_id) REFERENCES public.actors(id);

CREATE OR REPLACE FUNCTION public.prevent_audit_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  -- Allowed only as part of deleting the workspace the event belongs to.
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;
