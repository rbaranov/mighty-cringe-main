# ADR 0003: Encrypted PostgreSQL backups in Object Storage

- Status: accepted
- Date: 2026-07-21

## Context

PostgreSQL runs on the production VPS with a persistent Docker volume. A volume or server snapshot
does not protect against accidental deletion, database corruption, or loss of the whole server. The
recovery path must be independent of that volume and must be exercised automatically.

## Decision

Create a private Hetzner Object Storage bucket in Helsinki and store PostgreSQL logical dumps in a
restic repository under its `postgres` prefix. Restic encrypts repository contents client-side with
an independent password before upload. S3 credentials and the restic password live only in the
root-readable production environment file; an offline copy of the restic password is required.

A systemd timer starts a short-lived backup container every day. The container creates a PostgreSQL
custom-format dump in tmpfs, validates its table of contents, uploads it with restic, removes the
plaintext dump, applies retention, and checks repository metadata plus a data subset. Retention is
14 daily, 8 weekly, and 12 monthly snapshots by default.

A second timer runs monthly. It restores the latest encrypted snapshot into tmpfs, starts a separate
PostgreSQL container backed only by tmpfs, applies the dump with `pg_restore --exit-on-error`, and
queries the core application tables. The isolated restore database is removed after the check.
Backup and restore verification share a host lock and cannot overlap.

## Recovery objectives

- Recovery point objective (RPO): at most 24 hours after the daily timer has completed successfully.
- Recovery time objective (RTO): four hours for the current small database, including provisioning a
  replacement PostgreSQL service and following the documented recovery procedure.

## Consequences

- The owner must create the private bucket and credentials and keep the restic password outside the
  VPS. Losing that password makes every snapshot unrecoverable.
- The first scheduled or manual backup initializes the repository. A wrong password or an existing
  incompatible repository fails safely instead of overwriting it.
- Logical backups favor portable, directly tested recovery over point-in-time recovery. Continuous
  WAL archiving can be added when the accepted RPO becomes shorter than 24 hours.
- Server snapshots remain a secondary recovery layer and never replace the independent repository.
