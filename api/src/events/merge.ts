import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { eventTypeLabels } from './types.js';
import { fail, jsonValue, recordChange, snapshot, transaction } from '../verification/history.js';
import { duplicateTitle, isAddress, listDuplicates, venuesMatch } from './duplicates.js';

type Value = string | number | null;
const blank = (value: unknown) => value == null || (typeof value === 'string' && !value.trim());
const sourceNames: Record<string, string> = { 'vilnius-events': 'Vilnius Events', avilys: 'Avilys', kakava: 'Kakava' };
const priceLabels: Record<string, string> = { free: 'Free', paid: 'Paid', unknown: 'Unknown' };
const classificationLabels: Record<string, string> = eventTypeLabels;

export type MergeField = 'title' | 'event_time' | 'event_end_time' | 'event_end_date' | 'venue' | 'city' | 'ticket_url' | 'price' | 'review_status';
export type Choices = Partial<Record<MergeField, number>>;
const mergeFields: MergeField[] = ['title', 'event_time', 'event_end_time', 'event_end_date', 'venue', 'city', 'ticket_url', 'price', 'review_status'];
const labels: Record<MergeField, string> = {
  title: 'Title', event_time: 'Time', event_end_time: 'End time', event_end_date: 'End date', venue: 'Venue', city: 'City', ticket_url: 'Tickets', price: 'Price', review_status: 'Type',
};

export interface PreviewField { field: MergeField; label: string; kept: string | null; other: string | null; choice: number; conflict: boolean }
interface Pair { survivor: RowDataPacket; removed: RowDataPacket; keptPrice?: RowDataPacket; removedPrice?: RowDataPacket; sources: RowDataPacket[] }

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

const priceText = (price?: RowDataPacket) => !price || price.price_type === 'unknown' && blank(price.price_text) ? null
  : String(price.price_text || priceLabels[price.price_type] || price.price_type);
const knownPrice = (price?: RowDataPacket) => Boolean(price && (price.price_type !== 'unknown' || !blank(price.price_text)));
/** A plain "paid" price with no amount says less than a listing that states the price. */
const barePaid = (price?: RowDataPacket) => price?.price_type === 'paid' && blank(price.price_text);
const statedPrice = (price?: RowDataPacket) => Boolean(price && price.price_type !== 'free' && !blank(price.price_text));
/** A title written in capitals only, such as "ROSEYE". */
const allCaps = (value: string) => /\p{L}/u.test(value) && value === value.toLocaleUpperCase('lt') && value !== value.toLocaleLowerCase('lt');
/** Ticket links that differ only by surrounding spaces or a trailing slash point to the same page. */
const urlKey = (value: string) => value.trim().replace(/\/+$/, '');
const sameUrl = (a: string, b: string) => urlKey(a) === urlKey(b);
/** A bilietai.lt seat map link, such as ".../renginiai/ID/name/seatmap?sector=1", belongs to the event page before "/seatmap". */
const bilietaiSeatmap = /^(https?:\/\/(?:www\.)?bilietai\.lt\/.+?)\/seatmap(?:[/?#].*)?$/i;
const isSeatmap = (value: string) => bilietaiSeatmap.test(urlKey(value));
const ticketPage = (value: string) => urlKey(value).replace(bilietaiSeatmap, '$1').replace(/\/+$/, '');

/**
 * Decides each field of the merged event. Equal values need no decision. When only one event has a value it is used.
 * A venue name beats a street address, a known price beats an unknown one, a stated price beats a plain "paid" and two free
 * prices agree whatever their wording.
 * Ticket links that differ only by a trailing slash count as equal, a bilietai.lt event page link beats its seat map link, and a title in normal case beats the same title in capitals. Other disagreements are conflicts that
 * keep the kept event's value unless a choice (an event ID per field) says otherwise.
 */
export function planMerge({ survivor, removed, keptPrice, removedPrice }: Pair, choices: Choices = {}) {
  const keep = Number(survivor.id), drop = Number(removed.id);
  const fields: PreviewField[] = [];
  for (const field of mergeFields) {
    let kept: string | null, other: string | null, preferOther = false, conflict = false;
    if (field === 'price') {
      kept = priceText(keptPrice); other = priceText(removedPrice);
      // Two free prices agree however each source words it ("Free", "Nemokamas").
      if (keptPrice?.price_type === 'free' && removedPrice?.price_type === 'free') other = kept;
      if (kept !== other) {
        if (!knownPrice(keptPrice)) preferOther = knownPrice(removedPrice);
        else if (barePaid(keptPrice) && statedPrice(removedPrice)) preferOther = true;
        else conflict = knownPrice(removedPrice) && !(barePaid(removedPrice) && statedPrice(keptPrice));
      }
    } else {
      kept = blank(survivor[field]) ? null : String(survivor[field]);
      other = blank(removed[field]) ? null : String(removed[field]);
      if (field === 'ticket_url' && kept !== null && other !== null && sameUrl(kept, other)) other = kept;
      if (field === 'review_status') {
        kept = classificationLabels[kept ?? ''] ?? kept; other = classificationLabels[other ?? ''] ?? other;
        if (kept !== other) {
          if (survivor.review_status === 'unsure') preferOther = removed.review_status !== 'unsure';
          else conflict = removed.review_status !== 'unsure';
        }
      } else if (kept === null) preferOther = other !== null;
      else if (other !== null && kept !== other) {
        if (field === 'title') {
          conflict = duplicateTitle(kept) !== duplicateTitle(other);
          // The same title in normal case reads better than one in capitals.
          preferOther = !conflict && allCaps(kept) && !allCaps(other);
        }
        else if (field === 'venue') {
          if (isAddress(kept) && !isAddress(other)) preferOther = true;
          else conflict = !venuesMatch(kept, other) && isAddress(kept) === isAddress(other);
        } else if (field === 'ticket_url') {
          // A bilietai.lt seat map and its event page are the same tickets; the event page link wins.
          if (ticketPage(kept) === ticketPage(other)) preferOther = isSeatmap(kept) && !isSeatmap(other);
          else conflict = true;
        } else if (field === 'city') conflict = kept.trim().toLocaleLowerCase('lt') !== other.trim().toLocaleLowerCase('lt');
        else conflict = true;
      }
    }
    const requested = choices[field];
    if (requested !== undefined && requested !== keep && requested !== drop) throw fail(400, `Choose ${labels[field].toLowerCase()} from one of the two events.`);
    const choice = kept === other ? keep : requested ?? (preferOther ? drop : keep);
    fields.push({ field, label: labels[field], kept, other, choice, conflict });
  }
  return { keep, drop, fields, conflicts: fields.some(field => field.conflict) };
}

async function loadPair(conn: PoolConnection, firstId: number, secondId: number, lock: boolean): Promise<Pair> {
  if (!Number.isSafeInteger(firstId) || !Number.isSafeInteger(secondId) || firstId < 1 || secondId < 1 || firstId === secondId) throw fail(400, 'Choose two different events.');
  const forUpdate = lock ? ' FOR UPDATE' : '';
  const [rows] = await conn.execute<RowDataPacket[]>(`SELECT * FROM events WHERE id IN (?,?) ORDER BY id${forUpdate}`, [firstId, secondId]);
  if (rows.length !== 2) throw fail(404, 'Event not found. It may already have been merged.');
  const [survivor, removed] = chooseSurvivor(rows[0], rows[1]);
  const keep = Number(survivor.id), drop = Number(removed.id);
  // Both events may come from the same source (it listed the event twice). The kept event's listing stays primary;
  // the removed event's listings become secondary and only fill missing values on later imports.
  const [sources] = await conn.execute<RowDataPacket[]>(`SELECT event_id,source_key,source_id,is_secondary FROM event_sources WHERE event_id IN (?,?) ORDER BY id${forUpdate}`, [keep, drop]);
  const [prices] = await conn.execute<RowDataPacket[]>(`SELECT * FROM event_prices WHERE event_id IN (?,?)${forUpdate}`, [keep, drop]);
  return { survivor, removed, sources, keptPrice: prices.find(price => Number(price.event_id) === keep), removedPrice: prices.find(price => Number(price.event_id) === drop) };
}

/** The merged event as it would be saved, without changing anything. */
export async function previewMerge(pool: Pool, firstId: number, secondId: number, choices: Choices = {}) {
  return transaction(pool, async conn => {
    const pair = await loadPair(conn, firstId, secondId, false);
    const plan = planMerge(pair, choices);
    const describe = (event: RowDataPacket) => ({
      id: Number(event.id),
      publication_status: event.publication_status,
      sources: pair.sources.filter(source => Number(source.event_id) === Number(event.id)).map(source => sourceNames[source.source_key] ?? source.source_key),
    });
    return { kept: describe(pair.survivor), removed: describe(pair.removed), fields: plan.fields, conflicts: plan.conflicts };
  });
}

/**
 * Moves everything attached to one event onto another and removes the first. The removed ID redirects to the kept
 * event. Field values follow planMerge. Runs in the caller's transaction.
 */
export async function mergeEventsIn(conn: PoolConnection, firstId: number, secondId: number, actor: string, choices: Choices = {}, context: Record<string, unknown> = {}, ownTitle?: string) {
  const pair = await loadPair(conn, firstId, secondId, true);
  const { survivor, removed, sources, keptPrice, removedPrice } = pair;
  const { keep, drop, fields } = planMerge(pair, choices);
  const before = await snapshot(conn, keep, survivor);

  // A value taken from the removed event replaces the kept event's source value, so it is protected from refreshes.
  // A value that only fills a gap keeps the removed event's protection.
  const manual = new Set(manualFields(survivor)), removedManual = new Set(manualFields(removed));
  const updates: Record<string, Value> = {};
  let takePrice = false, priceOverride = false;
  for (const { field, kept, choice } of fields) {
    if (choice !== drop) continue;
    const override = kept !== null;
    if (field === 'price') { takePrice = true; priceOverride = override; continue; }
    updates[field] = removed[field] as Value;
    if (field === 'review_status') updates.classification_manual = override ? 1 : Number(removed.classification_manual);
    else if (override || removedManual.has(field)) manual.add(field);
  }
  // A title the editor wrote replaces both, and like any edit it is protected from source refreshes.
  if (ownTitle !== undefined) { updates.title = ownTitle; manual.add('title'); }
  for (const field of ['description_override', 'about_url_override'] as const) {
    if (blank(survivor[field]) && !blank(removed[field])) updates[field] = removed[field] as Value;
  }
  if (Number(removed.interest_score) > Number(survivor.interest_score)) updates.interest_score = Number(removed.interest_score);
  updates.manual_fields = JSON.stringify([...manual]);
  updates.updated_at = new Date().toISOString();
  await conn.execute(`UPDATE events SET ${Object.keys(updates).map(field => `${field}=?`).join(',')} WHERE id=?`, [...Object.values(updates), keep]);
  // A primary Vilnius Events record mirrors the editable details and their protection.
  const legacy = sources.find(source => Number(source.event_id) === keep && source.source_key === 'vilnius-events' && !Number(source.is_secondary));
  if (legacy) {
    const mirrored = (['event_end_date', 'event_time', 'venue', 'ticket_url'] as const).filter(field => field in updates);
    await conn.execute(`UPDATE vilnius_events SET ${[...mirrored.map(field => `${field}=?`), 'manual_fields=?'].join(',')} WHERE source_id=?`,
      [...mirrored.map(field => updates[field]), updates.manual_fields, Number(legacy.source_id)]);
  }
  if (takePrice && removedPrice) {
    if (keptPrice) await conn.execute('DELETE FROM event_prices WHERE event_id=?', [keep]);
    await conn.execute('UPDATE event_prices SET event_id=?,manual=IF(?,1,manual) WHERE event_id=?', [keep, priceOverride ? 1 : 0, drop]);
  }

  // The kept event's artist decisions win where both events have one.
  await conn.execute(`INSERT IGNORE INTO event_artist_decisions(event_id,artist_mbid,decision)
    SELECT ?,artist_mbid,decision FROM event_artist_decisions WHERE event_id=?`, [keep, drop]);
  await conn.execute('DELETE FROM event_artist_decisions WHERE event_id=?', [drop]);
  // The kept event's showtimes win; it takes the other event's only when it has none.
  await conn.execute('UPDATE event_times SET event_id=? WHERE event_id=? AND NOT EXISTS (SELECT 1 FROM (SELECT event_id FROM event_times WHERE event_id=?) kept)', [keep, drop, keep]);
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

export function parseChoices(value: unknown): Choices {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw fail(400, 'Invalid merge choices.');
  const choices: Choices = {};
  for (const [field, id] of Object.entries(value)) {
    if (!mergeFields.includes(field as MergeField) || !Number.isSafeInteger(id) || Number(id) < 1) throw fail(400, 'Invalid merge choices.');
    choices[field as MergeField] = Number(id);
  }
  return choices;
}

export function mergeEvents(pool: Pool, firstId: number, secondId: number, actor: string, choices: Choices = {}, ownTitle?: string) {
  return transaction(pool, conn => mergeEventsIn(conn, firstId, secondId, actor, choices, {}, ownTitle));
}

/** An editor's own title for the merged event: trimmed text, or undefined when none was given. */
export function parseOwnTitle(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  const title = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!title || title.length > 300) throw fail(400, 'Write a title of up to 300 characters.');
  return title;
}

/** The merge preview for each pair, so a list can show them without further requests. */
export async function pairPreviews(pool: Pool, pairs: { event_ids: [number, number] }[]) {
  const previews = [];
  // One pair at a time keeps a long list from taking every pooled connection.
  for (const pair of pairs) previews.push(await previewMerge(pool, ...pair.event_ids).catch(() => null));
  return previews;
}

/** Merges every confident pair from a date onward that has no conflicting values, one transaction per pair. */
export async function mergeConfidentDuplicates(pool: Pool, fromDate: string, actor: string) {
  const pairs = (await listDuplicates(pool, fromDate)).filter(pair => pair.level === 'confident');
  const moved = new Map<number, number>();
  const current = (id: number) => { while (moved.has(id)) id = moved.get(id)!; return id; };
  const merged: { event_id: number; merged_event_id: number }[] = [];
  const skipped: { event_ids: [number, number]; error: string }[] = [];
  for (const pair of pairs) {
    const [first, second] = pair.event_ids.map(current);
    if (first === second) continue;
    try {
      const result = await transaction(pool, async conn => {
        if (planMerge(await loadPair(conn, first, second, true)).conflicts) return null;
        return mergeEventsIn(conn, first, second, actor, {}, { automatic: true });
      });
      if (!result) { skipped.push({ event_ids: [first, second], error: 'Values differ. Review this pair.' }); continue; }
      moved.set(result.merged_event_id, result.event_id);
      merged.push(result);
    } catch (cause) {
      skipped.push({ event_ids: [first, second], error: cause instanceof Error ? cause.message : 'Merge failed.' });
    }
  }
  return { merged, skipped };
}
