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

-- What our own sign-in (Better Auth, backend/lib/auth) keeps beside the people. People stay
-- in auth.users with the ids they always had, so nothing that points at them changes.
-- Only the API's own login can read these; a signed-in person's queries never can.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS image text;

-- How a person proves who they are: a password ('credential') or a Google account.
CREATE TABLE IF NOT EXISTS auth.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  provider_id text NOT NULL,
  -- The person's own id for a password; the provider's id for them otherwise.
  account_id text NOT NULL,
  -- The password's hash, never the password.
  password text,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounts_provider_account_key UNIQUE (provider_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON auth.accounts (user_id);

-- One row per signed-in browser.
CREATE TABLE IF NOT EXISTS auth.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  token text NOT NULL,
  expires_at timestamptz NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sessions_token_key UNIQUE (token)
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON auth.sessions (user_id);

-- Codes sent by email (confirm an address, reset a password), stored hashed, short-lived.
CREATE TABLE IF NOT EXISTS auth.verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_verifications_identifier ON auth.verifications (identifier);

GRANT SELECT, INSERT, UPDATE, DELETE ON auth.accounts, auth.sessions, auth.verifications TO project_admin;

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
