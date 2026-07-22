# ADR 0017: Web-grounded personal exercise catalog

- Status: accepted
- Date: 2026-07-22

## Context

The deterministic command parser from ADR 0016 can safely replace, add, remove, and move known
exercises, but a phrase such as “тяга Арни” may be an informal or ambiguous name that is absent from
the built-in catalog. Guessing the first web result could silently change the workout to the wrong
movement. Sending provider credentials or unrestricted search logic to the PWA would also expose a
secret and weaken the user boundary.

## Decision

Only an unresolved command target, or an explicit action in the catalog, offers online discovery.
The authenticated PWA sends the short search phrase and locale to the API. The API calls OpenRouter
server-side with its web-search plugin and a strict JSON schema. The prompt treats the query and
retrieved pages as untrusted data and requests at most three plausible candidates.

Every candidate includes RU/EN names, aliases, muscles, equipment, notes, confidence, sources, and
verified YouTube technique links when available. The API keeps only HTTPS sources present in the
provider's URL-citation annotations; a video must also be both cited and hosted by YouTube. A
candidate without any grounded source is discarded.

Discovery never writes data. The athlete sees all plausible candidates and explicitly selects one.
Only then does a separate authenticated API call create an exercise with `scope=user` and
`owner_id` taken exclusively from the current session. The client cannot choose an owner. The new
exercise is put into the active user's IndexedDB catalog and the original command is parsed again
with that exercise selected. The server returns the global catalog plus only the current user's
personal rows, so another device receives the exercise after sign-in.

The entire exercise cache is cleared on account change and logout. This differs from the earlier
global-only cache and prevents a personal exercise from surviving into another account's local
session.

`OPENROUTER_API_KEY` remains server-only and can be shared with voice transcription.
`EXERCISE_DISCOVERY_MODEL` independently enables discovery, so voice storage and transcription may
remain disabled. Production preflight rejects a configured discovery model without the key. The
selected model must support both strict structured output and the OpenRouter web plugin.

## Consequences

- Informal exercise names can become durable personal catalog entries without a release.
- Ambiguous names require a human choice; the first web result is never silently accepted.
- The original natural command completes immediately after the confirmed exercise is saved.
- Existing personal entries work offline, while discovering a new entry requires network access and
  configured provider credentials.
- Search adds provider latency and usage cost. The owner must use a spend-limited, ZDR OpenRouter key
  with provider logging disabled and review the candidate's cited technique information.
