import test from 'node:test';
import assert from 'node:assert/strict';
import { runCentralVilniusImport } from '../sources/central-vilnius-events.js';

test('central importer overlaps pages without advancing cursor and stops on stale updates',async()=>{
  const fetched:number[]=[]; const saved:{expected_offset:number;next_offset:number;advance_cursor:boolean}[]=[];
  const run=runCentralVilniusImport({pages:2,currentOffset:3},async page=>{
    fetched.push(page); return {data:[{id:page,title:{rendered:`Event ${page}`},link:`https://vilnius-events.lt/${page}`}],pages:10};
  },async page=>{saved.push(page);if(page.expected_offset===4)throw new Error('cursor changed');return {added:1,updated:0};});
  await assert.rejects(run,/cursor changed/);
  assert.deepEqual(fetched,[1,3,4,5]);
  assert.deepEqual(saved.map(x=>[x.expected_offset,x.next_offset,x.advance_cursor]),[[3,1,false],[3,3,false],[3,4,true],[4,5,true]]);
});

test('sample imports a single smaller page without moving the cursor',async()=>{
  const result=await runCentralVilniusImport({pages:4,currentOffset:7,sample:true},async(page,size)=>{
    assert.equal(page,1);assert.equal(size,10);return {data:[],pages:3};
  },async page=>{assert.equal(page.advance_cursor,false);assert.equal(page.expected_offset,7);return {added:0,updated:0};});
  assert.deepEqual(result,{fetched:0,added:0,updated:0});
});
