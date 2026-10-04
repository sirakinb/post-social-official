#!/usr/bin/env bash
# Deploy the web app to Vercel Production, only from a clean main that matches GitHub.
set -euo pipefail

cd "$(dirname "$0")/.."

VERCEL_PROJECT_ID="prj_Y1Fyu6SRy4vtGwsZekrqS1EC55R6"   # app-build-26/post-social
VERCEL_ORG_ID="team_eEUXbDFXnVAXxi9YfyUl8lym"

command -v vercel >/dev/null || { echo "Install the Vercel CLI first: npm i -g vercel" >&2; exit 1; }
[[ -f .vercel/project.json ]] || { echo "Not linked to Vercel. Run: vercel link" >&2; exit 1; }
linked="$(python3 -c "import json; d=json.load(open('.vercel/project.json')); print(d['projectId'], d['orgId'])")"
[[ "$linked" == "$VERCEL_PROJECT_ID $VERCEL_ORG_ID" ]] || { echo "This folder is linked to a different Vercel project." >&2; exit 1; }

[[ "$(git rev-parse --abbrev-ref HEAD)" == "main" ]] || { echo "Production deploys only from main." >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo "Working tree has uncommitted changes." >&2; exit 1; }
git fetch -q origin main
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || { echo "main is not in sync with origin/main." >&2; exit 1; }

read -r -p "Deploy $(git rev-parse --short HEAD) to PRODUCTION? Type 'prod' to continue: " answer
[[ "$answer" == "prod" ]] || { echo "Cancelled." >&2; exit 1; }

vercel deploy --prod
