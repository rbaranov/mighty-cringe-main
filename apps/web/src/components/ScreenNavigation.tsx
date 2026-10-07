import { useLayoutEffect, useRef } from 'react';

import { KeyboardSafeButton } from './KeyboardSafeButton';
import './screen-navigation.css';

type BackButtonProps = {
  label: string;
  onBack: () => void;
  disabled?: boolean;
};

export function BackButton({ label, onBack, disabled }: BackButtonProps) {
  return (
    <KeyboardSafeButton
      aria-label={label}
      className="navigation-back"
      disabled={disabled}
      onPress={() => {
        if (!disabled) onBack();
      }}
      title={label}
      type="button"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <path d="m14 5-7 7 7 7" />
      </svg>
    </KeyboardSafeButton>
  );
}

/** One persistent place to leave a nested screen, even after scrolling its content. */
export function ScreenNavigation({
  title,
  backLabel,
  onBack,
  disabled,
}: {
  title: string;
  backLabel: string;
  onBack: () => void;
  disabled?: boolean;
}) {
  const header = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    // Screens scroll inside the app shell; scrolling window leaves the heading offscreen.
    header.current?.closest('.app-content')?.scrollTo(0, 0);
  }, [title]);

  return (
    <header className="screen-navigation" ref={header}>
      <BackButton
        disabled={disabled}
        label={backLabel}
        onBack={() => {
          header.current?.closest('.app-content')?.scrollTo(0, 0);
          onBack();
        }}
      />
      <span className="screen-navigation-title">{title}</span>
    </header>
  );
}
