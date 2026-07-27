# ADR 0008: Offline-first body measurement history

- Status: accepted
- Date: 2026-07-22

## Context

Body measurements belong beside workout progress, but they have different data and editing needs.
An entry can be backdated, contain only some metrics, arrive through a historical CSV import, and be
changed on another device. A network interruption must not lose an entry, while a retry or concurrent
edit must not silently duplicate or overwrite it. Every server read and write must remain scoped to the
authenticated athlete.

## Decision

Each measurement session is a revisioned, user-owned entity with a client-generated UUID, measurement
timestamp, `isSelfMeasured` flag, and a validated JSON snapshot of the supported optional values:
height, weight, neck, chest, biceps, left and right thigh, calf, and waist. At least one value is required.
Dates chosen in the UI are serialized at local noon so their displayed calendar day remains stable in
normal timezone and daylight-saving transitions.

IndexedDB is the immediate write target. Measurement create, update, and delete mutations use the same
durable outbox, idempotency key, revision check, and explicit conflict resolution flow as workouts and
sets. A local delete is a tombstone until the server acknowledges it. History refreshes preserve pending
or conflicted local records and replace only synchronized records.

The authenticated API exposes list and revisioned CRUD operations. Repository queries always include
the current user ID; clients never supply an owner ID. PostgreSQL stores the current validated snapshot
and revision, while `client_mutations` makes retries idempotent within the same transaction.

The Progress screen derives trends and deltas from local history so pending offline changes are visible
immediately. Table import is parsed and validated on-device from CSV, TSV, or plain text. It accepts
Russian and English labels, dates running down rows or across columns, descriptive measurement labels,
explicit units, and historical dates. The client shows the normalized preview before saving, rejects
duplicate dates, and enqueues each accepted date through the normal create path. Manual entry also
prevents a second entry on an existing local date.

## Consequences

- Weight and circumference trends work without a separate analytics service.
- Partial entries remain useful; a missing metric is not treated as zero and is omitted from its trend.
- The detail view compares an entry only with the immediately previous session, so the source of every
  displayed delta is explainable.
- Full-history reads and client-side trend calculation are acceptable for the current personal journal.
  Pagination or server-side aggregates can be added later without changing mutation semantics.
- Date uniqueness is currently enforced by the client. If non-UI writers are introduced, the API and
  database should add an explicit per-user calendar-date constraint after defining timezone semantics.
