import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { MusicBrainzPage } from '../types.js';

export function createMusicBrainzImporter(db: DatabaseSync, statements: {artistExists: StatementSync; artistUpsert: StatementSync; runFinish: StatementSync}, userAgent: string) {
  const sourceKey = 'musicbrainz-lithuania-artists';
  const pageSize = 100;
  const musicBrainzRequestIntervalMs = 2000;
  const apiBase = 'https://musicbrainz.org/ws/2/artist/';
  const lithuaniaAreaMbid = '0785dc14-96af-3dc4-bde4-dcdfc2e2d0d6';
  let lastMusicBrainzRequestAt = 0;
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchArtistPage(offset: number, limit: number): Promise<MusicBrainzPage> {
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

function datePart(value: string | {year?: number; month?: number; day?: number} | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  const parts = [value.year, value.month, value.day].filter((part) => part !== undefined);
  return parts.length ? parts.join('-') : null;
}

async function importArtists(limit: number, runId: number, startOffset: number, fetchAll = false, progress: (value: {fetchedCount:number; addedCount:number; updatedCount:number})=>void = ()=>{}) {
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
      progress({fetchedCount,addedCount,updatedCount});
      offset = nextPageOffset;
      if (isFinalPage) break;
    }

    const finishedAt = new Date().toISOString();
    statements.runFinish.run(finishedAt, fetchedCount, addedCount, updatedCount, 'completed', null, runId);
    return { fetchedCount, addedCount, updatedCount, requestedLimit: limit, totalAvailable, nextOffset };
  } catch (error) {
    statements.runFinish.run(new Date().toISOString(), fetchedCount, addedCount, updatedCount, 'failed', error instanceof Error ? error.message : String(error), runId);
    throw error;
  }
}

  return { importArtists };
}
