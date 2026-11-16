-- A link already sent in a DM keeps working after its automation (or that comment's record)
-- is deleted: people still have the DM. Workspace deletion still removes them.
ALTER TABLE public.tracked_links ALTER COLUMN automation_id DROP NOT NULL;
ALTER TABLE public.tracked_links DROP CONSTRAINT tracked_links_automation_id_fkey;
ALTER TABLE public.tracked_links ADD CONSTRAINT tracked_links_automation_id_fkey
  FOREIGN KEY (automation_id) REFERENCES public.comment_automations(id) ON DELETE SET NULL;
ALTER TABLE public.tracked_links DROP CONSTRAINT tracked_links_run_id_fkey;
ALTER TABLE public.tracked_links ADD CONSTRAINT tracked_links_run_id_fkey
  FOREIGN KEY (run_id) REFERENCES public.automation_runs(id) ON DELETE SET NULL;
