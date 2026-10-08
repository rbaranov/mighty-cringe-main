# ADR 0022: Trainer access to an athlete journal through an explicit data context

- Status: accepted; owner authorized merge on 2026-10-08
- Date: 2026-10-08
- Supersedes: the read-only-only trainer policy in [ADR 0013](./0013-trainer-invites-and-read-only-access.md)
- Extends: [ADR 0004](./0004-offline-sync-and-conflicts.md), [ADR 0020](./0020-workout-active-time-and-auto-completion.md),
  and [ADR 0021](./0021-offline-exercise-preferences.md)

## Context

A trainer needs to use the athlete's ordinary journal: inspect history and progress, manage the
current workout and its sets, edit favorite workouts, record measurements, and maintain the athlete's
personal exercise catalog and preferences. A separate trainer editor would duplicate the same
screens and gradually lose parity. Replacing the signed-in user with the athlete would instead blur
authorization, attribution, local storage, and queued writes.

The athlete and trainer can edit simultaneously. Either device can be offline. A change of athlete,
revoked permission, delayed response, or PWA restart must not move changes into another journal.

## Decision

The authenticated **actor** remains the trainer. A separate **owner context** identifies whose
sporting data is displayed and changed. The existing athlete screens run inside that context.
A compact, persistent header shows the athlete's name and a distinct accent, including in editing
sheets; color alone does not identify the context. Returning to the trainer's own journal is explicit.
Interface language and display units remain the operator's preferences.

### Consent and server authorization

Trainer links retain the single-active-trainer constraint. Existing and newly accepted invitations
start with `access = read`; deployment does not upgrade anyone's permission. The athlete can explicitly
grant or withdraw `manage` through `PATCH /api/v1/trainer/relationship`. Removing the relationship
remains available to both parties. The current read-only trainer dashboard remains usable without
management permission.

`GET /api/v1/trainer/athletes/:athleteId/context` returns the currently authorized athlete summary,
including `access` and `linkId`. Entering a managed journal requires a fresh online check. Sporting
requests carry both `X-Athlete-Id` and `X-Trainer-Link-Id`. They never replace the authenticated session.
All sporting and own-voice requests also carry the captured `X-Actor-Id`. When the cookie belongs to
a different account, the server returns `403 actor_session_changed` before running the operation.
This prevents a stale tab from sending its own journal queue into an account opened in another tab.
The header is a consistency check, not an authentication credential; the server still authenticates
the session. Older clients without it remain compatible.
An access-level change rotates the link identifier; accepting a replacement invitation also creates
a new identifier. Old queued operations therefore remain invalid even if the same trainer later
receives management permission again.

Scoped access is restricted to workouts, sets, measurements, exercises, personal exercise preferences,
sync, exercise discovery, and the journal activity feed. Authentication, account preferences, raw
voice recordings and processing, notifications, administrative functions, and trainer relationship
management reject these headers. A trainer cannot use athlete context to grant themselves permission.
The owner remains responsible for account access and consent.

Every scoped request checks the current trainer role, active link, exact link identifier, and required
access level. Existing repository ownership checks still apply; referenced personal exercises must
also belong to the selected athlete. Global exercise catalog rows cannot be edited or deleted through
personal exercise endpoints. Personal catalog deletion preserves historical workouts and sets, as in
ADR 0018.

In PostgreSQL, the authorization check locks the current trainer role and link. Sporting database
operations and their audit event run in that same transaction, with response sending deferred until
commit. A concurrent revocation waits for an already authorized operation; after revocation commits,
subsequent requests and retries cannot use the old grant. Invalid access returns `403` with
`trainer_access_revoked` or `trainer_manage_required`.

### Local data and offline delivery

The self journal keeps its existing IndexedDB database. Managed journals use separate databases keyed
by the authenticated actor, athlete owner, and exact link identifier. Workouts, sets, catalog,
preferences, measurements, drafts, outbox, conflicts, and sync status belong to that context.
Changing athlete is not a login or a call to `activateLocalUser`.

Each write, delayed callback, refresh, retry, and conflict resolution captures its context before
starting. Returning to the self journal does not retarget a pending operation. Late responses may
update only their captured database. Account invalidation prevents old callbacks from continuing.
After a PWA restart the app starts in the self journal; re-entering an athlete context verifies access
again. A new link identifier selects a new database, leaving old queued changes isolated.

The existing durable outbox remains the first destination for supported offline sporting mutations.
Losing the connection after entering athlete context may leave a local change pending; the UI must
not present that change as delivered to the athlete. Server refusal stops the old context's queue and
returns the visible app to the self journal. Unsent revoked-context work is retained separately and
must never be replayed into another account or a renewed grant. Logout/account-data cleanup covers
all journal caches; destructive cleanup must account for pending work outside the visible journal.

Personal exercise edits and deletion retain their existing online requirement. Opening a new athlete
context also requires a connection. Previously received offline data cannot be remotely erased from
a disconnected device, and already observed data cannot be made unseen.

### Concurrent editing and visible changes

Existing mutation IDs and entity revisions protect workouts, sets, measurements, and preferences.
Duplicate successful sync requests do not repeat a write or create another trainer activity event.
Independent new sets retain independent UUIDs; colliding proposed positions are assigned distinct
positions under a workout lock. Conflicting edits require explicit resolution instead of silently
replacing another client's data.

Personal exercises now also have a revision. Their PUT and DELETE operations accept `If-Match`;
managed-journal edits require it. A missing revision requires a refresh (`428`), and an outdated
revision returns `409 revision_conflict` with the current exercise. The client keeps the user's input
available rather than silently retrying it against a newer revision.

Visible journals refresh on foreground/reconnect and every ten seconds while visible. This is
best-effort synchronization, not a live connection to another phone. An athlete's unsynced offline
workout is unavailable to the trainer; the last successful synchronization remains relevant context.
Merely viewing an athlete journal does not start an inactivity timer or automatically finish their
workout. The athlete's existing automatic-completion behavior remains in their self journal.

### Attribution and audit

Sporting data stays owned by the athlete. Trainer audit events separately record actor, athlete,
link identifier, domain action, timestamp, and mutation details. `manual`, `natural_text`, and
`voice_ai` remain input-source labels and are not repurposed as actor identity.

`GET /api/v1/journal-activity` returns the latest fifty trainer actions for the selected owner as
`id`, `actorDisplayName`, `action`, and `createdAt`. It excludes the athlete's own consent changes and
never returns raw request bodies, URLs, or grant identifiers. This is a concise activity history,
not automatic undo or a complete version-restoration interface.

## Consequences and limits

- Athlete and trainer use the same sporting screens with an explicit, visible owner boundary.
- Management permission is revocable and cannot silently arise from an old read-only invitation.
- A trainer's own workout, drafts, and pending changes remain separate while working with an athlete.
- Account control, voice permissions, notifications, and global catalog administration are outside
  delegated journal access. Assigning trainer roles remains separate administration work.
- Offline snapshots and pending changes can be stale; permission is enforced when contacting the
  server, and revoked queues do not receive a new grant automatically.
- The local acceptance helper uses synthetic accounts, a fixed loopback PostgreSQL database, and
  host-only cookies on `localhost` and `127.0.0.1`; it is never a production authentication mechanism.
