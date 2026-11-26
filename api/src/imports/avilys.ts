import { diff, history, lockEvent, recordChange, snapshot } from '../verification/history.js';
import { queueAfterImport } from '../verification/verification.js';
import { sourceEvidence } from '../verification/rules.js';
import { findImportMatch } from '../events/duplicates.js';
import { fillFromSource, recordAttach } from './attach.js';
import {createHash,timingSafeEqual} from 'node:crypto';
import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import {publishIfDated} from '../events/auto-publish.js';
interface AvilysEvent { id: number; title: string; city: string; categories: {id: number}[]; description?: string; startTime?: string; endTime?: string; venueName?: string; ticketUrl?: string; sourceUrl?: string; priceFrom?: number | string; priceTo?: number | string; free?: boolean }
interface ImportInput { verify_after_import?: boolean; publish_after_verification?: boolean; items: AvilysEvent[]; job: {id: number; owner: string} }
interface Lease extends RowDataPacket { job_id: number; owner_hash: string; expires_at: number | string }
const city = 'Vilnius';
const fail=(status: number,message: string)=>Object.assign(new Error(message),{status});
const esc=(value: string | undefined)=>String(value||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
const url=(value: string | undefined)=>{try{const u=new URL(value ?? '');return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const date=(value: string | undefined)=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(value))return null;const day=value.slice(0,10),parsed=new Date(`${day}T00:00:00Z`);return !Number.isNaN(parsed.valueOf())&&parsed.toISOString().slice(0,10)===day?day:null;};
// Avilys supplies Vilnius wall time, even when the timestamp ends in Z.
const time=(value: string | undefined)=>{if(!date(value))return null;const match=/^\d{4}-\d{2}-\d{2}T((?:[01]\d|2[0-3]):[0-5]\d)(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/.exec(value!);return match?.[1]??null;};
const price=(event:AvilysEvent)=>{
  const from=typeof event.priceFrom==='number'||typeof event.priceFrom==='string'?Number(event.priceFrom):NaN;
  const to=typeof event.priceTo==='number'||typeof event.priceTo==='string'?Number(event.priceTo):NaN;
  const priced=Number.isFinite(from)&&from>0;
  return {
    priceText:priced?(Number.isFinite(to)&&to>from?`${from}–${to} €`:`${from} €`):null,
    priceType:priced?'paid':event.free===true?'free':event.free===false?'paid':'unknown',
    available:priced||typeof event.free==='boolean',
  };
};

/** Store unreviewed candidates; preserve editorial changes on subsequent imports. */
export async function importAvilysPage(pool: Pool, data: unknown){
  const input=data as ImportInput;
  if(!Array.isArray(input?.items)||input.items.length>20||!Number.isSafeInteger(input.job?.id)||typeof input.job?.owner!=='string'||!/^[a-f0-9]{64}$/.test(input.job.owner))throw fail(400,'Invalid Avilys import.');
  const ids=new Set<number>();
  for(const e of input.items){
    if(!e||!Number.isSafeInteger(e.id)||e.id<1||ids.has(e.id)||typeof e.title!=='string'||!e.title.trim()||e.title.length>2000||typeof e.city!=='string'||e.city.toLowerCase()!==city.toLowerCase()||!Array.isArray(e.categories)||!e.categories.some(c=>c?.id===1)||typeof (e.description??'')!=='string'||(e.description?.length||0)>100000)throw fail(400,'Invalid Avilys event.');
    ids.add(e.id);
  }
  const conn=await pool.getConnection();let added=0,updated=0,attached=0;
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
        const venue=typeof e.venueName==='string'?e.venueName.slice(0,300):null,pricing=price(e);
        const match=await findImportMatch(conn,{title:e.title.trim(),event_date:date(e.startTime),event_time:time(e.startTime),venue,city},'avilys');
        if(match){
          const event=await lockEvent(conn,match),before=await snapshot(conn,match,event);
          await conn.execute('INSERT INTO event_sources(event_id,source_key,source_id,source_url,content_html,source_data_json,last_checked_at,about_url,is_secondary) VALUES(?,?,?,?,?,?,?,?,TRUE)',[match,'avilys',String(e.id),sourceUrl,description,metadata,now,original]);
          await fillFromSource(conn,event,{event_time:time(e.startTime),event_end_time:time(e.endTime),venue,ticket_url:url(e.ticketUrl),city},now);
          // Only a missing or unknown automatic price takes the Avilys value.
          if(pricing.available)await conn.execute(`INSERT INTO event_prices(event_id,price_text,price_type,manual,checked_at) VALUES(?,?,?,0,?)
            ON DUPLICATE KEY UPDATE price_text=IF(manual=0 AND price_type='unknown',VALUES(price_text),price_text),price_type=IF(manual=0 AND price_type='unknown',VALUES(price_type),price_type)`,[match,pricing.priceText,pricing.priceType,now]);
          await recordAttach(conn,match,before,'Avilys',{source_key:'avilys',source_id:e.id,job_id:input.job.id});
          await queueAfterImport(conn,match,input.job.id,input.verify_after_import!==false,input.publish_after_verification!==false);
          attached++;
          continue;
        }
        const [insert]=await conn.execute<ResultSetHeader>('INSERT INTO events(title,event_date,event_end_date,event_time,event_end_time,venue,ticket_url,city,review_status,manual_fields,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[e.title.trim(),date(e.startTime),null,time(e.startTime),time(e.endTime),typeof e.venueName==='string'?e.venueName.slice(0,300):null,url(e.ticketUrl),city,'unsure','[]',now,now]);
        await conn.execute('INSERT INTO event_sources(event_id,source_key,source_id,source_url,content_html,source_data_json,last_checked_at,about_url) VALUES(?,?,?,?,?,?,?,?)',[insert.insertId,'avilys',String(e.id),sourceUrl,description,metadata,now,original]);

        if(pricing.available)await conn.execute('INSERT INTO event_prices(event_id,price_text,price_type,manual,checked_at) VALUES(?,?,?,?,?)',[insert.insertId,pricing.priceText,pricing.priceType,0,now]);
        await history(conn,insert.insertId,'imported','Avilys',diff({},await snapshot(conn,insert.insertId)),{source_id:e.id,job_id:input.job.id});
        await publishIfDated(conn,insert.insertId,null,'Avilys');
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
          const endTime=time(e.endTime);
          if(endTime && event.event_end_time==null && Array.isArray(manual) && !manual.includes('event_end_time'))await conn.execute('UPDATE events SET event_end_time=?,updated_at=? WHERE id=? AND event_end_time IS NULL AND event_date=?',[endTime,now,links[0].event_id,sourceDate]);
        }
        const pricing=price(e);
        // A refresh without a structured amount can retain the price extracted from the same description.
        const priceText = pricing.priceText ?? (links[0].content_html === description && before.price_type === pricing.priceType && typeof before.price_text === 'string' ? before.price_text : null);
        // A secondary listing only replaces an unknown automatic price.
        const replace=Number(links[0].is_secondary)?"manual=0 AND price_type='unknown'":'manual=0';
        if(pricing.available)await conn.execute(`INSERT INTO event_prices(event_id,price_text,price_type,manual,checked_at) VALUES(?,?,?,?,?)
          ON DUPLICATE KEY UPDATE checked_at=IF(${replace},VALUES(checked_at),checked_at),price_text=IF(${replace},VALUES(price_text),price_text),price_type=IF(${replace},VALUES(price_type),price_type)`,
        [id,priceText,pricing.priceType,0,now]);
        await conn.execute("UPDATE event_sources SET content_html=?,source_data_json=?,last_checked_at=?,about_url=? WHERE source_key='avilys' AND source_id=?",[description,metadata,now,original,String(e.id)]);
        const previousSource=sourceEvidence(links[0]);
        const nextSource=sourceEvidence({source_key:'avilys',source_url:sourceUrl,about_url:original,content_html:description,source_data_json:metadata});
        if(await recordChange(conn,id,'source_refreshed','Avilys',{...before,source:previousSource},{...await snapshot(conn,id),source:nextSource},{source_id:e.id,job_id:input.job.id})){
          await queueAfterImport(conn,id,input.job.id,input.verify_after_import!==false,input.publish_after_verification!==false);
        }
        updated++;
      }
    }
    await conn.commit();return {added,updated,attached};
  }catch(cause){await conn.rollback();throw cause;}}finally{conn.release();}
}
