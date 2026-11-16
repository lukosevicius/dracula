import { createHash, timingSafeEqual } from 'node:crypto';
import { normalizeEventSearch } from './event-search.mjs';
import { vilniusToday } from './catalogue.mjs';
import { importVilniusPage } from './import-vilnius.mjs';

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
    importVilniusPage: input => importVilniusPage(pool,input),
    async getImage(mediaId) {
      const [rows]=await pool.execute('SELECT local_name,mime_type FROM vilnius_images WHERE media_id=?',[mediaId]);
      return rows[0] || null;
    },
    authorized(header) {
      const match = /^Bearer ([^\s]+)$/.exec(header || '');
      return !!match && timingSafeEqual(tokenHash, digest(match[1]));
    },
    async listEvents(query) {
      const page=Number(query.get('page') || 1), limit=Number(query.get('limit') || 25);
      const review=query.get('review') || 'all', when=query.get('when') || 'upcoming', source=query.get('source') || 'all';
      const readiness=query.get('readiness') || 'all', assistantReview=query.get('assistantReview') || 'all', price=query.get('price') || 'all';
      const from=query.get('from'),to=query.get('to'),today=vilniusToday(),search=normalizeEventSearch((query.get('search') || '').slice(0,200));
      if(!Number.isSafeInteger(page)||page<1||page>1000000||!Number.isSafeInteger(limit)||limit<1||limit>100 || !['all','music','not_music','unsure'].includes(review) || !['all','upcoming','past','unknown','today','tomorrow','weekend','custom'].includes(when) || !['all','ready','attention'].includes(readiness) || !['all','pending'].includes(assistantReview) || !['all','free','paid','unknown'].includes(price) || source.length>191) throw error(400,'Invalid filters.');
      if(['today','tomorrow','weekend','custom'].includes(when) && (!from || !to || !validDate(from) || !validDate(to) || to<from)) throw error(400,'Choose a valid date range.');
      const clauses=[],params=[];
      const ready="e.review_status='music' AND (NULLIF(e.event_date,'') IS NULL OR COALESCE(NULLIF(e.event_end_date,''),e.event_date)>=?)";
      if(price!=='all'){clauses.push("COALESCE((SELECT p.price_type FROM event_prices p WHERE p.event_id=e.id),'unknown')=?");params.push(price);}
      if(assistantReview==='pending') clauses.push('EXISTS (SELECT 1 FROM assistant_event_reviews ar WHERE ar.event_id=e.id AND ar.confirmed_at IS NULL)');
      if(readiness!=='all'){clauses.push(`${readiness==='attention'?'NOT ':''}(${ready})`);params.push(today);}
      if(review!=='all'){clauses.push('e.review_status=?');params.push(review);}
      if(source!=='all'){clauses.push('EXISTS (SELECT 1 FROM event_sources sf WHERE sf.event_id=e.id AND sf.source_key=?)');params.push(source);}
      if(when==='upcoming'||when==='past'){clauses.push(`e.event_date IS NOT NULL AND COALESCE(e.event_end_date,e.event_date)${when==='past'?'<':'>='}?`);params.push(today);}
      if(when==='unknown') clauses.push('e.event_date IS NULL');
      if(['today','tomorrow','weekend','custom'].includes(when)){clauses.push('e.event_date<=? AND COALESCE(e.event_end_date,e.event_date)>=?');params.push(to,from);}
      let where=clauses.length?`WHERE ${clauses.join(' AND ')}`:'';
      const conn=await pool.getConnection();
      try {
        await conn.beginTransaction();
        try {
          let searchTotal=null;
          const order=when==='past'?'DESC':'ASC';
          // Seeker strips HTML/entities before prefix matching. Searching titles in JS preserves that behavior.
          if(search){
            const [titles]=await conn.execute(`SELECT e.id,e.title FROM events e ${where} ORDER BY e.event_date IS NULL,e.event_date ${order},e.event_time IS NULL,e.event_time ${order},e.id`,params);
            const matches=titles.filter(row=>normalizeEventSearch(row.title).startsWith(search));
            searchTotal=matches.length;
            const ids=matches.slice((page-1)*limit,page*limit).map(row=>row.id);
            if(ids.length){where+=`${where?' AND':'WHERE'} e.id IN (${ids.map(()=>'?').join(',')})`;params.push(...ids);} else where+=`${where?' AND':'WHERE'} 1=0`;
          }
          const [totals]=await conn.execute(`SELECT COUNT(*) AS count FROM events e ${where}`,params);
          const [events]=await conn.execute(`SELECT e.*,s.source_id,s.source_key,s.source_url,s.about_url,s.last_checked_at AS details_checked_at,ar.reviewed_at AS assistant_reviewed_at,ar.confirmed_at AS assistant_confirmed_at,ar.notes AS assistant_notes,ep.price_text,COALESCE(ep.price_type,'unknown') AS price_type FROM events e LEFT JOIN event_prices ep ON ep.event_id=e.id LEFT JOIN assistant_event_reviews ar ON ar.event_id=e.id JOIN event_sources s ON s.id=(SELECT id FROM event_sources WHERE event_id=e.id ORDER BY id LIMIT 1) ${where} ORDER BY e.event_date IS NULL,e.event_date ${order},e.event_time IS NULL,e.event_time ${order},e.id LIMIT ? OFFSET ?`,[...params,limit,search?0:(page-1)*limit]);
          const [counts]=await conn.execute("SELECT COUNT(*) AS total, COALESCE(SUM(review_status='music'),0) AS music, COALESCE(SUM(review_status='not_music'),0) AS not_music, COALESCE(SUM(review_status='unsure'),0) AS unsure, COALESCE(SUM(event_date IS NULL),0) AS unknown FROM events",[]);
          const [readyRows]=await conn.execute(`SELECT COUNT(*) AS count FROM events e WHERE ${ready}`,[today]);
          const [states]=await conn.execute('SELECT next_offset FROM source_state WHERE source_key=?',['vilnius-events']);
          const [sources]=await conn.execute('SELECT DISTINCT source_key FROM event_sources ORDER BY source_key',[]);
          const [runs]=await conn.execute('SELECT * FROM vilnius_event_runs ORDER BY id DESC LIMIT 8',[]);
          await conn.commit();
          return {events,total:searchTotal ?? Number(totals[0].count),page,limit,counts:Object.fromEntries(Object.entries(counts[0]).map(([key,value])=>[key,Number(value)])),readyCount:Number(readyRows[0].count),nextPage:Number(states[0]?.next_offset || 0)+1,sources,runs};
        } catch(cause){await conn.rollback();throw cause;}
      } finally {conn.release();}
    },
    async getEvent(id) {
      const conn=await pool.getConnection();
      try {
        await conn.beginTransaction();
        try {
          const [events]=await conn.execute('SELECT * FROM events WHERE id=?',[id]);
          if (events.length!==1) throw error(404,'Event not found.');
          const [sources]=await conn.execute('SELECT * FROM event_sources WHERE event_id=? ORDER BY id',[id]);
          const [prices]=await conn.execute('SELECT * FROM event_prices WHERE event_id=?',[id]);
          const [artists]=await conn.execute('SELECT d.artist_mbid,d.decision,a.name FROM event_artist_decisions d JOIN artists a ON a.mbid=d.artist_mbid WHERE d.event_id=? ORDER BY a.name',[id]);
          const vn=sources.find(source=>source.source_key==='vilnius-events');
          const [legacy]=vn ? await conn.execute('SELECT * FROM vilnius_events WHERE source_id=?',[Number(vn.source_id)]) : [[]];
          const [availableArtists]=await conn.execute('SELECT mbid,name FROM artists',[]);
          const [images]=legacy[0]?.featured_media ? await conn.execute('SELECT media_id,width,height,source_url,local_name,mime_type FROM vilnius_images WHERE media_id=?',[legacy[0].featured_media]) : [[]];
          const [candidates]=events[0].event_date ? await conn.execute('SELECT id,title,event_date,venue FROM events WHERE id<>? AND event_date=? LIMIT 500',[id,events[0].event_date]) : [[]];
          await conn.commit();
          return {event:events[0],sources,price:prices[0] || null,artist_decisions:artists,vilnius_event:legacy[0] || null,available_artists:availableArtists,image:images[0] || null,match_candidates:candidates};
        } catch(cause) {await conn.rollback(); throw cause;}
      } finally {conn.release();}
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
    },
    async confirmAssistantReview(id) {
      const [result]=await pool.execute('UPDATE assistant_event_reviews SET confirmed_at=? WHERE event_id=? AND confirmed_at IS NULL',[new Date().toISOString(),id]);
      if(!result.affectedRows)throw error(404,'No pending assistant review.');
    }
  };
}
