import test from 'node:test';import assert from 'node:assert/strict';
import type {createCentralApi} from '../central-api.js';import {runCentralAi} from '../database/central-ai-evaluation.js';
test('central AI refuses a request that may exceed the budget',async()=>{
  let calls=0;
  const api={aiArtists:async()=>[],aiEvent:async()=>({title:'Test',content_html:'Test'}),aiSave:async()=>{throw Error('Should not save');}} as unknown as ReturnType<typeof createCentralApi>;
  const request=async()=>{calls++;return new Response(JSON.stringify({totalTokens:1000}));};
  await assert.rejects(runCentralAi(api,{id:1,owner:'a'.repeat(64)},[1],['gemini-3.5-flash-lite'],0.00001,'fake-key',()=>{},request as typeof fetch),/Budget reached/);assert.equal(calls,1);
});
test('central AI saves a validated result without changing event reviews',async()=>{
  const saved:Record<string,unknown>[]=[];
  const api={aiArtists:async()=>[],aiEvent:async()=>({title:'Test',content_html:'Concert'}),aiSave:async(value:Record<string,unknown>)=>{saved.push(value);}} as unknown as ReturnType<typeof createCentralApi>;
  let calls=0;const request=async()=>++calls===1?new Response(JSON.stringify({totalTokens:10})):new Response(JSON.stringify({usageMetadata:{promptTokenCount:10,totalTokenCount:20},candidates:[{content:{parts:[{text:JSON.stringify({classification:'music',explanation:'Concert',performers:[]})}]}}]}));
  const result=await runCentralAi(api,{id:1,owner:'a'.repeat(64)},[1],['gemini-3.5-flash-lite'],1,'fake-key',()=>{},request as typeof fetch);assert.equal(result.fetched,1);assert.equal(saved[0].classification,'music');assert.equal(saved[0].status,'completed');
});
test('central AI stops when provider usage is unknown and never retries generation',async()=>{
  const saved:Record<string,unknown>[]=[];let calls=0;
  const api={aiArtists:async()=>[],aiEvent:async()=>({title:'Test',content_html:'Concert'}),aiSave:async(value:Record<string,unknown>)=>{saved.push(value);}} as unknown as ReturnType<typeof createCentralApi>;
  const request=async()=>++calls===1?new Response(JSON.stringify({totalTokens:10})):new Response(JSON.stringify({candidates:[]}));
  await assert.rejects(runCentralAi(api,{id:1,owner:'a'.repeat(64)},[1,2],['gemini-3.5-flash-lite'],1,'fake-key',()=>{},request as typeof fetch),/may have incurred charges/);
  assert.equal(calls,2);assert.equal(saved.length,1);assert.equal(saved[0].status,'failed');
});
