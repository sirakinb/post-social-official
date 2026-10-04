#!/usr/bin/env bash
# Bundle an InsForge function into one file and deploy it.
#   scripts/deploy-function.sh <dev|prod> <name>      e.g. dev media
# Prod deploys go through scripts/insforge-env.sh, so they need a synced main.
set -euo pipefail
cd "$(dirname "$0")/.."

target="${1:-}"; name="${2:-}"
[[ "$target" == "dev" || "$target" == "prod" ]] && [[ -n "$name" ]] || { echo "Usage: scripts/deploy-function.sh <dev|prod> <name>" >&2; exit 1; }
entry="backend/functions/$name/index.ts"
[[ -f "$entry" ]] || { echo "No function at $entry" >&2; exit 1; }

out=".build/functions/$name.js"
mkdir -p "$(dirname "$out")"
npx esbuild "$entry" --bundle --format=esm --platform=neutral --target=es2022 \
  --main-fields=module,main --log-level=warning --outfile="$out"
echo "Bundled $out ($(wc -c < "$out" | tr -d ' ') bytes)"

scripts/insforge-env.sh "$target" functions deploy "$name" --file "$out"
