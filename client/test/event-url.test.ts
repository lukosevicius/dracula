import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventIdFromSegment, eventPath, eventSlug, eventUrl, hiddenFromSearch } from '../src/utils/event-url';

test('event addresses use plain Lithuanian words and end with the id', () => {
  assert.equal(eventPath({ id: 423, title: 'Kariuomenės dienos minėjimas/koncertas su grupe DELČIA' }), '/renginiai/kariuomenes-dienos-minejimas-koncertas-su-grupe-delcia-423');
  assert.equal(eventUrl({ id: 7, title: 'ĄČĘĖĮŠŲŪŽ ąčęėįšųūž' }), 'https://dracula.lt/renginiai/aceeisuuz-aceeisuuz-7');
  assert.equal(eventSlug('Koncertas &#8211; <b>Vilnius</b> &amp; draugai'), 'koncertas-vilnius-draugai');
  assert.equal(eventPath({ id: 9, title: '★★★' }), '/renginiai/9');
});

test('long names are cut at a whole word', () => {
  const slug = eventSlug('Didysis kalėdinis koncertas su simfoniniu orkestru ir choru Vilniaus Kongresų rūmuose');
  assert.ok(slug.length <= 60, slug);
  assert.equal(slug, 'didysis-kaledinis-koncertas-su-simfoniniu-orkestru-ir-choru');
});

test('the id comes from the end of the address, whatever the words say', () => {
  assert.equal(eventIdFromSegment('festivalis-2026-423'), '423');
  assert.equal(eventIdFromSegment('423'), '423');
  assert.equal(eventIdFromSegment('senas-pavadinimas-423'), '423');
  assert.equal(eventIdFromSegment('be-numerio'), null);
  assert.equal(eventIdFromSegment('renginys-0'), null);
  assert.equal(eventIdFromSegment(undefined), null);
});

test('past events leave search results three days after their last day', () => {
  const event = { event_date: '2026-11-20', event_end_date: '2026-11-22', times: [] };
  assert.equal(hiddenFromSearch(event, '2026-11-25'), false);
  assert.equal(hiddenFromSearch(event, '2026-11-26'), true);
  assert.equal(hiddenFromSearch({ event_date: '2026-11-28', times: [{ date: '2026-12-30' }] }, '2027-01-02'), false);
  assert.equal(hiddenFromSearch({ event_date: '2026-12-30' }, '2027-01-03'), true);
  assert.equal(hiddenFromSearch({ event_date: null }, '2030-01-01'), false);
});
