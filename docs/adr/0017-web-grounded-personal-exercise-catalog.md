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

Only an unresolved command target, or an explicit action in the catalog or a personal exercise
card, offers online discovery. The catalog and workout picker use the same add panel immediately
below their local search: the athlete can create the described exercise manually or start online
discovery. Manual creation asks only for a name or movement description and primary muscle, writes
the personal exercise to IndexedDB first, and queues an `exercise.create` mutation in the durable
outbox. Empty sources and videos are valid for this manual draft, so recording a workout never
depends on an external provider.

The authenticated PWA starts a short-lived server discovery job with the search phrase and locale.
When enriching an existing personal card, the API also supplies its current names, aliases, muscles,
equipment, and notes as search context after verifying ownership. The API searches general technique
information and direct video evidence in parallel through the OpenRouter web-search server tool with
Exa, then converts only the bounded URL-citation records into a strict JSON schema in a separate ZDR
request. Separating search from structuring avoids the provider dropping structured output while a
server tool runs. All prompts treat the query, existing details, and retrieved pages as untrusted
data and request at most three plausible candidates.

The PWA polls the authenticated job and displays its real phases: information search, video search,
card structuring, and citation verification. It also shows elapsed time and can cancel the provider
request through `AbortSignal`. A job is scoped to the current user, retained in process only briefly,
and fails after 90 seconds rather than leaving the interface waiting indefinitely. A restart can lose
an in-flight job; the client keeps the original description and offers retry or manual creation.

Every candidate includes RU/EN names, aliases, muscles, equipment, notes, confidence, sources, and
verified YouTube technique links when available. The API keeps only HTTPS sources present in the
provider's URL-citation annotations; a video must also be both cited and hosted by YouTube. A
candidate without any grounded source is discarded, but missing video is not a reason to discard an
otherwise grounded exercise. Structured output explicitly distinguishes an executable movement from
a muscle, anatomical structure, symptom, or anatomy article.

Candidate names also follow ADR 0019: one concise canonical name per locale, at most 80 characters,
with the distinguishing equipment, position, angle or grip whenever the movement has variants.
Short gym phrases and the user's original wording belong in aliases. The same shared contract
rejects ambiguous names during discovery, creation and editing.

Discovery never writes data. The athlete sees all plausible candidates and explicitly selects one.
Only then does a separate authenticated API call create an exercise with `scope=user` and
`owner_id` taken exclusively from the current session. The client cannot choose an owner. When the
action starts from an existing personal card, the PWA first shows the exact fields and links that
would be added; confirmation merges new evidence without silently replacing an established name or
athlete-entered note. The new or enriched exercise is put into the active user's IndexedDB catalog.
The server returns the global catalog plus only the current user's personal rows, so another device
receives it after sign-in.

The entire exercise cache is cleared on account change and logout. This differs from the earlier
global-only cache and prevents a personal exercise from surviving into another account's local
session.

`OPENROUTER_API_KEY` remains server-only and can be shared with voice transcription.
`EXERCISE_DISCOVERY_MODEL` independently enables discovery, so voice storage and transcription may
remain disabled. Production preflight rejects a configured discovery model without the key. The
selected model must support tool calling and strict structured output; OpenRouter supplies the web
search server tool.

## Consequences

- Informal exercise names can become durable personal catalog entries without a release.
- The athlete can create and use a personal exercise immediately while offline, then enrich it later.
- Ambiguous names require a human choice; the first web result is never silently accepted.
- Search progress and cancellation are visible, and an external request cannot wait beyond the
  server timeout.
- Existing personal entries work offline, while discovering a new entry requires network access and
  configured provider credentials.
- A grounded candidate remains usable without video; the interface states that video is optional.
- Search adds provider latency and usage cost. The owner must use a spend-limited, ZDR OpenRouter key
  with provider logging disabled and review the candidate's cited technique information.
