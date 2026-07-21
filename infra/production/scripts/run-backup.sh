#!/bin/sh

set -eu

: "${PRODUCTION_DIR:?PRODUCTION_DIR is required}"
: "${PRODUCTION_ENV_FILE:?PRODUCTION_ENV_FILE is required}"

cd "$PRODUCTION_DIR"

lock_file=/tmp/mighty-cringe-postgres-backup.lock
exec 9>"$lock_file"
if ! flock -n 9; then
  echo "Another backup or restore verification is still running" >&2
  exit 75
fi

compose() {
  docker compose --env-file "$PRODUCTION_ENV_FILE" --profile backup "$@"
}

case "${1:-}" in
  backup)
    compose run --rm backup backup
    ;;
  verify)
    cleanup_restore_database() {
      compose rm --stop --force restore-postgres >/dev/null 2>&1 || true
    }
    trap cleanup_restore_database EXIT INT TERM
    cleanup_restore_database
    compose up --detach --wait restore-postgres
    compose run --rm --no-deps backup verify
    ;;
  *)
    echo "Usage: run-backup.sh [backup|verify]" >&2
    exit 64
    ;;
esac
