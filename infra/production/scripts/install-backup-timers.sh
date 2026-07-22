#!/bin/sh

set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this installer as root" >&2
  exit 77
fi
if [ "$#" -ne 1 ]; then
  echo "Usage: install-backup-timers.sh <production-directory>" >&2
  exit 64
fi

production_dir=$(CDPATH= cd -- "$1" && pwd)
test -f "$production_dir/compose.yaml"

install -d -m 0755 /usr/local/lib/mighty-cringe
install -d -m 0750 -o deploy -g deploy /var/lib/mighty-cringe/monitoring
install -m 0755 "$production_dir/scripts/run-backup.sh" /usr/local/lib/mighty-cringe/run-backup.sh
install -m 0644 "$production_dir/systemd/mighty-cringe-backup.service" /etc/systemd/system/
install -m 0644 "$production_dir/systemd/mighty-cringe-backup.timer" /etc/systemd/system/
install -m 0644 "$production_dir/systemd/mighty-cringe-restore-check.service" /etc/systemd/system/
install -m 0644 "$production_dir/systemd/mighty-cringe-restore-check.timer" /etc/systemd/system/

install -d -m 0750 -o deploy -g deploy /etc/mighty-cringe
{
  printf 'PRODUCTION_DIR="%s"\n' "$production_dir"
  printf 'PRODUCTION_ENV_FILE="%s"\n' /etc/mighty-cringe/production.env
  printf 'MONITOR_STATE_DIR="%s"\n' /var/lib/mighty-cringe/monitoring
} > /etc/mighty-cringe/backup-runner.env
chown root:deploy /etc/mighty-cringe/backup-runner.env
chmod 0640 /etc/mighty-cringe/backup-runner.env

systemctl daemon-reload
systemctl enable --now mighty-cringe-backup.timer mighty-cringe-restore-check.timer
