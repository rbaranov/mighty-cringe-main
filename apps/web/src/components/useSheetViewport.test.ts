import { describe, expect, it } from 'vitest';
import { sheetViewportStyle } from './useSheetViewport';

describe('sheet viewport', () => {
  it('fits the visible region above a keyboard, including browser pan', () => {
    expect(sheetViewportStyle({ height: 330, offsetTop: 94, scale: 1 })).toEqual({
      '--sheet-viewport-height': '330px',
      '--sheet-viewport-top': '94px',
    });
  });

  it('restores the full height and top after the keyboard closes', () => {
    expect(sheetViewportStyle({ height: 844, offsetTop: 0, scale: 1 })).toEqual({
      '--sheet-viewport-height': '844px',
      '--sheet-viewport-top': '0px',
    });
  });

  it('does not mistake pinch zoom or a transient zero viewport for a keyboard', () => {
    expect(sheetViewportStyle({ height: 330, offsetTop: 94, scale: 2 })).toBeUndefined();
    expect(sheetViewportStyle({ height: 0, offsetTop: 0, scale: 1 })).toBeUndefined();
  });
});
