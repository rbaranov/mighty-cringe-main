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
height, weight, neck, chest, biceps, left and right thigh, calf, waist, and the optional sex used by
RFM (`male` or `female`). Sex alone does not make an entry a measurement: at least one numeric value
is required. Dates chosen in the UI are serialized at local noon so their displayed calendar day
remains stable in normal timezone and daylight-saving transitions.

The snapshot may also contain a manually entered body-fat percentage. When that value is absent, the
product can show a derived adult RFM estimate. Waist always comes from the entry being displayed.
Height and sex first use explicit values from that entry; when either is absent, it is inherited
independently from the latest measurement in the athlete's history where that value was specified.
The male equation is `64 − 20 × height / waist`; the female equation is
`76 − 20 × height / waist`. The UI identifies which equation produced the estimate. The estimate is
presentation-only and is not persisted as if it were measured, and a manually entered percentage
always has priority.

Sex is stored with a measurement rather than inferred from the athlete's name or OAuth profile. The
form can record it explicitly or leave it empty to reuse the latest known value, exactly like height.
Existing snapshots without the field normalize to `null`, so they remain valid and can inherit a value
from another measurement.

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
- RFM estimates can change retrospectively when a newer entry supplies a different height or sex;
  the source label and non-persisted calculation make that behavior explicit.
- The detail view compares an entry only with the immediately previous session, so the source of every
  displayed delta is explainable.
- Full-history reads and client-side trend calculation are acceptable for the current personal journal.
  Pagination or server-side aggregates can be added later without changing mutation semantics.
- Date uniqueness is currently enforced by the client. If non-UI writers are introduced, the API and
  database should add an explicit per-user calendar-date constraint after defining timezone semantics.
