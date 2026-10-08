import { useEffect, useId, useRef } from 'react';

import type { CurrentUser, TrainerAthleteSummary } from '@mighty-cringe/contracts';

import { tr, usePreferences } from '../lib/preferences';
import './AthleteContextHeader.css';

type Props = {
  user: CurrentUser;
  athlete: TrainerAthleteSummary | null;
  athletes: TrainerAthleteSummary[];
  onSelectAthlete: (athlete: TrainerAthleteSummary) => void;
  onReturnToSelf: () => void;
  onManageAthletes?: () => void;
  switching?: boolean;
};

export function AthleteContextHeader({
  user,
  athlete,
  athletes,
  onSelectAthlete,
  onReturnToSelf,
  onManageAthletes,
  switching = false,
}: Props) {
  const { locale } = usePreferences();
  const menuRef = useRef<HTMLDetailsElement>(null);
  const menuId = useId();
  const canSwitch = ['trainer', 'admin', 'superadmin'].includes(user.role);
  const firstName = user.displayName.trim().split(/\s+/)[0] || tr(locale, 'спортсмен', 'athlete');

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        menuRef.current.open = false;
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);

  function select(action: () => void) {
    if (switching) return;
    if (menuRef.current) menuRef.current.open = false;
    action();
  }

  return (
    <div className={`athlete-context-header${athlete ? ' athlete-context-header-delegated' : ''}`}>
      <div className="athlete-context-brand-row">
        <p className="brand">MightyCringe</p>
        {athlete && (
          <button
            className="athlete-context-return"
            disabled={switching}
            onClick={() => select(onReturnToSelf)}
            type="button"
          >
            {tr(locale, 'К себе', 'My log')}
          </button>
        )}
      </div>
      {canSwitch ? (
        <details
          className="athlete-context-switcher"
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || !menuRef.current) return;
            menuRef.current.open = false;
            menuRef.current.querySelector('summary')?.focus();
          }}
          ref={menuRef}
        >
          <summary
            aria-controls={menuId}
            aria-disabled={switching}
            aria-label={
              athlete
                ? tr(
                    locale,
                    `Подопечный: ${athlete.displayName}. Сменить профиль`,
                    `Athlete: ${athlete.displayName}. Switch profile`,
                  )
                : tr(
                    locale,
                    'Мои тренировки. Выбрать подопечного',
                    'My workouts. Choose an athlete',
                  )
            }
            onClick={(event) => {
              if (switching) event.preventDefault();
            }}
            title={athlete?.displayName}
          >
            {athlete ? (
              <>
                <span className="athlete-context-prefix">
                  {tr(locale, 'Подопечный', 'Athlete')} ·
                </span>
                <strong className="athlete-context-current-name">{athlete.displayName}</strong>
              </>
            ) : (
              <span className="athlete-context-current-name">
                {tr(locale, 'Привет', 'Hi')}, {firstName} 👋
              </span>
            )}
            <span aria-hidden="true" className="athlete-context-chevron">
              ▾
            </span>
          </summary>
          <div
            aria-label={tr(locale, 'Выбор профиля', 'Choose a profile')}
            className="athlete-context-menu"
            id={menuId}
          >
            <button
              aria-current={!athlete ? 'true' : undefined}
              disabled={switching}
              onClick={() => select(onReturnToSelf)}
              type="button"
            >
              <span>{tr(locale, 'Мои тренировки', 'My workouts')}</span>
              <small>{user.displayName}</small>
            </button>
            {athletes.map((item) => (
              <button
                aria-current={athlete?.id === item.id ? 'true' : undefined}
                disabled={switching}
                key={item.id}
                onClick={() => select(() => onSelectAthlete(item))}
                type="button"
              >
                <span>{item.displayName}</span>
                <small>
                  {item.access === 'manage'
                    ? tr(locale, 'Просмотр и изменения', 'View and edit')
                    : tr(locale, 'Только просмотр', 'View only')}
                </small>
              </button>
            ))}
            {athletes.length === 0 && (
              <p>{tr(locale, 'Пока нет подключённых подопечных.', 'No connected athletes yet.')}</p>
            )}
            {onManageAthletes && (
              <button
                className="athlete-context-manage"
                disabled={switching}
                onClick={() => select(onManageAthletes)}
                type="button"
              >
                {tr(locale, 'Управлять подопечными', 'Manage athletes')}
              </button>
            )}
          </div>
        </details>
      ) : (
        <p className="subtle">
          {tr(locale, 'Привет', 'Hi')}, {firstName} 👋
        </p>
      )}
    </div>
  );
}
