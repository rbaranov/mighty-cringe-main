import type { UnitSystem } from '@mighty-cringe/contracts';
import { canonicalWeight, displayWeight } from '../lib/preferences';

// Display units are rounded. Pass a source only while the weight field is untouched.
// Reusing a previous value must not manufacture a tiny PR; explicit edits use typed units.
export function canonicalSetWeight(
  value: string,
  sourceWeightKg: number | null,
  unitSystem: UnitSystem,
): number | null {
  const parsed = parseDecimalInput(value);
  if (parsed === null) return null;
  if (sourceWeightKg !== null && parsed === displayWeight(sourceWeightKg, unitSystem))
    return sourceWeightKg;
  return canonicalWeight(parsed, unitSystem);
}

export function parseDecimalInput(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/u.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseIntegerInput(value: string): number | null {
  const parsed = parseDecimalInput(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

export function stepNumericInput(
  value: string,
  direction: -1 | 1,
  step: number,
  minimum: number,
  maximum: number,
  locale: 'ru' | 'en',
) {
  const parsed = parseDecimalInput(value);
  const next =
    parsed === null
      ? minimum
      : Math.min(maximum, Math.max(minimum, Number((parsed + direction * step).toFixed(2))));
  return formatNumericInput(next, locale);
}

export function formatNumericInput(value: number, locale: 'ru' | 'en') {
  const formatted = String(value);
  return locale === 'ru' ? formatted.replace('.', ',') : formatted;
}
