/**
 * Looks a performer up in MusicBrainz when an editor adds them as a new artist. Dracula imported only Lithuanian
 * artists, but MusicBrainz has artists from every country: a single clear match gives the real ID, country and type.
 * Anything less than one clear match returns null, and the artist is added as Dracula's own.
 */
import type { Pool } from 'mysql2/promise';
import { reserveMusicBrainz } from '../imports/musicbrainz.js';
import { normalizeArtist } from '../verification/artists.js';

export type MusicBrainzArtist = { mbid: string; name: string; country: string | null; artist_type: string | null; area: string | null; disambiguation: string | null; sort_name: string | null; aliases: string[] };
type Found = { id?: string; name?: string; score?: number; country?: string; type?: string; disambiguation?: string; 'sort-name'?: string; area?: { name?: string }; aliases?: { name?: string }[] };

const userAgent = 'Seeker/0.1.0';
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** The one artist whose name or alias is exactly this name with a strong score, or null. */
export function clearMatch(name: string, artists: Found[]): MusicBrainzArtist | null {
  const key = normalizeArtist(name);
  const matches = artists.filter(artist => typeof artist.id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(artist.id) &&
    typeof artist.name === 'string' && Number(artist.score) >= 90 &&
    [artist.name, ...(artist.aliases ?? []).map(alias => alias.name)].some(value => typeof value === 'string' && normalizeArtist(value) === key));
  if (matches.length !== 1) return null;
  const found = matches[0];
  return {
    mbid: found.id!, name: found.name!, country: /^[A-Z]{2}$/.test(found.country ?? '') ? found.country! : null,
    artist_type: found.type ?? null, area: found.area?.name ?? null, disambiguation: found.disambiguation || null, sort_name: found['sort-name'] ?? null,
    aliases: (found.aliases ?? []).map(alias => alias.name).filter((value): value is string => typeof value === 'string').slice(0, 50),
  };
}

export async function lookUpMusicBrainz(pool: Pool, name: string, request = fetch): Promise<MusicBrainzArtist | null> {
  try { return await searchMusicBrainz(pool, name, request); } catch { return null; }
}

/** Like lookUpMusicBrainz, but a failed request throws instead of reading as "no clear match". */
export async function searchMusicBrainz(pool: Pool, name: string, request = fetch): Promise<MusicBrainzArtist | null> {
  // Shares the import's pace: MusicBrainz allows about one request a second.
  for (let tries = 0; tries < 5; tries++) {
    const waitMs = await reserveMusicBrainz(pool).then(result => result.waitMs, () => 0);
    if (!waitMs) break;
    await pause(waitMs);
  }
  const url = new URL('https://musicbrainz.org/ws/2/artist/');
  url.searchParams.set('query', `artist:"${name.replace(/["\\]/g, ' ')}"`);
  url.searchParams.set('fmt', 'json');
  url.searchParams.set('limit', '5');
  const response = await request(url, { headers: { accept: 'application/json', 'user-agent': userAgent }, signal: AbortSignal.timeout(10_000), redirect: 'error' });
  if (!response.ok) throw new Error(`MusicBrainz returned HTTP ${response.status}.`);
  const body = await response.json() as { artists?: Found[] };
  return clearMatch(name, Array.isArray(body.artists) ? body.artists : []);
}
