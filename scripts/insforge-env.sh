#!/usr/bin/env bash
# Run InsForge CLI commands against dev or prod, and promote migrations dev -> prod.
#
#   scripts/insforge-env.sh dev  <insforge args...>   e.g. dev db migrations up --all
#   scripts/insforge-env.sh prod <insforge args...>   read-only commands anywhere; anything
#                                                     else only from a synced main
#   scripts/insforge-env.sh promote                   apply git migrations and insforge.toml to prod
#
# The folder is linked to the dev branch by default. Prod is reached only through
# this script, which switches to the parent project and always switches back.
# (INSFORGE_PROJECT_ID does not redirect db commands, so never rely on it.)
set -euo pipefail

cd "$(dirname "$0")/.."
# Pinned so the CLI that applied a migration on dev is the one that applies it on prod.
INSFORGE_CLI_VERSION="0.2.8"
CLI=(npx -y "@insforge/cli@${INSFORGE_CLI_VERSION}")
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

switch_to_prod() {
  trap ensure_dev EXIT
  "${CLI[@]}" branch switch --parent >/dev/null
  [[ "$(linked_name)" == "$PROD_NAME" ]] || { echo "Could not link to prod" >&2; exit 1; }
}

require_releasable_main() {
  [[ "$(git rev-parse --abbrev-ref HEAD)" == "main" ]] || { echo "Prod changes only from main." >&2; exit 1; }
  [[ -z "$(git status --porcelain)" ]] || { echo "Working tree has uncommitted changes." >&2; exit 1; }
  git fetch -q origin main
  [[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || { echo "main is not in sync with origin/main." >&2; exit 1; }
}

confirm_prod() {
  local answer
  read -r -p "$1 Type 'prod' to continue: " answer
  [[ "$answer" == "prod" ]] || { echo "Cancelled." >&2; exit 1; }
}

# Commands that only read state. Everything else counts as a change to prod.
is_read_only() {
  case "$*" in
    "current"*|"metadata"*|"whoami"*|"branch list"*|"logs "*|"diagnose"*) return 0 ;;
    "db migrations list"*|"secrets list"*|"secrets get "*|"config plan"*) return 0 ;;
    "functions list"*|"functions code "*|"schedules list"*|"schedules get "*|"schedules logs "*) return 0 ;;
    "storage buckets"*|"storage list-objects "*|"backups list"*|"backups latest"*) return 0 ;;
    *) return 1 ;;
  esac
}

# Prints the applied migration versions of the linked environment, one per line.
applied_versions() {
  "${CLI[@]}" db migrations list --json 2>/dev/null \
    | python3 -c "import json,sys; [print(int(m['version'])) for m in json.load(sys.stdin)['migrations']]"
}

local_versions() {
  for f in migrations/*.sql; do
    [[ -e "$f" ]] || continue
    echo $((10#$(basename "$f" | cut -d_ -f1)))
  done
}

target="${1:-}"
shift || true

case "$target" in
  dev)
    ensure_dev
    "${CLI[@]}" "$@"
    ;;
  prod)
    if [[ "$*" == "db migrations up"* ]]; then
      echo "Apply migrations to prod with: npm run db:promote (it checks dev first)." >&2
      exit 1
    fi
    if is_read_only "$@"; then
      confirm_prod "Read-only command on PROD ($PROD_NAME)."
    else
      require_releasable_main
      confirm_prod "This CHANGES PROD ($PROD_NAME): $*."
    fi
    switch_to_prod
    "${CLI[@]}" "$@"
    ;;
  promote)
    require_releasable_main
    ensure_dev
    # Captured in variables so a failed lookup stops the script (set -e) instead of
    # silently comparing against an empty list.
    local_list="$(local_versions | sort)"
    dev_applied="$(applied_versions | sort)"
    missing_on_dev="$(comm -23 <(echo "$local_list") <(echo "$dev_applied"))"
    if [[ -n "$missing_on_dev" ]]; then
      echo "These migrations were never applied to dev. Run npm run db:dev and test first:" >&2
      echo "$missing_on_dev" >&2
      exit 1
    fi
    switch_to_prod
    prod_applied="$(applied_versions | sort)"
    pending="$(comm -23 <(echo "$local_list") <(echo "$prod_applied"))"
    if [[ -n "$pending" ]]; then
      echo "Pending migrations on prod (all verified on dev):"
      echo "$pending"
      confirm_prod "Apply these migrations to PROD ($PROD_NAME)?"
      "${CLI[@]}" db migrations up --all
    else
      echo "Prod migrations are up to date."
    fi
    # Project settings (insforge.toml): sign-up, password policy, redirects.
    config_changes="$("${CLI[@]}" config plan --json 2>/dev/null \
      | python3 -c "import json,sys; print(len(json.load(sys.stdin)['changes']))")"
    if [[ "$config_changes" != "0" ]]; then
      "${CLI[@]}" config plan
      confirm_prod "Apply these settings to PROD ($PROD_NAME)?"
      "${CLI[@]}" config apply --auto-approve
    else
      echo "Prod settings are up to date."
    fi
    echo "Done. Redeploy prod functions and the worker if they depend on this change."
    ;;
  *)
    sed -n '2,7p' "$0" >&2
    exit 1
    ;;
esac
