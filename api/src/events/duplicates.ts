import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { normalizeEventSearch } from '../admin/event-search.js';

export type MatchLevel = 'confident' | 'likely';
export interface MatchEvent {
  id: number;
  title: string;
  event_date: string | null;
  event_time: string | null;
  venue: string | null;
  city: string | null;
}

const cities = new Set(['vilnius', 'kaunas', 'klaipeda', 'siauliai', 'panevezys', 'palanga', 'lithuania', 'lietuva']);
// Ticket-status labels sources add to otherwise identical titles.
const noise = /\b(?:sold out|soldout|isparduota|isparduoti bilietai|bilietai isparduoti|paskutiniai bilietai|last tickets|atsauktas|cancelled|canceled)\b/g;

function words(value: string): string {
  return normalizeEventSearch(value.replace(/\\(['"])/g, '$1')).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Comparable title: entities decoded, accents and punctuation removed, ticket status and a trailing city segment dropped. */
export function duplicateTitle(value: string): string {
  const segments = value.split('|').map(words).filter(Boolean);
  while (segments.length > 1 && cities.has(segments.at(-1)!)) segments.pop();
  return segments.join(' ').replace(noise, ' ').replace(/\s+/g, ' ').trim();
}

/** Comparable venue: "Šv. Kotrynos bažnyčia. Renginių salė" and "Šv. Kotrynos bažnyčia" share a prefix. */
export function duplicateVenue(value: string | null): string {
  return value ? words(value) : '';
}

function venuesMatch(a: string | null, b: string | null): boolean {
  const first = duplicateVenue(a), second = duplicateVenue(b);
  if (!first || !second) return false;
  const [short, long] = first.length <= second.length ? [first, second] : [second, first];
  return long === short || long.startsWith(`${short} `);
}

// Sources often give a street address where another gives the venue name, so an address never contradicts a name.
function isAddress(value: string): boolean {
  return value.includes(',') || /\b(?:g|gatve|pr|prospektas|al|aleja|skg|skersgatvis|pl|plentas|lithuania|lietuva)\b/.test(duplicateVenue(value));
}

function venuesConflict(a: string | null, b: string | null): boolean {
  return Boolean(a && b && duplicateVenue(a) && duplicateVenue(b) && !venuesMatch(a, b) && !isAddress(a) && !isAddress(b));
}

function tokens(title: string): Set<string> {
  return new Set(title.split(' ').filter(word => word.length > 2 && !cities.has(word)));
}

/**
 * Two listings of the same performance. Confident matches have the same comparable title on the same date, agree
 * on the start time or venue, and do not name two different venues. Likely matches need a person to decide.
 * A different start time or city on the same date means a different performance.
 */
export function compareEvents(a: MatchEvent, b: MatchEvent): MatchLevel | null {
  if (a.id === b.id || !a.event_date || a.event_date !== b.event_date) return null;
  if (a.city && b.city && a.city.trim().toLocaleLowerCase('lt') !== b.city.trim().toLocaleLowerCase('lt')) return null;
  if (a.event_time && b.event_time && a.event_time !== b.event_time) return null;
  const first = duplicateTitle(a.title), second = duplicateTitle(b.title);
  if (!first || !second) return null;
  const sameTime = Boolean(a.event_time && a.event_time === b.event_time);
  if (first === second) return (sameTime || venuesMatch(a.venue, b.venue)) && !venuesConflict(a.venue, b.venue) ? 'confident' : 'likely';
  // Numbered editions or parts ("Vol. 2", "#3", "2026") with different numbers are different events.
  const numbers = (title: string) => title.split(' ').filter(word => /^\d+$/.test(word)).sort().join(' ');
  if (numbers(first) !== numbers(second)) return null;
  const left = tokens(first), right = tokens(second);
  const shared = [...left].filter(word => right.has(word)).length;
  return shared >= 2 && shared / Math.max(left.size, right.size) >= 0.6 ? 'likely' : null;
}

const pairKey = (a: number, b: number) => a < b ? `${a}-${b}` : `${b}-${a}`;

interface CandidateRow extends RowDataPacket, MatchEvent { source_keys: string | null }

/**
 * The single existing event a new source listing should join, if the match is confident and unambiguous.
 * Events that already have a listing from the same source are excluded: those are separate source records.
 */
export async function findImportMatch(conn: PoolConnection, listing: Omit<MatchEvent, 'id'>, sourceKey: string): Promise<number | null> {
  if (!listing.event_date) return null;
  const [rows] = await conn.execute<CandidateRow[]>(`SELECT e.id,e.title,e.event_date,e.event_time,e.venue,e.city FROM events e
    WHERE e.event_date=? AND NOT EXISTS (SELECT 1 FROM event_sources s WHERE s.event_id=e.id AND s.source_key=?) ORDER BY e.id LIMIT 500`, [listing.event_date, sourceKey]);
  const confident = rows.filter(row => compareEvents({ ...listing, id: 0 }, { ...row, id: Number(row.id) }) === 'confident');
  return confident.length === 1 ? Number(confident[0].id) : null;
}

export interface DuplicatePair { level: MatchLevel; mergeable: boolean; event_ids: [number, number] }

/** Pairs on or after a date, excluding pairs marked as distinct. Pairs from the same source cannot be merged. */
export async function listDuplicates(db: Pool | PoolConnection, fromDate: string): Promise<DuplicatePair[]> {
  const [rows] = await db.execute<CandidateRow[]>(`SELECT e.id,e.title,e.event_date,e.event_time,e.venue,e.city,
      (SELECT GROUP_CONCAT(DISTINCT s.source_key ORDER BY s.source_key) FROM event_sources s WHERE s.event_id=e.id) AS source_keys
    FROM events e WHERE e.event_date>=? ORDER BY e.event_date,e.id`, [fromDate]);
  const [dismissed] = await db.execute<RowDataPacket[]>('SELECT first_event_id,second_event_id FROM event_duplicate_dismissals', []);
  const distinct = new Set(dismissed.map(row => pairKey(Number(row.first_event_id), Number(row.second_event_id))));
  const byDate = new Map<string, CandidateRow[]>();
  for (const row of rows) byDate.set(String(row.event_date), [...(byDate.get(String(row.event_date)) ?? []), row]);
  const pairs: DuplicatePair[] = [];
  for (const group of byDate.values()) {
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const a = group[i], b = group[j], first = Number(a.id), second = Number(b.id);
      if (distinct.has(pairKey(first, second))) continue;
      const level = compareEvents({ ...a, id: first }, { ...b, id: second });
      if (!level) continue;
      const left = new Set(String(a.source_keys ?? '').split(',').filter(Boolean));
      const mergeable = !String(b.source_keys ?? '').split(',').some(key => left.has(key));
      pairs.push({ level, mergeable, event_ids: [first, second] });
    }
  }
  return pairs.sort((x, y) => Number(y.level === 'confident') - Number(x.level === 'confident'));
}

/** Other events that may be the same performance, for verification findings. */
export async function similarEvents(conn: PoolConnection, event: MatchEvent): Promise<number[]> {
  if (!event.event_date) return [];
  const [rows] = await conn.execute<CandidateRow[]>(`SELECT e.id,e.title,e.event_date,e.event_time,e.venue,e.city FROM events e
    WHERE e.event_date=? AND e.id<>? AND NOT EXISTS (SELECT 1 FROM event_duplicate_dismissals d
      WHERE (d.first_event_id=e.id AND d.second_event_id=?) OR (d.first_event_id=? AND d.second_event_id=e.id)) ORDER BY e.id LIMIT 200`, [event.event_date, event.id, event.id, event.id]);
  return rows.filter(row => compareEvents(event, { ...row, id: Number(row.id) })).map(row => Number(row.id));
}

export async function dismissDuplicate(pool: Pool, ids: unknown): Promise<void> {
  if (!Array.isArray(ids) || ids.length !== 2 || !ids.every(id => Number.isSafeInteger(id) && id > 0) || ids[0] === ids[1]) {
    throw Object.assign(new Error('Choose two different events.'), { status: 400 });
  }
  const [first, second] = [Math.min(ids[0], ids[1]), Math.max(ids[0], ids[1])];
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM events WHERE id IN (?,?)', [first, second]);
  if (Number(rows[0].n) !== 2) throw Object.assign(new Error('Event not found.'), { status: 404 });
  await pool.execute('INSERT IGNORE INTO event_duplicate_dismissals(first_event_id,second_event_id) VALUES(?,?)', [first, second]);
}
