# ADR 0001: European single-node production platform

**Status:** Accepted on 2026-07-20

## Decision

Deploy the first production release to an x86 Hetzner Cloud cost-optimized server in Helsinki.
Serve `mightycringe.com` with Caddy and keep the PWA, API, worker, and PostgreSQL in a private
Docker network. Store raw voice recordings and encrypted backups in a private S3-compatible
Hetzner Object Storage bucket in Helsinki.

## Why

This keeps the product independent of the existing `emirtest.kz` server, places the durable
application data in the EU, and has a materially better operational boundary than shared web
hosting. A cost-optimized x86 node is sufficient for the first release because transcription and
LLM parsing run in the cloud; the application itself does not need a GPU.

## Safety properties

- Only Caddy publishes ports 80 and 443; PostgreSQL never has a public port.
- Audio objects are private and only accessed through short-lived signed URLs or the API.
- Every client mutation has a UUID, so a retry cannot duplicate a logged set.
- PostgreSQL uses daily encrypted base backups plus continuous WAL archival to a separate bucket.
- Server snapshots are a recovery convenience, not the only backup.

## Growth path

Move PostgreSQL to a managed service or a second private VM before sustained multi-tenant load.
The API, database migrations, and object storage contract remain unchanged.
