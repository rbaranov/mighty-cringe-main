#!/bin/sh

set -eu

production_dir=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT INT TERM

fake_bin="$test_root/bin"
state_dir="$test_root/state"
calls_file="$test_root/curl-calls"
mkdir -p "$fake_bin" "$state_dir"
touch "$state_dir/last-backup-success" "$state_dir/last-restore-check-success"

cat > "$fake_bin/curl" <<'EOF'
#!/bin/sh
last=
for argument in "$@"; do
  last=$argument
done
printf '%s\n' "$last" >> "$FAKE_CURL_CALLS"
if [ "$last" = "$HEALTHCHECKS_PING_URL/fail" ]; then
  cat >> "$FAKE_CURL_CALLS"
fi
EOF

cat > "$fake_bin/docker" <<'EOF'
#!/bin/sh
case "$*" in
  *"ps --status running --services"*)
    printf '%s\n' caddy web api postgres
    ;;
  *"exec --no-TTY postgres"*)
    exit "${FAKE_POSTGRES_STATUS:-0}"
    ;;
  *)
    exit 64
    ;;
esac
EOF

cat > "$fake_bin/systemctl" <<'EOF'
#!/bin/sh
case "$1" in
  is-enabled | is-active)
    exit 0
    ;;
  is-failed)
    exit 1
    ;;
esac
exit 64
EOF

cat > "$fake_bin/df" <<'EOF'
#!/bin/sh
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
printf '/dev/fake 100 50 50 %s%% /\n' "${FAKE_DISK_PERCENT:-50}"
EOF

cat > "$fake_bin/flock" <<'EOF'
#!/bin/sh
exit 0
EOF

chmod +x "$fake_bin/curl" "$fake_bin/docker" "$fake_bin/systemctl" "$fake_bin/df" \
  "$fake_bin/flock"

run_monitor() {
  PATH="$fake_bin:$PATH" \
    FAKE_CURL_CALLS="$calls_file" \
    HEALTHCHECKS_PING_URL=https://hc-ping.example/test-check \
    PRODUCTION_DIR="$production_dir" \
    PRODUCTION_ENV_FILE="$production_dir/backup-test.env" \
    MONITOR_STATE_DIR="$state_dir" \
    MONITOR_PUBLIC_HEALTH_URL=https://mightycringe.example/health \
    MONITOR_DISK_PATHS=/ \
    "$production_dir/scripts/run-monitoring.sh"
}

run_monitor
grep -Fqx 'https://hc-ping.example/test-check/start' "$calls_file"
grep -Fqx 'https://hc-ping.example/test-check' "$calls_file"

: > "$calls_file"
if FAKE_DISK_PERCENT=95 run_monitor; then
  echo "Monitoring unexpectedly accepted critical disk usage" >&2
  exit 1
fi
grep -Fqx 'https://hc-ping.example/test-check/fail' "$calls_file"
grep -Fq 'disk usage for / is 95%' "$calls_file"

echo "Monitoring success and critical failure paths passed"
