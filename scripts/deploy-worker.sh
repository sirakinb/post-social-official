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
    CREDENTIAL_ENCRYPTION_KEY TIKTOK_CLIENT_KEY TIKTOK_CLIENT_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET \
    LINKEDIN_CLIENT_ID LINKEDIN_CLIENT_SECRET BLUESKY_CLIENT_JWK CONNECTIONS_BASE_URL X_CLIENT_ID X_CLIENT_SECRET; do
    echo "$name=$(secret "$name")"
  done
  # Dev only publishes to the owner's approved test accounts (platform account ids).
  if [[ "$target" == "dev" ]]; then echo "PUBLISH_ALLOWLIST=$(secret PUBLISH_ALLOWLIST)"; fi
  # Post stats only for platforms switched on in this environment (optional; none on prod
  # until each platform's review approves the read permissions).
  echo "ANALYTICS_PLATFORMS=$(secret ANALYTICS_PLATFORMS 2>/dev/null || true)"
  # Platforms whose stats come from their public pages (ScrapeCreators) until they approve
  # Post Social; optional, and off without the ScrapeCreators key.
  echo "ANALYTICS_PUBLIC_PLATFORMS=$(secret ANALYTICS_PUBLIC_PLATFORMS 2>/dev/null || true)"
  # Official stats for a few listed workspaces before a platform approves (the owner's and
  # each reviewer's test login): the platforms, and the workspace ids. Both optional.
  echo "ANALYTICS_PREVIEW_PLATFORMS=$(secret ANALYTICS_PREVIEW_PLATFORMS 2>/dev/null || true)"
  echo "ANALYTICS_PREVIEW_WORKSPACES=$(secret ANALYTICS_PREVIEW_WORKSPACES 2>/dev/null || true)"
  # Comment-to-DM: the workspaces it's switched on for (or "all"), and where tracked links
  # point (defaults to the website). Both optional; without the first the inbox sweeps are off.
  echo "INBOX_WORKSPACES=$(secret INBOX_WORKSPACES 2>/dev/null || true)"
  echo "LINK_BASE_URL=$(secret LINK_BASE_URL 2>/dev/null || true)"
  echo "SCRAPECREATORS_API_KEY=$(secret SCRAPECREATORS_API_KEY 2>/dev/null || true)"
  # Daily stats health check alerts, for the admin only: the address, the Resend key to
  # email it, and the ScrapeCreators credit level to warn below. All optional.
  echo "ALERT_EMAIL=$(secret ALERT_EMAIL 2>/dev/null || true)"
  echo "RESEND_API_KEY=$(secret RESEND_API_KEY 2>/dev/null || true)"
  echo "ALERT_CREDITS_BELOW=$(secret ALERT_CREDITS_BELOW 2>/dev/null || echo 1000)"
  # Nudge emails to new customers: "on" to send, the unsubscribe link secret, and the website
  # address for links (EMAIL_APP_URL overrides WEB_APP_HOME; dev sets it to staging). All optional; without them no nudge email goes out.
  echo "NUDGE_EMAILS=$(secret NUDGE_EMAILS 2>/dev/null || true)"
  echo "EMAIL_LINK_SECRET=$(secret EMAIL_LINK_SECRET 2>/dev/null || true)"
  echo "WEB_APP_HOME=$(secret WEB_APP_HOME 2>/dev/null || true)"
  echo "EMAIL_APP_URL=$(secret EMAIL_APP_URL 2>/dev/null || true)"
  # Monitoring (PostHog): the project's public key; optional.
  echo "POSTHOG_KEY=$(secret POSTHOG_KEY 2>/dev/null || true)"
  # "production" or "dev", matching the website's labels in PostHog.
  if [[ "$target" == "prod" ]]; then echo "APP_ENV=production"; else echo "APP_ENV=dev"; fi
  echo "MEDIA_RETENTION_DAYS=30"
  echo "WORKER_CONCURRENCY=3"
} > "$env_file"

# A secret that can't be read lands empty and quietly switches stats off, so say what's on.
setting_of() { grep "^$1=" "$env_file" | cut -d= -f2-; }
# The required ones stop the deploy instead: the CLI sometimes fails a read, and a worker
# started with an empty key can't publish.
required=(INSFORGE_BASE_URL INSFORGE_API_KEY R2_ACCOUNT_ID R2_BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY CREDENTIAL_ENCRYPTION_KEY)
[[ "$target" == "dev" ]] && required+=(PUBLISH_ALLOWLIST)
for name in "${required[@]}"; do
  [[ -n "$(setting_of "$name")" ]] || { echo "Couldn't read $name from $target's secrets, so nothing was deployed. Try again." >&2; exit 1; }
done
echo "Analytics: official=[$(setting_of ANALYTICS_PLATFORMS)] preview=[$(setting_of ANALYTICS_PREVIEW_PLATFORMS)] public=[$(setting_of ANALYTICS_PUBLIC_PLATFORMS)] ScrapeCreators key: $([[ -n "$(setting_of SCRAPECREATORS_API_KEY)" ]] && echo set || echo MISSING)"
if [[ "$target" == "prod" && ( -z "$(setting_of ANALYTICS_PUBLIC_PLATFORMS)" || -z "$(setting_of SCRAPECREATORS_API_KEY)" ) ]]; then
  echo "Post stats would be off on prod: a secret above could not be read. Try again." >&2
  exit 1
fi

deploy_log="$(mktemp)"
trap 'rm -f "$env_file" "$deploy_log"' EXIT
scripts/insforge-env.sh "$target" compute deploy worker --name post-social-worker \
  --port 8080 --cpu shared-1x --memory 1024 --region iad --env-file "$env_file" \
  --always-on | tee "$deploy_log"  # it polls for jobs and gets no web traffic to wake it

# InsForge can stop the new machine seconds after launching it, even when always-on (seen
# on dev 2026-11-02: launched, then stopped 15s later, and no jobs ran until a request woke
# it). A request to it starts it again, so wait out that window, then wake it and check it.
endpoint="$(grep -oE 'https://[^ ]+\.fly\.dev' "$deploy_log" | head -1)"
[[ -n "$endpoint" ]] || { echo "Deployed, but couldn't find the worker's address to check it's running." >&2; exit 1; }
sleep 30
for _ in $(seq 1 12); do
  if curl -fsS -m 10 "$endpoint/health" >/dev/null 2>&1; then echo "Worker is running."; exit 0; fi
  sleep 5
done
echo "The worker isn't answering at $endpoint/health, so jobs may not run. Check it in the InsForge dashboard." >&2
exit 1
