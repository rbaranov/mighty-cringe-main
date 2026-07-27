# ADR 0018: Soft-deleted personal exercises

- Status: accepted
- Date: 2026-07-27

## Context

Web discovery from ADR 0017 can add a duplicate, an imprecise translation, or another personal
exercise whose data the athlete later wants to correct. Physically deleting that row would break the
stable exercise identifier already stored in completed workouts, set history, and synchronization
records. At the same time, continuing to show a rejected exercise in catalog search and workout
replacement makes the duplicate keep causing mistakes.

Archiving has a different product meaning: an archived exercise may be a valid movement the athlete
wants to keep and potentially restore, filter, or inspect later. Treating every deletion as an
archive would hide this distinction and leave unclear whether the entry is still an active catalog
choice.

## Decision

Only user-owned exercises can be edited or deleted. Global catalog records remain read-only.
Editing keeps the stable exercise identifier and updates the personal record in place.

Deletion is soft: the API sets `deleted_at` on the personal exercise instead of removing its
PostgreSQL row. The authenticated exercise response continues to include the owner's soft-deleted
records so clients can resolve historical identifiers and names. Active catalog, discovery
deduplication, and workout replacement filter out records with `deletedAt`.

The delete confirmation explicitly explains that completed workouts and set history remain intact.
The API accepts repeated deletion of the same owned row without exposing another user's record.

Archiving is not implemented by `deleted_at`. If the product later needs a reversible archive, it
will use a separate state and explicit restore/filter behavior.

## Consequences

- An athlete can remove an incorrect or duplicate personal exercise without corrupting history.
- Correcting a personal exercise updates future and historical presentation while preserving links
  to workout data.
- Deleted personal rows remain stored and synchronized, so retention and a future restore policy can
  be decided independently.
- Global catalog corrections still require a curated catalog change rather than a user mutation.
- A future archive feature needs its own contract and database representation.
