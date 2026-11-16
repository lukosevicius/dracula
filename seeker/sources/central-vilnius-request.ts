import type { SourceEvent } from '../types.js';

/** Fetches source pages locally; the central API coordinates request pacing. */
export function createCentralVilniusRequest(reserve:()=>Promise<number>, userAgent:string, request:typeof fetch=fetch, pause:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))) {
  return async (page:number,size:number):Promise<{data:SourceEvent[];pages:number|null}> => {
    if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(size)||size<1||size>50)throw new Error('Invalid source page.');
    const url=new URL('https://www.vilnius-events.lt/wp-json/wp/v2/event');
    for(const [key,value] of Object.entries({categories:'4,81',per_page:String(size),page:String(page),orderby:'date',order:'desc',_fields:'id,title,link,content,categories,featured_media,date,modified'}))url.searchParams.set(key,value);
    for(let attempt=0;attempt<4;attempt++){
      // Reserve again after waiting: another worker may have taken the next slot.
      while(true){const wait=await reserve();if(!wait)break;await pause(wait);}
      let response:Response;
      try {response=await request(url,{headers:{accept:'application/json','user-agent':userAgent},signal:AbortSignal.timeout(20000),redirect:'error'});}
      catch(error){if(attempt===3)throw new Error(`Request failed: ${error instanceof Error?error.message:String(error)}`);await pause((attempt+1)*5000);continue;}
      if(response.ok){const data=await response.json();if(!Array.isArray(data))throw new Error('Unexpected response from Vilnius Events.');return {data:data as SourceEvent[],pages:Number(response.headers.get('x-wp-totalpages'))||null};}
      if(response.status===400){const body=await response.json().catch(()=>({}));if(body.code==='rest_post_invalid_page_number')return {data:[],pages:null};}
      if(![429,500,502,503,504].includes(response.status)||attempt===3)throw new Error(`Vilnius Events returned HTTP ${response.status}.`);
      const retry=response.headers.get('retry-after'),seconds=Number(retry);
      const retryMs=retry&&Number.isFinite(seconds)?seconds*1000:Math.max(0,Date.parse(retry||'')-Date.now())||0;
      if(retryMs>120000)throw new Error('Vilnius Events requested a longer pause. Please retry later.');
      await pause(Math.max(retryMs,[5000,15000,30000][attempt]));
    }
    throw new Error('Vilnius Events did not return a response.');
  };
}
