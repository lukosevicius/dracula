import type { createCentralApi } from '../central-api.js';
import type { SourceEvent } from '../types.js';
import { runCentralVilniusImport } from './central-vilnius-events.js';
import { createCentralVilniusRequest } from './central-vilnius-request.js';
import { createCentralVilniusImages } from './central-vilnius-images.js';

type Api=ReturnType<typeof createCentralApi>;
type Options={pages:number;restart?:boolean;sample?:boolean;refresh?:boolean;includeImages?:boolean};

/** Runs source fetches locally and commits events and optional images through the API. */
export async function runCentralVilnius(api:Api,options:Options,userAgent:string,progress:(value:{fetched:number;added:number;updated:number})=>void=()=>{},fetchPage?:(page:number,size:number)=>Promise<{data:SourceEvent[];pages:number|null}>,imageRequest?:typeof fetch) {
  const state=await api.listEvents(new URLSearchParams({when:'all',limit:'1'}));
  if(!Number.isSafeInteger(state.nextPage)||state.nextPage<1)throw new Error('Central API returned an invalid source cursor.');
  const ensureImage=options.includeImages?createCentralVilniusImages(api,userAgent,imageRequest):null;
  const result=await runCentralVilniusImport({...options,currentOffset:state.nextPage-1},fetchPage || createCentralVilniusRequest(api.reserveVilniusRequest,userAgent),api.importVilniusPage,progress,async items=>{
    // A missing image must not stop the import; the next run tries again.
    if(ensureImage)for(const id of new Set(items.map(item=>item.featured_media).filter((value):value is number=>value!==null))){
      try{await ensureImage(id,true);}
      catch(error){console.error(`Vilnius Events image ${id} could not be saved:`,error instanceof Error?error.message:String(error));}
    }
  });
  return result;
}
