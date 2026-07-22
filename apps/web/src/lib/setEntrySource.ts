import type { CurrentUser, SetEntrySource } from '@mighty-cringe/contracts';

export function setEntrySourceLabel(
  source: SetEntrySource,
  locale: CurrentUser['locale'] = 'ru',
): string | null {
  if (source === 'voice_ai') return locale === 'en' ? 'AI: voice' : 'AI: голос';
  if (source === 'natural_text') return locale === 'en' ? 'text' : 'текст';
  return null;
}

export function setEntrySourceSuffix(
  source: SetEntrySource,
  locale: CurrentUser['locale'] = 'ru',
): string {
  const label = setEntrySourceLabel(source, locale);
  return label ? ` · ${label}` : '';
}
