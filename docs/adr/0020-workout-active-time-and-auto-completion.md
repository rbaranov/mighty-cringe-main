# ADR 0020: Active workout time and client-side automatic completion

- Status: accepted
- Date: 2026-07-30

## Context

An athlete can leave a workout active after leaving the gym. Treating the eventual tap on
“Finish” as the real end makes a session last hours or days, moves it to another calendar day, and
leaves no way to correct the resulting time. A server timer cannot safely solve this for an
offline-first PWA because the server cannot know that meaningful activity is still happening only
on the device.

ADR 0004 defines the durable outbox and revision boundary. ADR 0007 originally grouped and counted
workouts by completion time. This decision adds an explicit active-time model and changes progress
grouping to the workout start day.

## Decision

A workout stores:

- `durationSeconds`: accumulated active time;
- `activeSegmentStartedAt`: start of the currently open interval, or `null` when completed;
- `lastActivityAt`: the latest meaningful athlete action;
- `completionReason`: `manual`, `automatic`, or `null`;
- `endedAt`: completion marker and effective end, calculated as
  `startedAt + durationSeconds`.

While a workout is active, the PWA checks inactivity at startup, on foreground/focus, at the next
threshold, and at least once a minute. After 1 hour 45 minutes it shows a compact warning. “Yes,
keep going” records an idempotent `workout.touch`. After 2 hours the PWA automatically completes
the workout. The final active interval ends at `lastActivityAt + 15 minutes`, capped at processing
time, so the two-hour observation window is not counted. There is no server cron.

Meaningful activity is set creation, correction, deletion, or ordering; workout-plan and superset
changes; a confirmed text or voice mutation; resume; and the explicit keep-going action.
Navigation, video viewing, and merely opening a form do not reset inactivity.

Resuming a completed workout preserves accumulated duration and opens a new active segment. Time
between segments is excluded. If another workout is active, the existing explicit confirmation
finishes it before resuming the selected workout.

Workout and set mutations carry a client `activityAt`. The server updates `lastActivityAt`
monotonically in the same transaction. A set mutation and `workout.touch` do not increment the
workout revision; revisioned workout edits continue to follow ADR 0004. Processing time is stored
in `updatedAt`, not represented as athlete activity.

Completed workouts are grouped in history by the local calendar day of `startedAt`, including
sessions whose effective end crosses midnight. An automatically completed workout with no sets
remains visible as “0 sets”, but it is excluded from workout counts, streaks, volume, and strength
records.

The completed-workout editor atomically changes local start date/time and duration from 1 minute to
24 hours, recalculating `endedAt`. Existing completed rows are migrated with their historical
`endedAt - startedAt` duration. Existing active rows derive their latest activity from workout and
set timestamps and are reconciled by the PWA on first load.

## Consequences

- Offline activity remains authoritative until the outbox synchronizes; the server cannot
  prematurely finish a workout that continues on a disconnected device.
- A post-completion notice is stored locally, survives reopening, and offers Continue or Edit
  without blocking the next action.
- Effective `endedAt` describes accumulated duration, not wall-clock processing time. `updatedAt`
  remains the audit timestamp for when a mutation was handled.
- Progress definitions in ADR 0007 are amended: workout days and month/year grouping use
  `startedAt`, and a workout contributes to count and streak only if it has at least one
  non-deleted set.
- Push reminders and a configurable timeout remain outside this decision.
