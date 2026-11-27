// Builds data/lt-ip-cities.json, the Lithuanian part of DB-IP's free "IP to City Lite" database, for guessing a
// visitor's city (src/geo/locate.ts). Nothing leaves the server: the lookup reads only this file.
//
// Refresh every few months:
//   1. Download dbip-city-lite-YYYY-MM.csv.gz from https://db-ip.com/db/download/ip-to-city-lite
//   2. node scripts/build-lt-ip-cities.mjs path/to/dbip-city-lite-YYYY-MM.csv.gz
//
// Licence: CC BY 4.0, "IP Geolocation by DB-IP" (https://db-ip.com). The privacy page credits it.
import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { basename } from 'node:path';
import { isIPv4, isIPv6 } from 'node:net';

const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/build-lt-ip-cities.mjs dbip-city-lite-YYYY-MM.csv.gz');

/** One CSV line, with quoted fields (city names can contain commas). */
function fields(line) {
  const out = []; let value = ''; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) { if (ch === '"' && line[i + 1] === '"') { value += '"'; i++; } else if (ch === '"') quoted = false; else value += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(value); value = ''; }
    else value += ch;
  }
  out.push(value);
  return out;
}

const v4 = (ip) => ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
/** IPv6 as 32 lowercase hex digits, so ranges compare correctly as plain strings. */
function v6(ip) {
  const [head, tail = ''] = ip.split('::');
  const parts = (s) => (s ? s.split(':') : []);
  const h = parts(head), t = parts(tail);
  const groups = ip.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  return groups.map((g) => g.padStart(4, '0')).join('').toLowerCase();
}

const cities = [], cityIndex = new Map(), ranges4 = [], ranges6 = [];
const lines = createInterface({ input: createReadStream(source).pipe(createGunzip()), crlfDelay: Infinity });
for await (const line of lines) {
  const [start, end, , country, , city] = fields(line);
  if (country !== 'LT' || !city) continue;
  if (!cityIndex.has(city)) { cityIndex.set(city, cities.length); cities.push(city); }
  const index = cityIndex.get(city);
  if (isIPv4(start) && isIPv4(end)) ranges4.push([v4(start), v4(end), index]);
  else if (isIPv6(start) && isIPv6(end)) ranges6.push([v6(start), v6(end), index]);
}

/** Sorted, with touching ranges of the same city joined. */
function merged(ranges, next) {
  ranges.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const out = [];
  for (const range of ranges) {
    const last = out[out.length - 1];
    if (last && last[2] === range[2] && next(last[1]) === range[0]) last[1] = range[1];
    else out.push([...range]);
  }
  return out;
}
const nextHex = (hex) => (BigInt(`0x${hex}`) + 1n).toString(16).padStart(32, '0');

const data = {
  source: `${basename(source)} — IP Geolocation by DB-IP (https://db-ip.com), CC BY 4.0`,
  cities,
  v4: merged(ranges4, (n) => n + 1),
  v6: merged(ranges6, nextHex),
};
await writeFile(new URL('../data/lt-ip-cities.json', import.meta.url), JSON.stringify(data) + '\n');
console.log(`${cities.length} cities, ${data.v4.length} IPv4 and ${data.v6.length} IPv6 ranges`);
