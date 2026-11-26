import { lockEvent, recordChange, snapshot } from '../verification/history.js';
import { fillFromSource, mergeIfMatched } from './attach.js';
import { parseShowtimes, saveShowtimes } from '../events/times.js';
import {createHash,timingSafeEqual} from 'node:crypto';
import type {Pool, ResultSetHeader, RowDataPacket} from 'mysql2/promise';
import { publishIfDated } from '../events/auto-publish.js';
type DetailField = 'event_date' | 'event_end_date' | 'event_time' | 'venue' | 'ticket_url';
type Details = Partial<Record<DetailField, string | null>>;
interface EnrichmentInput { details: Details & { event_end_time?: string | null; times?: unknown }; price_type: string; price_text?: string | null; about_url?: string | null; expected_source_url: string; expected_content_html: string; job?: { id: number; owner: string } }
interface Lease extends RowDataPacket { job_id: number; owner_hash: string; expires_at: number | string }
const fail=(status: number,message: string)=>Object.assign(new Error(message),{status});
const fields: DetailField[]=['event_date','event_end_date','event_time','venue','ticket_url'];
const validDate=(value: string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;

export async function enrichEvent(pool: Pool,id: number,data: unknown){
  const input=data as EnrichmentInput;
  if(!Number.isSafeInteger(id)||id<1||!input||!input.details||fields.some(k=>input.details[k]!=null&&typeof input.details[k]!=='string')||!['free','paid','unknown'].includes(input.price_type)||(input.price_text!=null&&(typeof input.price_text!=='string'||input.price_text.length>300)))throw fail(400,'Invalid enrichment.');
  const d=input.details;const times=parseShowtimes(d.times);if(d.event_end_time!=null&&(typeof d.event_end_time!=='string'||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(d.event_end_time)))throw fail(400,'Invalid end time.');if((d.event_date&&!validDate(d.event_date))||(d.event_end_date&&(!d.event_date||!validDate(d.event_end_date)||d.event_end_date<d.event_date))||(d.event_time&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(d.event_time))||(d.venue?.length||0)>300||(d.ticket_url?.length||0)>2048)throw fail(400,'Invalid event details.');
  for(const value of [d.ticket_url,input.about_url])if(value){try{if(typeof value!=='string'||value.length>2048||!['http:','https:'].includes(new URL(value).protocol))throw Error();}catch{throw fail(400,'Invalid URL.');}}
  if(typeof input.expected_source_url!=='string'||typeof input.expected_content_html!=='string')throw fail(400,'Missing source version.');
  const conn=await pool.getConnection();try{await conn.beginTransaction();try{
    const [state]=await conn.execute<RowDataPacket[]>('SELECT source_key FROM source_state WHERE source_key=? FOR UPDATE',['vilnius-events']);if(!state.length)throw fail(409,'Source state is missing.');
    const [leases]=await conn.execute<Lease[]>('SELECT job_id,owner_hash,expires_at FROM job_leases WHERE source_key=? FOR UPDATE',['vilnius-events']);
    const lease=leases[0],owner=input.job?.owner;if(!lease||!Number.isSafeInteger(input.job?.id)||input.job?.id!==Number(lease.job_id)||typeof owner!=='string'||!/^[a-f0-9]{64}$/.test(owner)||Number(lease.expires_at)<=Date.now()||!timingSafeEqual(Buffer.from(lease.owner_hash),Buffer.from(createHash('sha256').update(owner).digest('hex'))))throw fail(409,'The import lease is invalid or has expired.');
    const event=await lockEvent(conn,id);
    const before=await snapshot(conn,id,event);
    const [links]=await conn.execute<RowDataPacket[]>("SELECT source_id,source_url,content_html,about_url,detail_evidence_json,is_secondary FROM event_sources WHERE event_id=? AND source_key='vilnius-events' ORDER BY is_secondary,id FOR UPDATE",[id]);if(!links.length)throw fail(404,'Event not found.');
    // A merged event can hold two Vilnius Events listings; the fetched page says which one these details belong to.
    const link=links.find(row=>row.source_url===input.expected_source_url&&row.content_html===input.expected_content_html);
    if(!link)throw fail(409,'Source changed while details were fetched.');
    const sourceId=Number(link.source_id),[rows]=await conn.execute<RowDataPacket[]>('SELECT * FROM vilnius_events WHERE source_id=? FOR UPDATE',[sourceId]);if(rows.length!==1)throw fail(409,'Event source is inconsistent.');
    const row=rows[0],manual=JSON.parse(row.manual_fields);if(!Array.isArray(manual))throw fail(409,'Event manual fields are inconsistent.');
    const values=fields.map(field=>manual.includes(field)?row[field]:(d[field]??row[field]));const now=new Date().toISOString();
    await conn.execute('UPDATE vilnius_events SET event_date=?,event_end_date=?,event_time=?,venue=?,ticket_url=?,details_checked_at=?,details_version=1 WHERE source_id=?',[...values,now,sourceId]);
    const secondary=Boolean(Number(link.is_secondary));
    // A listing that joined an event from another source only fills missing values.
    if(secondary)await fillFromSource(conn,event,{...Object.fromEntries(fields.map((field,index)=>[field,values[index]])),event_end_time:d.event_end_time??null},now);
    else {
      await conn.execute('UPDATE events SET event_date=?,event_end_date=?,event_time=?,venue=?,ticket_url=?,updated_at=? WHERE id=?',[...values,now,id]);
      // End time lives only on the event; the page value replaces it unless an editor set it.
      let eventManual: unknown=[];try{eventManual=JSON.parse(event.manual_fields);}catch{eventManual=['event_end_time'];}
      if(d.event_end_time&&Array.isArray(eventManual)&&!eventManual.includes('event_end_time'))await conn.execute('UPDATE events SET event_end_time=? WHERE id=?',[d.event_end_time,id]);
      // Several showings (for example 16:00 and 19:00) are kept as one event unless an editor set the date or time.
      if(times&&Array.isArray(eventManual)&&!eventManual.includes('event_date')&&!eventManual.includes('event_time')&&!manual.includes('event_date')&&!manual.includes('event_time'))await saveShowtimes(conn,id,times);
    }
    const detailEvidence=JSON.stringify({...d,price_type:input.price_type,price_text:input.price_text??null});
    await conn.execute("UPDATE event_sources SET about_url=?,about_checked_at=?,last_checked_at=?,detail_evidence_json=? WHERE source_key='vilnius-events' AND source_id=?",[input.about_url||null,now,now,detailEvidence,link.source_id]);
    const replace=secondary?"manual=0 AND price_type='unknown'":'manual=0';
    await conn.execute(`INSERT INTO event_prices(event_id,price_text,price_type,manual,checked_at) VALUES(?,?,?,0,?) ON DUPLICATE KEY UPDATE checked_at=IF(${replace},VALUES(checked_at),checked_at),price_text=IF(${replace},VALUES(price_text),price_text),price_type=IF(${replace},VALUES(price_type),price_type)`,[id,input.price_text||null,input.price_type,now]);
    const changed = await recordChange(conn,id,'details_refreshed','Vilnius Events',{...before,about_url:link.about_url,source_details:link.detail_evidence_json},{...await snapshot(conn,id),about_url:input.about_url||null,source_details:detailEvidence},{job_id:input.job?.id});
    if(changed && input.job){
      // Source enrichment is the final step of this import. Rebase only the verification queued for that same source revision.
      const [pending]=await conn.execute<ResultSetHeader>(`UPDATE event_verifications v JOIN verification_jobs j ON j.id=v.job_id
        SET v.event_revision=v.event_revision+1 WHERE j.import_job_id=? AND v.event_id=? AND v.event_revision=? AND v.status='queued'`,[input.job.id,id,event.revision]);
      if(pending.affectedRows)await conn.execute("UPDATE events SET verification_status='queued' WHERE id=?",[id]);
    }
    // A date found on the event page may reveal the same performance from another source.
    if(!secondary){
      await publishIfDated(conn,id,event.event_date,'Vilnius Events');
      await mergeIfMatched(conn,id,event.event_date,'Vilnius Events');
    }
    await conn.commit();
  }catch(cause){await conn.rollback();throw cause;}}finally{conn.release();}
}
