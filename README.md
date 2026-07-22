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
corepack enable
pnpm install --frozen-lockfile
pnpm local:doctor
pnpm local:dev
```

The frontend is served at `http://localhost:5173`; the API at `http://localhost:3000`.
The local command starts PostgreSQL in an isolated Docker Compose project or native `.local`
directory, applies migrations, and runs the PWA, API and worker on the host with hot reload. It
explicitly enables a development athlete without production OAuth credentials; the API ignores this
flag in production. Data is preserved across restarts. See the
[local runbook](docs/development/local-environment.md) for stop, status, reset and pre-merge
acceptance commands.

Plain `pnpm dev` remains available for deliberately limited in-memory development, but it is not the
pre-merge acceptance path.

## Production target

- `mightycringe.com` — PWA and API under `/api`.
- Hetzner Cloud, Helsinki, x86 cost-optimized instance.
- PostgreSQL on the private Docker network.
- Private Hetzner Object Storage bucket in Helsinki for raw audio and encrypted backups.

See [ADR 0001](docs/adr/0001-production-platform.md) for the decision and
[production README](infra/production/README.md) for deployment prerequisites.

## Current implementation boundary

The application includes local-first workout and measurement flows, deterministic typed commands,
Google OIDC sessions, trainer read-only access, private queued voice processing, opt-in push, and a
durable ordered outbox with explicit revision conflicts. Provider-backed voice and push remain
disabled until their complete production credential groups are configured. Unknown exercise names
can be researched through a server-side, citation-grounded search, explicitly confirmed, and saved
to the authenticated user's personal catalog. This search remains disabled until the server has
`OPENROUTER_API_KEY` and `EXERCISE_DISCOVERY_MODEL`.
