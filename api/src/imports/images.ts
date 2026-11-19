import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import type {Pool, RowDataPacket} from 'mysql2/promise';
interface ImageInput {media_id: number; data: string; mime_type: string; source_url: string; source_modified?: string; width?: number; height?: number; job?: {id: number; owner: string}}
interface AvilysImageInput {source_id:number;data:string;mime_type:string;source_url:string;width?:number;height?:number;job:{id:number;owner:string}}
interface Lease extends RowDataPacket {job_id: number; owner_hash: string; expires_at: number | string}
interface Format {ext: string; check: (bytes: Buffer) => boolean}
const fail=(status: number,message: string)=>Object.assign(new Error(message),{status});
const limit=12*1024*1024;
const formats: Record<string, Format>={
  'image/jpeg':{ext:'jpg',check:b=>b.length>=3&&b[0]===255&&b[1]===216&&b[2]===255},
  'image/png':{ext:'png',check:b=>b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))},
  'image/gif':{ext:'gif',check:b=>['GIF87a','GIF89a'].includes(b.subarray(0,6).toString('ascii'))},
  'image/webp':{ext:'webp',check:b=>b.subarray(0,4).toString('ascii')==='RIFF'&&b.subarray(8,12).toString('ascii')==='WEBP'}
};
export async function saveImage(pool: Pool,dir: string,data: unknown){
  const input=data as ImageInput;
  if(!dir||!Number.isSafeInteger(input?.media_id)||input.media_id<1||typeof input.data!=='string'||input.data.length>Math.ceil(limit/3)*4||!formats[input.mime_type])throw fail(400,'Invalid image.');
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data))throw fail(400,'Invalid image encoding.');
  const bytes=Buffer.from(input.data,'base64'),format=formats[input.mime_type];
  if(!bytes.length||bytes.length>limit||!format.check(bytes))throw fail(400,'Invalid image content.');
  let url;try{url=new URL(input.source_url);if(url.protocol!=='https:'||!['vilnius-events.lt','www.vilnius-events.lt'].includes(url.hostname)||!url.pathname.startsWith('/wp-content/uploads/')||url.username||url.password)throw Error();}catch{throw fail(400,'Invalid image source.');}
  for(const key of ['width','height'] as const)if(input[key]!=null&&(!Number.isSafeInteger(input[key])||input[key]<1||input[key]>100000))throw fail(400,'Invalid image dimensions.');
  if(input.source_modified!=null&&(typeof input.source_modified!=='string'||input.source_modified.length>100))throw fail(400,'Invalid image metadata.');
  const name=`${input.media_id}-${createHash('sha256').update(bytes).digest('hex')}.${format.ext}`;
  const conn=await pool.getConnection();let temp: string | null = null;
  try {await conn.beginTransaction();try{
    const [source]=await conn.execute<RowDataPacket[]>('SELECT source_key FROM source_state WHERE source_key=? FOR UPDATE',['vilnius-events']);if(!source.length)throw fail(409,'Source state is missing.');
    const [leases]=await conn.execute<Lease[]>('SELECT job_id,owner_hash,expires_at FROM job_leases WHERE source_key=? FOR UPDATE',['vilnius-events']);
    if(leases.length){const lease=leases[0],owner=input.job?.owner;
      if(!Number.isSafeInteger(input.job?.id)||input.job?.id!==Number(lease.job_id)||typeof owner!=='string'||!/^[a-f0-9]{64}$/.test(owner)||Number(lease.expires_at)<=Date.now()||!timingSafeEqual(Buffer.from(lease.owner_hash),Buffer.from(createHash('sha256').update(owner).digest('hex'))))throw fail(409,'The import lease is invalid or has expired.');
    }else if(input.job)throw fail(409,'The import lease has expired.');
    const [events]=await conn.execute<RowDataPacket[]>('SELECT source_id FROM vilnius_events WHERE featured_media=? LIMIT 1 FOR UPDATE',[input.media_id]);if(!events.length)throw fail(404,'Image is not referenced by an event.');
    await mkdir(dir,{recursive:true});temp=join(dir,`.${randomUUID()}.tmp`);await writeFile(temp,bytes,{flag:'wx'});await rename(temp,join(dir,name));temp=null;
    await conn.execute('INSERT INTO vilnius_images(media_id,source_url,local_name,mime_type,width,height,source_modified,downloaded_at) VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE source_url=VALUES(source_url),local_name=VALUES(local_name),mime_type=VALUES(mime_type),width=VALUES(width),height=VALUES(height),source_modified=VALUES(source_modified),downloaded_at=VALUES(downloaded_at)',[input.media_id,url.href,name,input.mime_type,input.width||null,input.height||null,input.source_modified||null,new Date().toISOString()]);
    await conn.commit();return {name};
  }catch(cause){await conn.rollback();throw cause;}}finally{if(temp)await rm(temp,{force:true});conn.release();}
}

/** Stores an Avilys image against its source event, after confirming the URL came from that event's latest scrape. */
export async function saveAvilysImage(pool:Pool,dir:string,data:unknown){
  const input=data as AvilysImageInput;
  if(!dir||!Number.isSafeInteger(input?.source_id)||input.source_id<1||typeof input.data!=='string'||input.data.length>Math.ceil(limit/3)*4||!formats[input.mime_type]||!Number.isSafeInteger(input.job?.id)||input.job.id<1||typeof input.job.owner!=='string'||!/^[a-f0-9]{64}$/.test(input.job.owner))throw fail(400,'Invalid Avilys image.');
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data))throw fail(400,'Invalid image encoding.');
  const bytes=Buffer.from(input.data,'base64'),format=formats[input.mime_type];
  if(!bytes.length||bytes.length>limit||!format.check(bytes))throw fail(400,'Invalid image content.');
  let url:URL;try{url=new URL(input.source_url);if(url.protocol!=='https:'||url.username||url.password||url.port)throw Error();}catch{throw fail(400,'Invalid Avilys image source.');}
  for(const key of ['width','height'] as const)if(input[key]!=null&&(!Number.isSafeInteger(input[key])||input[key]!<1||input[key]!>100000))throw fail(400,'Invalid image dimensions.');
  const conn=await pool.getConnection();let temp:string|null=null;
  try{await conn.beginTransaction();try{
    const [sources]=await conn.execute<RowDataPacket[]>("SELECT event_id,source_data_json FROM event_sources WHERE source_key='avilys' AND source_id=? FOR UPDATE",[String(input.source_id)]);
    if(!sources.length)throw fail(404,'Avilys event not found.');
    let metadata:Record<string,unknown>;try{metadata=JSON.parse(sources[0].source_data_json);}catch{throw fail(409,'Avilys source metadata is invalid.');}
    if(metadata.imageUrl!==url.href)throw fail(409,'Avilys image changed; rescrape the event before uploading.');
    const [leases]=await conn.execute<Lease[]>('SELECT job_id,owner_hash,expires_at FROM job_leases WHERE source_key=? FOR UPDATE',['vilnius-events']);
    const lease=leases[0],ownerHash=createHash('sha256').update(input.job.owner).digest('hex');
    if(!lease||Number(lease.job_id)!==input.job.id||Number(lease.expires_at)<=Date.now()||!timingSafeEqual(Buffer.from(lease.owner_hash),Buffer.from(ownerHash)))throw fail(409,'Import lease expired.');
    const [jobs]=await conn.execute<RowDataPacket[]>('SELECT source FROM jobs WHERE id=?',[input.job.id]);if(jobs[0]?.source!=='avilys')throw fail(409,'Job is not an Avilys import.');
    const imageName=`avilys-${input.source_id}-${createHash('sha256').update(bytes).digest('hex')}.${format.ext}`;
    await mkdir(dir,{recursive:true});temp=join(dir,`.${randomUUID()}.tmp`);await writeFile(temp,bytes,{flag:'wx'});await rename(temp,join(dir,imageName));temp=null;
    await conn.execute('INSERT INTO event_images(event_id,source_key,source_id,source_url,local_name,mime_type,width,height,downloaded_at) VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE source_url=VALUES(source_url),local_name=VALUES(local_name),mime_type=VALUES(mime_type),width=VALUES(width),height=VALUES(height),downloaded_at=VALUES(downloaded_at)',[sources[0].event_id,'avilys',String(input.source_id),url.href,imageName,input.mime_type,input.width||null,input.height||null,new Date().toISOString()]);
    await conn.commit();return {name:imageName};
  }catch(cause){await conn.rollback();throw cause;}}finally{if(temp)await rm(temp,{force:true});conn.release();}
}
