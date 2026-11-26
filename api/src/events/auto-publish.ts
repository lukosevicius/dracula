import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { jsonValue, setPublication } from '../verification/history.js';

/** Vilnius Events' "Festivaliai" category also holds festivals that are not music, so an editor checks those first. */
const vilniusFestivalCategory = 81;

/**
 * Imported events go live as soon as they have a date. An event without a date stays a draft until a later import
 * finds one. Editors' publication choices are never overridden, and an event that already had a date is left alone,
 * so drafts kept back on purpose stay drafts. Vilnius Events festival listings always wait for an editor.
 */
export async function publishIfDated(conn: PoolConnection, id: number, previousDate: unknown, actor: string) {
  if (previousDate) return;
  const [rows] = await conn.execute<RowDataPacket[]>('SELECT id,event_date,publication_status,publication_manual FROM events WHERE id=?', [id]);
  const event = rows[0];
  if (!event?.event_date || event.publication_status !== 'draft' || Number(event.publication_manual)) return;
  const [vilnius] = await conn.execute<RowDataPacket[]>("SELECT source_id FROM event_sources WHERE event_id=? AND source_key='vilnius-events'", [id]);
  for (const { source_id } of vilnius) {
    const [listings] = await conn.execute<RowDataPacket[]>('SELECT categories_json FROM vilnius_events WHERE source_id=?', [Number(source_id)]);
    if (listings.some(listing => categories(listing.categories_json).includes(vilniusFestivalCategory))) return;
  }
  await setPublication(conn, event, 'live', actor, false, { reason: 'imported_with_date' });
}

function categories(value: unknown): number[] {
  try {
    const list = jsonValue<unknown>(value);
    return Array.isArray(list) ? list.map(Number) : [];
  } catch {
    return [];
  }
}
