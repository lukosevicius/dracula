import test from 'node:test';
import assert from 'node:assert/strict';
import { compareEvents, duplicateTitle } from '../dist/events/duplicates.js';
import { chooseSurvivor } from '../dist/events/merge.js';

const event = (id: number, title: string, venue: string | null, event_time: string | null = '20:00', extra: Record<string, unknown> = {}) =>
  ({ id, title, venue, event_time, event_date: '2026-12-03', city: 'Vilnius', ...extra });

test('comparable titles ignore case, entities, ticket status and a trailing city', () => {
  assert.equal(duplicateTitle('Collaborative Jazz Septet &#8211; Christmas'), duplicateTitle('Collaborative Jazz Septet – Christmas'));
  assert.equal(duplicateTitle('Neda / Labutis / Banys trio (sold out)'), duplicateTitle('Neda / Labutis / Banys trio'));
  assert.equal(duplicateTitle('Gala žvaigždės | Vilnius'), 'gala zvaigzdes');
  assert.equal(duplicateTitle("Candlelight: Vivaldi\\'s Four Seasons"), duplicateTitle("Candlelight: Vivaldi's Four Seasons"));
});

test('the same performance from two sources is a confident match', () => {
  assert.equal(compareEvents(event(1, 'ROSEYE', 'Jazz Cellar 11'), event(2, 'Roseye', 'Jazz Cellar 11')), 'confident');
  // A street address from one source never contradicts a venue name from the other.
  assert.equal(compareEvents(event(1, 'Jam session', 'Jazz Cellar 11'), event(2, 'Jam Session', 'Aušros Vartų 11, Vilnius, Lithuania')), 'confident');
  assert.equal(compareEvents(event(1, 'MKČ26 | „DŽIAZO DIALOGAI“', 'Šv. Kotrynos bažnyčia', '19:00'), event(2, 'MKČ26 | „DŽIAZO DIALOGAI“', 'Šv. Kotrynos bažnyčia. Renginių salė', '19:00')), 'confident');
  assert.equal(compareEvents(event(1, 'Pavel Arakelian trio', 'Jazz Cellar 11', null), event(2, 'Pavel Arakelian trio', 'Jazz Cellar 11', '20:00')), 'confident');
});

test('uncertain pairs need a person and different performances do not match', () => {
  assert.equal(compareEvents(event(1, 'Jam session', 'Jazz Cellar 11'), event(2, 'Jam session', 'Kablys')), 'likely');
  assert.equal(compareEvents(event(1, 'Collaborative Jazz Septet – Christmas', 'Jazz Cellar 11'), event(2, 'Collaborative Jazz Septet - X-mas Special', 'Jazz Cellar 11')), 'likely');
  assert.equal(compareEvents(event(1, "Candlelight: Vivaldi's Four Seasons | Vilnius", 'Vilnius Town Hall'), event(2, 'Candlelight: Tribute to Adele | Vilnius', 'Vilnius Town Hall')), null);
  assert.equal(compareEvents(event(1, 'ROSEYE', 'Jazz Cellar 11', '18:00'), event(2, 'ROSEYE', 'Jazz Cellar 11', '21:00')), null);
  assert.equal(compareEvents(event(1, 'SMASH sessions #episode 16', 'SMASH'), event(2, 'SMASH sessions #episode 17', 'SMASH')), null);
  assert.equal(compareEvents(event(1, 'ROSEYE', 'Jazz Cellar 11'), event(2, 'ROSEYE', 'Jazz Cellar 11', '20:00', { event_date: '2026-12-04' })), null);
  assert.equal(compareEvents(event(1, 'ROSEYE', 'Jazz Cellar 11'), event(2, 'ROSEYE', 'Jazz Cellar 11', '20:00', { city: 'Kaunas' })), null);
});

test('a merge keeps the live event, then the edited one, then the older one', () => {
  const row = (id: number, publication_status = 'draft', manual_fields = '[]') => ({ id, publication_status, manual_fields }) as never;
  assert.equal(chooseSurvivor(row(5), row(9, 'live'))[0].id, 9);
  assert.equal(chooseSurvivor(row(5), row(9, 'draft', '["venue"]'))[0].id, 9);
  assert.equal(chooseSurvivor(row(9), row(5))[0].id, 5);
});

test('a merge plan prefers venue names and known prices, and flags real disagreements', async () => {
  const { planMerge } = await import('../dist/events/merge.js');
  const row = (id: number, venue: string, title: string) => ({ id, title, venue, event_time: '20:00', event_end_date: null, city: 'Vilnius', ticket_url: null, review_status: 'music', manual_fields: '[]' }) as never;
  const price = (event_id: number, price_type: string, price_text: string | null) => ({ event_id, price_type, price_text, manual: 0 }) as never;
  const pair = { survivor: row(28, 'Jazz Cellar 11', 'Jam session'), removed: row(184, 'Aušros Vartų 11, Vilnius, Lithuania', 'Jam Session'), sources: [],
    keptPrice: price(28, 'paid', 'Nuo 10 €'), removedPrice: price(184, 'free', null) };
  const plan = planMerge(pair);
  const field = (name: string) => plan.fields.find((entry: { field: string }) => entry.field === name)!;
  assert.deepEqual([field('venue').choice, field('venue').conflict], [28, false]);
  assert.deepEqual([field('title').choice, field('title').conflict], [28, false]);
  assert.deepEqual([field('price').kept, field('price').other, field('price').choice, field('price').conflict], ['Nuo 10 €', 'Free', 28, true]);
  assert.equal(plan.conflicts, true);
  assert.equal(planMerge(pair, { price: 184 }).fields.find((entry: { field: string }) => entry.field === 'price')!.choice, 184);
  assert.throws(() => planMerge(pair, { price: 999 }), { status: 400 });
  // The address listing survives when it is Live, but the venue name still wins by default.
  const swapped = planMerge({ ...pair, survivor: pair.removed, removed: pair.survivor, keptPrice: price(184, 'unknown', null), removedPrice: pair.keptPrice });
  const venue = swapped.fields.find((entry: { field: string }) => entry.field === 'venue')!;
  const known = swapped.fields.find((entry: { field: string }) => entry.field === 'price')!;
  assert.deepEqual([venue.choice, known.choice, swapped.conflicts], [28, 28, false]);
});
