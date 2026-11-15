import { createHash, timingSafeEqual } from 'node:crypto';

const statuses = new Set(['music', 'not_music', 'unsure']);
const decisions = new Set(['accepted', 'dismissed', 'remove']);
const priceTypes = new Set(['free', 'paid', 'unknown']);
const detailFields = ['event_date','event_end_date','event_time','venue','ticket_url'];
const error = (status, message) => Object.assign(new Error(message), { status });
const digest = value => createHash('sha256').update(value).digest();
function validDate(value) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const d=new Date(`${value}T00:00:00Z`); return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0,10)===value; }

export function createAdmin(pool, token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9._~-]{32,}$/.test(token)) throw new Error('ADMIN_TOKEN must be at least 32 URL-safe ASCII characters.');
  const tokenHash = digest(token);
  async function withEvent(id, fn) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      try {
        // Serialize edits to both copies of the source event.
        const [rows] = await conn.execute("SELECT e.id,s.source_id FROM events e JOIN event_sources s ON s.event_id=e.id AND s.source_key='vilnius-events' WHERE e.id=? FOR UPDATE", [id]);
        if (rows.length !== 1 || !/^\d+$/.test(String(rows[0].source_id))) throw error(404, 'Event not found.');
        const sourceId = Number(rows[0].source_id);
        if (!Number.isSafeInteger(sourceId) || sourceId < 1) throw error(409, 'Event source is inconsistent.');
        const [source] = await conn.execute('SELECT source_id,event_date,event_end_date,event_time,venue,ticket_url,manual_fields FROM vilnius_events WHERE source_id=? FOR UPDATE', [sourceId]);
        if (source.length !== 1) throw error(409, 'Event source is inconsistent.');
        await fn(conn, sourceId, source[0]);
        await conn.commit();
      } catch (cause) { await conn.rollback(); throw cause; }
    } finally { conn.release(); }
  }
  return {
    authorized(header) {
      const match = /^Bearer ([^\s]+)$/.exec(header || '');
      return !!match && timingSafeEqual(tokenHash, digest(match[1]));
    },
    async review(id, body) {
      if (!statuses.has(body?.review_status)) throw error(400, 'Invalid review status.');
      await withEvent(id, async (conn, sourceId) => {
        await conn.execute('UPDATE vilnius_events SET review_status=? WHERE source_id=?', [body.review_status, sourceId]);
        await conn.execute('UPDATE events SET review_status=? WHERE id=?', [body.review_status, id]);
      });
    },
    async details(id, body) {
      if (!body || typeof body !== 'object' || !statuses.has(body.review_status) || detailFields.some(field => body[field] != null && typeof body[field] !== 'string')) throw error(400, 'Invalid event details.');
      const [date,end,time,venue,ticket] = detailFields.map(field => body[field]?.trim() || null);
      if (date && !validDate(date)) throw error(400, 'Invalid date.');
      if (end && (!date || !validDate(end) || end < date)) throw error(400, 'Invalid end date.');
      if (time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw error(400, 'Invalid time.');
      if ((venue?.length || 0) > 300 || (ticket?.length || 0) > 2048) throw error(400, 'Field is too long.');
      if (ticket) { try { if (!['http:','https:'].includes(new URL(ticket).protocol)) throw new Error(); } catch { throw error(400,'Invalid ticket URL.'); } }
      await withEvent(id, async (conn, sourceId, existing) => {
        const parsed=JSON.parse(existing.manual_fields);
        if (!Array.isArray(parsed) || !parsed.every(value=>typeof value==='string')) throw error(409, 'Event manual fields are inconsistent.');
        const locked=new Set(parsed); const values=[date,end,time,venue,ticket];
        detailFields.forEach((field,index)=>{ if (values[index] !== existing[field]) locked.add(field); });
        const fields=JSON.stringify([...locked]);
        await conn.execute('UPDATE vilnius_events SET event_date=?,event_end_date=?,event_time=?,venue=?,ticket_url=?,review_status=?,manual_fields=?,details_manual=? WHERE source_id=?', [...values,body.review_status,fields,locked.size?1:0,sourceId]);
        await conn.execute('UPDATE events SET event_date=?,event_end_date=?,event_time=?,venue=?,ticket_url=?,review_status=?,manual_fields=? WHERE id=?', [...values,body.review_status,fields,id]);
      });
    },
    async artist(id, body) {
      if (typeof body?.mbid !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.mbid) || !decisions.has(body.decision)) throw error(400, 'Invalid artist decision.');
      await withEvent(id, async (conn, sourceId) => {
        const [artists] = await conn.execute('SELECT mbid FROM artists WHERE mbid=?', [body.mbid]);
        if (!artists.length) throw error(404, 'Artist not found.');
        for (const [table, key] of [['vilnius_event_artists', sourceId], ['event_artist_decisions', id]]) {
          await conn.execute(`DELETE FROM ${table} WHERE event_id=? AND artist_mbid=?`, [key, body.mbid]);
          if (body.decision !== 'remove') await conn.execute(`INSERT INTO ${table}(event_id,artist_mbid,decision) VALUES(?,?,?)`, [key, body.mbid, body.decision]);
        }
      });
    },
    async price(id, body) {
      if (!priceTypes.has(body?.price_type) || (body.price_text != null && typeof body.price_text !== 'string')) throw error(400, 'Invalid price.');
      const text = body.price_text?.trim() || null;
      if (text && text.length > 300) throw error(400, 'Invalid price.');
      await withEvent(id, async conn => {
        const [rows] = await conn.execute('SELECT event_id FROM event_prices WHERE event_id=?', [id]);
        if (rows.length) await conn.execute('UPDATE event_prices SET price_text=?,price_type=?,manual=1,checked_at=? WHERE event_id=?', [text,body.price_type,new Date().toISOString(),id]);
        else await conn.execute('INSERT INTO event_prices(event_id,price_text,price_type,manual,checked_at) VALUES(?,?,?,1,?)', [id,text,body.price_type,new Date().toISOString()]);
      });
    }
  };
}
