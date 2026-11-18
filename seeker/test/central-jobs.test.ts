import test from 'node:test';
import assert from 'node:assert/strict';
import type {createCentralApi} from '../central-api.js';
import {createCentralJobs} from '../central-jobs.js';
import type {runCentralVilnius} from '../sources/central-vilnius-run.js';

test('central job commits work with its lease and records progress',async()=>{
  const updates:string[]=[],owner='a'.repeat(64);let savedOwner='';
  const api={startJob:async()=>({id:5,owner}),updateJob:async(_id:number,_owner:string,status:string)=>{updates.push(status);},importVilniusPage:async(page:{job:{owner:string}})=>{savedOwner=page.job.owner;return {added:1,updated:0};}} as unknown as ReturnType<typeof createCentralApi>;
  const run=async(jobApi:typeof api,_options:unknown,_agent:string,progress:(v:{fetched:number;added:number;updated:number})=>void)=>{await jobApi.importVilniusPage({items:[],advance_cursor:false,expected_offset:0,next_offset:0,total_available:null});const result={fetched:1,added:1,updated:0};progress(result);return result;};
  const jobs=createCentralJobs(api,'Test/1',run as typeof runCentralVilnius);
  assert.equal(await jobs.start({source:'vilnius-events',action:'sample'}),5);
  for(let i=0;i<30&&!updates.includes('completed');i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(savedOwner,owner);assert.deepEqual(updates,['running','completed']);
  await assert.rejects(jobs.start({source:'musicbrainz',action:'sample'}),/not available/);
});

test('Avilys job respects the requested starting page and limit',async()=>{
  const original=globalThis.fetch,owner='a'.repeat(64),updates:string[]=[];let page='',saved=0;
  globalThis.fetch=(async input=>{page=new URL(String(input)).searchParams.get('page')||'';return Response.json({page:3,pageSize:20,total:60,data:[{id:1,title:'Concert',city:'Vilnius',categories:[{id:1,name:'Music'}]},{id:2,title:'Another',city:'Vilnius',categories:[{id:1,name:'Music'}]}]});}) as typeof fetch;
  const api={startJob:async()=>({id:5,owner}),updateJob:async(_id:number,_owner:string,status:string)=>{updates.push(status);},importAvilysPage:async(items:unknown[],job:{owner:string})=>{assert.equal(job.owner,owner);saved=items.length;return {added:saved,updated:0};}} as unknown as ReturnType<typeof createCentralApi>;
  try{const jobs=createCentralJobs(api,'Test/1');await jobs.start({source:'avilys',action:'import',limit:1,start_page:3});for(let i=0;i<30&&!updates.includes('completed');i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(page,'3');assert.equal(saved,1);assert.deepEqual(updates,['running','completed']);}finally{globalThis.fetch=original;}
});
