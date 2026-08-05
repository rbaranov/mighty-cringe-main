import { useRef, type ButtonHTMLAttributes } from 'react';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  onPress: () => void;
};

/**
 * Commits a button action before iOS resizes the visual viewport to dismiss
 * the software keyboard. Without this, the target can move between
 * pointerdown and click and Safari drops the click entirely.
 */
export function KeyboardSafeButton({ onPointerDown, onPress, ...props }: Props) {
  const pressedBeforeKeyboardDismissal = useRef(false);

  return (
    <button
      {...props}
      onClick={() => {
        if (pressedBeforeKeyboardDismissal.current) {
          pressedBeforeKeyboardDismissal.current = false;
          return;
        }
        onPress();
      }}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          !isTextEntryElement(document.activeElement)
        ) {
          return;
        }

        event.preventDefault();
        pressedBeforeKeyboardDismissal.current = true;
        window.setTimeout(() => {
          pressedBeforeKeyboardDismissal.current = false;
        }, 1_000);
        document.activeElement.blur();
        onPress();
      }}
    />
  );
}

function isTextEntryElement(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element instanceof HTMLTextAreaElement || element.isContentEditable) return true;
  if (!(element instanceof HTMLInputElement)) return false;
  return ![
    'button',
    'checkbox',
    'color',
    'file',
    'hidden',
    'image',
    'radio',
    'range',
    'reset',
    'submit',
  ].includes(element.type);
}
