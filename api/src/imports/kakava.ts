import { diff, history, lockEvent, recordChange, snapshot } from '../verification/history.js';
import { queueAfterImport } from '../verification/verification.js';
import { sourceEvidence } from '../verification/rules.js';
import { findImportMatch } from '../events/duplicates.js';
import { publishIfDated } from '../events/auto-publish.js';
import { fillFromSource, recordAttach } from './attach.js';
import { cityName } from './avilys.js';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

/** One Kakava show (one date of an event), as Seeker's Kakava adapter normalizes it. Times are Vilnius wall time. */
interface KakavaShow {
  id: number; eventId: number; title: string; slug: string; startTime: string; endTime?: string | null;
  venueName?: string | null; venueAddress?: string | null; city?: string | null; description?: string;
  imageUrl?: string | null; priceFrom?: number | null; status?: string[]; promoter?: string | null; sourceUrl: string;
}
interface ImportInput { verify_after_import?: boolean; publish_after_verification?: boolean; items: KakavaShow[]; job: { id: number; owner: string } }
interface Lease extends RowDataPacket { job_id: number; owner_hash: string; expires_at: number | string }

const actor = 'Kakava';
const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
const local = /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d)$/;
const validDay = (day: string) => { const parsed = new Date(`${day}T00:00:00Z`); return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === day; };
const parts = (value: string | null | undefined) => { const match = typeof value === 'string' ? local.exec(value) : null; return match && validDay(match[1]) ? { day: match[1], time: match[2] } : null; };
const short = (value: unknown, max: number) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
/** "Nuo 26,6 €", the same wording the price rules produce. */
const priceText = (euros: number) => `Nuo ${String(Math.round(euros * 100) / 100).replace('.', ',')} €`;

function validShow(e: KakavaShow) {
  if (!e || typeof e !== 'object' || !Number.isSafeInteger(e.id) || e.id < 1 || !Number.isSafeInteger(e.eventId) || e.eventId < 1) return false;
  if (typeof e.title !== 'string' || !e.title.trim() || e.title.length > 2000 || typeof e.slug !== 'string' || !/^[\w-]{1,500}$/.test(e.slug)) return false;
  if (e.sourceUrl !== `https://kakava.lt/renginys/${e.slug}/${e.eventId}`) return false;
  const start = parts(e.startTime);
  if (!start || (e.endTime != null && (!parts(e.endTime) || e.endTime < e.startTime))) return false;
  if ((e.description ?? '') && (typeof e.description !== 'string' || e.description.length > 100_000)) return false;
  if (e.priceFrom != null && (typeof e.priceFrom !== 'number' || !Number.isFinite(e.priceFrom) || e.priceFrom <= 0 || e.priceFrom > 100_000)) return false;
  if (e.imageUrl != null) { try { const url = new URL(e.imageUrl); if (url.protocol !== 'https:' || url.username || url.password) return false; } catch { return false; } }
  if (e.status != null && (!Array.isArray(e.status) || e.status.length > 10 || !e.status.every(item => typeof item === 'string' && item.length <= 50))) return false;
  for (const field of ['venueName', 'venueAddress', 'city', 'promoter'] as const) if (e[field] != null && (typeof e[field] !== 'string' || e[field]!.length > 500)) return false;
  return true;
}

/** Fields an editor set by hand. Unreadable data protects every field. */
function manualFieldsOf(event: RowDataPacket): string[] {
  try { const value = JSON.parse(String(event.manual_fields ?? '[]')); return Array.isArray(value) ? value.filter((field): field is string => typeof field === 'string') : []; }
  catch { return ['event_date', 'event_time', 'event_end_date', 'event_end_time']; }
}

/** Stores Kakava shows as event candidates and keeps editors' changes on later imports, like the Avilys import. */
export async function importKakavaPage(pool: Pool, data: unknown) {
  const input = data as ImportInput;
  if (!Array.isArray(input?.items) || input.items.length > 20 || !Number.isSafeInteger(input.job?.id) || typeof input.job?.owner !== 'string' || !/^[a-f0-9]{64}$/.test(input.job.owner)) throw fail(400, 'Invalid Kakava import.');
  const ids = new Set<number>();
  for (const e of input.items) {
    if (!validShow(e) || ids.has(e.id)) throw fail(400, 'Invalid Kakava event.');
    ids.add(e.id);
  }
  const conn = await pool.getConnection(); let added = 0, updated = 0, attached = 0, skipped = 0;
  try {
    await conn.beginTransaction();
    try {
      const [leases] = await conn.execute<Lease[]>('SELECT job_id,owner_hash,expires_at FROM job_leases WHERE source_key=? FOR UPDATE', ['vilnius-events']);
      const lease = leases[0], hash = createHash('sha256').update(input.job.owner).digest('hex');
      if (!lease || Number(lease.job_id) !== input.job.id || Number(lease.expires_at) <= Date.now() || !timingSafeEqual(Buffer.from(lease.owner_hash), Buffer.from(hash))) throw fail(409, 'Import lease expired.');
      const [jobs] = await conn.execute<RowDataPacket[]>('SELECT source FROM jobs WHERE id=?', [input.job.id]);
      if (jobs[0]?.source !== 'kakava') throw fail(409, 'Job is not a Kakava import.');
      const now = new Date().toISOString(), verify = input.verify_after_import !== false, publish = input.publish_after_verification !== false;
      for (const e of input.items) {
        const start = parts(e.startTime)!, end = parts(e.endTime);
        const city = cityName(e.city) || null, venue = short(e.venueName, 300);
        const endDate = end && end.day > start.day ? end.day : null, endTime = end && end.day === start.day ? end.time : null;
        const price = e.priceFrom ? priceText(e.priceFrom) : null;
        const description = e.description ?? '';
        const metadata = JSON.stringify({
          title: e.title.trim(), eventId: e.eventId, city, venueName: venue, venueAddress: short(e.venueAddress, 500), startTime: e.startTime, endTime: e.endTime ?? null,
          sourceUrl: e.sourceUrl, imageUrl: e.imageUrl ?? null, priceFrom: e.priceFrom ?? null, status: e.status ?? [], promoter: short(e.promoter, 200),
          structured_details: { event_date: start.day, event_end_date: endDate, event_time: start.time, venue, ticket_url: e.sourceUrl, price_text: price, price_type: price ? 'paid' : null },
        });
        const [links] = await conn.execute<RowDataPacket[]>("SELECT * FROM event_sources WHERE source_key='kakava' AND source_id=? FOR UPDATE", [String(e.id)]);
        if (!links.length) {
          const [removed] = await conn.execute<RowDataPacket[]>("SELECT 1 FROM removed_listings WHERE source_key='kakava' AND source_id=?", [String(e.id)]);
          if (removed.length) { skipped++; continue; }
          const match = await findImportMatch(conn, { title: e.title.trim(), event_date: start.day, event_time: start.time, venue, city }, 'kakava');
          if (match) {
            const event = await lockEvent(conn, match), before = await snapshot(conn, match, event);
            await conn.execute('INSERT INTO event_sources(event_id,source_key,source_id,source_url,content_html,source_data_json,last_checked_at,about_url,is_secondary) VALUES(?,?,?,?,?,?,?,?,TRUE)', [match, 'kakava', String(e.id), e.sourceUrl, description, metadata, now, null]);
            await fillFromSource(conn, event, { event_end_date: endDate, event_time: start.time, event_end_time: endTime, venue, ticket_url: e.sourceUrl, city }, now);
            // Only a missing or unknown automatic price takes the Kakava value.
            if (price) await conn.execute(`INSERT INTO event_prices(event_id,price_text,price_type,manual,checked_at) VALUES(?,?,'paid',0,?)
              ON DUPLICATE KEY UPDATE price_text=IF(manual=0 AND price_type='unknown',VALUES(price_text),price_text),price_type=IF(manual=0 AND price_type='unknown',VALUES(price_type),price_type)`, [match, price, now]);
            await recordAttach(conn, match, before, actor, { source_key: 'kakava', source_id: e.id, job_id: input.job.id });
            await queueAfterImport(conn, match, input.job.id, verify, publish);
            attached++;
            continue;
          }
          const [insert] = await conn.execute<ResultSetHeader>('INSERT INTO events(title,event_date,event_end_date,event_time,event_end_time,venue,ticket_url,city,review_status,manual_fields,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
            [e.title.trim(), start.day, endDate, start.time, endTime, venue, e.sourceUrl, city, 'unsure', '[]', now, now]);
          await conn.execute('INSERT INTO event_sources(event_id,source_key,source_id,source_url,content_html,source_data_json,last_checked_at,about_url) VALUES(?,?,?,?,?,?,?,?)', [insert.insertId, 'kakava', String(e.id), e.sourceUrl, description, metadata, now, null]);
          if (price) await conn.execute("INSERT INTO event_prices(event_id,price_text,price_type,manual,checked_at) VALUES(?,?,'paid',0,?)", [insert.insertId, price, now]);
          await history(conn, insert.insertId, 'imported', actor, diff({}, await snapshot(conn, insert.insertId)), { source_id: e.id, job_id: input.job.id });
          await publishIfDated(conn, insert.insertId, null, actor);
          await queueAfterImport(conn, insert.insertId, input.job.id, verify, publish);
          added++;
        } else {
          const id = Number(links[0].event_id);
          let event = await lockEvent(conn, id);
          const before = await snapshot(conn, id, event);
          let previousStart: unknown;
          try { previousStart = JSON.parse(String(links[0].source_data_json)).startTime; } catch { /* Older metadata: treat as unchanged. */ }
          const old = typeof previousStart === 'string' ? parts(previousStart) : null;
          if (old && (old.day !== start.day || old.time !== start.time)) {
            // Kakava moved the show. The event follows when it still shows Kakava's old date and nobody edited the
            // date or time; otherwise an editor decides.
            const manual = manualFieldsOf(event);
            const follows = !Number(links[0].is_secondary) && event.event_date === old.day && (event.event_time == null || event.event_time === old.time)
              && !['event_date', 'event_time', 'event_end_date', 'event_end_time'].some(field => manual.includes(field));
            if (follows) await conn.execute('UPDATE events SET event_date=?,event_time=?,event_end_date=?,event_end_time=?,updated_at=? WHERE id=?', [start.day, start.time, endDate, endTime, now, id]);
            else await conn.execute('UPDATE events SET needs_attention=1 WHERE id=?', [id]);
            await history(conn, id, 'source_moved', actor, follows ? diff(before, await snapshot(conn, id)) : {}, { source_key: 'kakava', source_id: e.id, from: previousStart, to: e.startTime, applied: follows, job_id: input.job.id });
            event = await lockEvent(conn, id);
          }
          // Reviewed event fields are not overwritten on refresh; only empty ones are filled, and only while the dates agree.
          if (event.event_date === start.day) await fillFromSource(conn, event, { event_end_date: endDate, event_time: start.time, event_end_time: endTime, venue, ticket_url: e.sourceUrl, city }, now);
          if (price) {
            // A secondary listing only replaces an unknown automatic price.
            const replace = Number(links[0].is_secondary) ? "manual=0 AND price_type='unknown'" : 'manual=0';
            await conn.execute(`INSERT INTO event_prices(event_id,price_text,price_type,manual,checked_at) VALUES(?,?,'paid',0,?)
              ON DUPLICATE KEY UPDATE checked_at=IF(${replace},VALUES(checked_at),checked_at),price_text=IF(${replace},VALUES(price_text),price_text),price_type=IF(${replace},VALUES(price_type),price_type)`, [id, price, now]);
          }
          await conn.execute("UPDATE event_sources SET source_url=?,content_html=?,source_data_json=?,last_checked_at=? WHERE source_key='kakava' AND source_id=?", [e.sourceUrl, description, metadata, now, String(e.id)]);
          const previous = sourceEvidence(links[0]);
          const next = sourceEvidence({ source_key: 'kakava', source_url: e.sourceUrl, about_url: null, content_html: description, source_data_json: metadata });
          if (await recordChange(conn, id, 'source_refreshed', actor, { ...before, source: previous }, { ...await snapshot(conn, id), source: next }, { source_id: e.id, job_id: input.job.id })) {
            await queueAfterImport(conn, id, input.job.id, verify, publish);
          }
          updated++;
        }
      }
      await conn.commit();
      return { added, updated, attached, skipped };
    } catch (cause) { await conn.rollback(); throw cause; }
  } finally { conn.release(); }
}
