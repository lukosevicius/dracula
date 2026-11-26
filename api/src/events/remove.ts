import type { Pool, RowDataPacket } from 'mysql2/promise';
import { fail, history, lockEvent, transaction } from '../verification/history.js';

const sourceNames: Record<string, string> = { 'vilnius-events': 'Vilnius Events', avilys: 'Avilys' };

/**
 * Removes one source listing, for example one the source has taken down. An event with no other listing is deleted
 * with everything attached to it; otherwise the event stays and its remaining listing becomes the primary one.
 */
export function removeListing(pool: Pool, eventId: number, sourceKey: unknown, actor: string) {
  if (!Number.isSafeInteger(eventId) || eventId < 1 || typeof sourceKey !== 'string' || !(sourceKey in sourceNames)) throw fail(400, 'Choose an event and a source.');
  return transaction(pool, async conn => {
    await lockEvent(conn, eventId);
    const [sources] = await conn.execute<RowDataPacket[]>('SELECT id,source_key,source_id,is_secondary FROM event_sources WHERE event_id=? ORDER BY id FOR UPDATE', [eventId]);
    const listing = sources.find(source => source.source_key === sourceKey);
    if (!listing) throw fail(404, `This event has no ${sourceNames[sourceKey]} listing.`);
    const remaining = sources.filter(source => source !== listing);
    if (sourceKey === 'vilnius-events') await conn.execute('DELETE FROM vilnius_events WHERE source_id=?', [Number(listing.source_id)]);
    await conn.execute('DELETE FROM event_images WHERE event_id=? AND source_key=?', [eventId, sourceKey]);
    await conn.execute('DELETE FROM event_sources WHERE id=?', [listing.id]);
    if (!remaining.length) {
      // Tables without cascading keys; the rest (history, findings, prices, saves, redirects) cascade.
      await conn.execute('DELETE FROM event_artist_decisions WHERE event_id=?', [eventId]);
      await conn.execute('DELETE FROM ai_evaluations WHERE event_id=?', [eventId]);
      await conn.execute('DELETE FROM events WHERE id=?', [eventId]);
      return { event_deleted: true };
    }
    if (!Number(listing.is_secondary)) await conn.execute('UPDATE event_sources SET is_secondary=FALSE WHERE id=?', [remaining[0].id]);
    await history(conn, eventId, 'source_removed', actor, {}, { source_key: sourceKey, source_id: listing.source_id });
    return { event_deleted: false };
  });
}
