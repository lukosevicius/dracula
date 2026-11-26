import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { fail, jsonValue, recordChange, snapshot, transaction } from '../verification/history.js';
import { listDuplicates } from './duplicates.js';

// Fields a merge may fill on the kept event when it has no value of its own.
const fillable = ['event_end_date', 'event_time', 'venue', 'city', 'ticket_url'] as const;
const blank = (value: unknown) => value == null || (typeof value === 'string' && !value.trim());

function manualFields(event: RowDataPacket): string[] {
  try {
    const value = jsonValue<unknown>(event.manual_fields);
    return Array.isArray(value) ? value.filter((field): field is string => typeof field === 'string') : [];
  } catch {
    return [];
  }
}

/** Keep the public listing, then the edited one, then the older one. */
export function chooseSurvivor(a: RowDataPacket, b: RowDataPacket): [RowDataPacket, RowDataPacket] {
  const rank = (event: RowDataPacket) => [event.publication_status === 'live' ? 1 : 0, manualFields(event).length ? 1 : 0, -Number(event.id)];
  const [x, y] = [rank(a), rank(b)];
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i] ? [a, b] : [b, a];
  return [a, b];
}

/**
 * Moves everything attached to one event onto another and removes the first. The removed ID redirects to the kept
 * event. The kept event's own values win; empty fields are filled from the removed event. Runs in the caller's
 * transaction.
 */
export async function mergeEventsIn(conn: PoolConnection, firstId: number, secondId: number, actor: string, context: Record<string, unknown> = {}) {
  if (!Number.isSafeInteger(firstId) || !Number.isSafeInteger(secondId) || firstId < 1 || secondId < 1 || firstId === secondId) throw fail(400, 'Choose two different events.');
  const [rows] = await conn.execute<RowDataPacket[]>('SELECT * FROM events WHERE id IN (?,?) ORDER BY id FOR UPDATE', [firstId, secondId]);
  if (rows.length !== 2) throw fail(404, 'Event not found.');
  const [survivor, removed] = chooseSurvivor(rows[0], rows[1]);
  const keep = Number(survivor.id), drop = Number(removed.id);
  const [sources] = await conn.execute<RowDataPacket[]>('SELECT event_id,source_key,source_id,is_secondary FROM event_sources WHERE event_id IN (?,?) FOR UPDATE', [keep, drop]);
  const keptKeys = new Set(sources.filter(source => Number(source.event_id) === keep).map(source => source.source_key));
  if (sources.some(source => Number(source.event_id) === drop && keptKeys.has(source.source_key))) {
    throw fail(409, 'Both events have a listing from the same source. Unpublish the extra listing instead.');
  }
  const before = await snapshot(conn, keep, survivor);

  // Fill empty values, carrying over manual protection for values that came from the removed event.
  const manual = new Set(manualFields(survivor)), removedManual = new Set(manualFields(removed));
  type Value = string | number | null;
  const updates: Record<string, Value> = {};
  for (const field of fillable) {
    if (blank(survivor[field]) && !blank(removed[field])) {
      updates[field] = removed[field] as Value;
      if (removedManual.has(field)) manual.add(field);
    }
  }
  for (const field of ['description_override', 'about_url_override'] as const) {
    if (blank(survivor[field]) && !blank(removed[field])) updates[field] = removed[field] as Value;
  }
  if (survivor.review_status === 'unsure' && removed.review_status !== 'unsure') {
    updates.review_status = removed.review_status as Value;
    updates.classification_manual = removed.classification_manual as Value;
  }
  if (Number(removed.interest_score) > Number(survivor.interest_score)) updates.interest_score = Number(removed.interest_score);
  updates.manual_fields = JSON.stringify([...manual]);
  updates.updated_at = new Date().toISOString();
  await conn.execute(`UPDATE events SET ${Object.keys(updates).map(field => `${field}=?`).join(',')} WHERE id=?`, [...Object.values(updates), keep]);
  // A primary Vilnius Events record mirrors the editable details and their protection.
  const legacy = sources.find(source => Number(source.event_id) === keep && source.source_key === 'vilnius-events' && !Number(source.is_secondary));
  if (legacy) {
    const mirrored = fillable.filter(field => field !== 'city' && field in updates);
    await conn.execute(`UPDATE vilnius_events SET ${[...mirrored.map(field => `${field}=?`), 'manual_fields=?'].join(',')} WHERE source_id=?`,
      [...mirrored.map(field => updates[field]), updates.manual_fields, Number(legacy.source_id)]);
  }

  // A known or manual price replaces an unknown automatic one.
  const [prices] = await conn.execute<RowDataPacket[]>('SELECT * FROM event_prices WHERE event_id IN (?,?) FOR UPDATE', [keep, drop]);
  const keptPrice = prices.find(price => Number(price.event_id) === keep), removedPrice = prices.find(price => Number(price.event_id) === drop);
  if (removedPrice && (!keptPrice || (!Number(keptPrice.manual) && keptPrice.price_type === 'unknown' && (Number(removedPrice.manual) || removedPrice.price_type !== 'unknown')))) {
    await conn.execute('DELETE FROM event_prices WHERE event_id=?', [keep]);
    await conn.execute('UPDATE event_prices SET event_id=? WHERE event_id=?', [keep, drop]);
  }

  // The kept event's artist decisions win where both events have one.
  await conn.execute(`INSERT IGNORE INTO event_artist_decisions(event_id,artist_mbid,decision)
    SELECT ?,artist_mbid,decision FROM event_artist_decisions WHERE event_id=?`, [keep, drop]);
  await conn.execute('DELETE FROM event_artist_decisions WHERE event_id=?', [drop]);
  await conn.execute('UPDATE IGNORE event_images SET event_id=? WHERE event_id=?', [keep, drop]);
  await conn.execute('UPDATE IGNORE assistant_event_reviews SET event_id=? WHERE event_id=?', [keep, drop]);
  await conn.execute('UPDATE ai_evaluations SET event_id=? WHERE event_id=?', [keep, drop]);
  await conn.execute(`INSERT IGNORE INTO user_saved_events(user_id,event_id,created_at)
    SELECT user_id,?,created_at FROM user_saved_events WHERE event_id=?`, [keep, drop]);
  await conn.execute(`INSERT IGNORE INTO seeker_saved_events(event_id,saved_at)
    SELECT ?,saved_at FROM seeker_saved_events WHERE event_id=?`, [keep, drop]);
  await conn.execute('UPDATE event_sources SET event_id=?,is_secondary=TRUE WHERE event_id=?', [keep, drop]);
  await conn.execute('UPDATE event_history SET event_id=? WHERE event_id=?', [keep, drop]);
  await conn.execute('UPDATE event_redirects SET event_id=? WHERE event_id=?', [keep, drop]);
  await conn.execute('INSERT INTO event_redirects(old_event_id,event_id) VALUES(?,?)', [drop, keep]);
  // Findings, verification runs and remaining rows for the removed event are deleted by their foreign keys.
  await conn.execute('DELETE FROM events WHERE id=?', [drop]);

  await recordChange(conn, keep, 'merged', actor, before, await snapshot(conn, keep), { merged_event_id: drop, ...context });
  return { event_id: keep, merged_event_id: drop };
}

export function mergeEvents(pool: Pool, firstId: number, secondId: number, actor: string) {
  return transaction(pool, conn => mergeEventsIn(conn, firstId, secondId, actor));
}

/** Merges every confident pair from a date onward, one transaction per pair. */
export async function mergeConfidentDuplicates(pool: Pool, fromDate: string, actor: string) {
  const pairs = (await listDuplicates(pool, fromDate)).filter(pair => pair.level === 'confident' && pair.mergeable);
  const moved = new Map<number, number>();
  const current = (id: number) => { while (moved.has(id)) id = moved.get(id)!; return id; };
  const merged: { event_id: number; merged_event_id: number }[] = [];
  const skipped: { event_ids: [number, number]; error: string }[] = [];
  for (const pair of pairs) {
    const [first, second] = pair.event_ids.map(current);
    if (first === second) continue;
    try {
      const result = await transaction(pool, conn => mergeEventsIn(conn, first, second, actor, { automatic: true }));
      moved.set(result.merged_event_id, result.event_id);
      merged.push(result);
    } catch (cause) {
      skipped.push({ event_ids: [first, second], error: cause instanceof Error ? cause.message : 'Merge failed.' });
    }
  }
  return { merged, skipped };
}
