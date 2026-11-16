import type { ArtistDecision, ArtistsDashboard, EventDetails, ReviewStatus } from './types.js';

type Price = { price_text: string | null; price_type: 'free' | 'paid' | 'unknown' };
type Details = EventDetails & { review_status: ReviewStatus };
export type CentralEvent = { event: Record<string, unknown>; sources: Record<string, unknown>[]; price: Record<string, unknown> | null; artist_decisions: {artist_mbid:string;decision:string;name:string}[]; vilnius_event?:Record<string,unknown> | null; available_artists?:{mbid:string;name:string}[]; image?:Record<string,unknown> | null; match_candidates?:{id:number;title:string;event_date:string;venue:string|null}[] };
export type CentralEventList = {events:Record<string,unknown>[];total:number;page:number;limit:number;counts:Record<string,number>;readyCount:number;nextPage:number;sources:Record<string,unknown>[];runs:Record<string,unknown>[]};
export type VilniusImportItem = {source_id:number;title:string;source_url:string;content_html:string;categories:number[];featured_media:number | null;published_at:string | null;modified_at:string | null;details:Partial<EventDetails>};
export type VilniusImportPage = {items:VilniusImportItem[];advance_cursor:boolean;expected_offset:number;next_offset:number;total_available:number | null;job?:{id:number;owner:string}};
export type CentralJob = {id:number;source:string;action:string;status:string;started_at:string;finished_at:string|null;progress_json:string;error_message:string|null};

/** Server-side client only. Do not pass the token to the dashboard or browser. */
export function createCentralApi(origin: string, token: string, timeoutMs = 15000) {
  const base = new URL(origin);
  if (base.username || base.password || base.pathname !== '/' || base.search || base.hash || !['http:', 'https:'].includes(base.protocol)) throw new Error('Central API URL must be an HTTP(S) origin.');
  if (base.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(base.hostname)) throw new Error('Central API requires HTTPS outside local development.');
  if (!/^[A-Za-z0-9._~-]{32,}$/.test(token)) throw new Error('Central API token must contain at least 32 URL-safe ASCII characters.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('Invalid central API timeout.');

  function validateId(id:number) {
    if (!Number.isSafeInteger(id) || id < 1 || id > 999999999999) throw new Error('Invalid event ID.');
  }
  async function post(path:string, payload:object):Promise<Record<string,unknown>> {
    let response: Response;
    try {
      response = await fetch(new URL(path, base), {
        method:'POST', headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
        body:JSON.stringify(payload), redirect:'error', signal:AbortSignal.timeout(timeoutMs)
      });
    } catch { throw new Error('Central API request failed; the update outcome is unknown. Check the event before retrying.'); }
    if (!response.ok) {
      const uncertain = response.status >= 500 || response.status === 408;
      const message = uncertain ? `Central API returned HTTP ${response.status}; the update outcome is unknown. Check the event before retrying.` : `Central API rejected the update (HTTP ${response.status}).`;
      throw Object.assign(new Error(message), { status:response.status });
    }
    const body = await response.json().catch(() => null) as Record<string,unknown> | null;
    if (!body || body.ok !== true) throw new Error('Central API returned an invalid response; check the event before retrying.');
    return body;
  }
  async function edit(id: number, action: 'review' | 'details' | 'artist' | 'price' | 'confirm-assistant-review', payload: object): Promise<void> {
    validateId(id);
    await post(`/v1/admin/events/${id}/${action}`,payload);
  }
  return {
    async enrichmentCandidates(mode:'missing'|'oldest'|'all'|'event',after:number,eventId?:number):Promise<{event_id:number;source_url:string;content_html:string}[]> {
      const params=new URLSearchParams({mode,after:String(after)});if(eventId!==undefined)params.set('eventId',String(eventId));
      let response:Response;try{response=await fetch(new URL(`/v1/admin/enrichment?${params}`,base),{headers:{authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(timeoutMs)});}catch{throw new Error('Central API request failed.');}
      if(!response.ok)throw new Error(`Central API read failed (HTTP ${response.status}).`);const body=await response.json();if(!Array.isArray(body.events))throw new Error('Central API returned invalid events.');return body.events;
    },
    async enrichEvent(id:number,input:{details:Partial<EventDetails>;about_url:string|null;price_text:string|null;price_type:'free'|'paid'|'unknown';expected_source_url:string;expected_content_html:string;job?:{id:number;owner:string}}):Promise<void>{validateId(id);await post(`/v1/admin/events/${id}/enrich`,input);},
    async listMedia(after:number):Promise<number[]>{
      if(!Number.isSafeInteger(after)||after<0)throw new Error('Invalid media cursor.');
      let response:Response;try{response=await fetch(new URL(`/v1/admin/media?after=${after}&limit=100`,base),{headers:{authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(timeoutMs)});}catch{throw new Error('Central API request failed.');}
      if(!response.ok)throw new Error(`Central API read failed (HTTP ${response.status}).`);const value=await response.json();if(!Array.isArray(value.ids)||!value.ids.every((id:unknown)=>Number.isSafeInteger(id)&&Number(id)>0))throw new Error('Central API returned invalid media.');return value.ids;
    },
    async artistsDashboard():Promise<ArtistsDashboard>{
      let response:Response;try{response=await fetch(new URL('/v1/admin/artists',base),{headers:{authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(timeoutMs)});}catch{throw new Error('Central API request failed.');}
      if(!response.ok)throw new Error(`Central API read failed (HTTP ${response.status}).`);const value=await response.json();if(!Array.isArray(value.artists)||!Array.isArray(value.recentRuns))throw new Error('Central API returned invalid artists.');return value;
    },
    async getImageInfo(id:number):Promise<{source_url:string;source_modified:string|null}|null> {
      validateId(id);let response:Response;
      try{response=await fetch(new URL(`/v1/admin/images/${id}/info`,base),{headers:{authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(timeoutMs)});}catch{throw new Error('Central API request failed.');}
      if(response.status===404)return null;if(!response.ok)throw new Error(`Central API read failed (HTTP ${response.status}).`);
      const value=await response.json();if(typeof value.source_url!=='string'||(value.source_modified!==null&&typeof value.source_modified!=='string'))throw new Error('Central API returned invalid image metadata.');return value;
    },
    async uploadImage(image:{media_id:number;source_url:string;mime_type:string;width:number|null;height:number|null;source_modified:string|null;data:string;job?:{id:number;owner:string}}):Promise<void> {
      await post('/v1/admin/images',image);
    },
    async listJobs():Promise<CentralJob[]> {
      let response:Response;
      try {response=await fetch(new URL('/v1/admin/jobs',base),{headers:{authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(timeoutMs)});}catch{throw new Error('Central API request failed.');}
      if(!response.ok)throw new Error(`Central API read failed (HTTP ${response.status}).`);
      const body=await response.json() as {jobs?:CentralJob[]};if(!Array.isArray(body.jobs))throw new Error('Central API returned invalid jobs.');return body.jobs;
    },
    async startJob(action:string):Promise<{id:number;owner:string}> {
      const body=await post('/v1/admin/jobs/start',{action});
      if(!Number.isSafeInteger(body.id)||typeof body.owner!=='string'||!/^[a-f0-9]{64}$/.test(body.owner))throw new Error('Central API returned an invalid job; check before retrying.');
      return {id:body.id as number,owner:body.owner};
    },
    async updateJob(id:number,owner:string,status:'running'|'completed'|'failed',progress:{fetched:number;added:number;updated:number},error?:string):Promise<void>{
      validateId(id);await post(`/v1/admin/jobs/${id}`,{owner,status,progress,error});
    },
    async reserveVilniusRequest():Promise<number> {
      const body=await post('/v1/admin/imports/vilnius-events/reserve-request',{});
      if(!Number.isSafeInteger(body.waitMs) || Number(body.waitMs)<0 || Number(body.waitMs)>3000)throw new Error('Central API returned an invalid request reservation.');
      return Number(body.waitMs);
    },
    async importVilniusPage(page:VilniusImportPage):Promise<{added:number;updated:number}> {
      const body=await post('/v1/admin/imports/vilnius-events/page',page);
      if(!Number.isSafeInteger(body.added) || !Number.isSafeInteger(body.updated)) throw new Error('Central API returned an invalid response; check the import before retrying.');
      return {added:body.added as number,updated:body.updated as number};
    },
    async listEvents(filters:URLSearchParams):Promise<CentralEventList> {
      let response:Response;
      try {response=await fetch(new URL(`/v1/admin/events?${filters}`,base),{headers:{authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(timeoutMs)});}
      catch {throw new Error('Central API request failed.');}
      if(!response.ok) throw Object.assign(new Error(`Central API read failed (HTTP ${response.status}).`),{status:response.status});
      const body=await response.json().catch(()=>null) as CentralEventList | null;
      if(!body || !Array.isArray(body.events) || !Number.isSafeInteger(body.total) || !body.counts || !Array.isArray(body.sources) || !Array.isArray(body.runs)) throw new Error('Central API returned an invalid response.');
      return body;
    },
    async getEvent(id:number):Promise<CentralEvent | null> {
      validateId(id);
      let response:Response;
      try { response=await fetch(new URL(`/v1/admin/events/${id}`,base),{headers:{authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(timeoutMs)}); }
      catch {throw new Error('Central API request failed.');}
      if(response.status===404) return null;
      if(!response.ok) throw Object.assign(new Error(`Central API read failed (HTTP ${response.status}).`),{status:response.status});
      const body=await response.json().catch(()=>null) as CentralEvent | null;
      if(!body || !body.event || typeof body.event !== 'object' || !Array.isArray(body.sources) || !Array.isArray(body.artist_decisions) || !('price' in body)) throw new Error('Central API returned an invalid response.');
      return body;
    },
    async getImage(id:number):Promise<{bytes:Uint8Array;type:string} | null> {
      validateId(id);
      let response:Response;
      try {response=await fetch(new URL(`/v1/admin/images/${id}`,base),{headers:{authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(timeoutMs)});}
      catch {throw new Error('Central API request failed.');}
      if(response.status===404)return null;
      if(!response.ok)throw Object.assign(new Error(`Central API read failed (HTTP ${response.status}).`),{status:response.status});
      const type=response.headers.get('content-type') || '';
      if(!['image/jpeg','image/png','image/webp','image/gif'].includes(type))throw new Error('Central API returned an invalid image.');
      const length=Number(response.headers.get('content-length'));
      if(Number.isFinite(length) && length>12*1024*1024)throw new Error('Central API image is too large.');
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(bytes.length>12*1024*1024)throw new Error('Central API image is too large.');
      return {bytes,type};
    },
    review: (id:number, review_status:ReviewStatus) => edit(id,'review',{review_status}),
    details: (id:number, details:Details) => edit(id,'details',details),
    artist: (id:number, mbid:string, decision:ArtistDecision) => edit(id,'artist',{mbid,decision}),
    price: (id:number, price:Price) => edit(id,'price',price),
    confirmAssistantReview: (id:number) => edit(id,'confirm-assistant-review',{}),
  };
}
