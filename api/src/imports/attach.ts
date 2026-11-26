import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { diff, history, jsonValue, snapshot, type Snapshot } from '../verification/history.js';
import { findImportMatch } from '../events/duplicates.js';
import { mergeEventsIn } from '../events/merge.js';

export type SourceField = 'event_date' | 'event_end_date' | 'event_time' | 'event_end_time' | 'venue' | 'ticket_url' | 'city';

function manualFields(event: RowDataPacket): string[] {
  try {
    const value = jsonValue<unknown>(event.manual_fields);
    return Array.isArray(value) ? value.filter((field): field is string => typeof field === 'string') : [];
  } catch {
    // Unreadable protection data must not unlock any field.
    return ['event_date', 'event_end_date', 'event_time', 'event_end_time', 'venue', 'ticket_url', 'city', 'title'];
  }
}

/**
 * A secondary listing only fills values the event is missing. The event's first source and editors own the rest.
 * The event date is never changed: it is how the listing was matched.
 */
export async function fillFromSource(conn: PoolConnection, event: RowDataPacket, values: Partial<Record<SourceField, string | null>>, now: string) {
  const manual = manualFields(event);
  const updates = (Object.keys(values) as SourceField[])
    .filter(field => field !== 'event_date' && values[field] && (event[field] == null || event[field] === '') && !manual.includes(field));
  if (!updates.length) return;
  if (updates.includes('event_end_date') && (!event.event_date || String(values.event_end_date) < String(event.event_date))) updates.splice(updates.indexOf('event_end_date'), 1);
  if (!updates.length) return;
  await conn.execute(`UPDATE events SET ${updates.map(field => `${field}=?`).join(',')},updated_at=? WHERE id=?`, [...updates.map(field => values[field]!), now, event.id]);
}

/** Logs the new listing and marks earlier verification stale, because the event now has more evidence. */
export async function recordAttach(conn: PoolConnection, id: number, before: Snapshot, actor: string, context: Snapshot) {
  await history(conn, id, 'source_attached', actor, diff(before, await snapshot(conn, id)), context);
  await conn.execute(`UPDATE events SET revision=revision+1,verification_status=IF(verification_status='not_verified',verification_status,'stale') WHERE id=?`, [id]);
}

/**
 * A VN event that gains or changes its date after import gets the same matching as a new listing. A confident
 * match from another source is merged with it. Returns the ID that now holds the event.
 */
export async function mergeIfMatched(conn: PoolConnection, id: number, previousDate: unknown, actor: string): Promise<number> {
  const [rows] = await conn.execute<RowDataPacket[]>('SELECT id,title,event_date,event_time,venue,city FROM events WHERE id=?', [id]);
  const event = rows[0];
  if (!event?.event_date || event.event_date === previousDate) return id;
  const match = await findImportMatch(conn, { title: String(event.title), event_date: event.event_date, event_time: event.event_time, venue: event.venue, city: event.city }, 'vilnius-events');
  if (!match) return id;
  return (await mergeEventsIn(conn, id, match, actor, {}, { automatic: true, reason: 'date_found' })).event_id;
}
