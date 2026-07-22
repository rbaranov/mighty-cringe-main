import { describe, expect, it } from 'vitest';

import { setEntrySourceLabel, setEntrySourceSuffix } from './setEntrySource';

describe('set entry provenance', () => {
  it('leaves manual entries unbadged', () => {
    expect(setEntrySourceLabel('manual')).toBeNull();
    expect(setEntrySourceSuffix('manual')).toBe('');
  });

  it('distinguishes deterministic text input from AI voice transcription', () => {
    expect(setEntrySourceSuffix('natural_text')).toBe(' · текст');
    expect(setEntrySourceSuffix('voice_ai')).toBe(' · AI: голос');
  });
});
