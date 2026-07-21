# Production deployment

## Chosen platform

Create a Hetzner Cloud **CPX12** (x86 regular performance) in Helsinki with Ubuntu 24.04 LTS.
It is intentionally independent from `emirtest.kz`. Pair it with a private Hetzner Object Storage
bucket in Helsinki. The current plan is intentionally lean for the initial PWA, API, and
PostgreSQL. The optional worker is disabled by default; the server can later be resized without
changing the application architecture.

For the full setup procedure, see
[Hetzner first deployment](../../docs/deployment/hetzner-first-deploy.md).

## One-time provider setup

1. Create a Hetzner project, a Helsinki CPX12 server and firewall. Create the private Object Storage
   bucket before the application begins retaining real audio or user data.
2. At Prokbun, point `mightycringe.com` and `www.mightycringe.com` to the server's IPv4 address;
   add IPv6 too when the server has a primary IPv6 address.
3. Open inbound TCP 80/443 to the world and TCP 22 only from your administrative IP or VPN.
4. Add a non-root deploy user with an SSH key. Disable password SSH login and root login.
5. Register a self-hosted GitHub Actions runner under that user. It checks out private code using
   GitHub's short-lived workflow token, so no GitHub deploy key or personal access token is stored
   on the server.
6. Create `/etc/mighty-cringe/production.env` with a unique database password; never commit it.

## Deployment

After the self-hosted runner is online, merge changes into `main`. CI verifies formatting,
types, the application build, and tests on a GitHub-hosted runner. Only a successful CI run for
the current head of `main` calls **Deploy production**. The production runner checks out that
exact revision, validates the private environment file at `/etc/mighty-cringe/production.env`,
applies migrations through Docker Compose, starts the services, and verifies the public HTTPS
health endpoint. Deployments are serialized and a stale revision is skipped.

The **Deploy production** workflow can also be started manually on `main` to repeat a controlled
deployment of its current revision. A failed Compose operation or health check keeps the Actions
run red and includes service status and bounded logs for diagnosis.

Caddy obtains and renews TLS certificates after the domain records resolve to the server. The
`migrate` applies the committed Drizzle migrations before the API starts. PostgreSQL is private:
it has no published host port. To start the optional worker later, use
`docker compose --profile worker up -d`.

## Backup policy before admitting real data

Production installs two systemd timers during every deployment:

- `mighty-cringe-backup.timer` creates a client-side encrypted logical PostgreSQL backup daily,
  retains 14 daily, 8 weekly and 12 monthly snapshots, and validates repository data;
- `mighty-cringe-restore-check.timer` restores the latest snapshot into an isolated tmpfs-backed
  PostgreSQL container every month and verifies the core tables.

The timers only become operational after the private Helsinki bucket, S3 credentials and independent
`RESTIC_PASSWORD` are present in `/etc/mighty-cringe/production.env`. Keep an offline password copy.
The current RPO is 24 hours and the RTO target is four hours. Server snapshots are an additional
recovery mechanism, never the sole backup. Raw audio must use the private object bucket when audio
retention is implemented.

Every production deployment builds the backup image, creates a fresh encrypted snapshot, and proves
that the latest snapshot restores into an isolated PostgreSQL container before installing the timers.
For an incident, follow the exact non-overwriting recovery procedure in
[Hetzner first deployment](../../docs/deployment/hetzner-first-deploy.md#полное-восстановление-после-потери-postgresql).

## Monitoring and logs

Production also installs `mighty-cringe-monitor.timer`. Every five minutes it verifies the public
HTTPS endpoint, the required Compose services, PostgreSQL readiness, backup timers, the age of the
latest successful backup and restore check, and disk usage. It then sends a success or failure signal
to Healthchecks.io. A missed signal detects a dead VPS or lost network; an explicit failure includes
only bounded operational diagnostics and never application data or credentials.

Before deploying, create a Healthchecks.io check with a five-minute period and ten-minute grace time,
attach an owner notification integration, and add its secret UUID ping URL as
`HEALTHCHECKS_PING_URL` in `/etc/mighty-cringe/production.env`. The deployment intentionally fails
closed while this value is missing. See the
[first-deploy runbook](../../docs/deployment/hetzner-first-deploy.md#9-мониторинг-и-уведомления).

Compose uses Docker's `local` logging driver with three 10 MB files per container. Caddy access logs
and application logs remain available through `docker compose logs`; host and timer logs remain in
journald for up to 30 days, capped at 256 MB while preserving at least 1 GB of free space.

The application must not begin retaining user audio until steps 1–3 are automated and tested.
