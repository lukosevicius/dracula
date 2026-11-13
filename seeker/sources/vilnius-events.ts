import { extractDetails, extractPageDetails, suggestArtists } from './event-details.js';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { Artist, ArtistDecision, EventDetails, EventRecord, ReviewStatus, SourceEvent } from '../types.js';
import { migrateEventCatalogue } from '../database/events.js';
const SOURCE = 'vilnius-events';
const PAGE_SIZE = 50;
const INTERVAL = 3000;
const DETAIL_FIELDS = ['event_date','event_end_date','event_time','venue','ticket_url'] as const;
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createVilniusEvents(db: DatabaseSync, userAgent: string) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vilnius_events (
      source_id INTEGER PRIMARY KEY, title TEXT NOT NULL, source_url TEXT NOT NULL,
      content_html TEXT NOT NULL, categories_json TEXT NOT NULL,
      featured_media INTEGER, published_at TEXT, modified_at TEXT,
      first_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vilnius_event_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, finished_at TEXT,
      status TEXT NOT NULL, fetched_count INTEGER NOT NULL DEFAULT 0,
      added_count INTEGER NOT NULL DEFAULT 0, updated_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT
    );
  `);
  const columns = new Set(db.prepare('PRAGMA table_info(vilnius_events)').all().map(c=>c.name));
  for (const [name, type] of [['event_date','TEXT'],['event_time','TEXT'],['venue','TEXT'],['ticket_url','TEXT'],['details_manual','INTEGER NOT NULL DEFAULT 0'],['review_status',"TEXT NOT NULL DEFAULT 'unsure'"]]) {
    if (!columns.has(name)) db.exec(`ALTER TABLE vilnius_events ADD COLUMN ${name} ${type}`);
  }
  if (!columns.has('details_checked_at')) db.exec('ALTER TABLE vilnius_events ADD COLUMN details_checked_at TEXT');
  if (!columns.has('event_end_date')) {
    db.exec('ALTER TABLE vilnius_events ADD COLUMN event_end_date TEXT');
    db.exec('UPDATE vilnius_events SET details_checked_at=NULL WHERE details_manual=0');
  }
  if (!columns.has('details_version')) {
    db.exec('ALTER TABLE vilnius_events ADD COLUMN details_version INTEGER NOT NULL DEFAULT 0');
    db.exec('UPDATE vilnius_events SET details_checked_at=NULL WHERE details_manual=0');
  }
  if (!columns.has('manual_fields')) {
    db.exec("ALTER TABLE vilnius_events ADD COLUMN manual_fields TEXT NOT NULL DEFAULT '[]'");
    // Earlier versions only recorded that some field was edited; preserve all of them.
    db.prepare('UPDATE vilnius_events SET manual_fields=? WHERE details_manual=1').run(JSON.stringify(DETAIL_FIELDS));
  }
  db.exec(`CREATE TABLE IF NOT EXISTS vilnius_event_artists (
    event_id INTEGER NOT NULL REFERENCES vilnius_events(source_id) ON DELETE CASCADE,
    artist_mbid TEXT NOT NULL REFERENCES artists(mbid) ON DELETE CASCADE,
    decision TEXT NOT NULL CHECK(decision IN ('accepted','dismissed')),
    PRIMARY KEY(event_id, artist_mbid)
  )`);
  migrateEventCatalogue(db);
  const saveExtracted = db.prepare('UPDATE vilnius_events SET event_date=?,event_end_date=?,event_time=?,venue=?,ticket_url=? WHERE source_id=?');
  const extract = (id: SQLInputValue, values: Partial<EventDetails>) => {
    const existing=db.prepare('SELECT * FROM vilnius_events WHERE source_id=?').get(id);
    if (!existing) throw new Error('Event not found while extracting details.');
    const locked=new Set(JSON.parse(String(existing.manual_fields)));
    saveExtracted.run(...DETAIL_FIELDS.map(field => locked.has(field) ? existing[field] : values[field] ?? existing[field]),id);
  };
  for (const e of db.prepare('SELECT source_id,content_html FROM vilnius_events WHERE details_checked_at IS NULL').all()) extract(e.source_id,extractDetails(String(e.content_html)));
  db.prepare('INSERT OR IGNORE INTO source_state (source_key, next_offset, updated_at) VALUES (?, 0, ?)').run(SOURCE, new Date().toISOString());
  const upsert = db.prepare(`INSERT INTO vilnius_events
    (source_id,title,source_url,content_html,categories_json,featured_media,published_at,modified_at,first_seen_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET
    title=excluded.title,source_url=excluded.source_url,content_html=excluded.content_html,
    categories_json=excluded.categories_json,featured_media=excluded.featured_media,
    published_at=excluded.published_at,modified_at=excluded.modified_at,updated_at=excluded.updated_at`);
  let running = false;
  const state = () => {
    const artists = db.prepare('SELECT mbid,name FROM artists').all() as unknown as Artist[];
    const decisions = db.prepare('SELECT v.event_id,v.artist_mbid,v.decision,a.name FROM vilnius_event_artists v JOIN artists a ON a.mbid=v.artist_mbid').all() as unknown as {event_id:number;artist_mbid:string;decision:string;name:string}[];
    const byEvent = new Map<number, typeof decisions>();
    for (const d of decisions) { if (!byEvent.has(d.event_id)) byEvent.set(d.event_id,[]); byEvent.get(d.event_id)!.push(d); }
    return {
    total: Number(db.prepare('SELECT COUNT(*) AS count FROM vilnius_events').get()?.count || 0),
    nextPage: Number(db.prepare('SELECT next_offset FROM source_state WHERE source_key=?').get(SOURCE)?.next_offset || 0) + 1,
    running,
    runs: db.prepare('SELECT * FROM vilnius_event_runs ORDER BY id DESC LIMIT 8').all(),
    events: (db.prepare('SELECT * FROM vilnius_events ORDER BY published_at DESC, source_id DESC').all() as unknown as EventRecord[]).map(event=>{ const reviewed=byEvent.get(event.source_id)||[]; return {...event, artist_links:reviewed.filter(d=>d.decision==='accepted'), artist_suggestions:suggestArtists(event,artists,new Set(reviewed.map(d=>d.artist_mbid)))}; }),
  }; };
  function details(id: number) {
    const event=db.prepare('SELECT * FROM vilnius_events WHERE source_id=?').get(id);
    if (!event) throw Object.assign(new Error('Event not found.'),{status:404});
    const artists=db.prepare('SELECT mbid,name FROM artists').all() as unknown as Artist[];
    const reviewed=db.prepare('SELECT v.event_id,v.artist_mbid,v.decision,a.name FROM vilnius_event_artists v JOIN artists a ON a.mbid=v.artist_mbid WHERE v.event_id=?').all(id);
    return {...event,artist_links:reviewed.filter(d=>d.decision==='accepted'),artist_suggestions:suggestArtists(event as unknown as EventRecord,artists,new Set(reviewed.map(d=>String(d.artist_mbid))))};
  }
  function updateEvent(id: number, input: Partial<EventDetails> & {review_status: ReviewStatus}) {
    const existing=Number.isSafeInteger(id) ? db.prepare('SELECT * FROM vilnius_events WHERE source_id=?').get(id) : null;
    if (!existing) throw Object.assign(new Error('Event not found.'),{status:404});
    if (!['music','not_music','unsure'].includes(input.review_status)) throw Object.assign(new Error('Invalid review status.'),{status:400});
    const date=input.event_date || null, end=input.event_end_date || null, time=input.event_time || null, venue=input.venue?.trim() || null, ticket=input.ticket_url?.trim() || null;
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date)) throw Object.assign(new Error('Invalid date.'),{status:400});
    if (end && (!date || !/^\d{4}-\d{2}-\d{2}$/.test(end) || Number.isNaN(Date.parse(`${end}T00:00:00Z`)) || new Date(`${end}T00:00:00Z`).toISOString().slice(0,10)!==end || end<date)) throw Object.assign(new Error('Invalid end date.'),{status:400});
    if (time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw Object.assign(new Error('Invalid time.'),{status:400});
    if (ticket) { try { if (!['http:','https:'].includes(new URL(ticket).protocol)) throw Error(); } catch { throw Object.assign(new Error('Invalid ticket URL.'),{status:400}); } }
    if ((venue?.length || 0)>300 || (ticket?.length || 0)>2048) throw Object.assign(new Error('Field is too long.'),{status:400});
    const values=[date,end,time,venue,ticket], locked=new Set(JSON.parse(String(existing.manual_fields)));
    DETAIL_FIELDS.forEach((field,index)=>{ if(values[index]!==existing[field]) locked.add(field); });
    db.prepare('UPDATE vilnius_events SET event_date=?,event_end_date=?,event_time=?,venue=?,ticket_url=?,review_status=?,manual_fields=?,details_manual=? WHERE source_id=?').run(...values,input.review_status,JSON.stringify([...locked]),locked.size?1:0,id);
  }
  function reviewEvent(id: number, status: ReviewStatus) {
    if (!Number.isSafeInteger(id) || !['music','not_music','unsure'].includes(status)) throw Object.assign(new Error('Invalid event or review status.'),{status:400});
    if (!db.prepare('UPDATE vilnius_events SET review_status=? WHERE source_id=?').run(status,id).changes) throw Object.assign(new Error('Event not found.'),{status:404});
  }
  function reviewArtist(id: number, mbid: string, decision: ArtistDecision) {
    if (!Number.isSafeInteger(id) || !db.prepare('SELECT 1 FROM vilnius_events WHERE source_id=?').get(id) || !db.prepare('SELECT 1 FROM artists WHERE mbid=?').get(mbid)) throw Object.assign(new Error('Event or artist not found.'),{status:404});
    if (!['accepted','dismissed','remove'].includes(decision)) throw Object.assign(new Error('Invalid decision.'),{status:400});
    if (decision==='remove') db.prepare('DELETE FROM vilnius_event_artists WHERE event_id=? AND artist_mbid=?').run(id,mbid);
    else db.prepare('INSERT INTO vilnius_event_artists(event_id,artist_mbid,decision) VALUES(?,?,?) ON CONFLICT(event_id,artist_mbid) DO UPDATE SET decision=excluded.decision').run(id,mbid,decision);
  }
  async function requestPage(page: number, size = PAGE_SIZE): Promise<{data:SourceEvent[];pages:number|null}> {
    const url = new URL('https://www.vilnius-events.lt/wp-json/wp/v2/event');
    for (const [key, value] of Object.entries({categories:'4,81', per_page:String(size), page:String(page), orderby:'date', order:'desc', _fields:'id,title,link,content,categories,featured_media,date,modified'})) url.searchParams.set(key, value);
    for (let attempt = 0; attempt < 4; attempt++) {
      const last = db.prepare('SELECT last_request_at FROM source_state WHERE source_key=?').get(SOURCE)?.last_request_at;
      const wait = Math.max(0, INTERVAL - (Date.now() - (Date.parse(String(last)) || 0)));
      if (wait) await pause(wait);
      db.prepare('UPDATE source_state SET last_request_at=? WHERE source_key=?').run(new Date().toISOString(), SOURCE);
      let response;
      try { response = await fetch(url, {headers:{accept:'application/json', 'user-agent':userAgent}, signal:AbortSignal.timeout(20000)}); }
      catch (error) {
        if (attempt === 3) throw new Error(`Request failed: ${error instanceof Error ? error.message : String(error)}`);
        await pause((attempt + 1) * 5000); continue;
      }
      if (response.ok) {
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error('Unexpected response from Vilnius Events.');
        return {data: data as SourceEvent[], pages:Number(response.headers.get('x-wp-totalpages')) || null};
      }
      if (response.status === 400) {
        const body = await response.json().catch(() => ({}));
        if (body.code === 'rest_post_invalid_page_number') return {data:[], pages:null};
      }
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) throw new Error(`Vilnius Events returned HTTP ${response.status}.`);
      const retry = response.headers.get('retry-after');
      const seconds = Number(retry);
      const retryMs = retry && Number.isFinite(seconds) ? seconds * 1000 : Math.max(0, Date.parse(retry || '') - Date.now()) || 0;
      if (retryMs > 120000) throw new Error('Vilnius Events requested a longer pause. Please retry later.');
      await pause(Math.max(retryMs, [5000, 15000, 30000][attempt]));
    }
    throw new Error('Vilnius Events did not return a response.');
  }
  async function run(pages: number, restart: boolean, sample = false, refresh = false, progress: (value: {fetched:number; added:number; updated:number})=>void = ()=>{}) {
    if (running) throw Object.assign(new Error('An event import is already running.'), {status:409});
    running = true;
    let fetched = 0, added = 0, updated = 0;
    const runId = db.prepare("INSERT INTO vilnius_event_runs (started_at,status) VALUES (?, 'running')").run(new Date().toISOString()).lastInsertRowid;
    let page = restart || sample || refresh ? 1 : state().nextPage;
    const requestedStart=page;
    // Refresh the newest page and overlap the previous page when continuing.
    const queue = sample || refresh || restart ? [] : [...new Set([1, Math.max(1,page-1)])].filter(p=>p<page);
    try {
      for (let i = 0; i < pages + queue.length; i++) {
        const isOverlap=i<queue.length;
        page=isOverlap ? queue[i] : requestedStart + i - queue.length;
        const result = await requestPage(page, sample ? 10 : PAGE_SIZE);
        const now = new Date().toISOString();
        db.exec('BEGIN');
        let pageAdded = 0, pageUpdated = 0;
        try {
          for (const item of result.data) {
            if (!Number.isInteger(item.id) || !item.title?.rendered || !item.link) throw new Error('An event record is missing required fields.');
            const exists = db.prepare('SELECT modified_at,content_html FROM vilnius_events WHERE source_id=?').get(item.id);
            upsert.run(item.id,item.title.rendered,item.link,item.content?.rendered || '',JSON.stringify(item.categories || []),item.featured_media || null,item.date || null,item.modified || null,now,now);
            if (exists && (exists.modified_at !== (item.modified || null) || exists.content_html !== (item.content?.rendered || ''))) db.prepare('UPDATE vilnius_events SET details_checked_at=NULL WHERE source_id=?').run(item.id);
            if (!db.prepare('SELECT details_checked_at FROM vilnius_events WHERE source_id=?').get(item.id)?.details_checked_at) extract(item.id,extractDetails(item.content?.rendered || ''));
            if (exists) pageUpdated++; else pageAdded++;
          }
          const next = !result.data.length || (result.pages && page >= result.pages) ? 0 : page;
          if (!sample && !refresh && !isOverlap) db.prepare('UPDATE source_state SET next_offset=?, total_available=?, updated_at=? WHERE source_key=?').run(next,result.pages,now,SOURCE);
          fetched += result.data.length; added += pageAdded; updated += pageUpdated;
          db.prepare('UPDATE vilnius_event_runs SET fetched_count=?,added_count=?,updated_count=? WHERE id=?').run(fetched,added,updated,runId);
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        progress({fetched,added,updated});
        if (sample || refresh || (!isOverlap && (!result.data.length || (result.pages && page >= result.pages)))) break;
      }
      db.prepare("UPDATE vilnius_event_runs SET status='completed',finished_at=? WHERE id=?").run(new Date().toISOString(),runId);
      return {fetched,added,updated};
    } catch (error) {
      db.prepare("UPDATE vilnius_event_runs SET status='failed',finished_at=?,error_message=? WHERE id=?").run(new Date().toISOString(),error instanceof Error ? error.message : String(error),runId);
      throw error;
    } finally { running = false; }
  }
  async function enrich(limit = 10, refresh = false, progress: (value: {checked:number; enriched:number})=>void = ()=>{}) {
    if (running) throw Object.assign(new Error('An event import is already running.'), {status:409});
    running=true; let checked=0, enriched=0;
    try {
      const events=refresh ? db.prepare('SELECT source_id,source_url,content_html FROM vilnius_events ORDER BY details_checked_at ASC, published_at DESC LIMIT ?').all(limit) : db.prepare('SELECT source_id,source_url,content_html FROM vilnius_events WHERE details_checked_at IS NULL ORDER BY published_at DESC LIMIT ?').all(limit);
      for (const event of events) {
        const url=new URL(String(event.source_url));
        if (url.protocol!=='https:' || !['www.vilnius-events.lt','vilnius-events.lt'].includes(url.hostname)) throw new Error('Unexpected event URL.');
        let response;
        for (let attempt=0; attempt<4; attempt++) {
          const last=db.prepare('SELECT last_request_at FROM source_state WHERE source_key=?').get(SOURCE)?.last_request_at;
          const delay=Math.max(0,INTERVAL-(Date.now()-(Date.parse(String(last))||0))); if(delay) await pause(delay);
          db.prepare('UPDATE source_state SET last_request_at=? WHERE source_key=?').run(new Date().toISOString(),SOURCE);
          try { response=await fetch(url,{headers:{'user-agent':userAgent,accept:'text/html'},redirect:'error',signal:AbortSignal.timeout(20000)}); }
          catch(error) { if(attempt===3) throw new Error(`Event page request failed: ${error instanceof Error ? error.message : String(error)}`); await pause((attempt+1)*5000); continue; }
          if(response.ok) break;
          if(![429,500,502,503,504].includes(response.status)||attempt===3) throw new Error(`Event page returned HTTP ${response.status}.`);
          const retry=response.headers.get('retry-after'), seconds=Number(retry), ms=retry && Number.isFinite(seconds)?seconds*1000:Math.max(0,Date.parse(retry||'')-Date.now())||0;
          if(ms>120000) throw new Error('Vilnius Events requested a longer pause. Please retry later.');
          await pause(Math.max(ms,[5000,15000,30000][attempt]));
        }
        if (!response) throw new Error('Event page did not return a response.');
        const html=await response.text(), page=extractPageDetails(html), content=extractDetails(String(event.content_html));
        const date=page.ambiguous_dates ? null : page.event_date||content.event_date;
        const time=page.event_time || (!page.ambiguous_dates && (!page.event_date || page.event_date===content.event_date) ? content.event_time : null);
        extract(event.source_id,{event_date:date,event_end_date:page.event_end_date,event_time:time,venue:page.venue||content.venue,ticket_url:page.ticket_url||content.ticket_url});
        db.prepare('UPDATE vilnius_events SET details_checked_at=?,details_version=1 WHERE source_id=?').run(new Date().toISOString(),event.source_id);
        checked++; if(page.event_date||page.venue||page.ticket_url) enriched++;
        progress({checked,enriched});
      }
      return {checked,enriched};
    } finally { running=false; }
  }
  return {state, details, run, updateEvent, reviewEvent, reviewArtist, enrich};
}
