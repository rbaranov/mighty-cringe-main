import { createContext, useContext, type ReactNode } from 'react';

import type {
  CurrentUser,
  Exercise,
  MeasurementNumericKey,
  UnitSystem,
  UpdateUserPreferences,
} from '@mighty-cringe/contracts';

type Locale = CurrentUser['locale'];

const PreferencesContext = createContext<{ locale: Locale; unitSystem: UnitSystem }>({
  locale: 'ru',
  unitSystem: 'metric',
});

export function PreferencesProvider({
  locale,
  unitSystem,
  children,
}: {
  locale: Locale;
  unitSystem: UnitSystem;
  children: ReactNode;
}) {
  return (
    <PreferencesContext.Provider value={{ locale, unitSystem }}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  return useContext(PreferencesContext);
}

export function tr(locale: Locale, russian: string, english: string) {
  return locale === 'en' ? english : russian;
}

export function exerciseName(exercise: Exercise, locale: Locale) {
  return locale === 'en' ? exercise.nameEn : exercise.nameRu;
}

export function weightUnit(unitSystem: UnitSystem, locale: Locale = 'ru') {
  return unitSystem === 'imperial' ? 'lb' : tr(locale, 'кг', 'kg');
}

export function lengthUnit(unitSystem: UnitSystem, locale: Locale = 'ru') {
  return unitSystem === 'imperial' ? 'in' : tr(locale, 'см', 'cm');
}

export function displayWeight(weightKg: number, unitSystem: UnitSystem) {
  return round(unitSystem === 'imperial' ? weightKg * 2.2046226218 : weightKg, 1);
}

export function canonicalWeight(displayValue: number, unitSystem: UnitSystem) {
  return round(unitSystem === 'imperial' ? displayValue / 2.2046226218 : displayValue, 2);
}

export function displayLength(lengthCm: number, unitSystem: UnitSystem) {
  return round(unitSystem === 'imperial' ? lengthCm / 2.54 : lengthCm, 1);
}

export function canonicalLength(displayValue: number, unitSystem: UnitSystem) {
  return round(unitSystem === 'imperial' ? displayValue * 2.54 : displayValue, 2);
}

export function formatWeight(weightKg: number, locale: Locale, unitSystem: UnitSystem) {
  return `${formatNumber(displayWeight(weightKg, unitSystem), locale)} ${weightUnit(unitSystem, locale)}`;
}

export function formatLength(lengthCm: number, locale: Locale, unitSystem: UnitSystem) {
  return `${formatNumber(displayLength(lengthCm, unitSystem), locale)} ${lengthUnit(unitSystem, locale)}`;
}

export function displayMeasurement(
  key: MeasurementNumericKey,
  value: number,
  locale: Locale,
  unitSystem: UnitSystem,
) {
  if (key === 'bodyFatPercent') return `${formatNumber(value, locale)} %`;
  return key === 'weightKg'
    ? formatWeight(value, locale, unitSystem)
    : formatLength(value, locale, unitSystem);
}

export function displayMeasurementNumber(
  key: MeasurementNumericKey,
  value: number,
  unitSystem: UnitSystem,
) {
  if (key === 'bodyFatPercent') return value;
  return key === 'weightKg' ? displayWeight(value, unitSystem) : displayLength(value, unitSystem);
}

export function canonicalMeasurementNumber(
  key: MeasurementNumericKey,
  value: number,
  unitSystem: UnitSystem,
) {
  if (key === 'bodyFatPercent') return value;
  return key === 'weightKg'
    ? canonicalWeight(value, unitSystem)
    : canonicalLength(value, unitSystem);
}

export function measurementUnit(
  key: MeasurementNumericKey,
  unitSystem: UnitSystem,
  locale: Locale = 'ru',
) {
  if (key === 'bodyFatPercent') return '%';
  return key === 'weightKg' ? weightUnit(unitSystem, locale) : lengthUnit(unitSystem, locale);
}

export async function updateProfilePreferences(input: UpdateUserPreferences) {
  const response = await fetch('/api/v1/me/preferences', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new Event('mighty-cringe:unauthorized'));
    }
    throw new Error(
      input.locale === 'en'
        ? 'Could not save profile preferences.'
        : 'Не удалось сохранить настройки профиля.',
    );
  }
  return (await response.json()) as { user: CurrentUser };
}

function formatNumber(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'ru-RU', {
    maximumFractionDigits: 1,
  }).format(value);
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
