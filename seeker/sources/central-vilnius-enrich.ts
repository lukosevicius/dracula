import type {createCentralApi} from '../central-api.js';
import {extractDetails,extractPageDetails,extractEventPrice} from './event-details.js';
type Api=ReturnType<typeof createCentralApi>;

export async function runCentralEnrichment(api:Api,action:'details'|'refresh-details'|'details-event'|'refresh-all-details'|'refresh-upcoming-details',eventId:number|undefined,userAgent:string,progress:(value:{fetched:number;added:number;updated:number})=>void,request:typeof fetch=fetch,pause:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))) {
  let after=0,checked=0,enriched=0,failed=0;
  const mode=action==='details'?'missing':action==='refresh-details'?'oldest':action==='details-event'?'event':action==='refresh-upcoming-details'?'upcoming':'all';
  // Listings Vilnius Events took down redirect to its home page. Only the scheduled upcoming refresh acts on them.
  const gone:{event_id:number;source_id:string}[]=[];
  do {
    const events=await api.enrichmentCandidates(mode,after,eventId);if(!events.length){if(mode==='event')throw new Error('Event not found.');break;}
    for(const event of events){
      const url=new URL(event.source_url);if(url.protocol!=='https:'||!['www.vilnius-events.lt','vilnius-events.lt'].includes(url.hostname)||url.username||url.password)throw new Error('Unexpected event URL.');
      let response:Response|undefined;
      for(let attempt=0;attempt<4;attempt++){
        while(true){const wait=await api.reserveVilniusRequest();if(!wait)break;await pause(wait);}
        try{response=await request(url,{headers:{'user-agent':userAgent,accept:'text/html'},redirect:'manual',signal:AbortSignal.timeout(20000)});}catch(error){if(attempt===3)throw error;await pause((attempt+1)*5000);continue;}
        if(response.ok)break;
        if(response.status>=300&&response.status<400){if(mode==='event')throw new Error(`Event page redirected (HTTP ${response.status}).`);if(event.source_id&&redirectsHome(response,url))gone.push({event_id:event.event_id,source_id:String(event.source_id)});failed++;response=undefined;break;}
        if(![429,500,502,503,504].includes(response.status)||attempt===3)throw new Error(`Event page returned HTTP ${response.status}.`);
        const retry=response.headers.get('retry-after'),seconds=Number(retry),ms=retry&&Number.isFinite(seconds)?seconds*1000:Math.max(0,Date.parse(retry||'')-Date.now())||0;
        if(ms>120000)throw new Error('Vilnius Events requested a longer pause.');await pause(Math.max(ms,[5000,15000,30000][attempt]));
      }
      if(response){
        const html=await response.text(),page=extractPageDetails(html,url.href),content=extractDetails(event.content_html);
        const date=page.ambiguous_dates?null:page.event_date||content.event_date;
        const time=page.event_time||(!page.ambiguous_dates&&(!page.event_date||page.event_date===content.event_date)?content.event_time:null);
        const price=extractEventPrice(html);
        await api.enrichEvent(event.event_id,{details:{event_date:date,event_end_date:page.event_end_date,event_time:time,event_end_time:page.event_end_time,...(page.times?{times:page.times}:{}),venue:page.venue||content.venue,ticket_url:page.ticket_url||content.ticket_url},about_url:page.about_url,...price,expected_source_url:event.source_url,expected_content_html:event.content_html});
        checked++;if(page.event_date||page.venue||page.ticket_url||page.about_url)enriched++;
      }
      after=event.event_id;progress({fetched:checked+failed,added:enriched,updated:failed});
    }
    if((mode!=='all'&&mode!=='upcoming')||events.length<10)break;
  }while(true);
  if(mode!=='upcoming')return {fetched:checked+failed,added:enriched,updated:failed};
  // A burst of removals more likely means the site changed or is misbehaving, so nothing is removed then.
  const limit=Math.max(3,Math.ceil((checked+failed)*0.1));
  if(gone.length>limit)throw new Error(`${gone.length} of ${checked+failed} Vilnius Events listings look removed, more than the ${limit} allowed in one run. Nothing was removed; check the site.`);
  const outcomes={deleted:0,detached:0,unpublished:0,kept:0};
  for(const listing of gone){
    const result=await api.seekerWrite(`/events/${listing.event_id}/listing-gone`,{source_key:'vilnius-events',source_id:listing.source_id}) as {outcome?:keyof typeof outcomes};
    if(result.outcome&&result.outcome in outcomes)outcomes[result.outcome]++;
  }
  return {fetched:checked+failed,added:enriched,updated:failed,removed:outcomes.deleted+outcomes.detached,unpublished:outcomes.unpublished};
}

function redirectsHome(response:Response,url:URL){
  try{const target=new URL(response.headers.get('location')||'',url);return target.hostname.replace(/^www\./,'')===url.hostname.replace(/^www\./,'')&&(target.pathname===''||target.pathname==='/');}
  catch{return false;}
}
