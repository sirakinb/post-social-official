#!/usr/bin/env bash
# Build and deploy the worker to InsForge Compute.
#   scripts/deploy-worker.sh <dev|prod>
# Settings are read from the environment's InsForge secrets and passed to the container;
# nothing secret is written into the repo. Prod deploys need a clean main synced with GitHub.
set -euo pipefail
cd "$(dirname "$0")/.."

target="${1:-}"
[[ "$target" == "dev" || "$target" == "prod" ]] || { echo "Usage: scripts/deploy-worker.sh <dev|prod>" >&2; exit 1; }
export PATH="$HOME/.fly/bin:$PATH"
command -v flyctl >/dev/null || { echo "Install flyctl first: curl -L https://fly.io/install.sh | sh" >&2; exit 1; }

secret() {
  # Read-only on prod, so the wrapper only asks for confirmation once below.
  printf 'prod\n' | scripts/insforge-env.sh "$target" secrets get "$1" --json 2>/dev/null \
    | python3 -c "import json,sys; t=sys.stdin.read(); print(json.loads(t[t.index('{'):])['value'])"
}

worker/build.sh

env_file="$(mktemp)"
chmod 600 "$env_file"
trap 'rm -f "$env_file"' EXIT
{
  echo "INSFORGE_BASE_URL=$(secret INSFORGE_BASE_URL)"
  echo "INSFORGE_API_KEY=$(secret API_KEY)"
  for name in R2_ACCOUNT_ID R2_BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY \
    CREDENTIAL_ENCRYPTION_KEY TIKTOK_CLIENT_KEY TIKTOK_CLIENT_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
    echo "$name=$(secret "$name")"
  done
  # Dev only publishes to the owner's approved test accounts (platform account ids).
  if [[ "$target" == "dev" ]]; then echo "PUBLISH_ALLOWLIST=$(secret PUBLISH_ALLOWLIST)"; fi
  # Post stats only for platforms switched on in this environment (optional; none on prod
  # until each platform's review approves the read permissions).
  echo "ANALYTICS_PLATFORMS=$(secret ANALYTICS_PLATFORMS 2>/dev/null || true)"
  # Monitoring (PostHog): the project's public key; optional.
  echo "POSTHOG_KEY=$(secret POSTHOG_KEY 2>/dev/null || true)"
  echo "APP_ENV=$target"
  echo "MEDIA_RETENTION_DAYS=30"
  echo "WORKER_CONCURRENCY=3"
} > "$env_file"

scripts/insforge-env.sh "$target" compute deploy worker --name post-social-worker \
  --port 8080 --cpu shared-1x --memory 512 --region iad --env-file "$env_file" \
  --always-on  # it polls for jobs and gets no web traffic to wake it
