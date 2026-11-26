import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

export const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
export const eventFields = ['title', 'event_date', 'event_end_date', 'event_time', 'event_end_time', 'venue', 'city', 'ticket_url', 'review_status', 'publication_status', 'interest_score'] as const;
export type Snapshot = Record<string, unknown>;

export function jsonValue<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

export async function transaction<T>(pool: Pool, work: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    try {
      const result = await work(conn);
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    }
  } finally {
    conn.release();
  }
}

export async function lockEvent(conn: PoolConnection, id: number) {
  const [rows] = await conn.execute<RowDataPacket[]>('SELECT * FROM events WHERE id=? FOR UPDATE', [id]);
  if (!rows.length) throw fail(404, 'Event not found.');
  return rows[0];
}

export async function history(conn: PoolConnection, id: number, action: string, actor: string, changes: Snapshot = {}, context: Snapshot = {}) {
  await conn.execute('INSERT INTO event_history(event_id,action,actor,occurred_at,changes,context) VALUES(?,?,?,UTC_TIMESTAMP(3),?,?)', [id, action, actor, JSON.stringify(changes), JSON.stringify(context)]);
}

export function diff(before: Snapshot, after: Snapshot) {
  return Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(field => JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null))
    .map(field => [field, { before: before[field] ?? null, after: after[field] ?? null }]));
}

export async function snapshot(conn: PoolConnection, id: number, event?: RowDataPacket): Promise<Snapshot> {
  const row = event ?? await lockEvent(conn, id);
  const [price] = await conn.execute<RowDataPacket[]>('SELECT price_type,price_text FROM event_prices WHERE event_id=?', [id]);
  const [artists] = await conn.execute<RowDataPacket[]>('SELECT artist_mbid,decision FROM event_artist_decisions WHERE event_id=? ORDER BY artist_mbid', [id]);
  return {
    ...Object.fromEntries(eventFields.map(field => [field, row[field]])),
    price_type: price[0]?.price_type ?? 'unknown',
    price_text: price[0]?.price_text ?? null,
    artists,
  };
}

export async function recordChange(conn: PoolConnection, id: number, action: string, actor: string, before: Snapshot, after: Snapshot, context: Snapshot = {}) {
  const changes = diff(before, after);
  if (!Object.keys(changes).length) return false;
  await history(conn, id, action, actor, changes, context);
  if (Object.keys(changes).some(field => field !== 'interest_score' && field !== 'publication_status')) {
    await conn.execute(`UPDATE events SET revision=revision+1,verification_status=IF(verification_status='not_verified',verification_status,'stale') WHERE id=?`, [id]);
  }
  return true;
}

export async function setPublication(conn: PoolConnection, event: RowDataPacket, status: 'draft' | 'live', actor: string, manual: boolean, context: Snapshot = {}) {
  if (event.publication_status === status && (!manual || event.publication_manual)) return;
  await conn.execute('UPDATE events SET publication_status=?,publication_manual=?,revision=revision+1 WHERE id=?', [status, manual ? 1 : 0, event.id]);
  if (event.publication_status !== status) {
    await history(conn, Number(event.id), status === 'live' ? 'published' : 'unpublished', actor, diff({ publication_status: event.publication_status }, { publication_status: status }), context);
  } else {
    await history(conn, Number(event.id), 'publication_confirmed', actor, {}, { publication_status: status });
  }
}
