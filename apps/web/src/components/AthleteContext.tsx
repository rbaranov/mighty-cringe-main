import { createContext, useContext, type ReactNode } from 'react';

import type { TrainerAthleteSummary } from '@mighty-cringe/contracts';

import { tr, usePreferences } from '../lib/preferences';
import './AthleteContextHeader.css';

const AthleteContext = createContext<TrainerAthleteSummary | null>(null);

export function AthleteContextProvider({
  athlete,
  children,
}: {
  athlete: TrainerAthleteSummary | null;
  children: ReactNode;
}) {
  return <AthleteContext.Provider value={athlete}>{children}</AthleteContext.Provider>;
}

export function useAthleteContext() {
  return useContext(AthleteContext);
}

/** Repeat the owner inside dialogs, where the main masthead can be obscured. */
export function AthleteContextLabel() {
  const athlete = useAthleteContext();
  const { locale } = usePreferences();
  if (!athlete) return null;
  return (
    <p className="athlete-context-label">
      <span>{tr(locale, 'Подопечный', 'Athlete')} · </span>
      <strong>{athlete.displayName}</strong>
    </p>
  );
}
