import type {createCentralApi,CentralArtist} from '../central-api.js';
import type {MusicBrainzPage} from '../types.js';
type Api=ReturnType<typeof createCentralApi>;
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
function datePart(value:unknown):string|null {if(typeof value==='string')return value;if(!value||typeof value!=='object')return null;const date=value as {year?:number;month?:number;day?:number};const parts=[date.year,date.month,date.day].filter(part=>part!==undefined);return parts.length?parts.join('-'):null;}

export async function runCentralMusicBrainz(api:Api,job:{id:number;owner:string},action:'next'|'start'|'all',limit:number,userAgent:string,progress:(value:{fetched:number;added:number;updated:number})=>void,request:typeof fetch=fetch,wait=pause){
  const state=(await api.artistsDashboard()).sourceState;if(!state||!Number.isSafeInteger(Number(state.next_offset)))throw new Error('MusicBrainz source state is missing.');
  let expected=Number(state.next_offset),offset=action==='next'?expected:0,total=state.total_available===null?null:Number(state.total_available),fetched=0,added=0,updated=0;
  while(action==='all'||fetched<limit){
    const size=action==='all'?100:Math.min(100,limit-fetched);const url=new URL('https://musicbrainz.org/ws/2/artist/');
    for(const [key,value] of Object.entries({area:'0785dc14-96af-3dc4-bde4-dcdfc2e2d0d6',fmt:'json',limit:String(size),offset:String(offset)}))url.searchParams.set(key,value);
    let response:Response|undefined;
    for(let attempt=0;attempt<4;attempt++){
      while(true){const delay=await api.reserveMusicBrainz();if(!delay)break;await wait(delay);}
      try{response=await request(url,{headers:{accept:'application/json','user-agent':userAgent},signal:AbortSignal.timeout(20000),redirect:'error'});}catch(error){if(attempt===3)throw error;await wait([5000,15000,30000][attempt]);continue;}
      if(response.ok)break;if(response.status!==503||attempt===3)throw new Error(`MusicBrainz returned HTTP ${response.status}.`);
      const retry=response.headers.get('retry-after'),seconds=Number(retry),retryMs=retry&&Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(retry||'')-Date.now())||0;
      if(retryMs>120000)throw new Error('MusicBrainz requested a longer pause.');await wait(Math.max(retryMs,[5000,15000,30000][attempt]));
    }
    if(!response?.ok)throw new Error('MusicBrainz did not return a response.');const page=await response.json() as MusicBrainzPage;if(!Array.isArray(page.artists))throw new Error('Unexpected MusicBrainz response.');
    const original=page.artists,artists:CentralArtist[]=original.filter(a=>a.country==='LT'&&a.id&&a.name).map(a=>({id:a.id,name:a.name,country:'LT',sort_name:a['sort-name']||null,artist_type:a.type||null,area:a.area?.name||null,begin_area:a['begin-area']?.name||null,begin_date:datePart(a['life-span']?.begin),end_date:datePart(a['life-span']?.end),disambiguation:a.disambiguation||null,aliases:(a.aliases||[]).map(alias=>alias.name).filter(Boolean)}));
    const final=original.length<size,next=final?0:offset+original.length;if(final&&action==='all')total=fetched+artists.length;
    const saved=await api.importMusicBrainzPage({artists,expected_offset:expected,next_offset:next,total_available:total,job});expected=next;fetched+=artists.length;added+=saved.added;updated+=saved.updated;progress({fetched,added,updated});offset+=original.length;if(final)break;
  }
  return {fetched,added,updated};
}
