import { readFileSync } from 'node:fs';
import { isIPv4, isIPv6 } from 'node:net';

/**
 * Guesses a visitor's city from their IP address, using only data/lt-ip-cities.json (Lithuanian ranges from DB-IP's
 * free database, built by scripts/build-lt-ip-cities.mjs). Nothing is sent anywhere and the address is not stored.
 * Mobile networks often route through Vilnius, so this is only a starting point the visitor can change.
 */
type Table = { cities: string[]; v4: [number, number, number][]; v6: [string, string, number][] };

let table: Table | null | undefined;
function load(): Table | null {
  if (table === undefined) {
    try { table = JSON.parse(readFileSync(new URL('../../data/lt-ip-cities.json', import.meta.url), 'utf8')) as Table; }
    catch (error) { console.error('City lookup table unavailable:', error); table = null; }
  }
  return table;
}

const v4 = (ip: string) => ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
function v6(ip: string): string {
  const [head, tail = ''] = ip.split('::');
  const parts = (s: string) => (s ? s.split(':') : []);
  const h = parts(head), t = parts(tail);
  const groups = ip.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  return groups.map(g => g.padStart(4, '0')).join('').toLowerCase();
}

/** The range containing `value` in a sorted list of [start, end, city], or undefined. */
function find<T extends number | string>(ranges: [T, T, number][], value: T): number | undefined {
  let low = 0, high = ranges.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1, [start, end, city] = ranges[mid];
    if (value < start) high = mid - 1;
    else if (value > end) low = mid + 1;
    else return city;
  }
  return undefined;
}

/** The place name for an address in Lithuania, e.g. "Kaunas" or "Akademija (Kaunas)"; null when unknown. */
export function placeForIp(ip: string): string | null {
  const data = load();
  if (!data) return null;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
  const address = mapped ?? ip;
  const index = isIPv4(address) ? find(data.v4, v4(address)) : isIPv6(address) && !address.includes('.') ? find(data.v6, v6(address)) : undefined;
  return index === undefined ? null : data.cities[index] ?? null;
}

/** For comparing place names written with or without Lithuanian letters ("Panevezys" and "Panevėžys"). */
export const plainName = (name: string) => name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/**
 * The listed city a visitor is probably in. A suburb written as "Akademija (Kaunas)" counts as Kaunas;
 * a place with no events of its own gives null, and the app then starts with its default.
 */
export function guessCity(ip: string, listed: string[]): string | null {
  const place = placeForIp(ip);
  if (!place) return null;
  const candidates = [place, /\(([^)]+)\)\s*$/.exec(place)?.[1]].filter((name): name is string => Boolean(name)).map(plainName);
  return listed.find(city => candidates.includes(plainName(city))) ?? null;
}

/** The visitor's address: the first entry the hosting proxy adds to X-Forwarded-For, else the connection's own. */
export function clientIp(forwardedFor: string | string[] | undefined, remote: string | undefined): string {
  const header = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  return (header?.split(',')[0] ?? remote ?? '').trim();
}
