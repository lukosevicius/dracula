import type {Pool, PoolConnection, RowDataPacket, ResultSetHeader} from 'mysql2/promise';
type Field = 'event_date' | 'event_end_date' | 'event_time' | 'venue' | 'ticket_url';
import { createHash, timingSafeEqual } from 'node:crypto';
import { normalizeEventSearch } from './event-search.js';
import { vilniusToday } from '../catalogue/catalogue.service.js';

const statuses = new Set(['music', 'not_music', 'unsure']);
const decisions = new Set(['accepted', 'dismissed', 'remove']);
const priceTypes = new Set(['free', 'paid', 'unknown']);
const detailFields: Field[] = ['event_date','event_end_date','event_time','venue','ticket_url'];
const error = (status: number, message: string) => Object.assign(new Error(message), { status });
const digest = (value: string) => createHash('sha256').update(value).digest();
function validDate(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const d=new Date(`${value}T00:00:00Z`); return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0,10)===value; }

export function createAdmin(pool: Pool, token: string) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9._~-]{32,}$/.test(token)) throw new Error('ADMIN_TOKEN must be at least 32 URL-safe ASCII characters.');
  const tokenHash = digest(token);
  async function withEvent(id: number, fn: (conn: PoolConnection, sourceId: number | null, existing: RowDataPacket) => Promise<void>) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      try {
        const [events] = await conn.execute<RowDataPacket[]>('SELECT * FROM events WHERE id=? FOR UPDATE', [id]);
        if(events.length!==1) throw error(404,'Event not found.');
        const [vn] = await conn.execute<RowDataPacket[]>("SELECT source_id FROM event_sources WHERE event_id=? AND source_key='vilnius-events'", [id]);
        const sourceId=vn.length?Number(vn[0].source_id):null;
        if(vn.length && (!Number.isSafeInteger(sourceId)||Number(sourceId)<1)) throw error(409,'Event source is inconsistent.');
        const [source] = sourceId ? await conn.execute<RowDataPacket[]>('SELECT source_id,event_date,event_end_date,event_time,venue,ticket_url,manual_fields FROM vilnius_events WHERE source_id=? FOR UPDATE',[sourceId]) : [events];
        if(source.length!==1)throw error(409,'Event source is inconsistent.');
        await fn(conn,sourceId,source[0]);
        await conn.commit();
      } catch (cause) { await conn.rollback(); throw cause; }
    } finally { conn.release(); }
  }
  return {
    async savedEvents() {
      const [rows]=await pool.execute<RowDataPacket[]>(`SELECT e.*,s.source_id,s.source_key,s.source_url,s.about_url,s.last_checked_at AS details_checked_at,ar.reviewed_at AS assistant_reviewed_at,ar.confirmed_at AS assistant_confirmed_at,ar.notes AS assistant_notes,ep.price_text,COALESCE(ep.price_type,'unknown') AS price_type FROM seeker_saved_events saved JOIN events e ON e.id=saved.event_id LEFT JOIN event_prices ep ON ep.event_id=e.id LEFT JOIN assistant_event_reviews ar ON ar.event_id=e.id JOIN event_sources s ON s.id=(SELECT id FROM event_sources WHERE event_id=e.id ORDER BY id LIMIT 1) ORDER BY e.event_date IS NULL,e.event_date,e.event_time IS NULL,e.event_time,saved.saved_at DESC,e.id DESC`);
      return rows.map(row=>({...row,id:Number(row.id)}));
    },
    async saveEvents(ids: number[]) {
      if(!Array.isArray(ids)||ids.length>500||!ids.every(id=>Number.isSafeInteger(id)&&id>0&&id<=999999999999))throw error(400,'Invalid saved event IDs.');
      const unique=[...new Set(ids)];
      if(!unique.length)return;
      const placeholders=unique.map(()=>'?').join(',');
      await pool.execute(`INSERT IGNORE INTO seeker_saved_events(event_id) SELECT id FROM events WHERE id IN (${placeholders})`,unique);
    },
    async removeSavedEvent(id: number) {
      if(!Number.isSafeInteger(id)||id<1||id>999999999999)throw error(400,'Invalid event ID.');
      await pool.execute('DELETE FROM seeker_saved_events WHERE event_id=?',[id]);
    },
    async seekerSettings() {
      const [rows]=await pool.execute<RowDataPacket[]>('SELECT setting_key,setting_value FROM seeker_settings ORDER BY setting_key');
      const settings:Record<string,unknown>={};
      for(const row of rows){try{settings[String(row.setting_key)]=typeof row.setting_value==='string'?JSON.parse(row.setting_value):row.setting_value;}catch{throw error(500,'A saved Seeker setting is invalid.');}}
      return settings;
    },
    async saveSeekerSetting(key: string, value: unknown) {
      if(typeof key!=='string'||!/^[a-z][a-z0-9._-]{0,190}$/.test(key))throw error(400,'Invalid setting key.');
      let serialized:string;
      try{serialized=JSON.stringify(value);}catch{throw error(400,'Invalid setting value.');}
      if(serialized===undefined||Buffer.byteLength(serialized)>65536)throw error(400,'Setting value is too large or invalid.');
      await pool.execute('INSERT INTO seeker_settings(setting_key,setting_value) VALUES(?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)',[key,serialized]);
    },
    async enrichmentCandidates(mode: string | null,after: number,eventId: number){
      if(mode===null||!['missing','oldest','all','event'].includes(mode)||!Number.isSafeInteger(after)||after<0||(mode==='event'&&(!Number.isSafeInteger(eventId)||eventId<1)))throw error(400,'Invalid detail selection.');
      const clauses=["s.source_key='vilnius-events'"],params: (string | number)[]=[];
      if(mode==='missing')clauses.push('(v.details_checked_at IS NULL OR s.about_checked_at IS NULL)');
      if(mode==='event'){clauses.push('s.event_id=?');params.push(eventId);}else if(mode==='all'){clauses.push('s.event_id>?');params.push(after);}
      const order=mode==='oldest'?'v.details_checked_at ASC,v.published_at DESC':'s.event_id ASC';
      const [rows]=await pool.execute(`SELECT s.event_id,s.source_url,s.content_html FROM event_sources s JOIN vilnius_events v ON v.source_id=CAST(s.source_id AS UNSIGNED) WHERE ${clauses.join(' AND ')} ORDER BY ${order} LIMIT 10`,params);return rows;
    },
    async listMedia(after: number,limit: number){
      if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw error(400,'Invalid media pagination.');
      const [rows]=await pool.execute<RowDataPacket[]>('SELECT DISTINCT featured_media AS id FROM vilnius_events WHERE featured_media>? ORDER BY featured_media LIMIT ?',[after,limit]);return rows.map(row=>Number(row.id));
    },
    async artistsDashboard(){
      const conn=await pool.getConnection();try{await conn.beginTransaction();try{
        const [artists]=await conn.execute<RowDataPacket[]>('SELECT mbid,name,artist_type,area,country,source_url,first_seen_at FROM artists ORDER BY name',[]);
        const [runs]=await conn.execute<RowDataPacket[]>('SELECT * FROM import_runs ORDER BY id DESC LIMIT 8',[]);
        const [state]=await conn.execute<RowDataPacket[]>('SELECT next_offset,total_available FROM source_state WHERE source_key=?',['musicbrainz-lithuania-artists']);
        await conn.commit();return {totalArtists:artists.length,lastRun:runs[0]||null,recentRuns:runs,artists,sourceState:state[0]||null,importInProgress:false};
      }catch(cause){await conn.rollback();throw cause;}}finally{conn.release();}
    },
    async getArtist(mbid: string) {
      if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(mbid)) throw error(400, 'Invalid artist ID.');
      const [artists] = await pool.execute<RowDataPacket[]>(
        'SELECT mbid,name,artist_type,area,country,source_url,first_seen_at FROM artists WHERE mbid=?', [mbid],
      );
      if (!artists.length) return null;
      const [concerts] = await pool.execute<RowDataPacket[]>(
        `SELECT e.id,e.title,e.event_date,e.event_end_date,e.event_time,e.venue
         FROM event_artist_decisions d JOIN events e ON e.id=d.event_id
         WHERE d.artist_mbid=? AND d.decision='accepted'
         ORDER BY e.event_date,e.event_time IS NULL,e.event_time,e.id`, [mbid],
      );
      const today = vilniusToday();
      const past = [], upcoming = [], undated = [];
      for (const concert of concerts) {
        if (!concert.event_date) undated.push(concert);
        else if ((concert.event_end_date || concert.event_date) < today) past.push(concert);
        else upcoming.push(concert);
      }
      return { artist: artists[0], past: past.reverse(), upcoming, undated };
    },
    async reserveVilniusRequest() {
      const conn=await pool.getConnection();
      try {
        await conn.beginTransaction();
        try {
          const [rows]=await conn.execute<RowDataPacket[]>('SELECT last_request_at FROM source_state WHERE source_key=? FOR UPDATE',['vilnius-events']);
          if(rows.length!==1)throw error(409,'Source state is missing.');
          const now=Date.now(),last=Date.parse(rows[0].last_request_at || '') || 0;
          const waitMs=Math.max(0,last+3000-now);
          if(!waitMs)await conn.execute('UPDATE source_state SET last_request_at=? WHERE source_key=?',[new Date(now).toISOString(),'vilnius-events']);
          await conn.commit();return {waitMs};
        } catch(cause){await conn.rollback();throw cause;}
      } finally {conn.release();}
    },
    async getImage(mediaId: number) {
      const [rows]=await pool.execute<RowDataPacket[]>('SELECT local_name,mime_type,source_url,source_modified FROM vilnius_images WHERE media_id=?',[mediaId]);
      return rows[0] || null;
    },
    async getAvilysImage(sourceId:number) {
      const [rows]=await pool.execute<RowDataPacket[]>("SELECT source_url,local_name,mime_type,width,height,source_id FROM event_images WHERE source_key='avilys' AND source_id=?",[String(sourceId)]);
      return rows[0] || null;
    },
    authorized(header: string | undefined) {
      const match = /^Bearer ([^\s]+)$/.exec(header || '');
      return !!match && timingSafeEqual(tokenHash, digest(match[1]));
    },
    async listEvents(query: URLSearchParams) {
      const page=Number(query.get('page') || 1), limit=Number(query.get('limit') || 25), sort=query.get('sort') || 'date';
      const review=query.get('review') || 'all', when=query.get('when') || 'upcoming', source=query.get('source') || 'all';
      const readiness=query.get('readiness') || 'all', assistantReview=query.get('assistantReview') || 'all', price=query.get('price') || 'all';
      const from=query.get('from'),to=query.get('to'),today=vilniusToday(),search=normalizeEventSearch((query.get('search') || '').slice(0,200));
      if(!Number.isSafeInteger(page)||page<1||page>1000000||!Number.isSafeInteger(limit)||limit<1||limit>100 || !['all','music','not_music','unsure'].includes(review) || !['all','upcoming','past','unknown','today','tomorrow','weekend','custom'].includes(when) || !['all','ready','attention'].includes(readiness) || !['all','pending'].includes(assistantReview) || !['all','free','paid','unknown'].includes(price) || !['date','score-asc','score-desc'].includes(sort) || source.length>191) throw error(400,'Invalid filters.');
      if(['today','tomorrow','weekend','custom'].includes(when) && (!from || !to || !validDate(from) || !validDate(to) || to<from)) throw error(400,'Choose a valid date range.');
      const clauses: string[]=[],params: (string | number)[]=[];
      const ready="e.review_status='music' AND (NULLIF(e.event_date,'') IS NULL OR COALESCE(NULLIF(e.event_end_date,''),e.event_date)>=?)";
      if(price!=='all'){clauses.push("COALESCE((SELECT p.price_type FROM event_prices p WHERE p.event_id=e.id),'unknown')=?");params.push(price);}
      if(assistantReview==='pending') clauses.push('EXISTS (SELECT 1 FROM assistant_event_reviews ar WHERE ar.event_id=e.id AND ar.confirmed_at IS NULL)');
      if(readiness!=='all'){clauses.push(`${readiness==='attention'?'NOT ':''}(${ready})`);params.push(today);}
      if(review!=='all'){clauses.push('e.review_status=?');params.push(review);}
      if(source!=='all'){clauses.push('EXISTS (SELECT 1 FROM event_sources sf WHERE sf.event_id=e.id AND sf.source_key=?)');params.push(source);}
      if(when==='upcoming'||when==='past'){clauses.push(`e.event_date IS NOT NULL AND COALESCE(e.event_end_date,e.event_date)${when==='past'?'<':'>='}?`);params.push(today);}
      if(when==='unknown') clauses.push('e.event_date IS NULL');
      if(['today','tomorrow','weekend','custom'].includes(when)){clauses.push('e.event_date<=? AND COALESCE(e.event_end_date,e.event_date)>=?');params.push(to!,from!);}
      let where=clauses.length?`WHERE ${clauses.join(' AND ')}`:'';
      const conn=await pool.getConnection();
      try {
        await conn.beginTransaction();
        try {
          let searchTotal=null;
          const order=when==='past'?'DESC':'ASC';
          const scoreOrder=sort==='score-desc'?'e.interest_score DESC,':sort==='score-asc'?'e.interest_score ASC,':'';
          // Seeker strips HTML/entities before prefix matching. Searching titles in JS preserves that behavior.
          if(search){
            const [titles]=await conn.execute<RowDataPacket[]>(`SELECT e.id,e.title FROM events e ${where} ORDER BY ${scoreOrder}e.event_date IS NULL,e.event_date ${order},e.event_time IS NULL,e.event_time ${order},e.id`,params);
            const matches=titles.filter(row=>normalizeEventSearch(row.title).startsWith(search));
            searchTotal=matches.length;
            const ids=matches.slice((page-1)*limit,page*limit).map(row=>row.id);
            if(ids.length){where+=`${where?' AND':'WHERE'} e.id IN (${ids.map(()=>'?').join(',')})`;params.push(...ids);} else where+=`${where?' AND':'WHERE'} 1=0`;
          }
          const [totals]=await conn.execute<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM events e ${where}`,params);
          const [events]=await conn.execute<RowDataPacket[]>(`SELECT e.*,s.source_id,s.source_key,s.source_url,s.about_url,s.last_checked_at AS details_checked_at,ar.reviewed_at AS assistant_reviewed_at,ar.confirmed_at AS assistant_confirmed_at,ar.notes AS assistant_notes,ep.price_text,COALESCE(ep.price_type,'unknown') AS price_type FROM events e LEFT JOIN event_prices ep ON ep.event_id=e.id LEFT JOIN assistant_event_reviews ar ON ar.event_id=e.id JOIN event_sources s ON s.id=(SELECT id FROM event_sources WHERE event_id=e.id ORDER BY id LIMIT 1) ${where} ORDER BY ${scoreOrder}e.event_date IS NULL,e.event_date ${order},e.event_time IS NULL,e.event_time ${order},e.id LIMIT ? OFFSET ?`,[...params,limit,search?0:(page-1)*limit]);
          const [counts]=await conn.execute<RowDataPacket[]>("SELECT COUNT(*) AS total, COALESCE(SUM(review_status='music'),0) AS music, COALESCE(SUM(review_status='not_music'),0) AS not_music, COALESCE(SUM(review_status='unsure'),0) AS unsure, COALESCE(SUM(event_date IS NULL),0) AS unknown FROM events",[]);
          const [readyRows]=await conn.execute<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM events e WHERE ${ready}`,[today]);
          const [states]=await conn.execute<RowDataPacket[]>('SELECT next_offset FROM source_state WHERE source_key=?',['vilnius-events']);
          const [sources]=await conn.execute<RowDataPacket[]>('SELECT DISTINCT source_key FROM event_sources ORDER BY source_key',[]);
          const [runs]=await conn.execute<RowDataPacket[]>('SELECT * FROM vilnius_event_runs ORDER BY id DESC LIMIT 8',[]);
          await conn.commit();
          return {events,total:searchTotal ?? Number(totals[0].count),page,limit,counts:Object.fromEntries(Object.entries(counts[0]).map(([key,value])=>[key,Number(value)])),readyCount:Number(readyRows[0].count),nextPage:Number(states[0]?.next_offset || 0)+1,sources,runs};
        } catch(cause){await conn.rollback();throw cause;}
      } finally {conn.release();}
    },
    async getEvent(id: number) {
      const conn=await pool.getConnection();
      try {
        await conn.beginTransaction();
        try {
          const [events]=await conn.execute<RowDataPacket[]>('SELECT * FROM events WHERE id=?',[id]);
          if (events.length!==1) throw error(404,'Event not found.');
          const [sources]=await conn.execute<RowDataPacket[]>('SELECT * FROM event_sources WHERE event_id=? ORDER BY id',[id]);
          const [prices]=await conn.execute<RowDataPacket[]>('SELECT * FROM event_prices WHERE event_id=?',[id]);
          const [artists]=await conn.execute<RowDataPacket[]>('SELECT d.artist_mbid,d.decision,a.name FROM event_artist_decisions d JOIN artists a ON a.mbid=d.artist_mbid WHERE d.event_id=? ORDER BY a.name',[id]);
          const vn=sources.find(source=>source.source_key==='vilnius-events');
          const [legacy]=vn ? await conn.execute<RowDataPacket[]>('SELECT * FROM vilnius_events WHERE source_id=?',[Number(vn.source_id)]) : [[]];
          const [availableArtists]=await conn.execute<RowDataPacket[]>('SELECT mbid,name FROM artists',[]);
          const [images]=legacy[0]?.featured_media ? await conn.execute<RowDataPacket[]>("SELECT media_id,width,height,source_url,local_name,mime_type,'vilnius-events' AS source_key FROM vilnius_images WHERE media_id=?",[legacy[0].featured_media]) : [[]];
          const [avilysImages]=!images.length ? await conn.execute<RowDataPacket[]>("SELECT source_id,width,height,source_url,local_name,mime_type,source_key FROM event_images WHERE event_id=? AND source_key='avilys'",[id]) : [[]];
          const [candidates]=events[0].event_date ? await conn.execute<RowDataPacket[]>('SELECT id,title,event_date,venue FROM events WHERE id<>? AND event_date=? LIMIT 500',[id,events[0].event_date]) : [[]];
          await conn.commit();
          return {event:events[0],sources,price:prices[0] || null,artist_decisions:artists,vilnius_event:legacy[0] || null,available_artists:availableArtists,image:images[0] || avilysImages[0] || null,match_candidates:candidates};
        } catch(cause) {await conn.rollback(); throw cause;}
      } finally {conn.release();}
    },
    async review(id: number, data: unknown) {
      const body = data as Record<string, string>;
      if (!statuses.has(body?.review_status)) throw error(400, 'Invalid review status.');
      await withEvent(id, async (conn, sourceId) => {
        if(sourceId) await conn.execute('UPDATE vilnius_events SET review_status=? WHERE source_id=?', [body.review_status, sourceId]);
        await conn.execute('UPDATE events SET review_status=? WHERE id=?', [body.review_status, id]);
      });
    },
    async details(id: number, data: unknown) {
      const body = data as Record<string, string>;
      if (!body || typeof body !== 'object' || !statuses.has(body.review_status) || detailFields.some(field => body[field] != null && typeof body[field] !== 'string')) throw error(400, 'Invalid event details.');
      const [date,end,time,venue,ticket] = detailFields.map(field => body[field]?.trim() || null);
      if (date && !validDate(date)) throw error(400, 'Invalid date.');
      if (end && (!date || !validDate(end) || end < date)) throw error(400, 'Invalid end date.');
      if (time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw error(400, 'Invalid time.');
      if ((venue?.length || 0) > 300 || (ticket?.length || 0) > 2048) throw error(400, 'Field is too long.');
      if (ticket) { try { if (!['http:','https:'].includes(new URL(ticket).protocol)) throw new Error(); } catch { throw error(400,'Invalid ticket URL.'); } }
      await withEvent(id, async (conn, sourceId, existing) => {
        const parsed=JSON.parse(existing.manual_fields);
        if (!Array.isArray(parsed) || !parsed.every((value: unknown)=>typeof value==='string')) throw error(409, 'Event manual fields are inconsistent.');
        const locked=new Set(parsed); const values=[date,end,time,venue,ticket];
        detailFields.forEach((field,index)=>{ if (values[index] !== existing[field]) locked.add(field); });
        const fields=JSON.stringify([...locked]);
        if(sourceId) await conn.execute('UPDATE vilnius_events SET event_date=?,event_end_date=?,event_time=?,venue=?,ticket_url=?,review_status=?,manual_fields=?,details_manual=? WHERE source_id=?', [...values,body.review_status,fields,locked.size?1:0,sourceId]);
        await conn.execute('UPDATE events SET event_date=?,event_end_date=?,event_time=?,venue=?,ticket_url=?,review_status=?,manual_fields=? WHERE id=?', [...values,body.review_status,fields,id]);
      });
    },
    async artist(id: number, data: unknown) {
      const body = data as Record<string, string>;
      if (typeof body?.mbid !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.mbid) || !decisions.has(body.decision)) throw error(400, 'Invalid artist decision.');
      await withEvent(id, async (conn, sourceId) => {
        const [artists] = await conn.execute<RowDataPacket[]>('SELECT mbid FROM artists WHERE mbid=?', [body.mbid]);
        if (!artists.length) throw error(404, 'Artist not found.');
        for (const [table, key] of [...(sourceId ? [['vilnius_event_artists', sourceId] as const] : []), ['event_artist_decisions', id] as const]) {
          await conn.execute(`DELETE FROM ${table} WHERE event_id=? AND artist_mbid=?`, [key, body.mbid]);
          if (body.decision !== 'remove') await conn.execute(`INSERT INTO ${table}(event_id,artist_mbid,decision) VALUES(?,?,?)`, [key, body.mbid, body.decision]);
        }
      });
    },
    async price(id: number, data: unknown) {
      const body = data as Record<string, string>;
      if (!priceTypes.has(body?.price_type) || (body.price_text != null && typeof body.price_text !== 'string')) throw error(400, 'Invalid price.');
      const text = body.price_text?.trim() || null;
      if (text && text.length > 300) throw error(400, 'Invalid price.');
      await withEvent(id, async conn => {
        const [rows] = await conn.execute<RowDataPacket[]>('SELECT event_id FROM event_prices WHERE event_id=?', [id]);
        if (rows.length) await conn.execute('UPDATE event_prices SET price_text=?,price_type=?,manual=1,checked_at=? WHERE event_id=?', [text,body.price_type,new Date().toISOString(),id]);
        else await conn.execute('INSERT INTO event_prices(event_id,price_text,price_type,manual,checked_at) VALUES(?,?,?,1,?)', [id,text,body.price_type,new Date().toISOString()]);
      });
    },
    async interestScore(id: number, data: unknown) {
      const score=(data as Record<string,unknown>)?.interest_score;
      if(!Number.isInteger(score)||Number(score)<1||Number(score)>5)throw error(400,'Interest score must be from 1 to 5.');
      const [result]=await pool.execute<ResultSetHeader>('UPDATE events SET interest_score=? WHERE id=?',[Number(score),id]);
      if(!result.affectedRows){const [rows]=await pool.execute<RowDataPacket[]>('SELECT id FROM events WHERE id=?',[id]);if(!rows.length)throw error(404,'Event not found.');}
    },
    async confirmAssistantReview(id: number) {
      const [result]=await pool.execute<ResultSetHeader>('UPDATE assistant_event_reviews SET confirmed_at=? WHERE event_id=? AND confirmed_at IS NULL',[new Date().toISOString(),id]);
      if(!result.affectedRows)throw error(404,'No pending assistant review.');
    }
  };
}
