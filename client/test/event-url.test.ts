import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventIdFromSegment, eventPath, eventSlug, eventUrl } from '../src/utils/event-url';

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
