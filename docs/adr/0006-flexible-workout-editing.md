# ADR 0006: Revisioned workout plans and set deletion

- Status: accepted
- Date: 2026-07-21

## Context

The first workout slice records sets against a fixed suggested exercise list. An athlete must be able
to change the actual session while it is happening, including reordering and replacing exercises,
forming supersets, reordering sets, and correcting a mistakenly recorded set. These edits must keep
the offline-first and explicit-conflict guarantees established in ADR 0004.

## Decision

Treat the ordered exercise plan as part of the revisioned workout aggregate. Each plan item has a
stable UUID, exercise UUID, integer position, and optional superset group. A workout create carries
the initial plan; a workout update may atomically replace the complete plan. Superset groups must
contain at least two consecutive plan items. PostgreSQL stores the normalized plan in
`workout_exercises`, while API history always returns it with the workout.
In the active workout, consecutive items from one group are joined by a continuous accent line, so
supersets, trisets, and longer groups remain visually distinct without introducing a different data
shape for each group size.

Treat set order as revisioned set data. Each set carries a position within its exercise. Moving sets
uses the existing optimistic set update protocol. Set deletion is a dedicated idempotent mutation:
the PWA keeps a hidden local tombstone until the ordered outbox receives server confirmation, and the
server conditionally deletes only the expected revision. A concurrent edit produces the same explicit
server-versus-local choice as other mutations.

Removing or replacing a plan item never rewrites or deletes already recorded sets. Those sets remain
in workout history and the active UI labels them as performed outside the current plan. Deleting a set
is the only operation that removes that set from history.

## Consequences

- Plan edits conflict at workout granularity. This is intentional: independently merging order and
  superset changes would be surprising and could silently create a different session structure.
- Reordering two sets uses two independently revisioned updates. A concurrent edit may leave an
  explicit conflict, but it cannot silently overwrite the edited set.
- The plan currently permits at most 100 items and the UI prevents duplicate exercise choices. The
  data model keeps stable item IDs so duplicate slots can be supported later without a migration.
- Hard-deleted sets are recoverable only from encrypted backups. The UI requires confirmation and
  preserves an offline tombstone until the server acknowledges deletion.
