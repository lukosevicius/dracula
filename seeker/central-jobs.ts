import type {createCentralApi} from './central-api.js';
import {runCentralVilnius} from './sources/central-vilnius-run.js';
import {createCentralVilniusImages} from './sources/central-vilnius-images.js';
import {runCentralEnrichment} from './sources/central-vilnius-enrich.js';

type Api=ReturnType<typeof createCentralApi>;
export function createCentralJobs(api:Api,userAgent:string,run:typeof runCentralVilnius=runCentralVilnius,enrich:typeof runCentralEnrichment=runCentralEnrichment) {
  async function start(input:{source?:string;action?:string;pages?:number;include_images?:boolean;event_id?:number}) {
    const action=input.action || '',pages=Number(input.pages ?? 1);
    if(input.source!=='vilnius-events'||!['next','start','sample','refresh','download-images','details','refresh-details','details-event','refresh-all-details'].includes(action)||!Number.isInteger(pages)||pages<1||pages>10||(action==='details-event'&&(!Number.isSafeInteger(input.event_id)||Number(input.event_id)<1)))throw Object.assign(new Error('This central job is not available.'),{status:400});
    const job=await api.startJob(action);
    setImmediate(async()=>{
      let progress={fetched:0,added:0,updated:0},failure:unknown;
      let pending=Promise.resolve();
      const heartbeat=()=>{pending=pending.then(async()=>{if(failure)return;try{await api.updateJob(job.id,job.owner,'running',progress);}catch(error){failure=error;}});};
      const timer=setInterval(heartbeat,15000);timer.unref();
      try {
        const jobApi={...api,importVilniusPage:async page=>{await pending;if(failure)throw failure;return api.importVilniusPage({...page,job});},uploadImage:async image=>{await pending;if(failure)throw failure;return api.uploadImage({...image,job});},enrichEvent:async(id,input)=>{await pending;if(failure)throw failure;return api.enrichEvent(id,{...input,job});}};
        let result;
        if(action==='download-images'){
          const ensure=createCentralVilniusImages(jobApi,userAgent);let after=0;
          while(true){await pending;if(failure)throw failure;const ids=await api.listMedia(after);if(!ids.length)break;
            for(const id of ids){const state=await ensure(id);progress={fetched:progress.fetched+1,added:progress.added+(state==='downloaded'?1:0),updated:progress.updated};heartbeat();after=id;}
            if(ids.length<100)break;
          }
          result=progress;
        } else if(['details','refresh-details','details-event','refresh-all-details'].includes(action))result=await enrich(jobApi,action as 'details'|'refresh-details'|'details-event'|'refresh-all-details',input.event_id,userAgent,value=>{progress=value;heartbeat();});
        else result=await run(jobApi,{pages,restart:action==='start',sample:action==='sample',refresh:action==='refresh',includeImages:input.include_images===true},userAgent,value=>{progress=value;heartbeat();});
        clearInterval(timer);await pending;if(failure)throw failure;
        await api.updateJob(job.id,job.owner,'completed',result);
      } catch(error) {
        clearInterval(timer);await pending;
        // Do not retry an uncertain job update; a lease expiry makes later work stop safely.
        if(!failure)try{await api.updateJob(job.id,job.owner,'failed',progress,error instanceof Error?error.message:String(error));}catch{/* status will become interrupted after the lease expires */}
      }
    });
    return job.id;
  }
  return {start,list:()=>api.listJobs()};
}
