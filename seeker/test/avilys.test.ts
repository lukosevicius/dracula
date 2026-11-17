import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAvilysPage } from '../sources/avilys.js';

test('requests Vilnius music and preserves source timestamps',async()=>{
 let seen='';
 const request=(async (input:RequestInfo|URL)=>{seen=String(input);return Response.json({page:2,pageSize:20,total:21,data:[{id:7,title:'Show',startTime:'2026-11-17T19:00:00Z',categories:[{id:1,name:'Music'}]}]});}) as typeof fetch;
 const result=await fetchAvilysPage(2,request);const url=new URL(seen);
 assert.equal(url.searchParams.get('page'),'2');assert.equal(url.searchParams.get('location'),'Vilnius');assert.equal(url.searchParams.get('categories'),'1');assert.equal(result.data[0].startTime,'2026-11-17T19:00:00Z');
});
test('rejects invalid pages and source responses',async()=>{
 await assert.rejects(()=>fetchAvilysPage(0));
 const request=(async()=>Response.json({page:1,pageSize:20,total:1,data:[{id:0,title:'Show',categories:[]}]})) as typeof fetch;
 await assert.rejects(()=>fetchAvilysPage(1,request),/Invalid Avilys event/);
});
