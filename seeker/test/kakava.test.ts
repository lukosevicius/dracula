import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearKakavaCache, fetchKakavaEvents, fetchKakavaPage, normalizeKakava, KAKAVA_LIST_URL } from '../sources/kakava.js';

const now = Date.parse('2026-11-28T10:00:00Z');
const show = (overrides: Record<string, unknown> = {}) => ({
  shortId: 1, eventShortId: 10, eventTitle: 'Koncertas', eventTitleSlug: 'koncertas', eventCategories: [{ id: 1 }], showDate: true,
  startDateTime: '2026-12-05T19:00:00.0000000', endDateTime: '2026-12-05T21:00:00.0000000', state: 'Selling', frontEndStatus: ['SELLING'],
  location: { name: 'Kablys' }, city: { name: 'Vilnius' }, venueAddress: 'Kauno g. 5, Vilnius, Lietuva', eventDescription: '<p>Gyvai</p>',
  eventPicture: { desktopPictureUrl: 'https://res.cloudinary.com/kakavalt/image/fetch/a' }, priceFrom: 2660, priceFromWithTaxes: 2660,
  promoter: { brandName: 'Promo', email: 'private@example.com', phone: '+370' }, ...overrides,
});
const listing = (shows: unknown[]) => ({ shows, hasNextPage: false, resultStatus: 'OK' });
const noPause = async () => {};
beforeEach(() => clearKakavaCache());

test('keeps upcoming Lithuanian concerts and drops everything else', () => {
  const events = normalizeKakava(listing([
    show(),
    show({ shortId: 2, eventCategories: [{ id: 2 }] }), // theatre
    show({ shortId: 3, startDateTime: '2026-11-20T19:00:00.0000000', endDateTime: '2026-11-20T21:00:00.0000000' }), // past
    show({ shortId: 4, frontEndStatus: ['CANCELED'] }),
    show({ shortId: 5, venueAddress: 'Skanstes iela 21, Rīga, Latvija' }),
    show({ shortId: 6, showDate: false }), // voucher without a date
    show({ shortId: 7, startDateTime: '2026-09-24T18:30:00.0000000', endDateTime: '2026-12-11T20:00:00.0000000' }), // season ticket
    show({ shortId: 8, startDateTime: '2027-05-20T18:00:00.0000000', endDateTime: '2027-05-23T21:00:00.0000000' }), // festival
    show({ shortId: 9, startDateTime: '2026-11-28T09:00:00.0000000', endDateTime: '2026-11-28T11:00:00.0000000' }), // today
    show({ shortId: 1 }), // duplicate
  ]), now);
  assert.deepEqual(events.map(event => event.id), [9, 1, 8]);
  const [, first] = events;
  assert.deepEqual({ ...first, description: undefined }, {
    id: 1, eventId: 10, title: 'Koncertas', slug: 'koncertas', startTime: '2026-12-05T19:00', endTime: '2026-12-05T21:00', venueName: 'Kablys',
    venueAddress: 'Kauno g. 5, Vilnius, Lietuva', city: 'Vilnius', description: undefined, imageUrl: 'https://res.cloudinary.com/kakavalt/image/fetch/a',
    priceFrom: 26.6, status: ['SELLING'], promoter: 'Promo', sourceUrl: 'https://kakava.lt/renginys/koncertas/10',
  });
  assert.ok(!JSON.stringify(events).includes('private@example.com'), 'promoter contact details are not kept');
});

test('fetches once with an honest user agent and serves later calls from the cache', async () => {
  const seen: { url: string; headers: Headers }[] = [];
  const request = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), headers: new Headers(init?.headers) });
    return Response.json(listing(Array.from({ length: 25 }, (_, index) => show({ shortId: index + 1 }))));
  }) as typeof fetch;
  const page = await fetchKakavaPage(2, { userAgent: 'Seeker/test', request, now: () => now });
  assert.equal(page.total, 25); assert.equal(page.data.length, 5);
  await fetchKakavaEvents({ userAgent: 'Seeker/test', request, now: () => now + 5 * 60_000 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, KAKAVA_LIST_URL);
  assert.equal(seen[0].headers.get('user-agent'), 'Seeker/test');
  assert.equal(seen[0].headers.get('accept-language'), 'lt');
  await fetchKakavaEvents({ userAgent: 'Seeker/test', request, now: () => now + 11 * 60_000 });
  assert.equal(seen.length, 2, 'the cache expires after ten minutes');
});

test('stops at once when refused and retries a rate limit only once', async () => {
  let calls = 0;
  const refused = (async () => { calls++; return new Response('no', { status: 403 }); }) as typeof fetch;
  await assert.rejects(fetchKakavaEvents({ userAgent: 'x', request: refused, pause: noPause }), /HTTP 403/);
  assert.equal(calls, 1);

  calls = 0; const waits: number[] = [];
  const limited = (async () => { calls++; return new Response('slow down', { status: 429, headers: { 'retry-after': '120' } }); }) as typeof fetch;
  await assert.rejects(fetchKakavaEvents({ userAgent: 'x', request: limited, pause: async ms => { waits.push(ms); } }), /HTTP 429 twice/);
  assert.equal(calls, 2); assert.deepEqual(waits, [120_000]);

  calls = 0;
  const flaky = (async () => { calls++; return calls === 1 ? new Response('', { status: 503 }) : Response.json(listing([show()])); }) as typeof fetch;
  assert.equal((await fetchKakavaEvents({ userAgent: 'x', request: flaky, pause: noPause, now: () => now })).length, 1);
  assert.equal(calls, 2);
});

test('rejects a response that is not a Kakava listing', async () => {
  const request = (async () => Response.json({ items: [] })) as typeof fetch;
  await assert.rejects(fetchKakavaEvents({ userAgent: 'x', request }), /Invalid Kakava response/);
  await assert.rejects(fetchKakavaPage(0, { userAgent: 'x', request }), /Invalid Kakava page/);
});
