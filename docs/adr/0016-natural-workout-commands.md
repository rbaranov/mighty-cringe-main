# ADR 0016: Deterministic natural workout commands

- Status: accepted
- Date: 2026-07-22

## Context

Manual workout editing already supports adding, replacing, removing, and moving exercises through
the offline-first workout update path. The natural input from ADR 0010 only understood set volume,
so phrases such as “Замени тягу верхнего блока на румынскую тягу” incorrectly fell through to a
weight-and-repetitions clarification. Voice transcripts inherited the same limitation.

## Decision

The PWA parses workout commands locally before attempting natural-set parsing. The deterministic
grammar supports Russian and English add, replace, remove, and move intents. Source and anchor
exercises are resolved only against the active workout plan; added and replacement exercises are
resolved against the catalog. Russian inflections are matched conservatively, including phrases
such as “тягу верхнего блока” and “жима лёжа”.

Every resolved command is presented as an explicit preview. Only confirmation applies it through
the existing `workout.update` IndexedDB and durable outbox flow. Logged sets keep their original
exercise identity, and plan normalization preserves valid ordering while detaching invalidated
supersets. Text input and confirmed voice transcripts use the same parser.

Unknown or ambiguous names are never guessed. The interface asks the athlete to select a candidate;
an unknown target cannot be created implicitly because custom exercise metadata must be explicit.

## Consequences

- Core workout commands work offline and do not disclose text to an AI provider.
- Manual and natural editing share one mutation and conflict model.
- A recognized command no longer produces a set-volume question.
- User-specific exercise names require catalog support before the command can reference them
  directly.
