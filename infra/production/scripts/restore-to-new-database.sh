#!/bin/sh

set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: restore-to-new-database.sh <new-database-name>" >&2
  exit 64
fi

target_database=$1
case "$target_database" in
  "" | [0-9]* | *[!A-Za-z0-9_]*)
    echo "Database name must start with a letter or underscore and contain only letters, digits and underscores" >&2
    exit 64
    ;;
  *) ;;
esac
if [ "${#target_database}" -gt 63 ]; then
  echo "Database name must be at most 63 characters" >&2
  exit 64
fi

production_dir=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
production_env_file=${PRODUCTION_ENV_FILE:-/etc/mighty-cringe/production.env}
cd "$production_dir"

compose() {
  PRODUCTION_ENV_FILE="$production_env_file" docker compose \
    --env-file "$production_env_file" \
    --profile backup \
    "$@"
}

current_database=$(compose exec --no-TTY postgres sh -c 'printf "%s" "$POSTGRES_DB"')
if [ "$target_database" = "$current_database" ]; then
  echo "Refusing to restore over the active production database" >&2
  exit 73
fi

compose exec --no-TTY postgres sh -c \
  'createdb --username="$POSTGRES_USER" --maintenance-db=postgres "$1"' \
  restore-to-new-database "$target_database"
compose run --rm --no-deps \
  --env RESTORE_PGHOST=postgres \
  --env RESTORE_POSTGRES_DB="$target_database" \
  backup verify

echo "Restore into $target_database succeeded. Do not switch production until the application checks in the recovery runbook pass."
