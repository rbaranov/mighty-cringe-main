import { tr, usePreferences } from '../lib/preferences';
import type { PendingConfirmation } from '../lib/confirmation';

export function ConfirmationSheet({
  confirmation,
  onClose,
  onConfirm,
}: {
  confirmation: PendingConfirmation | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { locale } = usePreferences();
  if (!confirmation) return null;

  const step = confirmation.steps[confirmation.stepIndex] ?? confirmation.steps[0];
  const eyebrow =
    confirmation.steps.length > 1
      ? tr(
          locale,
          `Подтверждение ${confirmation.stepIndex + 1} из ${confirmation.steps.length}`,
          `Confirmation ${confirmation.stepIndex + 1} of ${confirmation.steps.length}`,
        )
      : tr(locale, 'Подтверждение', 'Confirmation');

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label={step.title}
        aria-modal="true"
        className="sheet confirmation-sheet"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="sheet-handle" />
        <p className="eyebrow">{eyebrow}</p>
        <h2>{step.title}</h2>
        <p className="confirmation-message">{step.message}</p>
        <button className="button danger full" onClick={onConfirm} type="button">
          {step.confirmLabel}
        </button>
        <button className="button ghost full" onClick={onClose} type="button">
          {tr(locale, 'Отмена', 'Cancel')}
        </button>
      </section>
    </div>
  );
}
