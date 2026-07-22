# ADR 0005: Production monitoring and owner alerts

- Status: accepted
- Date: 2026-07-21

## Context

The production VPS currently exposes a process health endpoint and writes container logs, but nobody
is notified if the host disappears, PostgreSQL stops, a backup silently becomes stale, or the disk
fills. Monitoring must remain small enough for the CPX12 host and must not copy user data or secrets
into a second observability platform.

## Decision

Run a host-level systemd oneshot every five minutes. It checks the public HTTPS endpoint, the four
required Compose services, PostgreSQL readiness, backup and restore timer state, successful-run stamp
ages, and the filesystems that contain production and Docker data. A 90% disk threshold, 36-hour
backup freshness limit and 40-day restore-verification limit are configurable through the production
environment.

Use a dedicated Healthchecks.io check as the external dead man's switch and alert router. Each run
sends a start event and either success or an explicit failure with bounded, non-sensitive diagnostic
text. If the VPS or its network disappears, the missing heartbeat becomes the alert. The check's UUID
URL is a secret stored only in the production environment. The owner must attach and test at least one
notification integration.

Keep logs on the VPS for the current scale. Caddy emits JSON access logs and Fastify emits application
logs to stdout/stderr. Docker's `local` logging driver rotates three 10 MB files per container. Journald
is persistent, capped at 256 MB and 30 days, and configured to preserve 1 GB of free space. Monitoring
and backup failures are therefore inspectable without creating an unbounded disk-growth path.

## Consequences

- The application cannot deploy this change until the owner creates a check and supplies
  `HEALTHCHECKS_PING_URL`; this is an intentional production gate.
- Healthchecks.io is used for heartbeat and notification delivery, not uptime probing, metrics, or log
  aggregation. The local script performs the probes and its missing heartbeat covers total host loss.
- The ping URL and diagnostic body must never contain credentials, user records, or application log
  excerpts. Detailed incident investigation stays in access-controlled host logs.
- A future multi-host deployment should replace the local checks with an external uptime probe,
  central metrics, and central log storage. Those systems are unnecessary overhead for the current
  single small VPS.
