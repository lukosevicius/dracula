import {createHash,timingSafeEqual} from 'node:crypto';
import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
interface AvilysEvent { id: number; title: string; city: string; categories: {id: number}[]; description?: string; startTime?: string; venueName?: string; ticketUrl?: string; sourceUrl?: string; priceFrom?: number | string; priceTo?: number | string; free?: boolean }
interface ImportInput { items: AvilysEvent[]; job: {id: number; owner: string} }
interface Lease extends RowDataPacket { job_id: number; owner_hash: string; expires_at: number | string }
const fail=(status: number,message: string)=>Object.assign(new Error(message),{status});
const esc=(value: string | undefined)=>String(value||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
const url=(value: string | undefined)=>{try{const u=new URL(value ?? '');return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const date=(value: string | undefined)=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(value))return null;const day=value.slice(0,10),parsed=new Date(`${day}T00:00:00Z`);return !Number.isNaN(parsed.valueOf())&&parsed.toISOString().slice(0,10)===day?day:null;};

/** Store unreviewed candidates; preserve editorial changes on subsequent imports. */
export async function importAvilysPage(pool: Pool, data: unknown){
  const input=data as ImportInput;
  if(!Array.isArray(input?.items)||input.items.length>20||!Number.isSafeInteger(input.job?.id)||typeof input.job?.owner!=='string'||!/^[a-f0-9]{64}$/.test(input.job.owner))throw fail(400,'Invalid Avilys import.');
  const ids=new Set<number>();
  for(const e of input.items){
    if(!e||!Number.isSafeInteger(e.id)||e.id<1||ids.has(e.id)||typeof e.title!=='string'||!e.title.trim()||e.title.length>2000||typeof e.city!=='string'||e.city.toLowerCase()!=='vilnius'||!Array.isArray(e.categories)||!e.categories.some(c=>c?.id===1)||typeof (e.description??'')!=='string'||(e.description?.length||0)>100000)throw fail(400,'Invalid Avilys event.');
    ids.add(e.id);
  }
  const conn=await pool.getConnection();let added=0,updated=0;
  try{await conn.beginTransaction();try{
    const [leases]=await conn.execute<Lease[]>('SELECT job_id,owner_hash,expires_at FROM job_leases WHERE source_key=? FOR UPDATE',['vilnius-events']);
    const lease=leases[0],hash=createHash('sha256').update(input.job.owner).digest('hex');
    if(!lease||Number(lease.job_id)!==input.job.id||Number(lease.expires_at)<=Date.now()||!timingSafeEqual(Buffer.from(lease.owner_hash),Buffer.from(hash)))throw fail(409,'Import lease expired.');
    const now=new Date().toISOString();
    for(const e of input.items){
      const [links]=await conn.execute<RowDataPacket[]>("SELECT event_id FROM event_sources WHERE source_key='avilys' AND source_id=? FOR UPDATE",[String(e.id)]);
      const sourceUrl=`https://avilys.app/event/${e.id}`, description=esc(e.description), metadata=JSON.stringify(e), original=url(e.sourceUrl);
      if(!links.length){
        // The source timestamps have appeared to contain local wall times labelled UTC. Keep time unknown until reviewed.
        const [insert]=await conn.execute<ResultSetHeader>('INSERT INTO events(title,event_date,event_end_date,event_time,venue,ticket_url,review_status,manual_fields,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[e.title.trim(),date(e.startTime),null,null,typeof e.venueName==='string'?e.venueName.slice(0,300):null,url(e.ticketUrl),'unsure','[]',now,now]);
        await conn.execute('INSERT INTO event_sources(event_id,source_key,source_id,source_url,content_html,source_data_json,last_checked_at,about_url) VALUES(?,?,?,?,?,?,?,?)',[insert.insertId,'avilys',String(e.id),sourceUrl,description,metadata,now,original]);
        const from=typeof e.priceFrom==='number'||typeof e.priceFrom==='string'?Number(e.priceFrom):NaN;
        const to=typeof e.priceTo==='number'||typeof e.priceTo==='string'?Number(e.priceTo):NaN;
        const priced=Number.isFinite(from)&&from>0;
        const priceText=priced?(Number.isFinite(to)&&to>from?`${from}–${to} €`:`${from} €`):(e.free===true?'Avilys: free (verify)':e.free===false?'Avilys: paid (verify)':null);
        if(priceText)await conn.execute('INSERT INTO event_prices(event_id,price_text,price_type,manual,checked_at) VALUES(?,?,?,?,?)',[insert.insertId,priceText,priced?'paid':'unknown',0,now]);
        added++;
      }else{
        // Do not overwrite reviewed event fields or source association on refresh.
        await conn.execute("UPDATE event_sources SET content_html=?,source_data_json=?,last_checked_at=?,about_url=? WHERE source_key='avilys' AND source_id=?",[description,metadata,now,original,String(e.id)]);
        updated++;
      }
    }
    await conn.commit();return {added,updated};
  }catch(cause){await conn.rollback();throw cause;}}finally{conn.release();}
}
