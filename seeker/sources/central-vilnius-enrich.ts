import type {createCentralApi} from '../central-api.js';
import {extractDetails,extractPageDetails,extractEventPrice} from './event-details.js';
type Api=ReturnType<typeof createCentralApi>;

export async function runCentralEnrichment(api:Api,action:'details'|'refresh-details'|'details-event'|'refresh-all-details',eventId:number|undefined,userAgent:string,progress:(value:{fetched:number;added:number;updated:number})=>void,request:typeof fetch=fetch,pause:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))) {
  let after=0,checked=0,enriched=0,failed=0;
  const mode=action==='details'?'missing':action==='refresh-details'?'oldest':action==='details-event'?'event':'all';
  do {
    const events=await api.enrichmentCandidates(mode,after,eventId);if(!events.length){if(mode==='event')throw new Error('Event not found.');break;}
    for(const event of events){
      const url=new URL(event.source_url);if(url.protocol!=='https:'||!['www.vilnius-events.lt','vilnius-events.lt'].includes(url.hostname)||url.username||url.password)throw new Error('Unexpected event URL.');
      let response:Response|undefined;
      for(let attempt=0;attempt<4;attempt++){
        while(true){const wait=await api.reserveVilniusRequest();if(!wait)break;await pause(wait);}
        try{response=await request(url,{headers:{'user-agent':userAgent,accept:'text/html'},redirect:'manual',signal:AbortSignal.timeout(20000)});}catch(error){if(attempt===3)throw error;await pause((attempt+1)*5000);continue;}
        if(response.ok)break;
        if(response.status>=300&&response.status<400){if(mode==='event')throw new Error(`Event page redirected (HTTP ${response.status}).`);failed++;response=undefined;break;}
        if(![429,500,502,503,504].includes(response.status)||attempt===3)throw new Error(`Event page returned HTTP ${response.status}.`);
        const retry=response.headers.get('retry-after'),seconds=Number(retry),ms=retry&&Number.isFinite(seconds)?seconds*1000:Math.max(0,Date.parse(retry||'')-Date.now())||0;
        if(ms>120000)throw new Error('Vilnius Events requested a longer pause.');await pause(Math.max(ms,[5000,15000,30000][attempt]));
      }
      if(response){
        const html=await response.text(),page=extractPageDetails(html,url.href),content=extractDetails(event.content_html);
        const date=page.ambiguous_dates?null:page.event_date||content.event_date;
        const time=page.event_time||(!page.ambiguous_dates&&(!page.event_date||page.event_date===content.event_date)?content.event_time:null);
        const price=extractEventPrice(html);
        await api.enrichEvent(event.event_id,{details:{event_date:date,event_end_date:page.event_end_date,event_time:time,venue:page.venue||content.venue,ticket_url:page.ticket_url||content.ticket_url},about_url:page.about_url,...price,expected_source_url:event.source_url,expected_content_html:event.content_html});
        checked++;if(page.event_date||page.venue||page.ticket_url||page.about_url)enriched++;
      }
      after=event.event_id;progress({fetched:checked+failed,added:enriched,updated:failed});
    }
    if(mode!=='all'||events.length<10)break;
  }while(true);
  return {fetched:checked+failed,added:enriched,updated:failed};
}
