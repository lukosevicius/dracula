import { createServer } from 'node:http';
import { createServer as createPortProbe } from 'node:net';
import { readFile } from 'node:fs/promises';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync, backup } from 'node:sqlite';
import { createVilniusEvents } from './sources/vilnius-events.js';
import { createMusicBrainzImporter } from './sources/musicbrainz.js';
import { createJobRunner } from './database/jobs.js';
import { createAiEvaluation, MODELS, type Model } from './database/ai-evaluation.js';
import { suggestEventMatches } from './database/event-matching.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const publicDir = join(root, 'public');
const compiledPublicDir = join(root, 'dist', 'public');
const clientDir = join(root, 'client', 'dist');
const dataDir = join(root, 'data');
const databasePath = join(dataDir, 'seeker.sqlite');
const port = Number(process.env.PORT || 4177);
const maxImportLimit = 1000;
const userAgent = process.env.SEEKER_USER_AGENT || 'Seeker/0.1.0';

// Refuse to migrate while another Seeker is already using this port.
await new Promise<void>((resolve, reject) => {
  const probe = createPortProbe();
  probe.once('error', reject);
  probe.listen(port, '127.0.0.1', () => probe.close(error => error ? reject(error) : resolve()));
});
mkdirSync(dataDir, { recursive: true });
const databaseExisted = existsSync(databasePath);
const db = new DatabaseSync(databasePath);
const migrationTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
const migrated = migrationTable && db.prepare('SELECT 1 FROM schema_migrations WHERE version=1').get();
if (databaseExisted && !migrated) {
  const backupDir=join(dataDir,'backups'); mkdirSync(backupDir,{recursive:true});
  const backupPath=join(backupDir,`before-event-migration-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);
  await backup(db,backupPath);
  const check=new DatabaseSync(backupPath,{readOnly:true});
  try { if(check.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new Error('Database backup integrity check failed.'); }
  finally { check.close(); }
  console.log(`Database backup created: ${backupPath}`);
}
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS artists (
    mbid TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_name TEXT,
    artist_type TEXT,
    country TEXT,
    area TEXT,
    begin_area TEXT,
    begin_date TEXT,
    end_date TEXT,
    disambiguation TEXT,
    aliases_json TEXT NOT NULL DEFAULT '[]',
    source_url TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS import_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    requested_limit INTEGER NOT NULL,
    mode TEXT NOT NULL DEFAULT 'next',
    fetched_count INTEGER NOT NULL DEFAULT 0,
    added_count INTEGER NOT NULL DEFAULT 0,
    updated_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'running',
    error_message TEXT
  );

  CREATE TABLE IF NOT EXISTS source_state (
    source_key TEXT PRIMARY KEY,
    next_offset INTEGER NOT NULL DEFAULT 0,
    total_available INTEGER,
    updated_at TEXT NOT NULL
  );
`);

const runColumns = db.prepare('PRAGMA table_info(import_runs)').all();
if (!runColumns.some((column) => column.name === 'mode')) {
  db.exec("ALTER TABLE import_runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'next'");
}

const sourceKey = 'musicbrainz-lithuania-artists';
const storedSourceState = db.prepare('SELECT source_key FROM source_state WHERE source_key = ?').get(sourceKey);
if (!storedSourceState) {
  const previousRun = db.prepare(`
    SELECT mode, fetched_count FROM import_runs WHERE status = 'completed' ORDER BY id DESC LIMIT 1
  `).get();
  const initialOffset = previousRun && previousRun.mode !== 'all'
    ? Number(previousRun.fetched_count || 0)
    : 0;
  db.prepare(`INSERT INTO source_state (source_key, next_offset, updated_at) VALUES (?, ?, ?)`)
    .run(sourceKey, initialOffset, new Date().toISOString());
}
const sourceStateColumns = db.prepare('PRAGMA table_info(source_state)').all();
if (!sourceStateColumns.some((column) => column.name === 'last_request_at')) {
  db.exec('ALTER TABLE source_state ADD COLUMN last_request_at TEXT');
}
const vilniusEvents = createVilniusEvents(db, userAgent);
const jobs = createJobRunner(db);
const aiEvaluation = createAiEvaluation(db);
db.prepare("UPDATE vilnius_event_runs SET status='failed', finished_at=?, error_message=? WHERE status='running'").run(new Date().toISOString(), 'Seeker stopped before the import finished. Completed pages are saved.');
db.prepare("UPDATE import_runs SET status='failed', finished_at=?, error_message=? WHERE status='running'").run(new Date().toISOString(), 'Seeker stopped before the import finished. Completed pages are saved.');

const statements = {
  runStart: db.prepare('INSERT INTO import_runs (started_at, requested_limit, mode) VALUES (?, ?, ?)'),
  runFinish: db.prepare(`UPDATE import_runs SET finished_at = ?, fetched_count = ?, added_count = ?, updated_count = ?, status = ?, error_message = ? WHERE id = ?`),
  artistExists: db.prepare('SELECT 1 FROM artists WHERE mbid = ?'),
  artistUpsert: db.prepare(`
    INSERT INTO artists (
      mbid, name, sort_name, artist_type, country, area, begin_area,
      begin_date, end_date, disambiguation, aliases_json, source_url,
      first_seen_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mbid) DO UPDATE SET
      name = excluded.name,
      sort_name = excluded.sort_name,
      artist_type = excluded.artist_type,
      country = excluded.country,
      area = excluded.area,
      begin_area = excluded.begin_area,
      begin_date = excluded.begin_date,
      end_date = excluded.end_date,
      disambiguation = excluded.disambiguation,
      aliases_json = excluded.aliases_json,
      source_url = excluded.source_url,
      updated_at = excluded.updated_at
  `),
};

const { importArtists } = createMusicBrainzImporter(db, statements, userAgent);
let importInProgress = false;

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function readDashboard() {
  const totalArtists = db.prepare('SELECT COUNT(*) AS count FROM artists').get().count;
  const lastRun = db.prepare('SELECT * FROM import_runs ORDER BY id DESC LIMIT 1').get() || null;
  const sourceState = db.prepare('SELECT next_offset, total_available FROM source_state WHERE source_key = ?')
    .get('musicbrainz-lithuania-artists');
  const recentRuns = db.prepare('SELECT * FROM import_runs ORDER BY id DESC LIMIT 8').all();
  const artists = db.prepare(`
    SELECT mbid, name, artist_type, area, country, source_url, first_seen_at
    FROM artists ORDER BY name COLLATE NOCASE ASC
  `).all();
  return { totalArtists, lastRun, recentRuns, artists, sourceState, importInProgress };
}

function contentType(path) {
  const ext = extname(path);
  return ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' })[ext] || 'application/octet-stream';
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const isApp = url.pathname === '/' || url.pathname === '/vilnius-events.html' || url.pathname === '/ai-evaluation.html';
  const pathname = isApp ? '/index.html' : decodeURIComponent(url.pathname);
  const assetDir = isApp || pathname.startsWith('/assets/') ? clientDir : pathname.endsWith('.js') ? compiledPublicDir : publicDir;
  const filePath = normalize(join(assetDir, pathname));
  if (!filePath.startsWith(`${assetDir}/`)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  try {
    const body = await readFile(filePath);
    response.writeHead(200, { 'content-type': contentType(filePath), 'cache-control': 'no-cache' });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

const server = createServer(async (request, response) => {
  const apiUrl = new URL(request.url || '/', 'http://localhost');
  if (request.method === 'GET' && apiUrl.pathname === '/about.html') {
    response.writeHead(302, { location: '/#musicbrainz-source-notes' });
    response.end();
    return;
  }
  if (request.method === 'GET' && apiUrl.pathname === '/api/ai-evaluations/events') { const limit=Math.min(5000,Math.max(1,Math.floor(Number(apiUrl.searchParams.get('limit'))||1))); const rows=db.prepare('SELECT id FROM events ORDER BY event_date IS NULL,event_date,event_time IS NULL,event_time,id LIMIT ?').all(limit); sendJson(response,200,{ids:rows.map(row=>row.id)});return; }
  if (request.method === 'GET' && apiUrl.pathname === '/api/ai-evaluations') { sendJson(response,200,{results:aiEvaluation.list(),configured:!!process.env.GEMINI_API_KEY}); return; }
  if (request.method === 'POST' && apiUrl.pathname === '/api/ai-evaluations/decision') {
    let raw=''; for await(const chunk of request) {raw+=chunk;if(raw.length>4096){sendJson(response,413,{error:'Request too large.'});return;}}
    try { const input=JSON.parse(raw); if(!Number.isSafeInteger(input.id)||!['accepted','dismissed'].includes(input.decision)) throw new Error('Invalid decision.'); if(!aiEvaluation.decision(input.id,input.decision).changes) throw new Error('Result not found.'); sendJson(response,200,{ok:true}); } catch(error) {sendJson(response,400,{error:error.message});} return;
  }
  if (request.method === 'GET' && apiUrl.pathname === '/api/jobs') {
    sendJson(response,200,{jobs:jobs.list()}); return;
  }
  if (request.method === 'POST' && apiUrl.pathname === '/api/jobs') {
    let raw=''; for await(const chunk of request) {raw+=chunk; if(raw.length>100000){sendJson(response,413,{error:'Request too large.'});return;}}
    try {
      const input=JSON.parse(raw || '{}');
      if(input.source==='ai-evaluation' && input.action==='analyze') {
        const ids=input.event_ids, models=input.models, budget=Number(input.budget);
        if(!Array.isArray(ids)||!ids.length||ids.length>5000||!ids.every((id:unknown)=>Number.isSafeInteger(id) && Number(id)>0)||new Set(ids).size!==ids.length) throw Object.assign(new Error('Select 1 to 5,000 unique events.'),{status:400});
        if(!Array.isArray(models)||!models.length||new Set(models).size!==models.length||!models.every((m:string)=>Object.hasOwn(MODELS,m))) throw Object.assign(new Error('Choose at least one supported model.'),{status:400});
        if(!Number.isFinite(budget)||budget<=0||budget>1000) throw Object.assign(new Error('Set a budget between $0 and $1,000.'),{status:400});
        if(!process.env.GEMINI_API_KEY) throw Object.assign(new Error('Set GEMINI_API_KEY before starting Seeker.'),{status:400});
        let id=0; id=jobs.start('ai-evaluation','analyze',progress=>aiEvaluation.run(id,ids,models as Model[],budget,progress)); sendJson(response,202,{id});return;
      }
      if(input.source==='vilnius-events' && ['next','start','sample','refresh','details','refresh-details','details-event','refresh-all-details'].includes(input.action)) {
        const pages=Number(input.pages ?? 1);
        if(!Number.isInteger(pages)||pages<1||pages>10) throw Object.assign(new Error('Choose between 1 and 10 pages.'),{status:400});
        let sourceId: number | undefined;
        if(input.action==='details-event') {
          if(!Number.isSafeInteger(input.event_id)) throw Object.assign(new Error('Invalid event.'),{status:400});
          const source=db.prepare("SELECT source_id FROM event_sources WHERE event_id=? AND source_key='vilnius-events'").get(input.event_id);
          if(!source) throw Object.assign(new Error('Event not found.'),{status:404});
          sourceId=Number(source.source_id);
        }
        const id=jobs.start('vilnius-events',input.action,progress=>['details','refresh-details','details-event','refresh-all-details'].includes(input.action)
          ? vilniusEvents.enrich(10,input.action==='refresh-details',progress,sourceId,input.action==='refresh-all-details')
          : vilniusEvents.run(pages,input.action==='start',input.action==='sample',input.action==='refresh',progress));
        sendJson(response,202,{id}); return;
      }
      if(input.source==='musicbrainz' && ['next','start','all'].includes(input.action)) {
        const limit=Number(input.limit);
        if(input.action!=='all'&&(!Number.isInteger(limit)||limit<1||limit>maxImportLimit)) throw Object.assign(new Error('Choose between 1 and 1,000 artists.'),{status:400});
        if(importInProgress) throw Object.assign(new Error('An import is already running.'),{status:409});
        const id=jobs.start('musicbrainz',input.action,async progress=>{
          importInProgress=true;
          try {
            const run=statements.runStart.run(new Date().toISOString(),input.action==='all'?-1:limit,input.action);
            const offset=Number(db.prepare('SELECT next_offset FROM source_state WHERE source_key=?').get(sourceKey)?.next_offset||0);
            return await importArtists(limit,Number(run.lastInsertRowid),input.action==='next'?offset:0,input.action==='all',progress);
          } finally {importInProgress=false;}
        });
        sendJson(response,202,{id}); return;
      }
      throw Object.assign(new Error('Invalid job.'),{status:400});
    } catch(error) {sendJson(response,error.status||400,{error:error.message});return;}
  }
  if (request.method === 'GET' && apiUrl.pathname === '/api/events') {
    const page=Math.max(1,Math.floor(Number(apiUrl.searchParams.get('page'))||1));
    const limit=Math.min(100,Math.max(1,Math.floor(Number(apiUrl.searchParams.get('limit'))||25)));
    const review=apiUrl.searchParams.get('review')||'all', when=apiUrl.searchParams.get('when')||'upcoming', sourceFilter=apiUrl.searchParams.get('source')||'all';
    const today=apiUrl.searchParams.get('today')||new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Vilnius',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const from=apiUrl.searchParams.get('from'),to=apiUrl.searchParams.get('to');
    const clauses:string[]=[], params:(string|number)[]=[];
    if(['music','not_music','unsure'].includes(review)){clauses.push('e.review_status=?');params.push(review);}
    if(sourceFilter!=='all'){clauses.push('EXISTS (SELECT 1 FROM event_sources sf WHERE sf.event_id=e.id AND sf.source_key=?)');params.push(sourceFilter);}
    if(when==='upcoming'){clauses.push('e.event_date IS NOT NULL AND COALESCE(e.event_end_date,e.event_date)>=?');params.push(today);}
    if(when==='past'){clauses.push('e.event_date IS NOT NULL AND COALESCE(e.event_end_date,e.event_date)<?');params.push(today);}
    if(when==='unknown') clauses.push('e.event_date IS NULL');
    if(['today','tomorrow','weekend','custom'].includes(when)) {
      if(!from||!to||!/\d{4}-\d{2}-\d{2}/.test(from)||!/\d{4}-\d{2}-\d{2}/.test(to)||to<from){sendJson(response,400,{error:'Choose a valid date range.'});return;}
      clauses.push('e.event_date<=? AND COALESCE(e.event_end_date,e.event_date)>=?');params.push(to,from);
    }
    const where=clauses.length?'WHERE '+clauses.join(' AND '):'';
    const count=Number(db.prepare(`SELECT COUNT(*) AS count FROM events e ${where}`).get(...params).count);
    const records=db.prepare(`SELECT e.*,s.source_id,s.source_key,s.source_url,s.about_url,s.last_checked_at AS details_checked_at FROM events e JOIN event_sources s ON s.id=(SELECT id FROM event_sources WHERE event_id=e.id ORDER BY id LIMIT 1) ${where} ORDER BY e.event_date IS NULL,e.event_date ${when==='past'?'DESC':'ASC'},e.event_time IS NULL,e.event_time ${when==='past'?'DESC':'ASC'},e.id LIMIT ? OFFSET ?`).all(...params,limit,(page-1)*limit);
    const counts=db.prepare("SELECT COUNT(*) AS total, SUM(review_status='music') AS music, SUM(review_status='not_music') AS not_music, SUM(review_status='unsure') AS unsure, SUM(event_date IS NULL) AS unknown FROM events").get();
    const source=db.prepare('SELECT next_offset FROM source_state WHERE source_key=?').get('vilnius-events');
    sendJson(response,200,{events:records,total:count,page,limit,counts,nextPage:Number(source?.next_offset||0)+1,sources:db.prepare('SELECT DISTINCT source_key FROM event_sources ORDER BY source_key').all(),runs:db.prepare('SELECT * FROM vilnius_event_runs ORDER BY id DESC LIMIT 8').all()}); return;
  }
  const eventPath=apiUrl.pathname.match(/^\/api\/events\/(\d+)(?:\/(review|details|artist|matches))?$/);
  if(eventPath) {
    const eventId=Number(eventPath[1]), event=db.prepare('SELECT id FROM events WHERE id=?').get(eventId);
    if(!event){sendJson(response,404,{error:'Event not found.'});return;}
    if(request.method==='GET' && eventPath[2]==='matches') {sendJson(response,200,{matches:suggestEventMatches(db,eventId)});return;}
    const source=db.prepare("SELECT source_id FROM event_sources WHERE event_id=? AND source_key='vilnius-events'").get(eventId);
    if(!source){sendJson(response,404,{error:'This source does not support event details yet.'});return;}
    if(request.method==='GET' && (!eventPath[2] || eventPath[2]==='details')) {
      try {sendJson(response,200,{event:vilniusEvents.details(Number(source.source_id)),sources:db.prepare('SELECT source_key,source_url,last_checked_at FROM event_sources WHERE event_id=? ORDER BY id').all(eventId),matches:suggestEventMatches(db,eventId)});}catch(error){sendJson(response,error.status||500,{error:error.message});}return;
    }
    if(request.method==='POST' && ['review','details','artist'].includes(eventPath[2])) {
      let raw='';for await(const chunk of request){raw+=chunk;if(raw.length>8192){sendJson(response,413,{error:'Request too large.'});return;}}
      try {
        const body=JSON.parse(raw);
        if(eventPath[2]==='review') {vilniusEvents.reviewEvent(Number(source.source_id),body.review_status);sendJson(response,200,{id:eventId,review_status:body.review_status});}
        else if(eventPath[2]==='details'){vilniusEvents.updateEvent(Number(source.source_id),body);sendJson(response,200,{id:eventId});}
        else {vilniusEvents.reviewArtist(Number(source.source_id),body.mbid,body.decision);sendJson(response,200,{id:eventId});}
      }catch(error){sendJson(response,error.status||400,{error:error.message});}return;
    }
  }
  if (request.method === 'POST' && request.url === '/api/vilnius-events/enrich') {
    let raw=''; for await (const chunk of request) { raw+=chunk; if(raw.length>1024) { sendJson(response,413,{error:'Request too large.'}); return; } }
    try { const body=JSON.parse(raw || '{}'); const result=await vilniusEvents.enrich(10,body.refresh===true); sendJson(response,200,{result,dashboard:vilniusEvents.state()}); }
    catch(error) { sendJson(response,error.status||502,{error:error.message,dashboard:vilniusEvents.state()}); }
    return;
  }
  if (request.method === 'POST' && ['/api/vilnius-events/update','/api/vilnius-events/artist','/api/vilnius-events/review'].includes(request.url)) {
    let raw = '';
    for await (const chunk of request) { raw += chunk; if (raw.length > 8192) { sendJson(response, 413, {error:'Request too large.'}); return; } }
    try {
      const body = JSON.parse(raw);
      if (request.url.endsWith('/update')) vilniusEvents.updateEvent(body.id, body);
      else if (request.url.endsWith('/review')) vilniusEvents.reviewEvent(body.id,body.review_status);
      else vilniusEvents.reviewArtist(body.id, body.mbid, body.decision);
      sendJson(response, 200, {dashboard:vilniusEvents.state()});
    } catch (error) { sendJson(response, error.status || 400, {error:error.message}); }
    return;
  }
  if (request.method === 'GET' && request.url === '/api/vilnius-events') {
    sendJson(response, 200, vilniusEvents.state());
    return;
  }
  if (request.method === 'POST' && request.url === '/api/vilnius-events/import') {
    let raw = '';
    for await (const chunk of request) {
      raw += chunk;
      if (raw.length > 4096) { sendJson(response, 413, {error:'Request too large.'}); return; }
    }
    let body;
    try { body = JSON.parse(raw || '{}'); } catch { sendJson(response, 400, {error:'Invalid JSON.'}); return; }
    if (!Number.isInteger(body.pages) || body.pages < 1 || body.pages > 10 || typeof body.restart !== 'boolean') {
      sendJson(response, 400, {error:'Choose between 1 and 10 pages.'}); return;
    }
    try {
      const result = await vilniusEvents.run(body.pages, body.restart, body.sample === true, body.refresh === true);
      sendJson(response, 200, {result, dashboard:vilniusEvents.state()});
    } catch (error) { sendJson(response, error.status || 502, {error:error.message, dashboard:vilniusEvents.state()}); }
    return;
  }
  if (request.method === 'GET' && request.url === '/api/dashboard') {
    sendJson(response, 200, readDashboard());
    return;
  }

  if (request.method === 'POST' && request.url === '/api/import') {
    if (importInProgress) {
      sendJson(response, 409, { error: 'An import is already running.' });
      return;
    }
    let rawBody = '';
    for await (const chunk of request) rawBody += chunk;
    let body;
    try {
      body = JSON.parse(rawBody || '{}');
    } catch {
      sendJson(response, 400, { error: 'Request body must be valid JSON.' });
      return;
    }
    const mode = ['next', 'start', 'all'].includes(body.mode) ? body.mode : 'next';
    const limit = Number(body.limit);
    if (mode !== 'all' && (!Number.isInteger(limit) || limit < 1 || limit > maxImportLimit)) {
      sendJson(response, 400, { error: `Choose a whole number from 1 to ${maxImportLimit}.` });
      return;
    }

    importInProgress = true;
    const run = statements.runStart.run(new Date().toISOString(), mode === 'all' ? -1 : limit, mode);
    const runId = Number(run.lastInsertRowid);
    const currentOffset = db.prepare('SELECT next_offset FROM source_state WHERE source_key = ?')
      .get('musicbrainz-lithuania-artists').next_offset;
    try {
      const startOffset = mode === 'next' ? Number(currentOffset) : 0;
      const result = await importArtists(limit, runId, startOffset, mode === 'all');
      sendJson(response, 200, { result, dashboard: readDashboard() });
    } catch (error) {
      sendJson(response, 502, { error: error.message, dashboard: readDashboard() });
    } finally {
      importInProgress = false;
    }
    return;
  }

  if (request.method === 'GET') {
    await serveStatic(request, response);
    return;
  }

  response.writeHead(405, { allow: 'GET, POST' });
  response.end('Method not allowed');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Seeker dashboard running at http://127.0.0.1:${port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
