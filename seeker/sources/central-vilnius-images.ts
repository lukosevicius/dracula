import type {createCentralApi} from '../central-api.js';
import {selectImage} from './vilnius-images.js';
type Api=ReturnType<typeof createCentralApi>;
const limit=12*1024*1024;

export function createCentralVilniusImages(api:Api,userAgent:string,request:typeof fetch=fetch,pause:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))) {
  async function get(url:string,accept:string) {
    for(let attempt=0;attempt<4;attempt++){
      while(true){const wait=await api.reserveVilniusRequest();if(!wait)break;await pause(wait);}
      let response:Response;
      try{response=await request(url,{headers:{accept,'user-agent':userAgent},signal:AbortSignal.timeout(20000),redirect:'error'});}
      catch(error){if(attempt===3)throw error;await pause((attempt+1)*5000);continue;}
      if(response.ok)return response;
      if(![429,500,502,503,504].includes(response.status)||attempt===3)throw new Error(`Image request returned HTTP ${response.status}.`);
      const retry=response.headers.get('retry-after'),seconds=Number(retry),ms=retry&&Number.isFinite(seconds)?seconds*1000:Math.max(0,Date.parse(retry||'')-Date.now())||0;
      if(ms>120000)throw new Error('Vilnius Events requested a longer pause.');await pause(Math.max(ms,[5000,15000,30000][attempt]));
    }
    throw new Error('Image request failed.');
  }
  return async(mediaId:number,refresh=false):Promise<'existing'|'downloaded'>=>{
    if(!Number.isSafeInteger(mediaId)||mediaId<1)throw new Error('Invalid media ID.');
    const existing=await api.getImageInfo(mediaId);
    if(!refresh&&existing)return 'existing';
    const response=await get(`https://www.vilnius-events.lt/wp-json/wp/v2/media/${mediaId}?_fields=id,source_url,media_details,modified`,'application/json');
    const media=await response.json();if(media.id!==mediaId)throw new Error('Unexpected media response.');
    const selected=selectImage(media),url=new URL(selected.url);
    if(url.protocol!=='https:'||!['www.vilnius-events.lt','vilnius-events.lt'].includes(url.hostname)||!url.pathname.startsWith('/wp-content/uploads/')||url.username||url.password)throw new Error('Unexpected image URL.');
    if(existing&&existing.source_url===url.href&&existing.source_modified===(media.modified||null))return 'existing';
    const file=await get(url.href,'image/*'),mime=(file.headers.get('content-type')||'').split(';')[0].toLowerCase();
    if(!['image/jpeg','image/png','image/webp','image/gif'].includes(mime))throw new Error('Unsupported image type.');
    if(Number(file.headers.get('content-length'))>limit)throw new Error('Image exceeds 12 MB.');
    const reader=file.body?.getReader();if(!reader)throw new Error('Image response was empty.');const chunks:Uint8Array[]=[];let bytes=0;
    while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>limit){await reader.cancel();throw new Error('Image exceeds 12 MB.');}chunks.push(part.value);}
    if(!bytes)throw new Error('Image response was empty.');
    await api.uploadImage({media_id:mediaId,source_url:url.href,mime_type:mime,width:selected.width,height:selected.height,source_modified:media.modified||null,data:Buffer.concat(chunks).toString('base64')});
    return 'downloaded';
  };
}
