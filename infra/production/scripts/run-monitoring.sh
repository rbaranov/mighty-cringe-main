#!/bin/sh

set -u

: "${PRODUCTION_DIR:?PRODUCTION_DIR is required}"
: "${PRODUCTION_ENV_FILE:?PRODUCTION_ENV_FILE is required}"
: "${HEALTHCHECKS_PING_URL:?HEALTHCHECKS_PING_URL is required}"

monitor_state_dir=${MONITOR_STATE_DIR:-/var/lib/mighty-cringe/monitoring}
domain=${DOMAIN:-mightycringe.com}
public_health_url=${MONITOR_PUBLIC_HEALTH_URL:-https://$domain/health}
disk_paths=${MONITOR_DISK_PATHS:-/ /var/lib/docker}
disk_critical_percent=${MONITOR_DISK_CRITICAL_PERCENT:-90}
backup_max_age=${MONITOR_BACKUP_MAX_AGE_SECONDS:-129600}
restore_max_age=${MONITOR_RESTORE_MAX_AGE_SECONDS:-3456000}
healthchecks_url=${HEALTHCHECKS_PING_URL%/}
failures=

case "$disk_critical_percent:$backup_max_age:$restore_max_age" in
  *[!0-9:]* | :* | *: | *::* )
    echo "Monitoring thresholds must be positive integers" >&2
    exit 64
    ;;
esac
if [ "$disk_critical_percent" -lt 1 ] || [ "$disk_critical_percent" -gt 100 ] || \
  [ "$backup_max_age" -lt 1 ] || [ "$restore_max_age" -lt 1 ]; then
  echo "Disk threshold must be 1-100 and freshness limits must be positive" >&2
  exit 64
fi

cd "$PRODUCTION_DIR"

exec 9>"$monitor_state_dir/monitor.lock"
if ! flock -n 9; then
  echo "Another production monitoring run is still active" >&2
  exit 75
fi

compose() {
  docker compose --env-file "$PRODUCTION_ENV_FILE" "$@"
}

record_failure() {
  failure=$1
  if [ -z "$failures" ]; then
    failures="- $failure"
  else
    failures="$failures
- $failure"
  fi
  echo "CRITICAL: $failure" >&2
}

send_healthchecks_signal() {
  suffix=$1
  body=${2:-}
  if [ -n "$body" ]; then
    printf '%s\n' "$body" | curl --fail --silent --show-error --max-time 10 --retry 2 \
      --retry-all-errors --header 'Content-Type: text/plain; charset=utf-8' --data-binary @- \
      "$healthchecks_url$suffix" >/dev/null
  else
    curl --fail --silent --show-error --max-time 10 --retry 2 --retry-all-errors \
      "$healthchecks_url$suffix" >/dev/null
  fi
}

check_freshness() {
  stamp=$1
  max_age=$2
  label=$3

  if [ ! -f "$stamp" ]; then
    record_failure "$label has no successful run recorded"
    return
  fi

  now=$(date +%s)
  modified=$(stat -c %Y "$stamp" 2>/dev/null || true)
  case "$modified" in
    '' | 0) modified=$(stat -f %m "$stamp" 2>/dev/null || true) ;;
  esac
  case "$modified" in
    '' | *[!0-9]*)
      record_failure "$label success timestamp cannot be read"
      return
      ;;
  esac

  age=$((now - modified))
  if [ "$age" -gt "$max_age" ]; then
    record_failure "$label is stale (${age}s old; limit ${max_age}s)"
  fi
}

# A failed start signal must never prevent the checks themselves from running. A missing final
# signal still lets Healthchecks.io detect a dead host or broken network after the grace period.
send_healthchecks_signal /start || echo "Could not send monitoring start signal" >&2

if ! curl --fail --silent --show-error --max-time 10 --retry 2 --retry-all-errors \
  --output /dev/null "$public_health_url"; then
  record_failure "public HTTPS health endpoint is unavailable"
fi

running_services=$(compose ps --status running --services 2>/dev/null || true)
for service in caddy web api postgres; do
  if ! printf '%s\n' "$running_services" | grep -Fqx "$service"; then
    record_failure "container service $service is not running"
  fi
done

if ! compose exec --no-TTY postgres sh -c \
  'pg_isready --quiet -U "$POSTGRES_USER" -d "$POSTGRES_DB"'; then
  record_failure "PostgreSQL is not accepting connections"
fi

for timer in mighty-cringe-backup.timer mighty-cringe-restore-check.timer; do
  if ! systemctl is-enabled --quiet "$timer"; then
    record_failure "$timer is not enabled"
  elif ! systemctl is-active --quiet "$timer"; then
    record_failure "$timer is not active"
  fi
done

for service in mighty-cringe-backup.service mighty-cringe-restore-check.service; do
  if systemctl is-failed --quiet "$service"; then
    record_failure "$service most recently failed"
  fi
done

check_freshness "$monitor_state_dir/last-backup-success" "$backup_max_age" "encrypted backup"
check_freshness "$monitor_state_dir/last-restore-check-success" "$restore_max_age" \
  "isolated restore verification"

for path in $disk_paths; do
  usage=$(df -P "$path" 2>/dev/null | awk 'NR == 2 { gsub("%", "", $5); print $5 }')
  case "$usage" in
    '' | *[!0-9]*)
      record_failure "disk usage for $path cannot be read"
      ;;
    *)
      if [ "$usage" -ge "$disk_critical_percent" ]; then
        record_failure "disk usage for $path is ${usage}% (limit ${disk_critical_percent}%)"
      fi
      ;;
  esac

  inode_usage=$(df -Pi "$path" 2>/dev/null | awk 'NR == 2 { gsub("%", "", $5); print $5 }')
  case "$inode_usage" in
    '' | *[!0-9]*)
      record_failure "inode usage for $path cannot be read"
      ;;
    *)
      if [ "$inode_usage" -ge "$disk_critical_percent" ]; then
        record_failure "inode usage for $path is ${inode_usage}% (limit ${disk_critical_percent}%)"
      fi
      ;;
  esac
done

if [ -n "$failures" ]; then
  diagnostic="MightyCringe production monitoring failed on $domain:
$failures"
  send_healthchecks_signal /fail "$diagnostic" || \
    echo "Could not send monitoring failure signal" >&2
  exit 1
fi

if ! send_healthchecks_signal '' "MightyCringe production checks passed on $domain"; then
  echo "Checks passed, but the success heartbeat could not be delivered" >&2
  exit 69
fi

echo "All production checks passed"
