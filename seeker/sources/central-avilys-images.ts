import type {createCentralApi} from '../central-api.js';
import type {AvilysEvent} from './avilys.js';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';

type Api=ReturnType<typeof createCentralApi>;
const limit=12*1024*1024;
const imageMime=(bytes:Buffer):string|null=>{
  if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'image/jpeg';
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString('ascii')))return 'image/gif';
  if(bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WEBP')return 'image/webp';
  return null;
};
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
function publicAddress(address:string){
  if(isIP(address)===4){const p=address.split('.').map(Number);return !(p[0]===0||p[0]===10||p[0]===127||p[0]>=224||p[0]===169&&p[1]===254||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]===192&&p[1]===168||p[0]===100&&p[1]>=64&&p[1]<=127||p[0]===198&&(p[1]===18||p[1]===19));}
  if(isIP(address)===6){const value=address.toLowerCase();return !(value==='::'||value==='::1'||value.startsWith('fc')||value.startsWith('fd')||value.startsWith('fe8')||value.startsWith('fe9')||value.startsWith('fea')||value.startsWith('feb')||value.startsWith('ff')||value.startsWith('::ffff:'));}
  return false;
}
async function validateImageUrl(value:string){
  let url:URL;try{url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port)throw Error();}catch{throw new Error('Avilys returned an unexpected image URL.');}
  let addresses:{address:string}[];try{addresses=isIP(url.hostname)?[{address:url.hostname}]:await lookup(url.hostname,{all:true,verbatim:true});}catch{throw new Error('Could not resolve the Avilys image host.');}
  if(!addresses.length||addresses.some(({address})=>!publicAddress(address)))throw new Error('Avilys image host does not resolve to a public address.');
  return url;
}

/** Downloads an Avilys image only when its source URL changes, then stores it with the event through the admin API. */
export function createCentralAvilysImages(api:Api,userAgent:string,request:typeof fetch=fetch) {
  return async(event:AvilysEvent,job:{id:number;owner:string}):Promise<'existing'|'downloaded'|'missing'>=>{
    if(!Number.isSafeInteger(event.id)||event.id<1)throw new Error('Invalid Avilys event ID.');
    if(!event.imageUrl)return 'missing';
    const sourceUrl=await validateImageUrl(event.imageUrl);
    const existing=await api.getAvilysImageInfo(event.id);if(existing?.source_url===sourceUrl.href)return 'existing';
    await pause(250);
    let url=sourceUrl,response:Response,redirects=0;
    while(true){
      try{response=await request(url,{headers:{accept:'image/*','user-agent':userAgent},redirect:'manual',signal:AbortSignal.timeout(20000)});}catch{throw new Error('Could not download the Avilys image.');}
      if(response.status<300||response.status>=400)break;
      const location=response.headers.get('location');await response.body?.cancel().catch(()=>{});
      if(!location||redirects>=3)throw new Error('Avilys image redirect is invalid or exceeded the limit.');
      try{url=await validateImageUrl(new URL(location,url).href);}catch{throw new Error('Avilys image redirect is invalid.');}
      redirects++;
    }
    if(!response.ok)throw new Error(`Avilys image returned HTTP ${response.status}.`);
    const length=Number(response.headers.get('content-length'));if(Number.isFinite(length)&&length>limit)throw new Error('Avilys image exceeds 12 MB.');
    const reader=response.body?.getReader();if(!reader)throw new Error('Avilys image response was empty.');
    const chunks:Uint8Array[]=[];let size=0;while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>limit){await reader.cancel();throw new Error('Avilys image exceeds 12 MB.');}chunks.push(part.value);}
    if(!size)throw new Error('Avilys image response was empty.');
    const bytes=Buffer.concat(chunks),mime=imageMime(bytes);if(!mime)throw new Error('Avilys returned unsupported image content.');
    await api.uploadAvilysImage({source_id:event.id,source_url:sourceUrl.href,mime_type:mime,width:null,height:null,data:bytes.toString('base64'),job});
    return 'downloaded';
  };
}
