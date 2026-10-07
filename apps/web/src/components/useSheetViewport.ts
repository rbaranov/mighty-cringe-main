import { useEffect, type CSSProperties } from 'react';

type SheetViewportStyle = CSSProperties & {
  '--sheet-viewport-height': string;
  '--sheet-viewport-top': string;
};

/** Shared by all modal backdrops, including those whose content scrolls internally. */
export function useSheetViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    // Measurement sheets are portaled to body, so the shared values must live above the app root.
    const root = document.documentElement.style;
    const properties = ['--sheet-viewport-height', '--sheet-viewport-top'] as const;
    const previous = properties.map((name) => ({
      name,
      value: root.getPropertyValue(name),
      priority: root.getPropertyPriority(name),
    }));
    const sync = () => {
      const style = sheetViewportStyle(viewport);
      for (const name of properties) {
        if (style) root.setProperty(name, style[name]);
        else root.removeProperty(name);
      }
    };
    sync();
    viewport.addEventListener('resize', sync);
    viewport.addEventListener('scroll', sync);
    window.addEventListener('pageshow', sync);
    window.addEventListener('resize', sync);
    return () => {
      viewport.removeEventListener('resize', sync);
      viewport.removeEventListener('scroll', sync);
      window.removeEventListener('pageshow', sync);
      window.removeEventListener('resize', sync);
      for (const { name, value, priority } of previous) {
        if (value) root.setProperty(name, value, priority);
        else root.removeProperty(name);
      }
    };
  }, []);
}

export function sheetViewportStyle({
  height,
  offsetTop,
  scale,
}: Pick<VisualViewport, 'height' | 'offsetTop' | 'scale'>): SheetViewportStyle | undefined {
  // Pinch zoom must remain pannable; it is not an on-screen keyboard resize.
  if (scale !== 1 || !Number.isFinite(height) || height <= 0) return undefined;
  return {
    '--sheet-viewport-height': `${height}px`,
    '--sheet-viewport-top': `${Math.max(0, offsetTop)}px`,
  };
}
