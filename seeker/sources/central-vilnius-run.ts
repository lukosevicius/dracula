import type { createCentralApi } from '../central-api.js';
import type { SourceEvent } from '../types.js';
import { runCentralVilniusImport } from './central-vilnius-events.js';
import { createCentralVilniusRequest } from './central-vilnius-request.js';

type Api=ReturnType<typeof createCentralApi>;
type Options={pages:number;restart?:boolean;sample?:boolean;refresh?:boolean};

/** A complete source-page import; jobs and image transfer are not connected yet. */
export async function runCentralVilnius(api:Api,options:Options,userAgent:string,progress:(value:{fetched:number;added:number;updated:number})=>void=()=>{},fetchPage?:(page:number,size:number)=>Promise<{data:SourceEvent[];pages:number|null}>) {
  const state=await api.listEvents(new URLSearchParams({when:'all',limit:'1'}));
  if(!Number.isSafeInteger(state.nextPage)||state.nextPage<1)throw new Error('Central API returned an invalid source cursor.');
  return runCentralVilniusImport({...options,currentOffset:state.nextPage-1},fetchPage || createCentralVilniusRequest(api.reserveVilniusRequest,userAgent),api.importVilniusPage,progress);
}
