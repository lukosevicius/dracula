import test from 'node:test';import assert from 'node:assert/strict';
import type {createCentralApi} from '../central-api.js';import {runCentralEnrichment} from '../sources/central-vilnius-enrich.js';
test('central detail refresh extracts event links and prices for API persistence',async()=>{
  let sent:Record<string,unknown>|undefined;
  const api={enrichmentCandidates:async()=>[{event_id:1,source_url:'https://www.vilnius-events.lt/renginiai/test',content_html:'description'}],reserveVilniusRequest:async()=>0,enrichEvent:async(_id:number,input:Record<string,unknown>)=>{sent=input;}} as unknown as ReturnType<typeof createCentralApi>;
  const html='<a class="se-btn--about" href="https://example.com/event">Event</a><div class="se-sidebar__price"><div class="se-price-line">Nemokama</div><!-- Upcoming dates -->';
  const result=await runCentralEnrichment(api,'details-event',1,'Test/1',()=>{},async()=>new Response(html));
  assert.equal(sent?.about_url,'https://example.com/event');assert.equal(sent?.price_type,'free');assert.equal(result.fetched,1);
});

test('the scheduled upcoming refresh reports listings that redirect to the home page and ignores moved ones',async()=>{
  const listings=[1,2,3,4].map(id=>({event_id:id,source_id:String(100+id),source_url:`https://www.vilnius-events.lt/renginiai/e${id}/`,content_html:'description'}));
  const gone:unknown[]=[];
  const api={enrichmentCandidates:async(_mode:string,after:number)=>listings.filter(item=>item.event_id>after),reserveVilniusRequest:async()=>0,enrichEvent:async()=>undefined,
    seekerWrite:async(path:string,body:Record<string,unknown>)=>{gone.push([path,body]);return {ok:true,outcome:'unpublished'};}} as unknown as ReturnType<typeof createCentralApi>;
  const request=async(url:URL|string)=>{
    const path=new URL(String(url)).pathname;
    if(path.includes('e1'))return new Response(null,{status:302,headers:{location:'https://www.vilnius-events.lt'}});
    if(path.includes('e2'))return new Response(null,{status:301,headers:{location:'https://www.vilnius-events.lt/renginiai/e2-new/'}});
    return new Response('<html></html>');
  };
  const result=await runCentralEnrichment(api,'refresh-upcoming-details',undefined,'Test/1',()=>{},request as typeof fetch,async()=>{});
  assert.deepEqual(gone,[['/events/1/listing-gone',{source_key:'vilnius-events',source_id:'101'}]]);
  assert.equal((result as {unpublished?:number}).unpublished,1);
});

test('a burst of removed listings stops the run without removing anything',async()=>{
  const listings=[1,2,3,4,5].map(id=>({event_id:id,source_id:String(id),source_url:`https://www.vilnius-events.lt/renginiai/e${id}/`,content_html:'description'}));
  let writes=0;
  const api={enrichmentCandidates:async(_mode:string,after:number)=>listings.filter(item=>item.event_id>after),reserveVilniusRequest:async()=>0,enrichEvent:async()=>undefined,
    seekerWrite:async()=>{writes++;return {ok:true};}} as unknown as ReturnType<typeof createCentralApi>;
  const request=async()=>new Response(null,{status:302,headers:{location:'/'}});
  await assert.rejects(runCentralEnrichment(api,'refresh-upcoming-details',undefined,'Test/1',()=>{},request as typeof fetch,async()=>{}),/Nothing was removed/);
  assert.equal(writes,0);
});
