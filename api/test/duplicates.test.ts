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
