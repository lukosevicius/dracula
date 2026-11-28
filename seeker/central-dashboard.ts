import type { IncomingMessage, ServerResponse } from 'node:http';
import { suggestArtists } from './sources/event-details.js';
import type { createCentralApi } from './central-api.js';
import type { ArtistDecision, EventDetails, ReviewStatus } from './types.js';
import {createCentralJobs} from './central-jobs.js';
import {fetchAvilysPage} from './sources/avilys.js';
import {fetchKakavaPage} from './sources/kakava.js';

type CentralApi = ReturnType<typeof createCentralApi>;
const normalize=(value:string)=>value.normalize('NFKD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase('lt').replace(/[^\p{L}\p{N}]+/gu,' ').trim();

/** Dashboard adapter; unimplemented endpoints fail closed and never touch SQLite. */
export function createCentralDashboard(api:CentralApi, userAgent='Seeker/0.1.0', { allowJobs = true } = {}) {
  const jobs=createCentralJobs(api,userAgent);
  return async (request:IncomingMessage,response:ServerResponse):Promise<boolean> => {
    const url=new URL(request.url || '/', 'http://localhost');
    if(!url.pathname.startsWith('/api/'))return false;
    const send=(status:number,body:unknown)=>{response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});response.end(JSON.stringify(body));};
    const readBody=async(max:number):Promise<Record<string,unknown>|null>=>{
      if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']||'')){send(415,{error:'Expected JSON.'});return null;}
      let size=0;const chunks:Buffer[]=[];for await(const chunk of request){const part=Buffer.from(chunk);size+=part.length;if(size>max){send(413,{error:'Request too large.'});return null;}chunks.push(part);}
      try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value)){send(400,{error:'Invalid JSON.'});return null;}return value;}catch{send(400,{error:'Invalid JSON.'});return null;}
    };
    try {
      const workflowPath = url.pathname.replace(/^\/api\/workflow(?=\/)/, '');
      const workflowRead = request.method === 'GET' && /^(?:\/providers|\/agents|\/attention-count|\/duplicates|\/verification\/(?:usage|rules(?:\/previews\/\d{1,15})?|jobs(?:\/\d{1,12})?)|\/events\/\d{1,12}\/verification|\/artists\/(?:review|unlinked)|\/scheduled-runs)$/.test(workflowPath);
      const workflowWrite = request.method === 'POST' && /^(?:\/providers|\/agents|\/duplicates\/(?:merge|merge-confident|dismiss|preview)|\/verification\/(?:jobs|rules(?:\/previews)?)|\/artists\/(?:extract|new|add-to-event)|\/events\/\d{1,12}\/(?:publication|remove-listing|findings\/\d{1,12}))$/.test(workflowPath);
      if (workflowRead) { send(200, await api.seekerRead(workflowPath + url.search)); return true; }
      if (workflowWrite) {
        const input = await readBody(32_768);
        if (!input) return true;
        send(200, await api.seekerWrite(workflowPath, input)); return true;
      }
      if(request.method==='GET'&&url.pathname==='/api/saved-events'){send(200,{events:await api.savedEvents()});return true;}
      if(request.method==='POST'&&url.pathname==='/api/saved-events'){
        const body=await readBody(8192);if(!body)return true;
        if(!Array.isArray(body.ids)||body.ids.length>500||!body.ids.every(id=>Number.isSafeInteger(id)&&Number(id)>0)){send(400,{error:'Invalid saved event IDs.'});return true;}
        await api.saveEvents(body.ids as number[]);send(200,{ok:true});return true;
      }
      if(request.method==='POST'&&url.pathname==='/api/saved-events/remove'){
        const body=await readBody(1024);if(!body)return true;
        if(!Number.isSafeInteger(body.id)||Number(body.id)<1){send(400,{error:'Invalid event ID.'});return true;}
        await api.removeSavedEvent(Number(body.id));send(200,{ok:true});return true;
      }
      if(request.method==='GET'&&url.pathname==='/api/seeker/settings'){send(200,{settings:await api.seekerSettings()});return true;}
      if(request.method==='POST'&&url.pathname==='/api/seeker/settings'){
        const body=await readBody(65536);if(!body)return true;
        if(typeof body.key!=='string'||! /^[a-z][a-z0-9._-]{0,190}$/.test(body.key)||!('value' in body)){send(400,{error:'Invalid Seeker setting.'});return true;}
        await api.saveSeekerSetting(body.key,body.value);send(200,{ok:true});return true;
      }
      if(request.method==='GET' && url.pathname==='/api/avilys/preview') {
        const raw=url.searchParams.get('page') || '1';
        if(!/^\d{1,5}$/.test(raw)||Number(raw)<1||Number(raw)>10000){send(400,{error:'Invalid Avilys page.'});return true;}
        send(200,await fetchAvilysPage(Number(raw)));return true;
      }
      if(request.method==='GET' && url.pathname==='/api/kakava/preview') {
        const raw=url.searchParams.get('page') || '1';
        if(!/^\d{1,5}$/.test(raw)||Number(raw)<1||Number(raw)>10000){send(400,{error:'Invalid Kakava page.'});return true;}
        // Served from the shared ten-minute cache, so paging through the preview does not call Kakava again.
        send(200,await fetchKakavaPage(Number(raw),{userAgent}));return true;
      }
      const sourceImage=/^\/api\/(avilys|kakava)-images\/(\d{1,12})$/.exec(url.pathname);
      if(request.method==='GET'&&sourceImage){const value=await api.getSourceImage(sourceImage[1] as 'avilys'|'kakava',Number(sourceImage[2]));if(!value){send(404,{error:'Image not found.'});return true;}response.writeHead(200,{'content-type':value.type,'cache-control':'private, no-store','x-content-type-options':'nosniff'});response.end(Buffer.from(value.bytes));return true;}
      if(request.method==='GET' && url.pathname==='/api/dashboard'){send(200,await api.artistsDashboard());return true;}
      const artistDetail = /^\/api\/artists\/([^/]+)$/.exec(url.pathname);
      if (request.method === 'GET' && artistDetail) {
        const detail = await api.getArtist(artistDetail[1]);
        if (detail) send(200, detail);
        else send(404, { error: 'Artist not found.' });
        return true;
      }
      if(request.method==='GET' && url.pathname==='/api/ai-evaluations/events'){send(200,{ids:await api.aiIds(Number(url.searchParams.get('limit')||1))});return true;}
      if(request.method==='GET' && url.pathname==='/api/ai-evaluations'){send(200,{results:await api.aiResults(),configured:!!process.env.GEMINI_API_KEY});return true;}
      if(request.method==='POST' && url.pathname==='/api/ai-evaluations/decision'){
        if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']||'')){send(415,{error:'Expected JSON.'});return true;}
        let size=0;const chunks:Buffer[]=[];for await(const chunk of request){const part=Buffer.from(chunk);size+=part.length;if(size>4096){send(413,{error:'Request too large.'});return true;}chunks.push(part);}
        let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{send(400,{error:'Invalid JSON.'});return true;}await api.aiDecision(input.id,input.decision);send(200,{ok:true});return true;
      }
      if(request.method==='GET' && url.pathname==='/api/jobs'){send(200,{jobs:await jobs.list()});return true;}
      if(request.method==='POST' && url.pathname==='/api/jobs'){
        if(!allowJobs){send(403,{error:'Start imports and background jobs from local Seeker.'});return true;}
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
      const route=/^\/api\/events\/(\d{1,12})(?:\/(review|details|artist|price|interest-score|matches|confirm-assistant-review))?$/.exec(url.pathname);
      if(route && Number(route[1])>0) {
        const id=Number(route[1]), action=route[2];
        if(request.method==='GET' && (!action || action==='details' || action==='matches')) {
          const result=await api.getEvent(id);
          if(!result){send(404,{error:'Event not found.'});return true;}
          if((!result.vilnius_event && !result.sources.length) || !Array.isArray(result.available_artists) || !Array.isArray(result.match_candidates)){send(503,{error:'Central event details are not available.'});return true;}
          const source=result.sources[0] || {};
          let sourceTimestamp:string|null=null;
          if(source.source_key==='avilys' && typeof source.source_data_json==='string'){try{const data=JSON.parse(source.source_data_json);if(typeof data.startTime==='string')sourceTimestamp=data.startTime;}catch{/* malformed source metadata stays unavailable */}}
          const event=result.vilnius_event || {...result.event,content_html:source.content_html,source_timestamp:sourceTimestamp};
          if(typeof event.title!=='string' || typeof event.content_html!=='string')throw new Error('Central event details are invalid.');
          const accepted=result.artist_decisions.filter(a=>a.decision==='accepted');
          const fromAi=result.artist_decisions.filter(a=>a.decision==='suggested').map(a=>({mbid:a.artist_mbid,name:a.name,reason:'AI' as const,excerpt:a.evidence||''}));
          const suggestions=[...fromAi,...suggestArtists({title:event.title,content_html:event.content_html},result.available_artists,new Set(result.artist_decisions.map(a=>a.artist_mbid)))];
          const title=normalize(String(result.event.title || '')),venue=normalize(String(result.event.venue || ''));
          const matches=result.match_candidates.filter(candidate=>{const other=normalize(candidate.title);if(!title||!other)return false;const a=new Set(title.split(' ').filter(v=>v.length>2)),b=new Set(other.split(' ').filter(v=>v.length>2));const shared=[...a].filter(v=>b.has(v)).length;return other===title || (shared>=2 && shared/Math.max(a.size,b.size)>=0.6);}).map(candidate=>({...candidate,venue_matches:Boolean(venue && candidate.venue && normalize(candidate.venue)===venue)})).sort((a,b)=>Number(b.venue_matches)-Number(a.venue_matches));
          if(action==='matches')send(200,{matches});
          else send(200,{event:{...event,artist_links:accepted,artist_suggestions:suggestions},row:{...source,...result.event,showtimes:Array.isArray(result.times)&&result.times.length?result.times.map((slot:{date:string;time:string|null})=>`${slot.date} ${slot.time??''}`).join(','):null,details_checked_at:source.last_checked_at,about_url:result.event.about_url_override??source.about_url,price_text:result.price?.price_text,price_type:result.price?.price_type},image:result.image || null,sources:result.sources,matches});
          return true;
        }
        if(request.method==='POST' && action && ['review','details','artist','price','interest-score','confirm-assistant-review'].includes(action)) {
          if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')){send(415,{error:'Expected JSON.'});return true;}
          let size=0;const chunks:Buffer[]=[];
          for await(const chunk of request){const buffer=Buffer.from(chunk);size+=buffer.length;if(size>8192){send(413,{error:'Request too large.'});return true;}chunks.push(buffer);}
          let body:Record<string,unknown>;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{send(400,{error:'Invalid JSON.'});return true;}
          if(action==='review')await api.review(id,body.review_status as ReviewStatus);
          else if(action==='details')await api.details(id,body as unknown as EventDetails & {review_status:ReviewStatus});
          else if(action==='artist')await api.artist(id,body.mbid as string,body.decision as ArtistDecision);
          else if(action==='price')await api.price(id,body as {price_text:string|null;price_type:'free'|'paid'|'unknown'});
          else if(action==='interest-score')await api.interestScore(id,body.interest_score as 1|2|3|4|5);
          else await api.confirmAssistantReview(id);
          send(200,{id});return true;
        }
      }
      send(503,{error:'This Seeker feature is not yet available with the central database.'});return true;
    } catch(error) {const status=Number((error as {status?:number}).status);send(status>=400&&status<500?status:502,{error:error instanceof Error?error.message:'Central API request failed.'});return true;}
  };
}
