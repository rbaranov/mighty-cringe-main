# ADR 0004: Durable workout sync and explicit conflicts

- Status: accepted
- Date: 2026-07-21

## Context

The first PWA slice queued workout and set creation in IndexedDB, but completion was local-only,
server history contained summaries without sets, and concurrent edits had no defined outcome. A
request retry had to remain safe while a change from another phone or browser could never be
silently overwritten.

## Decision

IndexedDB remains the immediate write target. Every create or update is stored in the durable
`outbox` before a network request. Entries have a monotonic local sequence, survive a PWA restart,
and are delivered in order. The queue drains again at startup, after every local change, and when
the browser returns online. Network and server failures leave retryable entries in place.

Workouts and sets have an integer server `revision`. Create mutations use client-generated entity
and mutation UUIDs. Update mutations include the revision on which the local edit was based. The
server records a mutation ID and its data change in the same PostgreSQL transaction:

- repeating a successful mutation is a no-op and returns the current entity;
- creating the same entity with identical data is a no-op;
- an update whose desired fields already match is a no-op, even if another revision was observed;
- an incompatible base revision returns `409 revision_conflict` with the current server entity;
- the server never accepts a client-supplied owner ID.

The PWA fetches complete server history, including sets, after login and reconnect. Server records
replace only local records already marked `synced`; pending or conflicted local edits are preserved.
Server-removed records delete only synced local copies.

A rejected change moves from the outbox to a persistent conflict store and the local record is
marked `conflict`. The Settings screen shows both choices. The athlete can accept the server state,
explicitly remove a local record that is absent on the server, or rebase their update onto the
current revision. Nothing is overwritten merely because a background refresh occurred.

## Consequences

- Starting, finishing, adding a set, and correcting a set use the same ordered delivery mechanism.
- Multiple local changes to one entity are rebased sequentially after each acknowledged response.
- Full-history reads are acceptable for the current small personal journal. Cursor-based incremental
  history can replace them when data volume requires it without changing conflict semantics.
- Exercise ordering, set deletion, and more complex workout editing remain separate product work;
  they must use the same revision and conflict boundary.
