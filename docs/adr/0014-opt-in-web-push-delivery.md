# ADR 0014: Opt-in Web Push and durable reminder delivery

- Status: accepted
- Date: 2026-07-22

## Context

Workout reminders must be useful without becoming unsolicited noise. Browser notification permission
is a sensitive capability, subscription endpoints are user-specific credentials, and mobile browsers
may suspend both the PWA and the network at any time. A timer in the page therefore cannot provide
reliable delivery. Quiet hours and the user's local time zone must be enforced before a job reaches a
push provider.

## Decision

The PWA reads notification availability and preferences without requesting permission. Only the
explicit “Разрешить и включить” action calls `Notification.requestPermission()` and creates a
`PushSubscription` with `userVisibleOnly: true` and the public VAPID application-server key. The VAPID
private key never crosses the server boundary. The API stores subscriptions under the authenticated
user and accepts only HTTPS endpoints and bounded encryption keys.

Each user chooses daily, weekday, or weekly frequency, a local delivery time, an IANA time zone, and
quiet-hour boundaries. A reminder time inside quiet hours is rejected visibly rather than silently
delayed or dropped. PostgreSQL stores the calculated next UTC occurrence. The worker atomically locks
due preferences, inserts idempotent notification jobs, advances the next occurrence, and claims jobs
with `FOR UPDATE SKIP LOCKED`. Stale processing leases recover after ten minutes. Temporary provider
errors retry up to five times with exponential backoff; HTTP 404/410 disables an expired browser
subscription. Disabling reminders immediately prevents pending jobs from being claimed.

Payloads contain only a generic workout prompt and an application URL, never workout or health data.
The service worker displays every received push as a visible notification and focuses or opens the PWA
when it is clicked. Delivery is at-least-once: a provider timeout can rarely cause a duplicate, which is
preferable to silently losing a reminder.

Primary references:

- W3C Push API: https://www.w3.org/TR/push-api/
- `web-push` VAPID and delivery API: https://github.com/web-push-libs/web-push

## Consequences

- Permission is contextual, revocable, and never requested on page load.
- Schedule and jobs survive API/worker restarts; multiple workers cannot claim the same job normally.
- The server retains subscription endpoints until opt-out, account deletion, expiry, or provider 404/410.
- Production remains disabled until the owner installs one stable VAPID pair and performs a real-device
  acceptance test. iOS/iPadOS users must add the PWA to the Home Screen before Web Push is available.
