# ADR 0012: Set entry provenance and the AI boundary

- Status: accepted
- Date: 2026-07-22

## Context

Manual logging is the dependable core of the product and must not become conditional on an AI provider,
network availability, quota, or model behavior. At the same time, a set created after cloud voice
transcription must remain distinguishable from a manually entered set. A locally parsed typed phrase is
assisted input, but it does not use an AI provider and must not be mislabeled as cloud AI.

Provider credentials and storage encryption material are server secrets. A future client refactor must
not accidentally expose their names or values in the PWA source or production bundle.

## Decision

Every set stores immutable creation provenance as one of `manual`, `natural_text`, or `voice_ai`.
Existing server and IndexedDB records migrate to `manual`. The regular “＋ Подход” form always creates
`manual` records and remains available from every exercise during a workout. The deterministic phrase
parser creates `natural_text` records, while a phrase originating from OpenRouter transcription creates
`voice_ai` records even though it passes through the same confirmation screen.

The workout and calendar history show “текст” for deterministic phrase input and “AI: голос” for cloud
voice transcription. Manual entries remain unbadged. Editing a set cannot rewrite its original source;
the update contract deliberately excludes provenance.

All Google, OpenRouter, S3, backup, session, and monitoring secrets remain server-side environment
variables. CI scans both `apps/web/src` and the built `apps/web/dist` and fails if a known server-only
secret name crosses the PWA boundary.

## Consequences

- Manual logging continues to work offline and independently of every AI service.
- Users can tell which historical values followed AI transcription and which came from local typed or
  direct manual input.
- Provenance is deliberately coarse: it records the creation path, not every later manual edit.
- Adding a new assisted input path requires a contract and migration decision instead of silently
  reusing an ambiguous boolean flag.
