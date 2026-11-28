/**
 * Read-only Kakava adapter: upcoming concerts in Lithuania from kakava.lt's public show listing.
 *
 * Kakava returns every show in one response (about 9 MB), so one import run makes one listing request. To stay a
 * well-behaved client: the listing is cached for ten minutes (previews and imports share it), requests time out,
 * a refusal (403) stops at once, and a rate limit or server error is retried only once after a pause.
 * Kakava times are Vilnius wall time without an offset.
 */
export type KakavaEvent = {
  id: number; eventId: number; title: string; slug: string; startTime: string; endTime: string | null;
  venueName: string | null; venueAddress: string | null; city: string | null; description: string;
  imageUrl: string | null; priceFrom: number | null; status: string[]; promoter: string | null; sourceUrl: string;
};
export type KakavaPage = { data: KakavaEvent[]; page: number; pageSize: number; total: number };
/** What one listing request tells us: shows to import, music shows Kakava marks cancelled, and every music show it lists. */
export type KakavaListing = { events: KakavaEvent[]; cancelled: Set<number>; listed: Set<number> };

export const KAKAVA_LIST_URL = 'https://api.kakava.lt/api/v1/event/show?boxOffice=false';
const MUSIC_CATEGORY = 1;
const CACHE_MS = 10 * 60_000;
const TIMEOUT_MS = 60_000;
const MAX_BYTES = 40 * 1024 * 1024;
const RETRY_PAUSE_MS = 60_000;
const MAX_RETRY_AFTER_MS = 5 * 60_000;
/** Season tickets and long-running vouchers are not dated events; real festivals last a few days. */
const MAX_SPAN_DAYS = 14;
const skippedStatuses = new Set(['CANCELED', 'SALE_EXPIRED']);
const localTime = /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d)(?::[0-5]\d(?:\.\d{1,9})?)?$/;

type Options = { userAgent: string; request?: typeof fetch; now?: () => number; pause?: (ms: number) => Promise<void>; fresh?: boolean };
let cache: { at: number; listing: KakavaListing } | null = null;
let inFlight: Promise<KakavaListing> | null = null;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const text = (value: unknown, max: number) => typeof value === 'string' && value.trim() ? value.replace(/\s+/g, ' ').trim().slice(0, max) : null;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const vilniusToday = (now: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vilnius' }).format(new Date(now));

function retryAfter(response: Response) {
  const value = response.headers.get('retry-after');
  const seconds = value && /^\d{1,6}$/.test(value) ? Number(value) * 1000 : NaN;
  return Number.isFinite(seconds) ? Math.min(Math.max(seconds, 1000), MAX_RETRY_AFTER_MS) : RETRY_PAUSE_MS;
}

async function requestListing(options: Options): Promise<unknown> {
  const request = options.request ?? fetch, pause = options.pause ?? sleep;
  for (let attempt = 1; ; attempt++) {
    let response: Response;
    try {
      response = await request(KAKAVA_LIST_URL, { headers: { accept: 'application/json', 'accept-language': 'lt', 'user-agent': options.userAgent }, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      if (attempt === 1) { await pause(RETRY_PAUSE_MS); continue; }
      throw new Error(`Kakava request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.status === 403) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error('Kakava refused the request (HTTP 403). Stopped so the import does not get blocked.');
    }
    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel().catch(() => undefined);
      if (attempt === 1) { await pause(retryAfter(response)); continue; }
      throw new Error(`Kakava returned HTTP ${response.status} twice. Stopped; try again later.`);
    }
    if (!response.ok) throw new Error(`Kakava returned HTTP ${response.status}.`);
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > MAX_BYTES) throw new Error('Kakava listing is unexpectedly large.');
    const body = await response.text();
    if (body.length > MAX_BYTES) throw new Error('Kakava listing is unexpectedly large.');
    try { return JSON.parse(body); } catch { throw new Error('Kakava returned invalid JSON.'); }
  }
}

/** Upcoming music shows in Lithuania, sorted by start time. Exported for tests. */
export function normalizeKakava(value: unknown, now: number): KakavaEvent[] {
  return readListing(value, now).events;
}

/** The listing split into shows to import, cancelled music shows and every music show listed. Exported for tests. */
export function readKakavaListing(value: unknown, now: number): KakavaListing {
  return readListing(value, now);
}

function readListing(value: unknown, now: number): KakavaListing {
  const body = record(value);
  if (!Array.isArray(body.shows)) throw new Error('Invalid Kakava response.');
  const today = vilniusToday(now), events: KakavaEvent[] = [], seen = new Set<number>(), cancelled = new Set<number>(), listed = new Set<number>();
  for (const raw of body.shows) {
    const show = record(raw);
    const id = show.shortId, eventId = show.eventShortId, title = text(show.eventTitle, 2000), slug = text(show.eventTitleSlug, 500);
    if (!Number.isSafeInteger(id) || Number(id) < 1 || !Number.isSafeInteger(eventId) || Number(eventId) < 1 || !title || !slug || !/^[\w-]+$/.test(slug) || seen.has(Number(id))) continue;
    const categories = Array.isArray(show.eventCategories) ? show.eventCategories.map(category => record(category).id) : [];
    if (!categories.includes(MUSIC_CATEGORY)) continue;
    listed.add(Number(id));
    const statuses = Array.isArray(show.frontEndStatus) ? show.frontEndStatus : [];
    if (statuses.includes('CANCELED') || show.state === 'Canceled') cancelled.add(Number(id));
    if (show.showDate === false) continue;
    const start = typeof show.startDateTime === 'string' ? localTime.exec(show.startDateTime) : null;
    if (!start) continue;
    const end = typeof show.endDateTime === 'string' ? localTime.exec(show.endDateTime) : null;
    const endDay = end && end[1] >= start[1] ? end[1] : null;
    if (endDay && (Date.parse(`${endDay}T00:00:00Z`) - Date.parse(`${start[1]}T00:00:00Z`)) / 86_400_000 > MAX_SPAN_DAYS) continue;
    if ((endDay ?? start[1]) < today) continue;
    const status = Array.isArray(show.frontEndStatus) ? show.frontEndStatus.filter((item): item is string => typeof item === 'string').slice(0, 10) : [];
    if (status.some(item => skippedStatuses.has(item)) || show.state === 'Canceled') continue;
    const location = record(show.location), city = text(record(show.city).name, 191), venueAddress = text(show.venueAddress, 500);
    const country = venueAddress?.split(',').at(-1)?.trim();
    if (country && country !== 'Lietuva') continue;
    const cents = show.priceFromWithTaxes ?? show.priceFrom;
    const picture = text(record(show.eventPicture).desktopPictureUrl, 2048);
    seen.add(Number(id));
    events.push({
      id: Number(id), eventId: Number(eventId), title, slug,
      startTime: `${start[1]}T${start[2]}`, endTime: end && endDay ? `${end[1]}T${end[2]}` : null,
      venueName: text(location.name, 300), venueAddress, city,
      description: typeof show.eventDescription === 'string' ? show.eventDescription.slice(0, 100_000) : '',
      imageUrl: picture && picture.startsWith('https://') ? picture : null,
      priceFrom: Number.isSafeInteger(cents) && Number(cents) > 0 ? Number(cents) / 100 : null,
      status, promoter: text(record(show.promoter).brandName, 200) ?? text(record(show.promoter).name, 200),
      sourceUrl: `https://kakava.lt/renginys/${slug}/${Number(eventId)}`,
    });
  }
  return { events: events.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.id - b.id), cancelled, listed };
}

/** The Kakava listing. Reuses one fetched in the last ten minutes unless `fresh` is set. */
export async function fetchKakavaListing(options: Options): Promise<KakavaListing> {
  const now = options.now ?? Date.now;
  if (!options.fresh && cache && now() - cache.at < CACHE_MS) return cache.listing;
  // Concurrent callers (a preview while a job starts) share one request.
  inFlight ??= requestListing(options).then(value => {
    const listing = readListing(value, now());
    cache = { at: now(), listing };
    return listing;
  }).finally(() => { inFlight = null; });
  return inFlight;
}

/** All upcoming Kakava concerts. */
export async function fetchKakavaEvents(options: Options): Promise<KakavaEvent[]> {
  return (await fetchKakavaListing(options)).events;
}

export async function fetchKakavaPage(page: number, options: Options): Promise<KakavaPage> {
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new Error('Invalid Kakava page.');
  const events = await fetchKakavaEvents(options);
  return { data: events.slice((page - 1) * 20, page * 20), page, pageSize: 20, total: events.length };
}

/** For tests. */
export function clearKakavaCache() { cache = null; inFlight = null; }
