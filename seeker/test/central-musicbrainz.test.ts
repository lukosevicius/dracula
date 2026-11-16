import test from 'node:test';import assert from 'node:assert/strict';
import type {createCentralApi} from '../central-api.js';import {runCentralMusicBrainz} from '../sources/central-musicbrainz.js';
test('central MusicBrainz imports Lithuanian artists and advances by source page',async()=>{
  const pages:Record<string,unknown>[]=[];
  const api={artistsDashboard:async()=>({sourceState:{next_offset:10,total_available:null}}),reserveMusicBrainz:async()=>0,importMusicBrainzPage:async(page:Record<string,unknown>)=>{pages.push(page);return {added:1,updated:0};}} as unknown as ReturnType<typeof createCentralApi>;
  const request=async(url:RequestInfo|URL)=>{assert.equal(new URL(String(url)).searchParams.get('offset'),'10');return new Response(JSON.stringify({artists:[{id:'f5e813d7-0f2e-499a-9d07-9c38d955837d',name:'Artist',country:'LT',aliases:[{name:'Alias'}]},{id:'x',name:'Other',country:'LV'}]}));};
  const result=await runCentralMusicBrainz(api,{id:1,owner:'a'.repeat(64)},'next',3,'Test/1',()=>{},request as typeof fetch,async()=>{});
  assert.equal(result.fetched,1);assert.equal(pages[0].expected_offset,10);assert.equal(pages[0].next_offset,0);assert.equal((pages[0].artists as unknown[]).length,1);
});
