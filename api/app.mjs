import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';

const types = { '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.webp':'image/webp', '.gif':'image/gif' };
const filters = new Set(['upcoming','today','tomorrow','weekend','custom','all','past','unknown']);
function validDate(value) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const date=new Date(`${value}T00:00:00Z`); return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0,10)===value; }
export function createApp(catalogue, imageDir, admin = null) {
  return createServer(async (req,res) => {
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('X-Content-Type-Options','nosniff');
    const json = (status, body) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(body)); };
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/v1/admin/')) {
        if (!admin) return json(404, {error:'Not found'});
        if (!admin.authorized(req.headers.authorization)) return json(401, {error:'Unauthorized'});
        const privateImage=/^\/v1\/admin\/images\/(\d{1,12})$/.exec(url.pathname);
        if (req.method==='GET' && privateImage) {
          const record=await admin.getImage(Number(privateImage[1]));
          if(!record || !/^\d+\.(jpg|png|webp|gif)$/.test(record.local_name)) return json(404,{error:'Not found'});
          const ext=record.local_name.slice(record.local_name.lastIndexOf('.'));
          if(record.mime_type!==types[ext]) return json(404,{error:'Not found'});
          const file=join(imageDir,record.local_name), info=await lstat(file).catch(()=>null);
          if(!info?.isFile()) return json(404,{error:'Not found'});
          res.writeHead(200,{'Content-Type':types[ext],'Content-Length':info.size,'Cache-Control':'private, no-store'});
          const stream=createReadStream(file); stream.on('error',()=>res.destroy()); stream.pipe(res); return;
        }
        if (req.method === 'GET' && url.pathname === '/v1/admin/events') {
          try { return json(200, await admin.listEvents(url.searchParams)); }
          catch (cause) { if (cause.status && cause.status < 500) return json(cause.status,{error:cause.message}); throw cause; }
        }
        const readRoute = /^\/v1\/admin\/events\/(\d{1,12})$/.exec(url.pathname);
        if (req.method === 'GET' && readRoute && Number(readRoute[1]) > 0) {
          try { return json(200, await admin.getEvent(Number(readRoute[1]))); }
          catch (cause) { if (cause.status && cause.status < 500) return json(cause.status,{error:cause.message}); throw cause; }
        }
        if (req.method !== 'POST') return json(405, {error:'Method not allowed'});
        const isImport=url.pathname==='/v1/admin/imports/vilnius-events/page';
        const route = /^\/v1\/admin\/events\/(\d{1,12})\/(review|details|artist|price|confirm-assistant-review)$/.exec(url.pathname);
        if (!isImport && (!route || !Number.isSafeInteger(Number(route[1])) || Number(route[1]) < 1)) return json(404, {error:'Not found'});
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return json(415, {error:'Expected JSON'});
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; if (size > (isImport ? 6*1024*1024 : 8192)) return json(413, {error:'Request too large'}); chunks.push(chunk); }
        let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json(400, {error:'Invalid JSON'}); }
        try { if(isImport) return json(200,{ok:true,...await admin.importVilniusPage(body)}); const method=route[2]==='confirm-assistant-review'?'confirmAssistantReview':route[2]; await admin[method](Number(route[1]), body); return json(200, {ok:true}); }
        catch (cause) { if (cause.status && cause.status < 500) return json(cause.status, {error:cause.message}); throw cause; }
      }
      if (req.method !== 'GET') return json(405, {error:'Method not allowed'});
      if (url.pathname === '/health') return json(200, {status:'ok'});
      if (url.pathname === '/v1/events') {
        if (url.searchParams.has('filter') || url.searchParams.has('offset')) {
          const filter=url.searchParams.get('filter') ?? 'upcoming', offset=url.searchParams.get('offset') ?? '0', limit=url.searchParams.get('limit') ?? '30';
          const from=url.searchParams.get('from') ?? '', to=url.searchParams.get('to') ?? '';
          if (!filters.has(filter) || !/^\d{1,8}$/.test(offset) || !/^\d{1,3}$/.test(limit) || Number(limit)<1 || Number(limit)>100 || (filter==='custom' && (!validDate(from) || (to && (!validDate(to) || to<from))))) return json(400,{error:'Invalid filter or pagination'});
          return json(200, await catalogue.page({offset:Number(offset),limit:Number(limit),filter,from,to}));
        }
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
