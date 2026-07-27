# ADR 0011: Private, durable voice processing

**Status:** Accepted

**Date:** 2026-07-22

**Amended:** 2026-07-26 — versioned account consent replaces per-recording consent; a remembered
voice mode starts capture when the input panel opens, follows the newest recording through
locale-bound transcription and parsing, then asks the athlete to confirm or edit the result. The
durable queue remains the failure and offline path.

**Amended:** 2026-07-27 — the worker rejects known non-speech media-credit and video-outro
hallucinations (for example, subtitle credits) as a permanent “command not heard” result before
they can reach deterministic workout-command parsing.

## Context

Voice capture must continue to work when a gym connection disappears, but raw audio is sensitive
personal data. A browser-side provider key would expose the project account and would let a failed
request lose the recording. A synchronous API request would also be vulnerable to mobile suspension,
provider rate limits, and the approximately 60-second upstream processing timeout documented for long
transcription requests.

The product specification requires raw audio and its transcript to remain available for playback and
correction. Therefore deletion after transcription is not automatic: retention must be visible and the
athlete must be able to delete the recording explicitly.

## Decision

Each recording uses this trust boundary:

1. The PWA asks for explicit, versioned consent before the first recording. Acceptance is stored in
   the current account's isolated local database and remains valid only for that exact consent
   version. A material terms change, explicit revocation in Settings, or a new browser microphone
   permission request makes the boundary visible again. Every upload still carries the accepted
   consent version for server validation. Capture is limited to 60 seconds and 10 MiB.
2. On stop, the Blob is committed to the authenticated user's IndexedDB before any network request.
   Upload and deletion are durable local queue operations with exponential retries.
3. The authenticated API validates the consent version, MIME type, size, workout ownership, and user
   ownership. Object keys start with the authenticated user id and are never returned by the public
   JSON contract.
4. The API writes raw audio to a dedicated private S3-compatible bucket over TLS. Hetzner Object
   Storage supports only SSE-C rather than AWS-managed SSE-S3, so every Put/Get supplies a separate
   32-byte customer encryption key. The key is server-only and must have an offline recovery copy.
5. PostgreSQL is the durable queue. A worker atomically claims pending work with `FOR UPDATE SKIP
LOCKED`, recovers leases stale for ten minutes, and retries transient errors up to five attempts
   with exponential backoff.
6. Only the worker sends base64 raw bytes to OpenRouter's dedicated transcription endpoint. The API
   key and model stay in server environment variables, every request sends the athlete's `ru` or `en`
   profile locale as the ISO-639-1 language hint, and every request sets `provider.zdr: true` so it can
   only use a Zero Data Retention endpoint. OpenRouter input/output logging must remain disabled for
   the project key.
7. If voice was the athlete's last selected input mode, opening «Пояснить» starts capture immediately
   after the versioned consent and browser permission checks. After stopping an online recording, the
   PWA persists it first, uploads immediately, and polls its user-scoped status (`pending`,
   `processing`, `confirmed`, `failed`) without making the athlete reopen a recording list. A
   confirmed transcript is forwarded directly to the deterministic local parser. The panel shows the
   parsed set or workout command and only then lets the athlete confirm it or edit the transcript;
   voice results never require a separate parse action and are never applied silently. Ambiguous
   phrases stay editable and require clarification.
8. Raw audio is retained until explicit deletion so it can be replayed and corrected. Recording
   statuses, playback, transcripts and deletion live under Settings rather than in the active input
   panel. Deletion removes the local Blob immediately, keeps a durable local tombstone while offline,
   deletes the encrypted S3 object, and only then removes its PostgreSQL row. Playback from the server
   is authenticated, user-scoped, and returned with `Cache-Control: private, no-store`.

Recordings that predate the versioned-consent schema are migrated to `failed` and are never submitted
to the provider. The athlete can delete and re-record them.

Official capability references:

- OpenRouter STT request, supported browser formats, and timeout guidance:
  https://openrouter.ai/docs/guides/overview/multimodal/stt
- OpenRouter Zero Data Retention controls: https://openrouter.ai/docs/guides/features/zdr
- OpenRouter data collection and opt-in content logging:
  https://openrouter.ai/docs/guides/privacy/data-collection
- Hetzner SSE-C support and lack of default object-at-rest encryption:
  https://docs.hetzner.com/storage/object-storage/faq/general/
- Hetzner per-key access restrictions:
  https://docs.hetzner.com/storage/object-storage/faq/s3-credentials/

## Consequences

An offline or suspended PWA does not lose a completed recording, transient provider failures do not
need user intervention, and neither S3 nor OpenRouter credentials are present in the browser bundle.
Manual/text entry remains independent of the voice services.

The athlete accepts the current processing terms once instead of interrupting every set. This is not
blanket or silent consent: the accepted version is account-scoped, visible and revocable in Settings,
and the server rejects an upload carrying any other version. Browser microphone permission remains a
separate user-agent control.

Production cannot enable voice until the owner creates a dedicated private bucket and credentials,
stores the SSE-C recovery key outside the VPS, creates a spend-limited OpenRouter key with privacy
controls, and selects an STT model. Losing or rotating the SSE-C key without re-encrypting retained
objects makes those recordings unreadable. A provider may have no compatible ZDR endpoint for a chosen
model; that produces a visible failed job rather than silently weakening the privacy boundary.

An unrelated production release may proceed with every voice setting empty; in that state the API and
worker keep voice disabled. Deployment preflight rejects a partially configured storage/transcription
pair and requires both complete groups together, including a valid 32-byte base64 SSE-C key, before
voice can be enabled.
