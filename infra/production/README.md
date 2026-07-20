# Production deployment

## Chosen platform

Create a Hetzner Cloud **CX33** (x86 cost-optimized) in Helsinki with Ubuntu 24.04 LTS.
It is intentionally independent from `emirtest.kz`. Pair it with a private Hetzner Object Storage
bucket in Helsinki. The current plan has ample headroom for the initial PWA, API, worker, and
PostgreSQL; it can later be resized without changing the application architecture.

## One-time provider setup

1. Create a Hetzner project, a Helsinki server, firewall and a private Object Storage bucket.
2. At Prokbun, point `mightycringe.com` and `www.mightycringe.com` to the server's IPv4 address;
   add IPv6 too when the server has a primary IPv6 address.
3. Open inbound TCP 80/443 to the world and TCP 22 only from your administrative IP or VPN.
4. Add a non-root deploy user with an SSH key. Disable password SSH login and root login.
5. Clone this private repository to `/srv/mighty-cringe`, create `.env` from `.env.example`, and
   generate a unique database password.

## First deployment

```bash
cd /srv/mighty-cringe/infra/production
cp .env.example .env
# Fill every value in .env; never commit it.
docker compose up -d --build
```

Caddy obtains and renews TLS certificates after the domain records resolve to the server. The
`migrate` applies the committed Drizzle migrations before the API and worker start. PostgreSQL is
private: it has no published host port.

## Backup policy before admitting real data

1. Archive PostgreSQL WAL continuously to the private object bucket.
2. Run an encrypted base backup every 24 hours and test a restore every month.
3. Store raw audio in the object bucket as soon as it reaches the server; only temporary local
   files may live on the VPS.
4. Enable server snapshots as an additional recovery mechanism, not as the sole backup.

The application must not begin retaining user audio until steps 1–3 are automated and tested.
