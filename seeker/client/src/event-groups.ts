type DatedEvent = { event_date: string | null };

const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' });
const dayAndMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function groupNewestEvents<T extends DatedEvent>(events: T[], today: string) {
  const tomorrow = shiftDate(today, 1);
  const weekdayNumber = new Date(`${today}T12:00:00Z`).getUTCDay();
  const sunday = shiftDate(today, (7 - weekdayNumber) % 7);
  const lastSeparateDay = sunday < tomorrow ? tomorrow : sunday;
  const days = new Map<string, T[]>();
  const later: T[] = [];

  for (const event of events) {
    if (!event.event_date) continue;
    const date = event.event_date < today ? today : event.event_date;
    if (date > lastSeparateDay) {
      later.push(event);
      continue;
    }
    const group = days.get(date);
    if (group) group.push(event);
    else days.set(date, [event]);
  }

  const groups = [...days].sort(([first], [second]) => first.localeCompare(second)).map(([date, events]) => {
    const value = new Date(`${date}T12:00:00Z`);
    const title = date === today ? 'Today' : date === tomorrow ? 'Tomorrow' : weekday.format(value);
    return { key: date, title, dateLabel: dayAndMonth.format(value), events };
  });
  if (later.length) groups.push({ key: 'later', title: 'Later', dateLabel: '', events: later });
  return groups;
}
