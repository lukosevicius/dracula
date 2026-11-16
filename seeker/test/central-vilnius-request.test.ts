import test from 'node:test';
import assert from 'node:assert/strict';
import {createCentralVilniusRequest} from '../sources/central-vilnius-request.js';

test('source requests reserve a shared slot and honor retry-after',async()=>{
  const waits:number[]=[], slots=[100,0,0];let requests=0;
  const fetcher=async(input:RequestInfo|URL)=>{
    assert.equal(new URL(String(input)).searchParams.get('per_page'),'10');
    return ++requests===1 ? new Response('',{status:429,headers:{'retry-after':'6'}}) : new Response(JSON.stringify([{id:1}]),{headers:{'x-wp-totalpages':'4'}});
  };
  const page=createCentralVilniusRequest(async()=>slots.shift() ?? 0,'Test/1',fetcher as typeof fetch,async ms=>{waits.push(ms);});
  assert.deepEqual(await page(2,10),{data:[{id:1}],pages:4});assert.deepEqual(waits,[100,6000]);
});

test('source invalid page means end of catalogue',async()=>{
  const page=createCentralVilniusRequest(async()=>0,'Test/1',async()=>new Response(JSON.stringify({code:'rest_post_invalid_page_number'}),{status:400}));
  assert.deepEqual(await page(100,50),{data:[],pages:null});
});
