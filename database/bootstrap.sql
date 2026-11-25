-- What a plain Postgres 15 database (AWS RDS, or a local one) needs before our migrations
-- or a copy of our data can go in. On InsForge these came with the platform; here we create
-- them ourselves, with the same names and definitions, so migrations/ runs unchanged.
--
-- Run once per database as its owner login (on RDS: postsocial_admin). Safe to run again.
-- No passwords here: app_admin and app_user can't sign in until one is set for them
-- (scripts/local-database.sh does it locally; on AWS the passwords are generated in AWS).
--
-- Roles, matching InsForge:
--   project_admin   owns every table and function in public. The API's own checks and the
--                   worker run as this role, so access policies don't apply to them.
--   authenticated   a signed-in person. The access policies in migrations/ are written for it.
--   anon            nobody signed in. Kept because migrations name it; it is granted nothing.
-- Logins:
--   app_admin       the API and the worker. Every session starts as project_admin.
--   app_user        requests made for one signed-in person. Every session starts as
--                   authenticated, and it can never become project_admin.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'project_admin') THEN CREATE ROLE project_admin NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_admin') THEN CREATE ROLE app_admin LOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN CREATE ROLE app_user LOGIN NOINHERIT; END IF;
END
$$;

-- The owner login applies migrations as project_admin, so everything they create is owned
-- by project_admin, as on InsForge.
GRANT project_admin TO CURRENT_USER;
GRANT project_admin TO app_admin;
ALTER ROLE app_admin SET role = 'project_admin';
GRANT authenticated TO app_user;
ALTER ROLE app_user SET role = 'authenticated';
-- Times are stored and compared in UTC everywhere.
ALTER ROLE app_admin SET timezone = 'UTC';
ALTER ROLE app_user SET timezone = 'UTC';

GRANT USAGE, CREATE ON SCHEMA public TO project_admin;
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Sign-in data. Ten tables in public point at auth.users(id).
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO PUBLIC;
GRANT CREATE ON SCHEMA auth TO project_admin;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password text,
  email_verified boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  profile jsonb DEFAULT '{}'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  is_project_admin boolean NOT NULL DEFAULT false,
  is_anonymous boolean NOT NULL DEFAULT false,
  CONSTRAINT _user_pkey PRIMARY KEY (id),
  CONSTRAINT _user_email_key UNIQUE (email)
);
CREATE INDEX IF NOT EXISTS idx_users_lower_email ON auth.users (lower(email));
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON auth.users TO project_admin;

-- Who is asking. The API sets request.jwt.claims for the length of one transaction when it
-- runs a query for a signed-in person (backend/lib/database.ts); the policies read it here.
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $function$
  SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb
$function$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $function$
  SELECT nullif(auth.jwt() ->> 'sub', '')::uuid
$function$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $function$
  SELECT nullif(auth.jwt() ->> 'role', '')::text
$function$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $function$
  SELECT nullif(auth.jwt() ->> 'email', '')::text
$function$;

-- Which migration files have been applied (backend/lib/migrations.ts).
CREATE SCHEMA IF NOT EXISTS app_meta;
CREATE TABLE IF NOT EXISTS app_meta.migrations (
  version text PRIMARY KEY,
  name text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
