import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { normalizeEventSearch } from '../database/event-search.js';

test('event title search ignores accents and case and decodes HTML entities', () => {
  assert.ok(normalizeEventSearch('Šviesos koncertas').startsWith(normalizeEventSearch('svieS')));
  assert.equal(normalizeEventSearch('Gruodis &#8211; RANDAI &amp; draugai'), 'gruodis – randai & draugai');
  assert.ok(!normalizeEventSearch('Šviesos koncertas').startsWith(normalizeEventSearch('koncertas')));
});
