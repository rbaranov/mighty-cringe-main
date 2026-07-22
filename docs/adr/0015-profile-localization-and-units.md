# ADR 0015: Profile localization and canonical units

## Status

Accepted for implementation.

## Context

The athlete must be able to use the whole PWA in Russian or English and keep that choice across
devices. The same profile must also support metric and imperial display without splitting workout or
body history into incompatible datasets. Offline recovery must not silently fall back to another
language or reinterpret already stored values.

Exercise catalog records already contain Russian and English names. Workout sets and body
measurements, however, are shared between progress calculations, CSV import, trainer read-only
views, natural-text parsing, and synchronization. Storing whichever unit happened to be visible at
entry time would make those consumers ambiguous and could corrupt comparisons after a profile
change.

## Decision

The authenticated user profile owns two explicit preferences:

- `locale`: `ru` or `en`;
- `unitSystem`: `metric` or `imperial`.

PostgreSQL persists both values. `PATCH /api/v1/me/preferences` validates and updates only the
authenticated user's profile. The public current-user contract returns both values, and the PWA
caches that complete public profile in the existing user-scoped IndexedDB metadata so a previously
authenticated offline session keeps the same presentation. Legacy cached profiles default to metric
units during parsing.

All domain and synchronization values remain canonical:

- set and body weight is stored as kilograms;
- height and circumferences are stored as centimetres.

Conversion happens only at input and presentation boundaries. Manual set entry, body measurement
forms, CSV import, progress, trainer views, and natural-text input convert imperial values to the
canonical representation before persistence. Switching the profile changes labels and displayed
numbers, not stored history or revisions. CSV headers or values may explicitly state `kg`, `cm`,
`lb`, or `in`; an explicit unit wins over the profile default.

The React preferences provider is the single presentation source for authenticated screens. Catalog
names come from `nameRu` / `nameEn`; dates and numbers use the matching locale. The anonymous login
screen uses the browser language because no profile exists yet. Generic Web Push text is selected
from the persisted profile locale when a durable job is created and still contains no workout or
health data.

## Consequences

- Language and units follow the user across sessions and devices while remaining available offline
  after a successful sign-in.
- Progress formulas, conflict handling, and server history keep one stable metric representation.
- Rounding is limited to display and bounded canonical input conversion; changing units repeatedly
  does not rewrite stored records.
- Adding another language requires interface copy and catalog fields or a catalog translation layer.
  Adding another unit system requires explicit canonical conversion rules rather than a database
  migration of historical values.
