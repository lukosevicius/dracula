import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createCentralDashboard } from '../central-dashboard.js';
import type { createCentralApi } from '../central-api.js';

test('central dashboard reads and edits through the API, and rejects unfinished operations',async()=>{
  const calls:unknown[]=[];
  const api={
    listEvents:async(query:URLSearchParams)=>({events:[],total:0,query:query.get('when')}),
    getArtist: async (mbid: string) => mbid === 'missing' ? null : { artist: { mbid }, past: [], upcoming: [], undated: [] },
    getEvent:async()=>({event:{id:1,title:'My Band',venue:'Club'},vilnius_event:{title:'My Band',content_html:'My Band plays.'},available_artists:[{mbid:'a',name:'My Band'}],artist_decisions:[],match_candidates:[{id:2,title:'My Band',event_date:'2026-11-20',venue:'Club'}],sources:[{id:99,source_key:'vilnius-events',source_id:'42'}],price:{price_type:'paid',price_text:'15 €'},image:null}),
    getImage:async()=>({bytes:new Uint8Array([1,2]),type:'image/jpeg'}),
    review:async(id:number,value:string)=>calls.push([id,value]),
  } as unknown as ReturnType<typeof createCentralApi>;
  const handler=createCentralDashboard(api),server=createServer(async(req,res)=>{if(!await handler(req,res)){res.writeHead(404);res.end();}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address || typeof address==='string')throw Error('Missing test address');
  const url=`http://127.0.0.1:${address.port}`;
  try {
    const list=await fetch(`${url}/api/events?when=all`);assert.equal((await list.json()).query,'all');
    const mbid = '12345678-1234-1234-1234-123456789abc';
    const artist = await fetch(`${url}/api/artists/${mbid}`);
    assert.equal(artist.status, 200);
    assert.deepEqual(await artist.json(), { artist: { mbid }, past: [], upcoming: [], undated: [] });
    assert.equal((await fetch(`${url}/api/artists/missing`)).status, 404);
    const detail=await (await fetch(`${url}/api/events/1/details`)).json();assert.equal(detail.event.artist_suggestions[0].name,'My Band');assert.equal(detail.matches[0].venue_matches,true);assert.equal(detail.row.id,1);assert.equal(detail.row.source_id,'42');assert.equal(detail.row.price_text,'15 €');
    const image=await fetch(`${url}/api/vilnius-images/7`);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/jpeg');
    const update=await fetch(`${url}/api/events/1/review`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({review_status:'music'})});assert.equal(update.status,200);assert.deepEqual(calls,[[1,'music']]);
    assert.equal((await fetch(`${url}/api/jobs`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,400);
  } finally {await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
