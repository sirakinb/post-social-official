-- A login for looking at the data, never changing it: app_viewer. It is what a person uses
-- to browse tables from their own machine (scripts/aws-db-view.mjs), the way InsForge's
-- dashboard showed them.
--
-- Run as the database's owner login after the migrations, on every deploy
-- (backend/migrate.ts --bootstrap). Safe to run again: a table added since the last run
-- gets its read rule here.
--
-- What it can do: read every table in public, and the list of people (auth.users).
-- What it can't: change anything (it is granted SELECT and nothing else, and its sessions
-- start read-only), or read the sign-in tables that hold sessions, password hashes and
-- emailed codes (auth.accounts, auth.sessions, auth.verifications).
-- No password here: it can't sign in until one is set (on AWS, generated in Secrets Manager
-- and given to the database as a hash by the migration task).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_viewer') THEN CREATE ROLE app_viewer LOGIN; END IF;
END
$$;

-- One person looking, not a service: few connections, no long queries on a small database.
ALTER ROLE app_viewer CONNECTION LIMIT 4;
ALTER ROLE app_viewer SET default_transaction_read_only = on;
ALTER ROLE app_viewer SET statement_timeout = '30s';
ALTER ROLE app_viewer SET idle_in_transaction_session_timeout = '5min';

GRANT USAGE ON SCHEMA public, auth TO app_viewer;
GRANT SELECT ON auth.users TO app_viewer;

-- Everything in public belongs to project_admin, so the rest is done as that role.
SET ROLE project_admin;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_viewer;
-- Tables a later migration creates are readable from the start.
ALTER DEFAULT PRIVILEGES FOR ROLE project_admin IN SCHEMA public GRANT SELECT ON TABLES TO app_viewer;

-- Every table has row-level security, and its rules are written for signed-in people. Without
-- a rule of its own the viewer would see every table as empty. This one lets it read all
-- rows, and applies to no one else: it names app_viewer only, and only reading.
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT c.oid::regclass AS name
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND c.relrowsecurity
      AND NOT EXISTS (SELECT FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'viewer_reads')
  LOOP
    EXECUTE format('CREATE POLICY viewer_reads ON %s FOR SELECT TO app_viewer USING (true)', target.name);
  END LOOP;
END
$$;

RESET ROLE;
