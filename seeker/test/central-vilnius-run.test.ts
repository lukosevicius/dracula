import test from 'node:test';
import assert from 'node:assert/strict';
import type {createCentralApi, VilniusImportPage} from '../central-api.js';
import {runCentralVilnius} from '../sources/central-vilnius-run.js';

test('central source runner reads the cursor and commits pages through the API',async()=>{
  const pages:number[]=[],saved:VilniusImportPage[]=[];
  const api={listEvents:async()=>({nextPage:3}),importVilniusPage:async(page:VilniusImportPage)=>{saved.push(page);return {added:1,updated:0};}} as unknown as ReturnType<typeof createCentralApi>;
  const result=await runCentralVilnius(api,{pages:1},'Test/1',()=>{},async(page)=>{pages.push(page);return {data:[{id:page,title:{rendered:`Event ${page}`},link:`https://www.vilnius-events.lt/${page}`}],pages:5};});
  assert.deepEqual(pages,[1,2,3]);assert.deepEqual(saved.map(page=>page.advance_cursor),[false,false,true]);assert.equal(saved[2].expected_offset,2);assert.equal(saved[2].next_offset,3);assert.equal(result.added,3);
});
