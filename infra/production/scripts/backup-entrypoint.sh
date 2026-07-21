#!/bin/sh

set -eu

require_environment() {
  : "${POSTGRES_DB:?POSTGRES_DB is required}"
  : "${POSTGRES_USER:?POSTGRES_USER is required}"
  : "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
  : "${RESTIC_PASSWORD:?RESTIC_PASSWORD is required}"
  if [ -z "${RESTIC_REPOSITORY:-}" ]; then
    : "${S3_ENDPOINT:?S3_ENDPOINT is required}"
    : "${S3_BUCKET:?S3_BUCKET is required}"
    : "${S3_ACCESS_KEY:?S3_ACCESS_KEY is required}"
    : "${S3_SECRET_KEY:?S3_SECRET_KEY is required}"
  fi
}

configure_clients() {
  export PGPASSWORD="$POSTGRES_PASSWORD"
  if [ -z "${RESTIC_REPOSITORY:-}" ]; then
    export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY"
    export AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY"
    export AWS_DEFAULT_REGION="${S3_REGION:-hel1}"
    export RESTIC_REPOSITORY="s3:${S3_ENDPOINT%/}/${S3_BUCKET}/postgres"
  fi
}

ensure_repository() {
  if restic cat config >/dev/null 2>&1; then
    return
  fi

  echo "Restic repository is not initialized; initializing it now"
  restic init
}

backup_database() {
  dump_path=/backup/postgres.dump
  rm -f "$dump_path"

  pg_dump \
    --host="${PGHOST:-postgres}" \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --format=custom \
    --compress=zstd:9 \
    --no-owner \
    --file="$dump_path"
  pg_restore --list "$dump_path" >/dev/null

  restic backup "$dump_path" \
    --host="${BACKUP_HOST:-mightycringe-production}" \
    --tag=postgres \
    --tag=logical
  rm -f "$dump_path"

  restic forget \
    --host="${BACKUP_HOST:-mightycringe-production}" \
    --tag=postgres \
    --keep-daily="${BACKUP_KEEP_DAILY:-14}" \
    --keep-weekly="${BACKUP_KEEP_WEEKLY:-8}" \
    --keep-monthly="${BACKUP_KEEP_MONTHLY:-12}" \
    --prune
  restic check --read-data-subset="${RESTIC_CHECK_SUBSET:-5%}"
}

verify_restore() {
  restore_root=/restore
  dump_path="$restore_root/backup/postgres.dump"
  find "$restore_root" -mindepth 1 -delete

  restic restore latest \
    --host="${BACKUP_HOST:-mightycringe-production}" \
    --tag=postgres \
    --target="$restore_root"
  test -s "$dump_path"
  pg_restore --list "$dump_path" >/dev/null
  pg_restore \
    --host="${RESTORE_PGHOST:-restore-postgres}" \
    --username="$POSTGRES_USER" \
    --dbname="${RESTORE_POSTGRES_DB:-mightycringe_restore}" \
    --no-owner \
    --no-privileges \
    --exit-on-error \
    "$dump_path"

  schema_ready=$(psql \
    --host="${RESTORE_PGHOST:-restore-postgres}" \
    --username="$POSTGRES_USER" \
    --dbname="${RESTORE_POSTGRES_DB:-mightycringe_restore}" \
    --no-psqlrc \
    --tuples-only \
    --no-align \
    --command="SELECT to_regclass('public.users') IS NOT NULL AND to_regclass('public.workouts') IS NOT NULL AND to_regclass('public.sets') IS NOT NULL;")
  test "$schema_ready" = "t"
  echo "Restore verification succeeded: core application tables are readable"
}

umask 077
require_environment
configure_clients

case "${1:-backup}" in
  backup)
    ensure_repository
    backup_database
    ;;
  verify)
    restic cat config >/dev/null
    verify_restore
    ;;
  *)
    echo "Usage: mighty-cringe-backup [backup|verify]" >&2
    exit 64
    ;;
esac
