import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createCentralApi } from '../central-api.js';

test('central API client sends server-side credentials and does not retry failed writes', async () => {
  const token='0123456789abcdef0123456789abcdef';
  const requests:{path:string;authorization:string;body:string}[]=[];
  const server=createServer(async(req,res)=>{
    let body=''; for await (const part of req) body+=part;
    requests.push({path:req.url!,authorization:req.headers.authorization || '',body});
    if(req.url==='/v1/admin/imports/vilnius-events/page') {res.writeHead(200,{'content-type':'application/json'}).end('{"ok":true,"added":1,"updated":0}');return;}
    if(req.method==='GET' && req.url?.startsWith('/v1/admin/events?')) {res.writeHead(200,{'content-type':'application/json'}).end('{"events":[],"total":0,"counts":{},"sources":[],"runs":[]}');return;}
    if(req.method==='GET') {res.writeHead(200,{'content-type':'application/json'}).end('{"event":{"id":12,"review_status":"unsure"},"sources":[],"price":null,"artist_decisions":[]}');return;}
    if(req.url?.includes('/artist')) {res.writeHead(503).end();return;}
    res.writeHead(200,{'content-type':'application/json'}).end('{"ok":true}');
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const port=(server.address() as {port:number}).port;
    const api=createCentralApi(`http://127.0.0.1:${port}`,token);
    await api.review(12,'music');
    assert.equal(requests[0].path,'/v1/admin/events/12/review');
    assert.equal(requests[0].authorization,`Bearer ${token}`);
    assert.deepEqual(JSON.parse(requests[0].body),{review_status:'music'});
    assert.equal((await api.getEvent(12))?.event.review_status,'unsure');
    assert.equal((await api.listEvents(new URLSearchParams({when:'all'}))).total,0);
    assert.deepEqual(await api.importVilniusPage({items:[],advance_cursor:false,expected_offset:0,next_offset:0,total_available:null}),{added:1,updated:0});
    await assert.rejects(api.artist(12,'artist','accepted'), /HTTP 503; the update outcome is unknown/);
    assert.equal(requests.length,5);
    await assert.rejects(api.review(-1,'music'), /Invalid event ID/);
    assert.equal(requests.length,5);
    assert.throws(()=>createCentralApi('http://example.com',token),/requires HTTPS/);
    assert.throws(()=>createCentralApi('https://example.com','weak'),/32 URL-safe/);
  } finally { await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())); }
});
