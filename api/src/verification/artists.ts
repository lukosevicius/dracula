import { normalizeEventSearch } from '../admin/event-search.js';
import { jsonValue } from './history.js';

export type Artist = { mbid: string; name: string; disambiguation: string | null; aliases_json: unknown };
export type ArtistCandidate = { mbid: string; name: string; disambiguation: string | null };

export const normalizeArtist = (name: string) => normalizeEventSearch(name).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function catalogueByName(artists: Artist[]) {
  const index = new Map<string, ArtistCandidate[]>();
  for (const { mbid, name, disambiguation, aliases_json } of artists) {
    let aliases: unknown;
    try { aliases = jsonValue(aliases_json); } catch { aliases = []; }
    const names = [name];
    if (Array.isArray(aliases)) for (const alias of aliases) {
      const text = typeof alias === 'string' ? alias : alias?.name;
      if (typeof text === 'string') names.push(text);
    }
    for (const key of new Set(names.map(normalizeArtist))) {
      if (!key) continue;
      const candidates = index.get(key) ?? [];
      candidates.push({ mbid, name, disambiguation });
      index.set(key, candidates);
    }
  }
  return index;
}

export function mentionedArtists(index: ReturnType<typeof catalogueByName>, title: string, descriptions: string[]) {
  const inTitle = ' ' + normalizeArtist(title) + ' ';
  const inText = ' ' + descriptions.map(normalizeArtist).join(' | ') + ' ';
  return [...index]
    .map(([name, artists]) => ({ name, artists, rank: inTitle.includes(' ' + name + ' ') ? 2 : inText.includes(' ' + name + ' ') ? 1 : 0 }))
    .filter(match => match.rank > 0)
    .sort((a, b) => b.rank - a.rank || b.name.length - a.name.length || a.name.localeCompare(b.name))
    .slice(0, 40)
    .map(({ name, artists }) => ({ matched_name: name, candidates: artists.slice(0, 8).map(({ name, disambiguation }) => ({ name, ...(disambiguation ? { disambiguation } : {}) })) }));
}

export function quotedArtistName(name: string, quote: string) {
  const normalized = normalizeArtist(name);
  return Boolean(normalized) && (' ' + normalizeArtist(quote) + ' ').includes(' ' + normalized + ' ');
}
