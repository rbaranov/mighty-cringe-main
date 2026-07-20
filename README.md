# Mighty & Cringe

Offline-first PWA for strength training: workout logging, exercise catalog, progress, voice
capture and read-only coach access.

## Repository layout

- `apps/web` — React PWA.
- `apps/api` — Fastify API and authorization boundary.
- `apps/worker` — asynchronous work: voice processing, push and retries.
- `packages/contracts` — API contracts and shared domain types.
- `packages/db` — PostgreSQL schema and Drizzle migrations.
- `infra/production` — production Docker Compose and Caddy configuration.

## Local development

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm dev
```

The frontend is served at `http://localhost:5173`; the API at `http://localhost:3000`.
Without `DATABASE_URL`, the API runs in deliberately limited in-memory development mode.
Production always requires PostgreSQL.

## Production target

- `mightycringe.com` — PWA and API under `/api`.
- Hetzner Cloud, Helsinki, x86 cost-optimized instance.
- PostgreSQL on the private Docker network.
- Private Hetzner Object Storage bucket in Helsinki for raw audio and encrypted backups.

See [ADR 0001](docs/adr/0001-production-platform.md) for the decision and
[production README](infra/production/README.md) for deployment prerequisites.

## Current implementation boundary

The initial vertical slice is deliberately limited to a local-first athlete flow: catalog,
start-workout, manual set logging, idempotent sync API and PostgreSQL migrations. Google OAuth,
voice transcription, trainer/admin consoles, push, media uploads and measurements are separate
subsequent slices. Do not admit real users to a public deployment until OAuth and backup automation
are complete.
