#!/usr/bin/env bash
# A local Postgres 15 set up the way the AWS database is: the same roles, the auth schema and
# every migration, with an owner login that isn't a superuser (as on RDS). For running the
# Node API service and its database tests on this machine. Needs Docker.
#
#   scripts/local-database.sh          create it (or bring an existing one up to date)
#   scripts/local-database.sh reset    throw the data away and start again
#   scripts/local-database.sh stop     remove the container
#
# The password "local" is for this container only; it listens on 127.0.0.1 and holds no real data.
set -euo pipefail
cd "$(dirname "$0")/.."

NAME="${LOCAL_DB_CONTAINER:-postsocial-db}"
PORT="${LOCAL_DB_PORT:-55432}"
psql_as_root() { docker exec -i "$NAME" psql -v ON_ERROR_STOP=1 -q -U postgres "$@"; }

if [[ "${1:-}" == "stop" ]]; then docker rm -f "$NAME" >/dev/null 2>&1 || true; echo "Removed $NAME"; exit 0; fi

if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" -e POSTGRES_PASSWORD=local -p "127.0.0.1:$PORT:5432" postgres:15 >/dev/null
fi
for _ in $(seq 1 60); do docker exec "$NAME" pg_isready -q -U postgres && break; sleep 1; done
docker exec "$NAME" pg_isready -q -U postgres || { echo "Postgres didn't start." >&2; exit 1; }

[[ "${1:-}" == "reset" ]] && psql_as_root -c "DROP DATABASE IF EXISTS postsocial WITH (FORCE)"
psql_as_root <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'postsocial_admin') THEN
    CREATE ROLE postsocial_admin LOGIN CREATEROLE CREATEDB PASSWORD 'local';
  END IF;
END $$;
SELECT 'CREATE DATABASE postsocial OWNER postsocial_admin' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'postsocial') \gexec
SQL

backend/build.sh >/dev/null
DATABASE_OWNER_URL="postgres://postsocial_admin:local@127.0.0.1:$PORT/postsocial" node backend/dist/migrate.mjs --bootstrap
psql_as_root -d postsocial -c "ALTER ROLE app_admin PASSWORD 'local'" -c "ALTER ROLE app_user PASSWORD 'local'"

cat <<TXT

Local database ready:
  DATABASE_OWNER_URL=postgres://postsocial_admin:local@127.0.0.1:$PORT/postsocial   (setup and migrations)
  DATABASE_URL=postgres://app_admin:local@127.0.0.1:$PORT/postsocial                (the API and the worker)
  DATABASE_USER_URL=postgres://app_user:local@127.0.0.1:$PORT/postsocial            (queries for a signed-in person)
TXT
