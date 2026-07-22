#!/bin/sh

set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this installer as root" >&2
  exit 77
fi
if [ "$#" -ne 1 ]; then
  echo "Usage: install-monitoring-timer.sh <production-directory>" >&2
  exit 64
fi

production_dir=$(CDPATH= cd -- "$1" && pwd)
production_env_file=/etc/mighty-cringe/production.env
test -f "$production_dir/compose.yaml"
test -r "$production_env_file"

env_value() {
  key=$1
  sed -n "s/^${key}=//p" "$production_env_file" | tail -n 1
}

healthchecks_ping_url=$(env_value HEALTHCHECKS_PING_URL)
domain=$(env_value DOMAIN)
disk_critical_percent=$(env_value MONITOR_DISK_CRITICAL_PERCENT)
backup_max_age=$(env_value MONITOR_BACKUP_MAX_AGE_SECONDS)
restore_max_age=$(env_value MONITOR_RESTORE_MAX_AGE_SECONDS)

if ! printf '%s\n' "$healthchecks_ping_url" | \
  grep -Eq '^https://[-A-Za-z0-9._~:/?&=%+]+$'; then
  echo "HEALTHCHECKS_PING_URL must be an unquoted HTTPS URL in $production_env_file" >&2
  exit 78
fi
if ! printf '%s\n' "$domain" | grep -Eq '^[A-Za-z0-9.-]+$'; then
  echo "DOMAIN must contain a valid unquoted hostname in $production_env_file" >&2
  exit 78
fi
for value in "$disk_critical_percent" "$backup_max_age" "$restore_max_age"; do
  if [ -n "$value" ] && ! printf '%s\n' "$value" | grep -Eq '^[0-9]+$'; then
    echo "Monitoring thresholds must be unquoted integers in $production_env_file" >&2
    exit 78
  fi
done

install -d -m 0755 /usr/local/lib/mighty-cringe
install -d -m 0750 -o deploy -g deploy /var/lib/mighty-cringe/monitoring
install -d -m 0755 /etc/systemd/journald.conf.d
install -m 0755 "$production_dir/scripts/run-monitoring.sh" \
  /usr/local/lib/mighty-cringe/run-monitoring.sh
install -m 0644 "$production_dir/systemd/mighty-cringe-monitor.service" /etc/systemd/system/
install -m 0644 "$production_dir/systemd/mighty-cringe-monitor.timer" /etc/systemd/system/
install -m 0644 "$production_dir/systemd/60-mighty-cringe-journald.conf" \
  /etc/systemd/journald.conf.d/60-mighty-cringe.conf

{
  printf 'PRODUCTION_DIR="%s"\n' "$production_dir"
  printf 'PRODUCTION_ENV_FILE="%s"\n' "$production_env_file"
  printf 'MONITOR_STATE_DIR="%s"\n' /var/lib/mighty-cringe/monitoring
  printf 'HEALTHCHECKS_PING_URL="%s"\n' "$healthchecks_ping_url"
  printf 'DOMAIN="%s"\n' "$domain"
  if [ -n "$disk_critical_percent" ]; then
    printf 'MONITOR_DISK_CRITICAL_PERCENT="%s"\n' "$disk_critical_percent"
  fi
  if [ -n "$backup_max_age" ]; then
    printf 'MONITOR_BACKUP_MAX_AGE_SECONDS="%s"\n' "$backup_max_age"
  fi
  if [ -n "$restore_max_age" ]; then
    printf 'MONITOR_RESTORE_MAX_AGE_SECONDS="%s"\n' "$restore_max_age"
  fi
} > /etc/mighty-cringe/monitoring-runner.env
chown root:deploy /etc/mighty-cringe/monitoring-runner.env
chmod 0640 /etc/mighty-cringe/monitoring-runner.env

systemctl daemon-reload
systemctl restart systemd-journald
systemctl enable --now mighty-cringe-monitor.timer
