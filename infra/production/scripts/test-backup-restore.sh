#!/bin/sh

set -eu

production_dir=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$production_dir"

compose() {
  PRODUCTION_ENV_FILE="$production_dir/backup-test.env" docker compose \
    --env-file "$production_dir/backup-test.env" \
    --file compose.yaml \
    --file compose.backup-test.yaml \
    --profile backup \
    "$@"
}

cleanup() {
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
cleanup

compose build backup
compose up --detach --wait postgres
compose exec --no-TTY postgres psql \
  --username=mightycringe \
  --dbname=mightycringe \
  --set=ON_ERROR_STOP=1 \
  --command='CREATE TABLE users (id uuid PRIMARY KEY); CREATE TABLE workouts (id uuid PRIMARY KEY); CREATE TABLE sets (id uuid PRIMARY KEY);'
compose run --rm backup backup
compose up --detach --wait restore-postgres
compose run --rm --no-deps backup verify
