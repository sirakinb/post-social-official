#!/usr/bin/env bash
# Replaces the old Convex app on vibrant-donkey-218 with the forwarder in convex/, then deletes
# the old app's data. Run from a Mac terminal: ops/convex-forwarder/deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

DEPLOYMENT="vibrant-donkey-218"
SITE="https://$DEPLOYMENT.convex.site"

echo "Paste a deploy key for $DEPLOYMENT (Convex dashboard > $DEPLOYMENT > Settings > Deploy key)."
read -r -s -p "Deploy key (hidden): " CONVEX_DEPLOY_KEY; echo
[[ "$CONVEX_DEPLOY_KEY" == *":$DEPLOYMENT|"* ]] || { echo "That key isn't for $DEPLOYMENT. Nothing changed." >&2; exit 1; }
export CONVEX_DEPLOY_KEY

echo
echo "This replaces everything on $DEPLOYMENT with the forwarder, stops its old scheduled jobs,"
echo "and then permanently deletes the old app's data (accounts, posts, logins, files)."
read -r -p "Type 'convex' to continue: " answer
[[ "$answer" == "convex" ]] || { echo "Cancelled." >&2; exit 1; }

npm install --silent
if [[ "$CONVEX_DEPLOY_KEY" == dev:* ]]; then
  npx convex dev --once --typecheck disable
else
  npx convex deploy -y --typecheck disable
fi

# The TikTok sign-in must now go straight on to InsForge.
location="$(curl -s -o /dev/null -w '%{redirect_url}' "$SITE/api/oauth/tiktok/callback?state=check")"
if [[ "$location" != https://syydd6ck.function2.insforge.app/connections/oauth/tiktok/callback\?state=check ]]; then
  echo "The TikTok forward isn't answering as expected (got: '${location}'). Stopping before deleting any data." >&2
  exit 1
fi
echo "TikTok forward works."

echo "Deleting the old app's data..."
for _ in $(seq 1 2000); do
  result="$(npx convex run cleanup:deleteBatch)"
  if grep -q '"done": *true' <<<"$result"; then echo "All old data deleted."; exit 0; fi
  printf '.'
done
echo
echo "Stopped after many batches; run this script again to finish." >&2
exit 1
