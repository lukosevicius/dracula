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

/** Current Vilnius time as "HH:MM". */
export function vilniusTime(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vilnius', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.hour}:${value.minute}`;
}

const minutes = (time: string) => { const [h, m] = time.split(':').map(Number); return h * 60 + (m || 0); };
/** Without an end time an event is treated as over this long after it starts. */
const assumedLength = 120;

type TimedEvent = { event_date: string | null; event_end_date?: string | null; event_time?: string | null; event_end_time?: string | null; times?: { date: string; time: string | null; end_time: string | null }[] };

/**
 * True for an event that took place earlier today and is over, so "Šiandien" shows what is still ahead.
 * Multi-day events, events with later showings and events without a time are never hidden.
 */
export function endedToday(event: TimedEvent, today: string, now: string) {
  const slots = event.times?.length ? event.times : [{ date: event.event_date ?? '', time: event.event_time ?? null, end_time: event.event_end_time ?? null }];
  if (event.event_end_date && event.event_end_date > today) return false;
  if (slots.some(slot => slot.date > today)) return false;
  const todays = slots.filter(slot => slot.date === today);
  if (!todays.length || todays.some(slot => !slot.time)) return false;
  return todays.every(slot => {
    const start = minutes(slot.time!);
    // An end time earlier than the start runs past midnight, so it is still on; one equal to the start is a data gap.
    const given = slot.end_time && slot.end_time !== slot.time ? minutes(slot.end_time) : null;
    const end = given == null ? start + assumedLength : given < start ? Infinity : given;
    return end <= minutes(now);
  });
}

/** Lithuanian noun form for a count: 1 renginys, 2 renginiai, 10 renginių. */
export function plural(count: number, [one, few, many]: [string, string, string]) {
  const mod10 = count % 10, mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod100 >= 10 && mod100 < 20) return many;
  return mod10 >= 2 ? few : many;
}
export const eventsWord = (count: number) => `${count} ${plural(count, ['renginys', 'renginiai', 'renginių'])}`;
