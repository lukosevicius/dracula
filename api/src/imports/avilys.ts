import { diff, history, lockEvent, recordChange, snapshot } from '../verification/history.js';
import { queueAfterImport } from '../verification/verification.js';
import { sourceEvidence } from '../verification/rules.js';
import {createHash,timingSafeEqual} from 'node:crypto';
import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
interface AvilysEvent { id: number; title: string; city: string; categories: {id: number}[]; description?: string; startTime?: string; venueName?: string; ticketUrl?: string; sourceUrl?: string; priceFrom?: number | string; priceTo?: number | string; free?: boolean }
interface ImportInput { verify_after_import?: boolean; publish_after_verification?: boolean; items: AvilysEvent[]; job: {id: number; owner: string} }
interface Lease extends RowDataPacket { job_id: number; owner_hash: string; expires_at: number | string }
const city = 'Vilnius';
const fail=(status: number,message: string)=>Object.assign(new Error(message),{status});
const esc=(value: string | undefined)=>String(value||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
const url=(value: string | undefined)=>{try{const u=new URL(value ?? '');return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const date=(value: string | undefined)=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(value))return null;const day=value.slice(0,10),parsed=new Date(`${day}T00:00:00Z`);return !Number.isNaN(parsed.valueOf())&&parsed.toISOString().slice(0,10)===day?day:null;};
// Avilys supplies Vilnius wall time, even when the timestamp ends in Z.
const time=(value: string | undefined)=>{if(!date(value))return null;const match=/^\d{4}-\d{2}-\d{2}T((?:[01]\d|2[0-3]):[0-5]\d)(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/.exec(value!);return match?.[1]??null;};

/** Store unreviewed candidates; preserve editorial changes on subsequent imports. */
export async function importAvilysPage(pool: Pool, data: unknown){
  const input=data as ImportInput;
  if(!Array.isArray(input?.items)||input.items.length>20||!Number.isSafeInteger(input.job?.id)||typeof input.job?.owner!=='string'||!/^[a-f0-9]{64}$/.test(input.job.owner))throw fail(400,'Invalid Avilys import.');
  const ids=new Set<number>();
  for(const e of input.items){
    if(!e||!Number.isSafeInteger(e.id)||e.id<1||ids.has(e.id)||typeof e.title!=='string'||!e.title.trim()||e.title.length>2000||typeof e.city!=='string'||e.city.toLowerCase()!==city.toLowerCase()||!Array.isArray(e.categories)||!e.categories.some(c=>c?.id===1)||typeof (e.description??'')!=='string'||(e.description?.length||0)>100000)throw fail(400,'Invalid Avilys event.');
    ids.add(e.id);
  }
  const conn=await pool.getConnection();let added=0,updated=0;
  try{await conn.beginTransaction();try{
    const [leases]=await conn.execute<Lease[]>('SELECT job_id,owner_hash,expires_at FROM job_leases WHERE source_key=? FOR UPDATE',['vilnius-events']);
    const lease=leases[0],hash=createHash('sha256').update(input.job.owner).digest('hex');
    if(!lease||Number(lease.job_id)!==input.job.id||Number(lease.expires_at)<=Date.now()||!timingSafeEqual(Buffer.from(lease.owner_hash),Buffer.from(hash)))throw fail(409,'Import lease expired.');
    const now=new Date().toISOString();
    const [legacyPrices]=await conn.execute<RowDataPacket[]>(`SELECT p.event_id,p.price_text FROM event_prices p
      JOIN event_sources s ON s.event_id=p.event_id WHERE s.source_key='avilys' AND p.manual=0
      AND p.price_text IN ('Avilys: free (verify)','Avilys: paid (verify)')`,[]);
    for(const price of legacyPrices)await conn.execute('UPDATE event_prices SET price_type=?,price_text=NULL,checked_at=? WHERE event_id=? AND manual=0',[
      price.price_text==='Avilys: free (verify)'?'free':'paid',now,price.event_id]);
    for(const e of input.items){
      const [links]=await conn.execute<RowDataPacket[]>("SELECT * FROM event_sources WHERE source_key='avilys' AND source_id=? FOR UPDATE",[String(e.id)]);
      const sourceUrl=`https://avilys.app/event/${e.id}`, description=esc(e.description), metadata=JSON.stringify(e), original=url(e.sourceUrl);
      if(!links.length){
        const [insert]=await conn.execute<ResultSetHeader>('INSERT INTO events(title,event_date,event_end_date,event_time,venue,ticket_url,city,review_status,manual_fields,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[e.title.trim(),date(e.startTime),null,time(e.startTime),typeof e.venueName==='string'?e.venueName.slice(0,300):null,url(e.ticketUrl),city,'unsure','[]',now,now]);
        await conn.execute('INSERT INTO event_sources(event_id,source_key,source_id,source_url,content_html,source_data_json,last_checked_at,about_url) VALUES(?,?,?,?,?,?,?,?)',[insert.insertId,'avilys',String(e.id),sourceUrl,description,metadata,now,original]);
        const from=typeof e.priceFrom==='number'||typeof e.priceFrom==='string'?Number(e.priceFrom):NaN;
        const to=typeof e.priceTo==='number'||typeof e.priceTo==='string'?Number(e.priceTo):NaN;
        const priced=Number.isFinite(from)&&from>0;
        const priceText=priced?(Number.isFinite(to)&&to>from?`${from}–${to} €`:`${from} €`):null;
        const priceType=priced?'paid':e.free===true?'free':e.free===false?'paid':'unknown';
        if(priceText||priceType!=='unknown')await conn.execute('INSERT INTO event_prices(event_id,price_text,price_type,manual,checked_at) VALUES(?,?,?,?,?)',[insert.insertId,priceText,priceType,0,now]);
        await history(conn,insert.insertId,'imported','Avilys',diff({},await snapshot(conn,insert.insertId)),{source_id:e.id,job_id:input.job.id});
        await queueAfterImport(conn,insert.insertId,input.job.id,input.verify_after_import!==false,input.publish_after_verification!==false);
        added++;
      }else{
        const id=Number(links[0].event_id);
        const event=await lockEvent(conn,id);
        const before=await snapshot(conn,id,event);
        // Do not overwrite reviewed event fields or source association on refresh.
        await conn.execute('UPDATE events SET city=? WHERE id=? AND city IS NULL',[city,links[0].event_id]);
        const sourceTime=time(e.startTime),sourceDate=date(e.startTime);
        if(sourceTime && sourceDate){
          let manual:unknown;
          try{manual=JSON.parse(event.manual_fields);}catch{/* Invalid metadata must not unlock a field. */}
          if(event.event_time==null && Array.isArray(manual) && !manual.includes('event_time'))await conn.execute('UPDATE events SET event_time=?,updated_at=? WHERE id=? AND event_time IS NULL AND event_date=?',[sourceTime,now,links[0].event_id,sourceDate]);
        }
        await conn.execute("UPDATE event_sources SET content_html=?,source_data_json=?,last_checked_at=?,about_url=? WHERE source_key='avilys' AND source_id=?",[description,metadata,now,original,String(e.id)]);
        const previousSource=sourceEvidence(links[0]);
        const nextSource=sourceEvidence({source_key:'avilys',source_url:sourceUrl,about_url:original,content_html:description,source_data_json:metadata});
        if(await recordChange(conn,id,'source_refreshed','Avilys',{...before,source:previousSource},{...await snapshot(conn,id),source:nextSource},{source_id:e.id,job_id:input.job.id})){
          await queueAfterImport(conn,id,input.job.id,input.verify_after_import!==false,input.publish_after_verification!==false);
        }
        updated++;
      }
    }
    await conn.commit();return {added,updated};
  }catch(cause){await conn.rollback();throw cause;}}finally{conn.release();}
}
