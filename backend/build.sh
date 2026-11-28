#!/usr/bin/env bash
# Bundles the Node API service into backend/dist: server.mjs (the service), migrate.mjs
# (database setup and migrations), and the SQL files migrate.mjs reads.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf backend/dist && mkdir -p backend/dist
bundle() {
  npx esbuild "backend/$1.ts" --bundle --platform=node --target=node24 --format=esm \
    --banner:js="import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" \
    --external:pg-native --log-level=warning --outfile="backend/dist/$1.mjs"
}
# pg-native is an optional C binding the Postgres client tries to load; we use the plain one.
bundle server
bundle migrate
cp -R migrations backend/dist/migrations
cp database/bootstrap.sql backend/dist/bootstrap.sql
cp database/migrate-auth.sql backend/dist/migrate-auth.sql
cp database/viewer.sql backend/dist/viewer.sql
echo "Built backend/dist ($(du -sh backend/dist | cut -f1))"
