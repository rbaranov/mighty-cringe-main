# ADR 0021: Offline-first personal exercise preferences

- Status: accepted
- Date: 2026-08-05

## Context

The shared catalog describes exercises, while an athlete's opinion about an exercise is personal.
Putting a preference on the shared exercise row would either mutate data for every athlete or mix
user-specific state with curated catalog content. The preference must also work during an offline
workout and must not silently overwrite a different choice made on another device.

The product uses two explicit values: `like` and `dislike`. No row shown in the interface means the
exercise is unmarked. A dislike is not deletion or archiving: the exercise remains searchable,
usable by explicit choice, and available in history.

## Decision

Store preferences as a separate per-user aggregate keyed by `(user_id, exercise_id)`. Its nullable
`value`, integer `revision`, and timestamps are independent from the global or personal exercise
record. Setting `null` removes the visible mark but keeps the row and revision so a concurrent
offline change can still be detected. The server accepts only a global exercise or a personal
exercise owned by the authenticated user; clients never supply an owner ID.

IndexedDB stores the local preference and its sync state. Every toggle writes the desired value and
an `exercise-preference.set` mutation to the durable outbox before attempting the network. The
server uses the existing per-user mutation IDs for idempotency and optimistic `baseRevision`
checks. A retry whose desired value already matches is a no-op. An incompatible revision becomes an
explicit conflict with the same keep-server or keep-mine choices used for other revisioned data.

Catalog and workout logic consume a preference lookup without adding a personal field to
`Exercise`. Likes sort before neutral choices within a replacement muscle group. Dislikes are
excluded from automatic workout suggestions and the default replacement list, including fallback.
An athlete who explicitly searches for or directly names a disliked exercise may still choose it
once with a visible warning. Manual plan addition also remains available. Existing draft and active
workouts are never rewritten after a preference change.

The local data export includes preference records and advances to format version 2. Preferences are
cleared with the rest of the account-scoped IndexedDB data on logout or account change.

## Consequences

- Athletes can safely classify both shared and personal exercises without affecting one another.
- Recommendations avoid unwanted movements while explicit workout decisions remain under athlete
  control.
- A preference survives offline use, restart, retry, and multi-device synchronization.
- The extra revisioned aggregate adds a small conflict path, but no preference is silently lost.
- A future reversible archive remains a separate state with its own filtering and restore behavior.
