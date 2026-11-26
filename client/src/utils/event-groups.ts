type DatedEvent = { id: number; event_date: string | null; times?: { date: string }[] };
export type EventListItem<T> = { type: 'heading'; date: string | null; key: string } | { type: 'row'; events: T[]; date: string | null; key: string } | { type: 'more'; date: string; remaining: number; key: string };

// Ongoing events appear on the first day of the selected range, rather than under a past date.
export function groupEventRows<T extends DatedEvent>(events: T[], columns: number, rangeStart: string, limits: Record<string, number> = {}): EventListItem<T>[] {
  const groups = new Map<string, T[]>();
  for (const event of events) {
    // An event with several showings is listed once, under its next showing in the range.
    const next = event.times?.length ? event.times.find(slot => slot.date >= rangeStart)?.date : undefined;
    const date = next ?? (event.event_date ? (event.event_date < rangeStart ? rangeStart : event.event_date) : '');
    const group = groups.get(date) ?? [];
    group.push(event);
    groups.set(date, group);
  }
  const result: EventListItem<T>[] = [];
  for (const [date, group] of groups) {
    result.push({ type: 'heading', date: date || null, key: `date-${date || 'unknown'}` });
    const visible = group.slice(0, limits[date] ?? group.length);
    for (let i = 0; i < visible.length; i += columns) {
      const row = visible.slice(i, i + columns);
      result.push({ type: 'row', events: row, date: date || null, key: `row-${row[0].id}` });
    }
    if (date && visible.length < group.length) result.push({ type: 'more', date, remaining: group.length - visible.length, key: `more-${date}` });
  }
  return result;
}

export function eventGroupLabel(date: string | null, today: string) {
  if (!date) return { title: 'Data nežinoma', date: '' };
  const tomorrow = new Date(`${today}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const value = new Date(`${date}T00:00:00Z`);
  const weekday = new Intl.DateTimeFormat('lt-LT', { weekday: 'long', timeZone: 'UTC' }).format(value);
  const title = date === today ? 'Šiandien' : date === tomorrow.toISOString().slice(0, 10) ? 'Rytoj' : weekday.charAt(0).toLocaleUpperCase('lt') + weekday.slice(1);
  const detail = new Intl.DateTimeFormat('lt-LT', { ...(date === today || date === tomorrow.toISOString().slice(0, 10) ? { weekday: 'long' as const } : {}), year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(value);
  return { title, date: detail };
}
