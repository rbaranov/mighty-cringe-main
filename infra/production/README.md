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

## First deployment

Start the **Deploy production** workflow manually after the self-hosted runner is online.
The workflow checks out `main` and runs Docker Compose with the private environment file at
`/etc/mighty-cringe/production.env`.

Caddy obtains and renews TLS certificates after the domain records resolve to the server. The
`migrate` applies the committed Drizzle migrations before the API starts. PostgreSQL is private:
it has no published host port. To start the optional worker later, use
`docker compose --profile worker up -d`.

## Backup policy before admitting real data

1. Archive PostgreSQL WAL continuously to the private object bucket.
2. Run an encrypted base backup every 24 hours and test a restore every month.
3. Store raw audio in the object bucket as soon as it reaches the server; only temporary local
   files may live on the VPS.
4. Enable server snapshots as an additional recovery mechanism, not as the sole backup.

The application must not begin retaining user audio until steps 1–3 are automated and tested.
