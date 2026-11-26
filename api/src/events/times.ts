import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { fail } from '../verification/history.js';

/** One showing of an event. Events with a single showing keep it on the event row and have no showtime rows. */
export interface Showtime { date: string; time: string | null; end_time: string | null }

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const validDate = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** Validated, de-duplicated showtimes in chronological order, or undefined when none were sent. */
export function parseShowtimes(value: unknown): Showtime[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 60) throw fail(400, 'Invalid showtimes.');
  const seen = new Map<string, Showtime>();
  for (const item of value) {
    const { date, time = null, end_time = null } = (item ?? {}) as Record<string, unknown>;
    if (!validDate(date) || (time !== null && (typeof time !== 'string' || !timePattern.test(time)))
        || (end_time !== null && (typeof end_time !== 'string' || !timePattern.test(end_time) || time === null))) throw fail(400, 'Invalid showtimes.');
    seen.set(`${date} ${time ?? ''}`, { date: date as string, time: time as string | null, end_time: end_time as string | null });
  }
  return [...seen.values()].sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''));
}

/** Replaces an event's showtimes. One showing or none leaves no rows: the event row holds it. */
export async function saveShowtimes(conn: PoolConnection, eventId: number, times: Showtime[]) {
  await conn.execute('DELETE FROM event_times WHERE event_id=?', [eventId]);
  if (times.length < 2) return;
  for (const time of times) {
    await conn.execute('INSERT INTO event_times(event_id,event_date,event_time,event_end_time) VALUES(?,?,?,?)', [eventId, time.date, time.time, time.end_time]);
  }
}

/** Showtimes for several events, keyed by event ID. */
export async function loadShowtimes(db: Pool | PoolConnection, ids: number[]): Promise<Map<number, Showtime[]>> {
  const result = new Map<number, Showtime[]>();
  if (!ids.length) return result;
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT event_id,event_date,event_time,event_end_time FROM event_times
    WHERE event_id IN (${ids.map(() => '?').join(',')}) ORDER BY event_date,event_time`, ids);
  for (const row of rows) {
    const id = Number(row.event_id);
    result.set(id, [...result.get(id) ?? [], { date: row.event_date, time: row.event_time ?? null, end_time: row.event_end_time ?? null }]);
  }
  return result;
}
