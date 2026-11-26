import type { Pool, RowDataPacket } from 'mysql2/promise';
import { fail, history, lockEvent, setPublication, transaction } from '../verification/history.js';

const sourceNames: Record<string, string> = { 'vilnius-events': 'Vilnius Events', avilys: 'Avilys' };

/**
 * Removes one source listing, for example one the source has taken down. An event with no other listing is deleted
 * with everything attached to it; otherwise the event stays and its remaining listing becomes the primary one.
 */
export function removeListing(pool: Pool, eventId: number, sourceKey: unknown, actor: string, sourceId?: unknown) {
  if (!Number.isSafeInteger(eventId) || eventId < 1 || typeof sourceKey !== 'string' || !(sourceKey in sourceNames)) throw fail(400, 'Choose an event and a source.');
  if (sourceId !== undefined && sourceId !== null && (typeof sourceId !== 'string' && typeof sourceId !== 'number' || String(sourceId).length > 191)) throw fail(400, 'Invalid source listing.');
  return transaction(pool, async conn => {
    await lockEvent(conn, eventId);
    const [sources] = await conn.execute<RowDataPacket[]>('SELECT id,source_key,source_id,is_secondary FROM event_sources WHERE event_id=? ORDER BY id FOR UPDATE', [eventId]);
    // A merged event can hold two listings from one source; then the request must say which one.
    const matching = sources.filter(source => source.source_key === sourceKey && (sourceId == null || String(source.source_id) === String(sourceId)));
    if (!matching.length) throw fail(404, `This event has no ${sourceNames[sourceKey]} listing.`);
    if (matching.length > 1) throw fail(409, `This event has several ${sourceNames[sourceKey]} listings. Choose one by source_id.`);
    const listing = matching[0];
    const remaining = sources.filter(source => source !== listing);
    if (sourceKey === 'vilnius-events') await conn.execute('DELETE FROM vilnius_events WHERE source_id=?', [Number(listing.source_id)]);
    await conn.execute('DELETE FROM event_images WHERE event_id=? AND source_key=? AND source_id=?', [eventId, sourceKey, String(listing.source_id)]);
    await conn.execute('DELETE FROM event_sources WHERE id=?', [listing.id]);
    // Remembered so a later import does not add it back while the source still lists it.
    await conn.execute('INSERT IGNORE INTO removed_listings(source_key,source_id,removed_at) VALUES(?,?,?)', [sourceKey, String(listing.source_id), new Date().toISOString()]);
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

export type GoneOutcome = 'deleted' | 'detached' | 'unpublished' | 'kept';

/**
 * Handles a listing its source has taken down, as found by a scheduled import.
 * A draft is removed. A live event is never deleted automatically: it is unpublished and flagged for an editor once,
 * and later runs keep it. A listing that shares its event with other sources is detached.
 */
export async function listingGone(pool: Pool, eventId: number, sourceKey: unknown, sourceId: unknown, actor: string): Promise<{ outcome: GoneOutcome }> {
  if (!Number.isSafeInteger(eventId) || eventId < 1 || typeof sourceKey !== 'string' || !(sourceKey in sourceNames)) throw fail(400, 'Choose an event and a source.');
  if ((typeof sourceId !== 'string' && typeof sourceId !== 'number') || !String(sourceId) || String(sourceId).length > 191) throw fail(400, 'Invalid source listing.');
  const decision = await transaction(pool, async conn => {
    const event = await lockEvent(conn, eventId);
    const [sources] = await conn.execute<RowDataPacket[]>('SELECT source_key,source_id FROM event_sources WHERE event_id=? FOR UPDATE', [eventId]);
    if (!sources.some(source => source.source_key === sourceKey && String(source.source_id) === String(sourceId))) throw fail(404, `This event has no such ${sourceNames[sourceKey]} listing.`);
    if (sources.length > 1) return 'detach' as const;
    const [flagged] = await conn.execute<RowDataPacket[]>(`SELECT id FROM event_history WHERE event_id=? AND action='source_gone'
      AND JSON_UNQUOTE(JSON_EXTRACT(context,'$.source_id'))=? LIMIT 1`, [eventId, String(sourceId)]);
    if (flagged.length) return 'kept' as const;
    if (event.publication_status !== 'live') return 'delete' as const;
    await setPublication(conn, event, 'draft', actor, false, { reason: 'source_gone' });
    await conn.execute('UPDATE events SET needs_attention=1 WHERE id=?', [eventId]);
    await history(conn, eventId, 'source_gone', actor, {}, { source_key: sourceKey, source_id: String(sourceId) });
    return 'unpublished' as const;
  });
  if (decision === 'kept' || decision === 'unpublished') return { outcome: decision };
  await removeListing(pool, eventId, sourceKey, actor, sourceId);
  return { outcome: decision === 'delete' ? 'deleted' : 'detached' };
}
