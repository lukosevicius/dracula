import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = dirname(fileURLToPath(import.meta.url));
const publicDir = join(root, 'public');
const dataDir = join(root, 'data');
const databasePath = join(dataDir, 'seeker.sqlite');
const port = Number(process.env.PORT || 4177);
const maxImportLimit = 1000;
const pageSize = 100;
const apiBase = 'https://musicbrainz.org/ws/2/artist/';
const userAgent = process.env.SEEKER_USER_AGENT || 'Seeker/0.1.0 (Dracula Lithuanian music events project)';

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
    fetched_count INTEGER NOT NULL DEFAULT 0,
    added_count INTEGER NOT NULL DEFAULT 0,
    updated_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'running',
    error_message TEXT
  );
`);

const statements = {
  runStart: db.prepare('INSERT INTO import_runs (started_at, requested_limit) VALUES (?, ?)'),
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
  const recentRuns = db.prepare('SELECT * FROM import_runs ORDER BY id DESC LIMIT 8').all();
  const recentArtists = db.prepare(`
    SELECT mbid, name, artist_type, area, country, source_url, first_seen_at
    FROM artists ORDER BY first_seen_at DESC, name COLLATE NOCASE LIMIT 10
  `).all();
  return { totalArtists, lastRun, recentRuns, recentArtists, importInProgress };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchArtistPage(offset, limit) {
  const url = new URL(apiBase);
  url.searchParams.set('query', 'country:LT');
  url.searchParams.set('fmt', 'json');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));

  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': userAgent,
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    throw new Error(`MusicBrainz returned HTTP ${response.status}. Please try again later.`);
  }
  return response.json();
}

function datePart(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  const parts = [value.year, value.month, value.day].filter((part) => part !== undefined);
  return parts.length ? parts.join('-') : null;
}

async function importArtists(limit, runId) {
  let fetchedCount = 0;
  let addedCount = 0;
  let updatedCount = 0;
  let offset = 0;
  let totalAvailable = null;
  let previousRequestAt = 0;

  try {
    while (fetchedCount < limit) {
      const now = Date.now();
      const delay = Math.max(0, 1100 - (now - previousRequestAt));
      if (previousRequestAt) await sleep(delay);
      previousRequestAt = Date.now();

      const requestedPageSize = Math.min(pageSize, limit - fetchedCount);
      const page = await fetchArtistPage(offset, requestedPageSize);
      const artists = Array.isArray(page.artists) ? page.artists : [];
      if (totalAvailable === null) totalAvailable = Number(page.count || artists.length);
      if (artists.length === 0) break;

      const timestamp = new Date().toISOString();
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
          if (isNew) addedCount += 1;
          else updatedCount += 1;
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }

      fetchedCount += artists.length;
      offset += artists.length;
      if (artists.length < requestedPageSize || offset >= totalAvailable) break;
    }

    const finishedAt = new Date().toISOString();
    statements.runFinish.run(finishedAt, fetchedCount, addedCount, updatedCount, 'completed', null, runId);
    return { fetchedCount, addedCount, updatedCount, requestedLimit: limit, totalAvailable };
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
  const filePath = normalize(join(publicDir, pathname));
  if (!filePath.startsWith(`${publicDir}/`)) {
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
    const limit = Number(body.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > maxImportLimit) {
      sendJson(response, 400, { error: `Choose a whole number from 1 to ${maxImportLimit}.` });
      return;
    }

    importInProgress = true;
    const run = statements.runStart.run(new Date().toISOString(), limit);
    const runId = Number(run.lastInsertRowid);
    try {
      const result = await importArtists(limit, runId);
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
