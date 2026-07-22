# Production deployment

## Chosen platform

Create a Hetzner Cloud **CPX12** (x86 regular performance) in Helsinki with Ubuntu 24.04 LTS.
It is intentionally independent from `emirtest.kz`. Pair it with a private Hetzner Object Storage
bucket in Helsinki. The current plan is intentionally lean for the initial PWA, API, worker, and
PostgreSQL; the server can later be resized without changing the application architecture.

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
6. Create `/etc/mighty-cringe/production.env` with a unique database password, Google OAuth Web
   client credentials and optional comma-separated `TRAINER_EMAILS`. Copy the optional voice and
   VAPID groups from `.env.example` only when every value in the corresponding group is ready;
   otherwise leave the whole group empty. Never commit this file. Authorize
   the exact redirect URI
   `https://mightycringe.com/api/v1/auth/google/callback` in Google Cloud Console.

## Deployment

After the self-hosted runner is online, merge changes into `main`. CI verifies formatting,
types, the application build, and tests on a GitHub-hosted runner. Only a successful CI run for
the current head of `main` calls **Deploy production**. The production runner checks out that
exact revision, validates the private environment file at `/etc/mighty-cringe/production.env`,
applies migrations through Docker Compose, starts the services, and verifies the public HTTPS
health endpoint. Deployments are serialized and a stale revision is skipped.

The configuration preflight requires the core database and Google OAuth settings. Voice storage plus
OpenRouter transcription form one optional all-or-nothing capability, and the three VAPID values form
another. A completely empty optional capability stays disabled without blocking unrelated releases;
a partial group or an invalid 32-byte voice encryption key stops deployment before any containers are
changed. Validation reports setting names only and never prints their values.

The **Deploy production** workflow can also be started manually on `main` to repeat a controlled
deployment of its current revision. A failed Compose operation or health check keeps the Actions
run red and includes service status and bounded logs for diagnosis.

Caddy obtains and renews TLS certificates after the domain records resolve to the server. The
`migrate` applies the committed Drizzle migrations before the API and worker start. PostgreSQL is
private and has no published host port. The worker also publishes no port, but has outbound access
to encrypted Object Storage and OpenRouter.

## Backup policy before admitting real data

1. Archive PostgreSQL WAL continuously to the private object bucket.
2. Run an encrypted base backup every 24 hours and test a restore every month.
3. Store raw audio in a dedicated private voice bucket, encrypted with the configured SSE-C key as
   soon as it reaches the server; only temporary local files may live on the VPS.
4. Enable server snapshots as an additional recovery mechanism, not as the sole backup.

The application must not begin retaining user audio until steps 1–3 are automated and tested.

## One-time Web Push setup

Generate one VAPID key pair locally with
`pnpm --filter @mighty-cringe/push exec web-push generate-vapid-keys --json`. Store its public and
private values as `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in
`/etc/mighty-cringe/production.env`, and set `VAPID_SUBJECT` to a monitored `mailto:` address on the
product domain. Never commit the private key. Keep the pair stable: replacing it invalidates existing
browser subscriptions and requires athletes to opt in again.

After deployment, install the PWA on a phone, enable reminders from Settings, choose a schedule a few
minutes ahead, and verify one notification arrives outside the configured quiet hours. Then disable
reminders and confirm no later job is delivered. On iPhone/iPad, Web Push permission is available only
to a web app added to the Home Screen.
