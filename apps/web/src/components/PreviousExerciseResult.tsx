import type { LocalSet, LocalWorkout } from '../lib/db';
import { formatSourceWeight, tr, usePreferences } from '../lib/preferences';
import { setEntryHistory } from '../lib/setEntryHistory';

export function PreviousExerciseResult({
  exerciseId,
  sets,
  workouts,
  workout,
}: {
  exerciseId: string;
  sets: LocalSet[];
  workouts: LocalWorkout[];
  workout?: LocalWorkout;
}) {
  const { locale, unitSystem } = usePreferences();
  const { previousWorkout, previousSets } = setEntryHistory(
    sets,
    workouts,
    workout ?? { id: '', startedAt: new Date().toISOString() },
    exerciseId,
  );
  if (!previousWorkout || !previousSets.length) return null;

  const groups: { weightKg: number; reps: number[] }[] = [];
  for (const set of previousSets) {
    const last = groups.at(-1);
    if (last?.weightKg === set.weightKg) last.reps.push(set.reps);
    else groups.push({ weightKg: set.weightKg, reps: [set.reps] });
  }
  const date = new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(previousWorkout.startedAt));

  return (
    <p className="previous-exercise-result">
      <span>
        {tr(locale, 'Прошлый раз', 'Last time')} ({date}):{' '}
      </span>
      {groups.map((group, index) => (
        <span className="previous-exercise-result-group" key={index}>
          {index > 0 ? '; ' : ''}
          {formatSourceWeight(group.weightKg, locale, unitSystem)} × {group.reps.join(' / ')}
        </span>
      ))}
    </p>
  );
}
