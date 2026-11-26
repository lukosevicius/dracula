import type { DatabaseSync } from 'node:sqlite';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const SOURCE='vilnius-events', INTERVAL=3000, MAX_BYTES=12*1024*1024;
type Size={width?:number;height?:number;source_url?:string};
type Media={id:number;source_url?:string;modified?:string;media_details?:{width?:number;height?:number;sizes?:Record<string,Size>}};
export function selectImage(media:Media):{url:string;width:number|null;height:number|null} {
 const detail=media.media_details||{}, full={source_url:media.source_url,width:detail.width,height:detail.height};
 const ratio=full.width&&full.height?full.width/full.height:0;
 const sizes=Object.values(detail.sizes||{}).filter(s=>s.source_url&&s.width&&s.height&&(!ratio||Math.abs(s.width/s.height-ratio)<0.02));
 if(full.source_url&&full.width&&full.height)sizes.push(full);
 sizes.sort((a,b)=>(a.width||0)-(b.width||0));
 const chosen=sizes.find(s=>(s.width||0)>=1200)||sizes.at(-1)||full;
 if(!chosen.source_url)throw new Error('Media record has no image URL.');
 return {url:chosen.source_url,width:chosen.width||null,height:chosen.height||null};
}
/** The preferred image from selectImage, followed by the smaller sizes of the same shape, largest first. */
export function imageChoices(media:Media):{url:string;width:number|null;height:number|null}[] {
 const chosen=selectImage(media), detail=media.media_details||{}, ratio=detail.width&&detail.height?detail.width/detail.height:0;
 const smaller=Object.values(detail.sizes||{})
  .filter(s=>s.source_url&&s.width&&s.height&&s.width<(chosen.width||0)&&(!ratio||Math.abs(s.width/s.height-ratio)<0.02))
  .sort((a,b)=>(b.width||0)-(a.width||0));
 return [chosen,...smaller.map(s=>({url:s.source_url!,width:s.width||null,height:s.height||null}))];
}
export function createVilniusImages(db:DatabaseSync,dataDir:string,userAgent:string) {
 db.exec(`CREATE TABLE IF NOT EXISTS vilnius_images (media_id INTEGER PRIMARY KEY,source_url TEXT NOT NULL,local_name TEXT NOT NULL,mime_type TEXT NOT NULL,width INTEGER,height INTEGER,source_modified TEXT,downloaded_at TEXT NOT NULL);`);
 const dir=join(dataDir,'images','vilnius-events');
 async function request(url:string,accept:string) {
  for(let attempt=0;attempt<4;attempt++) {
   const last=db.prepare('SELECT last_request_at FROM source_state WHERE source_key=?').get(SOURCE)?.last_request_at;
   const delay=Math.max(0,INTERVAL-(Date.now()-(Date.parse(String(last))||0)));if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
   db.prepare('UPDATE source_state SET last_request_at=? WHERE source_key=?').run(new Date().toISOString(),SOURCE);
   let response:Response;
   try{response=await fetch(url,{headers:{accept,'user-agent':userAgent},signal:AbortSignal.timeout(20000),redirect:'error'});}catch(error){if(attempt===3)throw error;await new Promise(resolve=>setTimeout(resolve,(attempt+1)*5000));continue;}
   if(response.ok)return response;
   if(![429,500,502,503,504].includes(response.status)||attempt===3)throw new Error(`Image request returned HTTP ${response.status}.`);
   const retry=response.headers.get('retry-after'), seconds=Number(retry),ms=retry&&Number.isFinite(seconds)?seconds*1000:Math.max(0,Date.parse(retry||'')-Date.now())||0;
   if(ms>120000)throw new Error('Vilnius Events requested a longer pause.');
   await new Promise(resolve=>setTimeout(resolve,Math.max(ms,[5000,15000,30000][attempt])));
  }
  throw new Error('Image request failed.');
 }
 async function ensure(mediaId:number,refresh=false):Promise<'downloaded'|'existing'> {
  if(!Number.isSafeInteger(mediaId)||mediaId<=0)throw new Error('Invalid media ID.');
  const existing=db.prepare('SELECT * FROM vilnius_images WHERE media_id=?').get(mediaId);
  const existingName=typeof existing?.local_name==='string'&&/^\d+\.(jpg|png|webp|gif)$/.test(existing.local_name)?existing.local_name:null;
  if(existingName&&!refresh&&await stat(join(dir,existingName)).then(()=>true,()=>false))return 'existing';
  const response=await request(`https://www.vilnius-events.lt/wp-json/wp/v2/media/${mediaId}?_fields=id,source_url,media_details,modified`,'application/json');
  const media=await response.json() as Media;if(media.id!==mediaId)throw new Error('Unexpected media response.');
  const selected=selectImage(media);const url=new URL(selected.url);
  if(url.protocol!=='https:'||!['www.vilnius-events.lt','vilnius-events.lt'].includes(url.hostname)||!url.pathname.startsWith('/wp-content/uploads/'))throw new Error('Unexpected image URL.');
  if(existingName&&existing?.source_url===url.href&&existing?.source_modified===(media.modified||null)&&await stat(join(dir,existingName)).then(()=>true,()=>false))return 'existing';
  const file=await request(url.href,'image/*'); const mime=(file.headers.get('content-type')||'').split(';')[0].toLowerCase();
  const ext=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'} as Record<string,string>)[mime];if(!ext)throw new Error(`Unsupported image type: ${mime||'unknown'}.`);
  if(Number(file.headers.get('content-length'))>MAX_BYTES)throw new Error('Image exceeds 12 MB.');
  const reader=file.body?.getReader();if(!reader)throw new Error('Image response was empty.');const chunks:Uint8Array[]=[];let bytes=0;
  while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>MAX_BYTES){await reader.cancel();throw new Error('Image exceeds 12 MB.');}chunks.push(part.value);}
  if(!bytes)throw new Error('Image response was empty.');
  await mkdir(dir,{recursive:true}); const name=`${mediaId}.${ext}`,temp=join(dir,`.${randomUUID()}.tmp`);
  try{await writeFile(temp,Buffer.concat(chunks));await rename(temp,join(dir,name));}finally{await rm(temp,{force:true});}
  db.prepare(`INSERT INTO vilnius_images(media_id,source_url,local_name,mime_type,width,height,source_modified,downloaded_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(media_id) DO UPDATE SET source_url=excluded.source_url,local_name=excluded.local_name,mime_type=excluded.mime_type,width=excluded.width,height=excluded.height,source_modified=excluded.source_modified,downloaded_at=excluded.downloaded_at`).run(mediaId,url.href,name,mime,selected.width,selected.height,media.modified||null,new Date().toISOString());
  return 'downloaded';
 }
 return {ensure};
}
