# ADR 0009: Offline session, recovery, and synchronization status

- Status: accepted
- Date: 2026-07-22

## Context

The application already writes workouts and measurements to IndexedDB before synchronizing them, but
an offline page reload still attempted `/api/v1/me` first and showed the login screen when that request
failed. An interrupted workout was present locally without an explicit recovery message, transient API
failures had no automatic retry, and the interface did not distinguish offline, synchronizing, and
failed states clearly. Service-worker registration also had two owners, making the installed PWA shell
harder to reason about.

Offline access must not weaken account boundaries. A cached identity may unlock data only after that
identity has previously been confirmed by the server on the same browser. A definitive server `401`
must win over the cache. Logging out while offline must keep the application closed until the server
cookie can also be invalidated.

## Decision

The browser stores only the validated public `CurrentUser` projection and an explicit
`offlineSessionAllowed` flag alongside the active user ID in IndexedDB. A successful `/api/v1/me`
response activates and refreshes this cache. Network errors, malformed responses, and temporary server
errors may restore that confirmed identity; a `401` disables offline restoration while retaining the
user's local records for a later authenticated recovery. Activating a different confirmed user clears
all data belonging to the previous local identity before the new boundary is established.

Logout always clears local user data. If the logout request cannot be confirmed, a durable browser
marker blocks cached-session restoration and causes an idempotent logout retry on the next online
session check. The marker is removed only after a successful response or confirmation that the server
session is already absent.

IndexedDB remains the immediate write target for workouts, sets, and measurements. On startup, the UI
waits for IndexedDB hydration before deciding whether an unfinished workout exists and then presents an
explicit recovery notice. The durable outbox exposes a shared synchronization state, keeps mutations
after transport and `5xx` failures, retries them with bounded exponential backoff, and records the last
successful synchronization time. A `401` is routed back through session validation instead of being
treated as a retryable transport failure.

The PWA plugin is the single owner of service-worker registration. Its generated worker precaches only
the static application shell and uses the shell as a navigation fallback; `/api/` and `/health` are
excluded so authenticated responses are never served from the service-worker cache. CI builds the PWA
and verifies the manifest, single registration path, hashed shell precache, and navigation fallback.

## Consequences

- A previously authenticated athlete can reload the installed application, continue an unfinished
  workout, inspect local history, and queue edits without network access.
- Server revocation takes precedence as soon as the server can answer; the cache cannot bypass a
  confirmed unauthorized response.
- An offline logout may leave the server cookie alive temporarily, but the application cannot use it to
  silently reopen the local session and retries invalidation when connectivity returns.
- Users can distinguish offline work, queued changes, active synchronization, conflicts, and transient
  server failures, and can trigger an immediate retry.
- Static shell precaching is verified automatically; true installed-device and browser eviction
  behavior still requires a production phone smoke test.
