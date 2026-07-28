# ADR 0007: Derived and explainable progress metrics

- Status: accepted
- Date: 2026-07-22

## Context

The training journal already keeps complete workouts and sets in IndexedDB and synchronizes the same
records with the server. The progress screen needs to remain useful offline, include pending local
changes immediately, and make every strength estimate traceable to the athlete's actual set. Storing
a second server-side copy of aggregates now would introduce cache invalidation and conflict rules
before the history volume requires them.

## Decision

Derive the initial progress metrics in the PWA from completed workouts and non-deleted sets. Pending
and conflicted local records are included and visibly marked as not yet synchronized. All calendar
grouping uses the browser's IANA timezone and the completion date of the workout.

Use the following definitions:

- a training day is a local calendar day with at least one completed workout;
- a streak is measured in consecutive local Monday–Sunday calendar weeks with at least one completed
  workout in each week; the unfinished current week does not break a streak established through the
  previous week, and the best streak is the longest historical run;
- month and year counts include completed, non-deleted workouts by their local completion date;
- training volume is the sum of `weightKg × reps`; the summary shows the inclusive trailing 30
  calendar days;
- working weight for an exercise and workout is its heaviest recorded set;
- estimated 1RM is the largest RIR-aware Epley result in that workout:
  `weightKg × (1 + (reps + (RIR ?? 0)) / 30)`.

Compare strength only within one selected exercise. The chart shows both the working weight and
estimated 1RM, while the personal-record card identifies the exact source set and repeats the
formula. The interface calls the number an estimate rather than a true tested maximum.

## Consequences

- The screen works offline and changes immediately after a local workout edit.
- Every aggregate can be recomputed from source records, so no migration or aggregate repair is
  needed when the formula changes.
- A browser timezone change can move a workout near midnight to an adjacent calendar day. This is
  consistent with presenting the history in the athlete's current local context; a stored workout
  timezone can replace it later if travel history needs to remain geographically fixed.
- Client-side aggregation is acceptable for the current personal-journal scale. If history becomes
  large, the server may return precomputed windows, but source IDs and formula semantics must remain
  available for explanation.
