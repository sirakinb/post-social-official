#!/usr/bin/env bash
# Deploy the web app to Vercel Production, only from a clean main that matches GitHub.
set -euo pipefail

cd "$(dirname "$0")/.."

[[ "$(git rev-parse --abbrev-ref HEAD)" == "main" ]] || { echo "Production deploys only from main." >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo "Working tree has uncommitted changes." >&2; exit 1; }
git fetch -q origin main
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || { echo "main is not in sync with origin/main." >&2; exit 1; }

read -r -p "Deploy $(git rev-parse --short HEAD) to PRODUCTION? Type 'prod' to continue: " answer
[[ "$answer" == "prod" ]] || { echo "Cancelled." >&2; exit 1; }

vercel deploy --prod
