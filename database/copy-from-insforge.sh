#!/usr/bin/env bash
# Fills one of our databases (AWS RDS, or a local one) with a copy of an InsForge database:
# everything in `public` (tables, data, functions, access rules) and the people in
# `auth.users`, plus their Google links in `auth.user_providers`.
#
# Runs inside the network, as the one-off task postsocial-<env>-copy (the database has no
# public address), started by scripts/aws-copy-database.mjs. Works the same on a laptop
# against a local database, which is how it is tested.
#
# The database it fills must already be set up (database/bootstrap.sql, by the migration
# task) and must hold no people, unless REPLACE=yes. Everything happens in one transaction:
# if any step fails, the database is left exactly as it was.
#
# Afterwards run the migration task with --bootstrap --baseline, which records the
# migrations as already applied (they came with the copy).
#
# Needs: SOURCE_URL (InsForge's database address; never printed), and the database to fill
# as PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD (its owner login).
# Prints names and counts only.
set -euo pipefail
# Plain byte order everywhere, so the two lists of counts line up.
export LC_ALL=C

: "${SOURCE_URL:?Set SOURCE_URL to the InsForge database address.}"
: "${PGHOST:?Set PGHOST, PGDATABASE, PGUSER and PGPASSWORD for the database to fill.}"
case "$SOURCE_URL" in postgres://* | postgresql://*) ;; *) echo "SOURCE_URL isn't a database address (the copy's source hasn't been set)." >&2; exit 1 ;; esac

work="$(mktemp -d "${WORK_DIR:-/tmp}/copy.XXXXXX")"
trap 'rm -rf "$work"' EXIT

# Warnings and errors only: no line per dropped table.
export PGOPTIONS="-c client_min_messages=warning"
ours() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
theirs() { PGOPTIONS="" psql -X -q -v ON_ERROR_STOP=1 -d "$SOURCE_URL" "$@"; }

# What we report before and after: people, and every table in public with its row count.
COUNTS="SELECT 'auth.users', count(*) FROM auth.users
        UNION ALL
        SELECT 'public.' || c.relname, (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname), false, true, '')))[1]::text::bigint
        FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
        ORDER BY 1"

people="$(ours -At -c "SELECT count(*) FROM auth.users")"
if [[ "$people" != "0" && "${REPLACE:-}" != "yes" ]]; then
  echo "The database to fill already holds $people people. Nothing was changed. (REPLACE=yes replaces what is there.)" >&2
  exit 1
fi

echo "Reading from InsForge"
# InsForge's own sign-in settings stay behind: they hold its keys, and nothing here uses them.
PGOPTIONS="" pg_dump "$SOURCE_URL" --format=custom --file="$work/source.dump" --schema=public --schema=auth \
  --exclude-table=auth.config --exclude-table=auth.custom_oauth_configs --exclude-table=auth.email_otps --exclude-table=auth.oauth_configs
# The same moment's numbers aren't available outside the dump, so these are a moment later:
# shown next to ours at the end, and only the people must match exactly.
theirs -At -F ' ' -c "$COUNTS" | sort > "$work/theirs.txt"

# What goes in. From `public`: everything except the schema itself and InsForge's defaults
# for future tables (it gives new tables to everyone signed in; our migrations say who gets
# what). From `auth`: the people (into the table bootstrap.sql made) and their Google links
# (that table comes with the copy; scripts/migrate-auth.sql reads it and it goes after).
pg_restore --list "$work/source.dump" > "$work/all.txt"
grep -E '^[0-9]+; [0-9]+ [0-9]+ ' "$work/all.txt" \
  | grep -Ev '^[0-9]+; [0-9]+ [0-9]+ (SCHEMA - |COMMENT - SCHEMA |ACL - SCHEMA |DEFAULT ACL )' \
  | grep -E '^[0-9]+; [0-9]+ [0-9]+ ([A-Z ]+ public |TABLE DATA auth users |(TABLE|TABLE DATA|CONSTRAINT|FK CONSTRAINT) auth user_providers )' \
  > "$work/chosen.txt"
tables="$(grep -Ec '^[0-9]+; [0-9]+ [0-9]+ TABLE public ' "$work/chosen.txt" || true)"
grep -Eq '^[0-9]+; [0-9]+ [0-9]+ TABLE DATA auth users ' "$work/chosen.txt" || { echo "The dump holds no auth.users. Nothing was changed." >&2; exit 1; }
[[ "$tables" -ge "${MIN_PUBLIC_TABLES:-30}" ]] || { echo "The dump holds only $tables tables in public. Nothing was changed." >&2; exit 1; }
# Every role the copy names must exist here already (a missing one would stop it half way,
# and the transaction would undo it; this says which one, first).
pg_restore --file=- --no-owner --schema-only --use-list="$work/chosen.txt" "$work/source.dump" \
  | grep -Eo '^(GRANT|REVOKE) .* (TO|FROM) [A-Za-z_"]+' | awk '{ print $NF }' | tr -d '"' | grep -vx PUBLIC | sort -u > "$work/roles.txt" || true
while read -r role; do
  [[ "$(ours -At -v role="$role" <<< "SELECT count(*) FROM pg_roles WHERE rolname = :'role'")" == "1" ]] || { echo "The copy names the role $role, which this database doesn't have. Nothing was changed." >&2; exit 1; }
done < "$work/roles.txt"
echo "Read $tables tables (roles named: $(paste -sd, "$work/roles.txt"))"

# One transaction: empty what is there, put the copy in, as the role that owns our tables.
{
  cat <<'SQL'
BEGIN;
DROP SCHEMA public CASCADE;
-- A new `public`, as Postgres itself makes it, with the grants bootstrap.sql adds.
CREATE SCHEMA public;
ALTER SCHEMA public OWNER TO pg_database_owner;
COMMENT ON SCHEMA public IS 'standard public schema';
GRANT USAGE ON SCHEMA public TO PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO project_admin;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
DROP TABLE IF EXISTS auth.user_providers;
TRUNCATE auth.users;
TRUNCATE app_meta.migrations;
SQL
  pg_restore --file=- --no-owner --role=project_admin --use-list="$work/chosen.txt" "$work/source.dump"
  cat <<'SQL'
RESET ROLE;
SET search_path TO DEFAULT;
-- InsForge hands every new sequence to everyone; our migrations never do.
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
-- Google's own tokens from past sign-ins: nothing of ours reads them.
UPDATE auth.user_providers SET access_token = NULL, refresh_token = NULL;
COMMIT;
SQL
} | ours > /dev/null
echo "Copy is in"

ours -At -F ' ' -c "$COUNTS" | sort > "$work/ours.txt"
echo "Rows (InsForge now, ours):"
join -a1 -a2 -e missing -o 0,1.2,2.2 "$work/theirs.txt" "$work/ours.txt" | awk '{ printf "  %-44s %10s %10s%s\n", $1, $2, $3, ($2 == $3 ? "" : "   differs") }'
theirs_people="$(awk '$1 == "auth.users" { print $2 }' "$work/theirs.txt")"
ours_people="$(awk '$1 == "auth.users" { print $2 }' "$work/ours.txt")"
[[ "$ours_people" == "$theirs_people" && "$ours_people" != "0" ]] || { echo "People don't match: InsForge has $theirs_people, we have $ours_people." >&2; exit 1; }
[[ "$(wc -l < "$work/theirs.txt")" == "$(wc -l < "$work/ours.txt")" ]] || { echo "The two databases don't have the same tables." >&2; exit 1; }
echo "Done: $ours_people people, $tables tables. Next: the migration task with --bootstrap --baseline."
