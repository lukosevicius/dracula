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
    await assert.rejects(api.artist(12,'artist','accepted'), /HTTP 503; the update outcome is unknown/);
    assert.equal(requests.length,2);
    await assert.rejects(api.review(-1,'music'), /Invalid event ID/);
    assert.equal(requests.length,2);
    assert.throws(()=>createCentralApi('http://example.com',token),/requires HTTPS/);
    assert.throws(()=>createCentralApi('https://example.com','weak'),/32 URL-safe/);
  } finally { await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())); }
});
