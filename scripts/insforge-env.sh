#!/usr/bin/env bash
# Run InsForge CLI commands against dev or prod, and promote migrations dev -> prod.
#
#   scripts/insforge-env.sh dev  <insforge args...>   e.g. dev db migrations up --all
#   scripts/insforge-env.sh prod <insforge args...>   read-only checks on prod (asks first)
#   scripts/insforge-env.sh promote                   apply git migrations to prod
#
# The folder is linked to the dev branch by default. Prod is reached only through
# this script, which switches to the parent project and always switches back.
# (INSFORGE_PROJECT_ID does not redirect db commands, so never rely on it.)
set -euo pipefail

cd "$(dirname "$0")/.."
CLI=(npx -y @insforge/cli)
PROD_NAME="post-social"
DEV_BRANCH="dev"

linked_name() {
  python3 -c "import json; print(json.load(open('.insforge/project.json'))['project_name'])"
}

ensure_dev() {
  if [[ "$(linked_name)" != "$DEV_BRANCH" ]]; then
    "${CLI[@]}" branch switch "$DEV_BRANCH" >/dev/null
  fi
  [[ "$(linked_name)" == "$DEV_BRANCH" ]] || { echo "Could not link to dev" >&2; exit 1; }
}

require_releasable_main() {
  [[ "$(git rev-parse --abbrev-ref HEAD)" == "main" ]] || { echo "Prod changes only from main." >&2; exit 1; }
  [[ -z "$(git status --porcelain -- migrations)" ]] || { echo "Uncommitted migration files." >&2; exit 1; }
  git fetch -q origin main
  [[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || { echo "main is not in sync with origin/main." >&2; exit 1; }
}

confirm_prod() {
  local answer
  read -r -p "This touches PROD ($PROD_NAME). Type 'prod' to continue: " answer
  [[ "$answer" == "prod" ]] || { echo "Cancelled." >&2; exit 1; }
}

with_prod() {
  trap ensure_dev EXIT
  "${CLI[@]}" branch switch --parent >/dev/null
  [[ "$(linked_name)" == "$PROD_NAME" ]] || { echo "Could not link to prod" >&2; exit 1; }
  "$@"
}

target="${1:-}"
shift || true

case "$target" in
  dev)
    ensure_dev
    "${CLI[@]}" "$@"
    ;;
  prod)
    confirm_prod
    with_prod "${CLI[@]}" "$@"
    ;;
  promote)
    require_releasable_main
    ensure_dev
    echo "== Applied on dev:";  "${CLI[@]}" db migrations list
    with_prod bash -c '
      echo "== Applied on prod:"; "$@" db migrations list
      echo "== Local migration files:"; ls migrations 2>/dev/null || true
      read -r -p "Apply all pending migrations to PROD? Type prod: " a
      [[ "$a" == "prod" ]] || { echo "Cancelled." >&2; exit 1; }
      "$@" db migrations up --all
      echo "Done. Redeploy prod functions and the worker if they depend on this change."
    ' _ "${CLI[@]}"
    ;;
  *)
    sed -n '2,6p' "$0" >&2
    exit 1
    ;;
esac
