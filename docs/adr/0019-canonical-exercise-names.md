# ADR 0019: Canonical exercise names and aliases

- Status: accepted
- Date: 2026-07-28

## Context

A training history needs stable exercise identities, while athletes search and speak using short
gym phrases. A second `shortName` field would create two competing titles that could drift apart.
Conversely, making an ambiguous phrase such as «Пуловер» canonical produces duplicates because the
same word can mean materially different movements.

## Decision

Each exercise has one canonical Russian name and one canonical English name, both no longer than
80 characters. A canonical name starts with the movement and adds only the details needed to
distinguish it from realistic alternatives:

- implement or machine;
- standing, seated or lying position;
- bench angle;
- grip or unilateral variant.

For example, use «Жим штанги лёжа на горизонтальной скамье», «Жим гантелей лёжа на
горизонтальной скамье» and «Жим штанги лёжа на наклонной скамье». Do not add a separate display or
short-name field. Cards may clamp the canonical text visually, while the detail screen and native
`title` expose it in full.

Short, historical and conversational forms live in `aliases`. Search and deterministic natural
commands index canonical RU/EN names and aliases together. Creation, editing and web-grounded
discovery share the same contract and reject known ambiguous standalone names, asking the athlete
to add equipment, position, angle or grip.

Fast manual creation is the deliberate exception to requiring two researched translations at entry
time. It preserves the athlete's entered movement description in both locale fields so the exercise
can be used offline immediately, while still applying the ambiguity guard. Later editing or
web-grounded enrichment can replace that identical placeholder pair with distinct canonical RU/EN
names after showing the proposed changes. If the athlete has already established different names,
enrichment preserves them and only merges missing details.

Global exercises keep their stable UUIDs when renamed. A legacy personal shorthand that exactly
matches a global canonical name or alias is omitted from new catalog choices, so the global
canonical card wins without deleting the personal record or changing historical workout and set
references.

## Consequences

- Catalog cards stay concise enough for mobile but remain unambiguous.
- Old phrases continue to work in search and voice commands.
- Stable exercise IDs preserve history across global renames.
- Legacy personal duplicates remain available to historical records but cannot create another new
  competing choice.
- The exact-list validation catches high-risk ambiguous names; broader semantic ambiguity still
  requires human review of discovery candidates.
- Offline manual entry can temporarily have the same text in both locale fields; this state is
  explicit and safe to improve later without blocking workout recording.
