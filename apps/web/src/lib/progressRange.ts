export type ProgressPeriod = 30 | 90 | 'all';

/** Calendar-day windows use local date keys, so a DST day still counts as one day. */
export function progressWindow(period: ProgressPeriod, todayKey: string) {
  const shift = (days: number) => {
    const date = new Date(`${todayKey}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  return {
    start: period === 'all' ? null : shift(1 - period),
    end: todayKey,
    previousStart: period === 'all' ? null : shift(1 - period * 2),
    previousEnd: period === 'all' ? null : shift(-period),
  };
}

export function inProgressWindow(
  dateKey: string,
  window: ReturnType<typeof progressWindow>,
  previous = false,
) {
  const start = previous ? window.previousStart : window.start;
  const end = previous ? window.previousEnd : window.end;
  return end !== null && (!start || dateKey >= start) && dateKey <= end;
}

/** Position points using the real workout start instant, including same-day sessions. */
export function timestampPosition(value: string, first: string, last: string): number {
  const span = Date.parse(last) - Date.parse(first);
  return span === 0 ? 0.5 : (Date.parse(value) - Date.parse(first)) / span;
}
