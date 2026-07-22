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
`LOCAL_DEMO_AUTH=true` from the example environment signs in a disposable local athlete so the full
interface can be tested without production OAuth credentials. The API ignores this flag when
`NODE_ENV=production`. Production always requires PostgreSQL and configured Google OAuth.

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
