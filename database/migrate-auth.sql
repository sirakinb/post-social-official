-- Carries sign-in records that came with a copy of InsForge into the form our own sign-in
-- (Better Auth, backend/lib/auth) reads. Run by the migration task right after
-- bootstrap.sql, every time: on a database with nothing to carry it changes nothing.
--
-- Nobody's password changes and nobody's id changes. A password's hash moves from the
-- person's row to their 'credential' account, as it is (bcrypt, which we check directly).

-- Names and pictures were inside InsForge's profile; ours are columns.
UPDATE auth.users SET name = btrim(profile ->> 'name')
WHERE name IS NULL AND btrim(coalesce(profile ->> 'name', '')) <> '';
UPDATE auth.users SET image = profile ->> 'avatar_url'
WHERE image IS NULL AND coalesce(profile ->> 'avatar_url', '') <> '';

-- We look people up by the lower-case form of their email. Two people whose emails differ
-- only by capitals would collide here and stop the run: that needs a person to look at.
UPDATE auth.users SET email = lower(email) WHERE email <> lower(email);

-- Passwords: one 'credential' account per person who has one.
INSERT INTO auth.accounts (user_id, provider_id, account_id, password, created_at, updated_at)
SELECT id, 'credential', id::text, password, coalesce(created_at, now()), now()
FROM auth.users
WHERE password IS NOT NULL
ON CONFLICT (provider_id, account_id) DO NOTHING;
-- The hash now lives in one place only.
UPDATE auth.users AS person SET password = NULL
WHERE password IS NOT NULL
  AND EXISTS (SELECT FROM auth.accounts WHERE user_id = person.id AND provider_id = 'credential');

-- Google links: InsForge kept them in auth.user_providers, which comes along with a copy
-- for this step only and is removed once its rows are carried over.
DO $$
BEGIN
  IF to_regclass('auth.user_providers') IS NOT NULL THEN
    INSERT INTO auth.accounts (user_id, provider_id, account_id, created_at, updated_at)
    SELECT user_id, provider, provider_account_id, coalesce(created_at, now()), now()
    FROM auth.user_providers
    ON CONFLICT (provider_id, account_id) DO NOTHING;
    DROP TABLE auth.user_providers;
  END IF;
END
$$;
