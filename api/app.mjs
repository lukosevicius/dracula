import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';

const types = { '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.webp':'image/webp', '.gif':'image/gif' };
export function createApp(catalogue, imageDir) {
  return createServer(async (req,res) => {
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('X-Content-Type-Options','nosniff');
    const json = (status, body) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(body)); };
    if (req.method !== 'GET') return json(405, {error:'Method not allowed'});
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/health') return json(200, {status:'ok'});
      if (url.pathname === '/v1/events') {
        const after = url.searchParams.get('after') ?? '0';
        const limit = url.searchParams.get('limit') ?? '30';
        if (!/^\d{1,12}$/.test(after) || !/^\d{1,3}$/.test(limit) || Number(limit)<1 || Number(limit)>100) return json(400,{error:'Invalid pagination'});
        return json(200, await catalogue.list(Number(after),Number(limit)));
      }
      const event = /^\/v1\/events\/(\d{1,12})$/.exec(url.pathname);
      if (event) { const result = await catalogue.get(Number(event[1])); return result ? json(200,result) : json(404,{error:'Not found'}); }
      const image = /^\/v1\/images\/([A-Za-z0-9._-]+)$/.exec(url.pathname);
      if (image && image[1] !== '.' && image[1] !== '..') {
        const name=image[1]; const ext=name.slice(name.lastIndexOf('.')).toLowerCase();
        if (!types[ext] || !await catalogue.hasImage(name)) return json(404,{error:'Not found'});
        const file=join(imageDir,name); const info=await lstat(file).catch(() => null);
        if (!info?.isFile()) return json(404,{error:'Not found'});
        res.writeHead(200,{'Content-Type':types[ext],'Content-Length':info.size,'Cache-Control':'public, max-age=3600'});
        const stream=createReadStream(file); stream.on('error',()=>res.destroy()); stream.pipe(res); return;
      }
      return json(404,{error:'Not found'});
    } catch (error) { console.error('Request failed:',error); return json(500,{error:'Service unavailable'}); }
  });
}
