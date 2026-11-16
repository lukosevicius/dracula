import type {createCentralApi} from './central-api.js';
import {runCentralVilnius} from './sources/central-vilnius-run.js';
import {createCentralVilniusImages} from './sources/central-vilnius-images.js';
import {runCentralEnrichment} from './sources/central-vilnius-enrich.js';
import {runCentralMusicBrainz} from './sources/central-musicbrainz.js';
import {runCentralAi} from './database/central-ai-evaluation.js';
import {MODELS,type Model} from './database/ai-evaluation.js';

type Api=ReturnType<typeof createCentralApi>;
export function createCentralJobs(api:Api,userAgent:string,run:typeof runCentralVilnius=runCentralVilnius,enrich:typeof runCentralEnrichment=runCentralEnrichment,musicbrainz:typeof runCentralMusicBrainz=runCentralMusicBrainz,ai:typeof runCentralAi=runCentralAi) {
  async function start(input:{source?:string;action?:string;pages?:number;include_images?:boolean;event_id?:number;limit?:number;event_ids?:number[];models?:Model[];budget?:number}) {
    const action=input.action || '',pages=Number(input.pages ?? 1);
    const source=input.source==='musicbrainz'?'musicbrainz':input.source==='ai-evaluation'?'ai-evaluation':'vilnius-events',limit=Number(input.limit),budget=Number(input.budget);
    if(input.source!==source||(source==='ai-evaluation'?(action!=='analyze'||!Array.isArray(input.event_ids)||!input.event_ids.length||input.event_ids.length>5000||!input.event_ids.every(id=>Number.isSafeInteger(id)&&id>0)||new Set(input.event_ids).size!==input.event_ids.length||!Array.isArray(input.models)||!input.models.length||new Set(input.models).size!==input.models.length||!input.models.every(model=>Object.hasOwn(MODELS,model))||!Number.isFinite(budget)||budget<=0||budget>1000||!process.env.GEMINI_API_KEY):source==='musicbrainz'?(!['next','start','all'].includes(action)||(action!=='all'&&(!Number.isInteger(limit)||limit<1||limit>1000))):(!['next','start','sample','refresh','download-images','details','refresh-details','details-event','refresh-all-details'].includes(action)||!Number.isInteger(pages)||pages<1||pages>10||(action==='details-event'&&(!Number.isSafeInteger(input.event_id)||Number(input.event_id)<1)))))throw Object.assign(new Error('This central job is not available or its settings are invalid.'),{status:400});
    const job=await api.startJob(action,source,source==='musicbrainz'&&action!=='all'?limit:0);
    setImmediate(async()=>{
      let progress={fetched:0,added:0,updated:0},failure:unknown;
      let pending=Promise.resolve();
      const heartbeat=()=>{pending=pending.then(async()=>{if(failure)return;try{await api.updateJob(job.id,job.owner,'running',progress,undefined,source);}catch(error){failure=error;}});};
      const timer=setInterval(heartbeat,15000);timer.unref();
      try {
        const jobApi={...api,importVilniusPage:async page=>{await pending;if(failure)throw failure;return api.importVilniusPage({...page,job});},uploadImage:async image=>{await pending;if(failure)throw failure;return api.uploadImage({...image,job});},enrichEvent:async(id,input)=>{await pending;if(failure)throw failure;return api.enrichEvent(id,{...input,job});}};
        let result;
        if(source==='ai-evaluation')result=await ai(jobApi,job,input.event_ids!,input.models!,budget,process.env.GEMINI_API_KEY!,value=>{progress=value;heartbeat();},fetch,async()=>{await pending;if(failure)throw failure;});
        else if(source==='musicbrainz')result=await musicbrainz(jobApi,job,action as 'next'|'start'|'all',limit,userAgent,value=>{progress=value;heartbeat();});
        else if(action==='download-images'){
          const ensure=createCentralVilniusImages(jobApi,userAgent);let after=0;
          while(true){await pending;if(failure)throw failure;const ids=await api.listMedia(after);if(!ids.length)break;
            for(const id of ids){const state=await ensure(id);progress={fetched:progress.fetched+1,added:progress.added+(state==='downloaded'?1:0),updated:progress.updated};heartbeat();after=id;}
            if(ids.length<100)break;
          }
          result=progress;
        } else if(['details','refresh-details','details-event','refresh-all-details'].includes(action))result=await enrich(jobApi,action as 'details'|'refresh-details'|'details-event'|'refresh-all-details',input.event_id,userAgent,value=>{progress=value;heartbeat();});
        else result=await run(jobApi,{pages,restart:action==='start',sample:action==='sample',refresh:action==='refresh',includeImages:input.include_images===true},userAgent,value=>{progress=value;heartbeat();});
        clearInterval(timer);await pending;if(failure)throw failure;
        await api.updateJob(job.id,job.owner,'completed',result,undefined,source);
      } catch(error) {
        clearInterval(timer);await pending;
        // Do not retry an uncertain job update; a lease expiry makes later work stop safely.
        if(!failure)try{await api.updateJob(job.id,job.owner,'failed',progress,error instanceof Error?error.message:String(error),source);}catch{/* status will become interrupted after the lease expires */}
      }
    });
    return job.id;
  }
  return {start,list:()=>api.listJobs()};
}
