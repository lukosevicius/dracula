import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createVilniusEvents } from './vilnius-events.js';
import type { MusicBrainzPage } from './types.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const publicDir = join(root, 'public');
const compiledPublicDir = join(root, 'dist', 'public');
const dataDir = join(root, 'data');
const databasePath = join(dataDir, 'seeker.sqlite');
const port = Number(process.env.PORT || 4177);
const maxImportLimit = 1000;
const pageSize = 100;
const musicBrainzRequestIntervalMs = 2000;
const apiBase = 'https://musicbrainz.org/ws/2/artist/';
const lithuaniaAreaMbid = '0785dc14-96af-3dc4-bde4-dcdfc2e2d0d6';
const userAgent = process.env.SEEKER_USER_AGENT || 'Seeker/0.1.0';

mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(databasePath);
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
db.prepare("UPDATE vilnius_event_runs SET status='failed', finished_at=?, error_message=? WHERE status='running'").run(new Date().toISOString(), 'Seeker stopped before the import finished. Completed pages are saved.');

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

let importInProgress = false;
let lastMusicBrainzRequestAt = 0;

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchArtistPage(offset, limit) {
  const url = new URL(apiBase);
  url.searchParams.set('area', lithuaniaAreaMbid);
  url.searchParams.set('fmt', 'json');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));

  const backoffMs = [5000, 15000, 30000];
  for (let attempt = 0; attempt <= backoffMs.length; attempt += 1) {
    const storedRequestAt = db.prepare('SELECT last_request_at FROM source_state WHERE source_key = ?')
      .get(sourceKey)?.last_request_at;
    const lastRequestTime = Math.max(
      lastMusicBrainzRequestAt,
      typeof storedRequestAt === 'string' ? Date.parse(storedRequestAt) || 0 : 0,
    );
    const delay = Math.max(0, musicBrainzRequestIntervalMs - (Date.now() - lastRequestTime));
    if (delay > 0) await sleep(delay);
    lastMusicBrainzRequestAt = Date.now();
    db.prepare('UPDATE source_state SET last_request_at = ? WHERE source_key = ?')
      .run(new Date(lastMusicBrainzRequestAt).toISOString(), sourceKey);

    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent': userAgent,
      },
      signal: AbortSignal.timeout(20000),
    });
    if (response.ok) return await response.json() as MusicBrainzPage;

    if (response.status === 503 && attempt < backoffMs.length) {
      const retryAfter = response.headers.get('retry-after');
      const retryAfterSeconds = Number(retryAfter);
      const retryAfterDate = Date.parse(retryAfter || '');
      const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.min(retryAfterSeconds * 1000, 30000)
        : Number.isFinite(retryAfterDate)
          ? Math.min(Math.max(0, retryAfterDate - Date.now()), 30000)
          : 0;
      await sleep(Math.max(backoffMs[attempt], retryAfterMs));
      continue;
    }

    if (response.status === 503) {
      throw new Error('MusicBrainz is still returning HTTP 503 after several retries. Its API may be busy or rate-limiting requests. Completed pages are saved, so “Get next batch” can resume from the next unsaved page.');
    }
    throw new Error(`MusicBrainz returned HTTP ${response.status}. Please try again later.`);
  }
  throw new Error('MusicBrainz did not return a response. Please try again later.');
}

function datePart(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  const parts = [value.year, value.month, value.day].filter((part) => part !== undefined);
  return parts.length ? parts.join('-') : null;
}

async function importArtists(limit, runId, startOffset, fetchAll = false) {
  let fetchedCount = 0;
  let addedCount = 0;
  let updatedCount = 0;
  let offset = startOffset;
  let totalAvailable = fetchAll && startOffset === 0
    ? null
    : db.prepare('SELECT total_available FROM source_state WHERE source_key = ?').get(sourceKey)?.total_available ?? null;
  let nextOffset = startOffset;

  try {
    while (fetchAll || fetchedCount < limit) {
      const requestedPageSize = fetchAll ? pageSize : Math.min(pageSize, limit - fetchedCount);
      const page = await fetchArtistPage(offset, requestedPageSize);
      const sourceArtists = Array.isArray(page.artists) ? page.artists : [];
      const artists = sourceArtists.filter((artist) => artist.country === 'LT');
      if (sourceArtists.length === 0) {
        if (fetchAll) totalAvailable = fetchedCount;
        nextOffset = 0;
        db.prepare(`UPDATE source_state SET next_offset = 0, total_available = ?, updated_at = ? WHERE source_key = ?`)
          .run(totalAvailable, new Date().toISOString(), sourceKey);
        break;
      }

      const timestamp = new Date().toISOString();
      let pageAddedCount = 0;
      let pageUpdatedCount = 0;
      const nextPageOffset = offset + sourceArtists.length;
      const isFinalPage = sourceArtists.length < requestedPageSize;
      if (isFinalPage && fetchAll) totalAvailable = fetchedCount + artists.length;
      nextOffset = isFinalPage ? 0 : nextPageOffset;
      db.exec('BEGIN');
      try {
        for (const artist of artists) {
          if (!artist.id || !artist.name) continue;
          const isNew = !statements.artistExists.get(artist.id);
          const aliases = (artist.aliases || []).map((alias) => alias.name).filter(Boolean);
          statements.artistUpsert.run(
            artist.id,
            artist.name,
            artist['sort-name'] || null,
            artist.type || null,
            artist.country || null,
            artist.area?.name || null,
            artist['begin-area']?.name || null,
            datePart(artist['life-span']?.begin),
            datePart(artist['life-span']?.end),
            artist.disambiguation || null,
            JSON.stringify(aliases),
            `https://musicbrainz.org/artist/${artist.id}`,
            timestamp,
            timestamp,
          );
          if (isNew) pageAddedCount += 1;
          else pageUpdatedCount += 1;
        }
        db.prepare(`UPDATE source_state SET next_offset = ?, total_available = ?, updated_at = ? WHERE source_key = ?`)
          .run(nextOffset, totalAvailable, timestamp, 'musicbrainz-lithuania-artists');
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }

      addedCount += pageAddedCount;
      updatedCount += pageUpdatedCount;
      fetchedCount += artists.length;
      offset = nextPageOffset;
      if (isFinalPage) break;
    }

    const finishedAt = new Date().toISOString();
    statements.runFinish.run(finishedAt, fetchedCount, addedCount, updatedCount, 'completed', null, runId);
    return { fetchedCount, addedCount, updatedCount, requestedLimit: limit, totalAvailable, nextOffset };
  } catch (error) {
    statements.runFinish.run(new Date().toISOString(), fetchedCount, addedCount, updatedCount, 'failed', error.message, runId);
    throw error;
  }
}

function contentType(path) {
  const ext = extname(path);
  return ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' })[ext] || 'application/octet-stream';
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const pathname = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const assetDir = pathname.endsWith('.js') ? compiledPublicDir : publicDir;
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
      const startOffset = mode === 'next' ? currentOffset : 0;
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
