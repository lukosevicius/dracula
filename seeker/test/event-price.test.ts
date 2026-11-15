import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { classifyPrice, extractEventPrice } from '../sources/event-details.js';

test('extracts the VN event sidebar price without reading unrelated cards', () => {
  const block=(text:string)=>`<div class="se-sidebar__section se-sidebar__price"><div class="se-price-line">${text}</div></div><!-- Upcoming dates -->`;
  assert.deepEqual(extractEventPrice(block('<span class="se-price-prefix">Nuo </span><span class="se-price-amount">36.20 €</span>')), {price_text:'Nuo 36.20 €',price_type:'paid'});
  assert.deepEqual(extractEventPrice(block('<span class="se-price-amount">Nemokamas</span>')), {price_text:'Nemokamas',price_type:'free'});
  assert.deepEqual(extractEventPrice('<div class="related"><div class="se-price-line">Nemokamas</div></div>'), {price_text:null,price_type:'unknown'});
  assert.equal(classifyPrice('Nemokama vaikams, 10 € suaugusiems'), 'unknown');
  assert.equal(classifyPrice('0–20 €'), 'unknown');
  assert.equal(classifyPrice('0 €'), 'free');
});
