import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { setPublication } from '../verification/history.js';

/**
 * Imported events go live as soon as they have a date. An event without a date stays a draft until a later import
 * finds one. Editors' publication choices are never overridden, and an event that already had a date is left alone,
 * so drafts kept back on purpose stay drafts.
 */
export async function publishIfDated(conn: PoolConnection, id: number, previousDate: unknown, actor: string) {
  if (previousDate) return;
  const [rows] = await conn.execute<RowDataPacket[]>('SELECT id,event_date,publication_status,publication_manual FROM events WHERE id=?', [id]);
  const event = rows[0];
  if (!event?.event_date || event.publication_status !== 'draft' || Number(event.publication_manual)) return;
  await setPublication(conn, event, 'live', actor, false, { reason: 'imported_with_date' });
}
