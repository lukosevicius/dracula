import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { matchesEventSearch, normalizeEventSearch } from '../dist/admin/event-search.js';

test('event search finds text anywhere in the title, ignoring HTML, accents and case', () => {
  const title = 'MKČ26 | &quot;VIVA ITALIA!&quot; | Alessandra Ammara';
  for (const query of ['MKČ26', 'VIVA ITALIA', 'viva italia', 'ammara', 'mkc26']) assert.ok(matchesEventSearch(title, normalizeEventSearch(query)), query);
  assert.equal(matchesEventSearch(title, normalizeEventSearch('roma')), false);
});
