# ADR 0010: Local natural-language set parsing and confirmation

- Status: accepted
- Date: 2026-07-22

## Context

Natural input must be as dependable as the manual set form. Typed set logging is explicitly required
to work offline, must recognize the bilingual exercise catalog and colloquial aliases, and must never
commit a guessed value silently. Sending every typed phrase to a cloud model would make this basic path
network-dependent and would disclose workout notes before the voice privacy and consent boundary is in
place.

## Decision

Typed set phrases are parsed entirely in the PWA. The deterministic parser normalizes Russian and
English text, matches catalog names and aliases, tolerates a one-character inflection difference in
long exercise tokens, and extracts weight, repetitions, RIR, and the remaining comment. It supports
decimal weights, numeric and common Russian number words, explicit `RIR`, “в запасе”, “без запаса”, and
“до отказа”. Values are checked against the same product limits used by the set contract.

The per-exercise “＋ Подход” flow can open the natural input with that exercise as explicit context. The
global “Пояснить” flow requires an exercise name or alias. When multiple catalog entries match equally,
the parser returns candidates instead of choosing one. Missing or invalid values produce one focused
clarification question.

A parsed result is never written immediately. The sheet shows the resolved exercise, weight,
repetitions, RIR, comment, and most recent local result. Only explicit confirmation writes the normal
local set record and queues the existing idempotent `set.create` mutation. “Исправить фразу” returns to
the original text, while the manual form remains available at all times.

Voice capture now follows the separate consent, private storage, retry, and server-side provider
boundary from ADR 0011. ADR 0012 records whether the confirmed phrase originated from deterministic
text input or AI voice transcription. No AI or transcription key is added to the browser bundle.

## Consequences

- Core typed logging works without connectivity and has no provider cost or disclosure.
- Common gym phrasing is fast and explainable, but the deterministic grammar intentionally asks for
  clarification rather than pretending to understand arbitrary conversational commands.
- Workout commands were outside this first parser; ADR 0016 supersedes that limitation with a
  deterministic command layer that runs before set parsing.
- Voice remains dependent on the privacy pipeline and a production provider credential, while typed
  and manual logging keep working without either dependency.
