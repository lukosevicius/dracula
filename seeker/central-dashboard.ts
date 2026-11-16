import type { IncomingMessage, ServerResponse } from 'node:http';
import { suggestArtists } from './sources/event-details.js';
import type { createCentralApi } from './central-api.js';
import type { ArtistDecision, EventDetails, ReviewStatus } from './types.js';
import {createCentralJobs} from './central-jobs.js';

type CentralApi = ReturnType<typeof createCentralApi>;
const normalize=(value:string)=>value.normalize('NFKD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase('lt').replace(/[^\p{L}\p{N}]+/gu,' ').trim();

/** Dashboard adapter; unimplemented endpoints fail closed and never touch SQLite. */
export function createCentralDashboard(api:CentralApi, userAgent='Seeker/0.1.0') {
  const jobs=createCentralJobs(api,userAgent);
  return async (request:IncomingMessage,response:ServerResponse):Promise<boolean> => {
    const url=new URL(request.url || '/', 'http://localhost');
    if(!url.pathname.startsWith('/api/'))return false;
    const send=(status:number,body:unknown)=>{response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});response.end(JSON.stringify(body));};
    try {
      if(request.method==='GET' && url.pathname==='/api/dashboard'){send(200,await api.artistsDashboard());return true;}
      if(request.method==='GET' && url.pathname==='/api/jobs'){send(200,{jobs:await jobs.list()});return true;}
      if(request.method==='POST' && url.pathname==='/api/jobs'){
        if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')){send(415,{error:'Expected JSON.'});return true;}
        let size=0;const chunks:Buffer[]=[];for await(const chunk of request){const value=Buffer.from(chunk);size+=value.length;if(size>8192){send(413,{error:'Request too large.'});return true;}chunks.push(value);}
        let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{send(400,{error:'Invalid JSON.'});return true;}
        send(202,{id:await jobs.start(input)});return true;
      }
      if(request.method==='GET' && url.pathname==='/api/events') {send(200,await api.listEvents(url.searchParams));return true;}
      const image=/^\/api\/vilnius-images\/(\d{1,12})$/.exec(url.pathname);
      if(request.method==='GET' && image) {
        const value=await api.getImage(Number(image[1]));
        if(!value){send(404,{error:'Image not found.'});return true;}
        response.writeHead(200,{'content-type':value.type,'cache-control':'private, no-store','x-content-type-options':'nosniff'});response.end(value.bytes);return true;
      }
      const route=/^\/api\/events\/(\d{1,12})(?:\/(review|details|artist|price|matches|confirm-assistant-review))?$/.exec(url.pathname);
      if(route && Number(route[1])>0) {
        const id=Number(route[1]), action=route[2];
        if(request.method==='GET' && (!action || action==='details' || action==='matches')) {
          const result=await api.getEvent(id);
          if(!result){send(404,{error:'Event not found.'});return true;}
          if(!result.vilnius_event || !Array.isArray(result.available_artists) || !Array.isArray(result.match_candidates)){send(503,{error:'Central event details are not available.'});return true;}
          const event=result.vilnius_event;
          if(typeof event.title!=='string' || typeof event.content_html!=='string')throw new Error('Central event details are invalid.');
          const accepted=result.artist_decisions.filter(a=>a.decision==='accepted');
          const suggestions=suggestArtists({title:event.title,content_html:event.content_html},result.available_artists,new Set(result.artist_decisions.map(a=>a.artist_mbid)));
          const title=normalize(String(result.event.title || '')),venue=normalize(String(result.event.venue || ''));
          const matches=result.match_candidates.filter(candidate=>title && normalize(candidate.title)===title).map(candidate=>({...candidate,venue_matches:Boolean(venue && candidate.venue && normalize(candidate.venue)===venue)})).sort((a,b)=>Number(b.venue_matches)-Number(a.venue_matches));
          if(action==='matches')send(200,{matches});
          else send(200,{event:{...event,artist_links:accepted,artist_suggestions:suggestions},image:result.image || null,sources:result.sources,matches});
          return true;
        }
        if(request.method==='POST' && action && ['review','details','artist','price','confirm-assistant-review'].includes(action)) {
          if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')){send(415,{error:'Expected JSON.'});return true;}
          let size=0;const chunks:Buffer[]=[];
          for await(const chunk of request){const buffer=Buffer.from(chunk);size+=buffer.length;if(size>8192){send(413,{error:'Request too large.'});return true;}chunks.push(buffer);}
          let body:Record<string,unknown>;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{send(400,{error:'Invalid JSON.'});return true;}
          if(action==='review')await api.review(id,body.review_status as ReviewStatus);
          else if(action==='details')await api.details(id,body as unknown as EventDetails & {review_status:ReviewStatus});
          else if(action==='artist')await api.artist(id,body.mbid as string,body.decision as ArtistDecision);
          else if(action==='price')await api.price(id,body as {price_text:string|null;price_type:'free'|'paid'|'unknown'});
          else await api.confirmAssistantReview(id);
          send(200,{id});return true;
        }
      }
      send(503,{error:'This Seeker feature is not yet available with the central database.'});return true;
    } catch(error) {const status=Number((error as {status?:number}).status);send(status>=400&&status<500?status:502,{error:error instanceof Error?error.message:'Central API request failed.'});return true;}
  };
}
