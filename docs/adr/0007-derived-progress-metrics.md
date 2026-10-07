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
grouping uses the browser's IANA timezone. ADR 0020 changes the grouping source from completion
time to workout start time and excludes empty workouts from count and streak metrics.

Use the following definitions:

- a training day is a local calendar day with at least one completed workout containing a
  non-deleted set;
- a streak is measured in consecutive local Monday–Sunday calendar weeks with at least one completed
  workout in each week; the unfinished current week does not break a streak established through the
  previous week, and the best streak is the longest historical run;
- month and year counts include completed, non-deleted, non-empty workouts by their local start
  date; empty completed workouts remain visible in history;
- training volume is the sum of `weightKg × reps`; the selected window is the inclusive trailing
  30 or 90 calendar days, or all history through today;
- working weight for an exercise and workout is its heaviest recorded set;
- estimated 1RM is the largest RIR-aware Epley result in that workout:
  `weightKg × (1 + (reps + (RIR ?? 0)) / 30)`.

Compare strength only within one selected exercise. The chart shows both the working weight and
estimated 1RM, while the personal-record card identifies the exact source set and repeats the
formula. The interface calls the number an estimate rather than a true tested maximum.

### Workout results and source-backed records (2026-10-07)

Manual completion stores a local `workoutResultId` in the same IndexedDB transaction as completion
and its durable outbox mutation. The result is shown before a network flush finishes, survives a
reload, and can also be opened from history. It derives duration from `durationSeconds` and counts
performed exercises from actual eligible sets, not from the plan. The marker is local navigation
state, removed when dismissed or a workout is started/resumed; it is cleared on account changes.

Each exercise compares with its latest strictly earlier completed workout by `startedAt`. A
historical result cannot use later workouts as its baseline. Repetitions compare the best set at
exactly the same canonical weight. All-time records keep separate source sets for the heaviest
weight, RIR-aware estimated 1RM, and repetitions at each observed weight. Ties retain the original
source. A first observation is a baseline, not a newly broken record. Zero-weight sets contribute
repetition records but not zero-kilogram weight or estimated-strength records.

Result/record calculations exclude deleted sets, orphan sets, incomplete/invalid workouts and
sets outside numeric contract bounds. Pending/conflicted local values remain authoritative and
are labelled accordingly. Pending set deletions are also included in the result's synchronization
status even though those sets no longer contribute to metrics. Corrections and deletions recalculate
results without stored aggregates or schema changes.

### Progress navigation and periods (2026-10-07)

History, strength and measurements are separate tabs; strength opens by default. The calendar
and measurement actions retain their original behavior. Strength periods include all eligible
workouts in the selected local-date window, without truncating to a last-N subset. Comparisons use
the immediately preceding equal window; all-time results do not imply a previous comparison.
Monthly counters remain calendar-month counters and the strength window shows its exact dates.

The chart spaces points by the actual workout start instant. Selecting a point by pointer or
keyboard exposes its source sets and workout. All-time records remain visible independently of
the selected chart window. Small canonical weight differences remain visible in source labels;
reusing untouched rounded form defaults preserves their canonical value, while explicit edits
are converted from the user's selected units.

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
