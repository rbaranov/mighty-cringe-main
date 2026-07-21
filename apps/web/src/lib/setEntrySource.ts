import type { SetEntrySource } from '@mighty-cringe/contracts';

export function setEntrySourceLabel(source: SetEntrySource): string | null {
  if (source === 'voice_ai') return 'AI: голос';
  if (source === 'natural_text') return 'текст';
  return null;
}

export function setEntrySourceSuffix(source: SetEntrySource): string {
  const label = setEntrySourceLabel(source);
  return label ? ` · ${label}` : '';
}
