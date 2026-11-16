import test from 'node:test';import assert from 'node:assert/strict';
import type {createCentralApi} from '../central-api.js';import {runCentralEnrichment} from '../sources/central-vilnius-enrich.js';
test('central detail refresh extracts event links and prices for API persistence',async()=>{
  let sent:Record<string,unknown>|undefined;
  const api={enrichmentCandidates:async()=>[{event_id:1,source_url:'https://www.vilnius-events.lt/renginiai/test',content_html:'description'}],reserveVilniusRequest:async()=>0,enrichEvent:async(_id:number,input:Record<string,unknown>)=>{sent=input;}} as unknown as ReturnType<typeof createCentralApi>;
  const html='<a class="se-btn--about" href="https://example.com/event">Event</a><div class="se-sidebar__price"><div class="se-price-line">Nemokama</div><!-- Upcoming dates -->';
  const result=await runCentralEnrichment(api,'details-event',1,'Test/1',()=>{},async()=>new Response(html));
  assert.equal(sent?.about_url,'https://example.com/event');assert.equal(sent?.price_type,'free');assert.equal(result.fetched,1);
});
