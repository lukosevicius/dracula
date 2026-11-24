import { diff, history, jsonValue, lockEvent, recordChange, snapshot, type Snapshot } from '../verification/history.js';
import { queueAfterImport } from '../verification/verification.js';
import type {Pool, RowDataPacket, ResultSetHeader} from 'mysql2/promise';
type Field = 'event_date' | 'event_end_date' | 'event_time' | 'venue' | 'ticket_url';
type Details = Partial<Record<Field, string | null>>;
interface EventInput { source_id: number; title: string; source_url: string; content_html: string; categories: number[]; details: Details; featured_media?: number | null; published_at?: string | null; modified_at?: string | null }
interface PageInput { verify_after_import?: boolean; publish_after_verification?: boolean; items: EventInput[]; advance_cursor: boolean; expected_offset: number; next_offset: number; total_available: number | null; job?: {id: number; owner: string} }
interface Lease extends RowDataPacket {job_id: number; owner_hash: string; expires_at: number | string}
const fields: Field[]=['event_date','event_end_date','event_time','venue','ticket_url'];
const city = 'Vilnius';
const problem=(status: number,message: string)=>Object.assign(new Error(message),{status});
const dateOk=(value: string)=>/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;

/** Applies one source page atomically; Seeker's network worker remains local. */
export async function importVilniusPage(pool: Pool, data: unknown) {
  const input=data as PageInput;
  if(!input || !Array.isArray(input.items) || input.items.length>50 || typeof input.advance_cursor!=='boolean' || !Number.isSafeInteger(input.expected_offset) || input.expected_offset<0 || !Number.isSafeInteger(input.next_offset) || input.next_offset<0 || (input.total_available!==null && (!Number.isSafeInteger(input.total_available)||input.total_available<0))) throw problem(400,'Invalid import page.');
  const ids=new Set<number>();
  for(const item of input.items){
    if(!item || !Number.isSafeInteger(item.source_id)||item.source_id<1||ids.has(item.source_id)||typeof item.title!=='string'||!item.title.trim()||item.title.length>2000||typeof item.content_html!=='string'||item.content_html.length>100000||!Array.isArray(item.categories)||item.categories.length>100||!item.categories.every(Number.isSafeInteger)||!item.details||typeof item.details!=='object') throw problem(400,'Invalid event data.');
    ids.add(item.source_id);
    try {const u=new URL(item.source_url);if(u.protocol!=='https:'||!['vilnius-events.lt','www.vilnius-events.lt'].includes(u.hostname))throw Error();} catch {throw problem(400,'Invalid source URL.');}
    if(item.featured_media!=null&&(!Number.isSafeInteger(item.featured_media)||item.featured_media<1)) throw problem(400,'Invalid image ID.');
    if((['published_at','modified_at'] as const).some(field=>item[field]!=null&&(typeof item[field]!=='string'||item[field].length>100))) throw problem(400,'Invalid source date.');
    if(fields.some(field=>item.details[field]!=null&&typeof item.details[field]!=='string'))throw problem(400,'Invalid event details.');
    const d=item.details;
    if((d.event_date&&!dateOk(d.event_date))||(d.event_end_date&&(!d.event_date||!dateOk(d.event_end_date)||d.event_end_date<d.event_date))||(d.event_time&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(d.event_time))||(d.venue?.length||0)>300||(d.ticket_url?.length||0)>2048) throw problem(400,'Invalid event details.');
    if(d.ticket_url){try{if(!['http:','https:'].includes(new URL(d.ticket_url).protocol))throw Error();}catch{throw problem(400,'Invalid ticket URL.');}}
  }
  const conn=await pool.getConnection();let added=0,updated=0;
  const changedEventIds: number[]=[];
  try {
    await conn.beginTransaction();
    try {
      const [state]=await conn.execute<RowDataPacket[]>('SELECT next_offset FROM source_state WHERE source_key=? FOR UPDATE',['vilnius-events']);
      if(state.length!==1)throw problem(409,'Source state is missing.');
      const [leases]=await conn.execute<Lease[]>('SELECT job_id,owner_hash,expires_at FROM job_leases WHERE source_key=? FOR UPDATE',['vilnius-events']);
      if(leases.length){const lease=leases[0],owner=input.job?.owner;
        if(!Number.isSafeInteger(input.job?.id)||input.job?.id!==Number(lease.job_id)||typeof owner!=='string'||!/^[a-f0-9]{64}$/.test(owner)||Number(lease.expires_at)<=Date.now()||!timingSafeEqual(Buffer.from(lease.owner_hash),Buffer.from(createHash('sha256').update(owner).digest('hex'))))throw problem(409,'An event import is already running or the import lease has expired.');
      } else if(input.job)throw problem(409,'The import lease has expired.');
      if(input.advance_cursor && Number(state[0].next_offset)!==input.expected_offset)throw problem(409,'Source cursor changed; refresh before retrying.');
      const now=new Date().toISOString();
      for(const item of input.items){
        const [existing]=await conn.execute<RowDataPacket[]>('SELECT * FROM vilnius_events WHERE source_id=?',[item.source_id]);
        const categories=JSON.stringify(item.categories), metadata=JSON.stringify({title:item.title,published_at:item.published_at||null,modified_at:item.modified_at||null,categories_json:categories,structured_details:Object.fromEntries(fields.map(field=>[field,item.details[field]??null])),featured_media:item.featured_media||null});
        if(!existing.length){
          const values=fields.map(field=>item.details[field]||null);
          await conn.execute('INSERT INTO vilnius_events(source_id,title,source_url,content_html,categories_json,featured_media,published_at,modified_at,first_seen_at,updated_at,event_date,event_end_date,event_time,venue,ticket_url,details_manual,review_status,details_checked_at,details_version,manual_fields) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[item.source_id,item.title,item.source_url,item.content_html,categories,item.featured_media||null,item.published_at||null,item.modified_at||null,now,now,...values,0,'unsure',null,0,'[]']);
          const [result]=await conn.execute<ResultSetHeader>('INSERT INTO events(title,event_date,event_end_date,event_time,venue,ticket_url,city,review_status,manual_fields,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[item.title,...values,city,'unsure','[]',now,now]);
          await conn.execute('INSERT INTO event_sources(event_id,source_key,source_id,source_url,content_html,source_data_json,last_checked_at) VALUES(?,?,?,?,?,?,?)',[result.insertId,'vilnius-events',String(item.source_id),item.source_url,item.content_html,metadata,null]);
          await history(conn,result.insertId,'imported','Vilnius Events',diff({},await snapshot(conn,result.insertId)),{source_id:item.source_id,job_id:input.job?.id});
          await queueAfterImport(conn,result.insertId,input.job?.id,input.verify_after_import!==false,input.publish_after_verification!==false);
          changedEventIds.push(result.insertId);
          added++;
        } else {
          const row=existing[0], [links]=await conn.execute<RowDataPacket[]>("SELECT event_id,source_data_json FROM event_sources WHERE source_key='vilnius-events' AND source_id=? FOR UPDATE",[String(item.source_id)]);
          if(links.length!==1)throw problem(409,'Event source is inconsistent.');
          const id=Number(links[0].event_id);
          const event=await lockEvent(conn,id);
          const before=await snapshot(conn,id,event);
          const manual=JSON.parse(event.manual_fields);if(!Array.isArray(manual))throw problem(409,'Event manual fields are inconsistent.');
          let priorMetadata: Snapshot = {};
          try { priorMetadata = jsonValue<Snapshot>(links[0].source_data_json) ?? {}; } catch { /* Older source payloads can be malformed. */ }
          const sourceChanged=row.content_html!==item.content_html||row.source_url!==item.source_url||(priorMetadata.title??row.title)!==item.title||row.featured_media!==(item.featured_media||null);
          const changed=row.modified_at!==(item.modified_at||null)||sourceChanged;
          const title=manual.includes('title')?event.title:item.title;
          const checked=changed?null:row.details_checked_at;
          const values=fields.map(field=>checked===null&&!manual.includes(field)?(item.details[field]??row[field]):row[field]);
          await conn.execute('UPDATE vilnius_events SET title=?,source_url=?,content_html=?,categories_json=?,featured_media=?,published_at=?,modified_at=?,updated_at=?,event_date=?,event_end_date=?,event_time=?,venue=?,ticket_url=?,details_checked_at=? WHERE source_id=?',[title,item.source_url,item.content_html,categories,item.featured_media||null,item.published_at||null,item.modified_at||null,now,...values,checked,item.source_id]);
          await conn.execute('UPDATE events SET title=?,event_date=?,event_end_date=?,event_time=?,venue=?,ticket_url=?,city=?,updated_at=? WHERE id=?',[title,...values,manual.includes('city')?event.city:city,now,id]);
          await conn.execute("UPDATE event_sources SET source_url=?,content_html=?,source_data_json=?,last_checked_at=?,detail_evidence_json=IF(?,NULL,detail_evidence_json) WHERE source_key='vilnius-events' AND source_id=?",[item.source_url,item.content_html,metadata,checked,changed,String(item.source_id)]);
          const sourceBefore={source_url:row.source_url,description:row.content_html,image_id:row.featured_media,source_title:priorMetadata.title??row.title,structured_details:priorMetadata.structured_details??null};
          const sourceAfter={source_url:item.source_url,description:item.content_html,image_id:item.featured_media||null,source_title:item.title,structured_details:jsonValue<Snapshot>(metadata).structured_details};
          if(await recordChange(conn,id,'source_refreshed','Vilnius Events',{...before,...sourceBefore},{...await snapshot(conn,id),...sourceAfter},{source_id:item.source_id,job_id:input.job?.id})){
            await queueAfterImport(conn,id,input.job?.id,input.verify_after_import!==false,input.publish_after_verification!==false);
            changedEventIds.push(id);
          }
          updated++;
        }
      }
      if(input.advance_cursor)await conn.execute('UPDATE source_state SET next_offset=?,total_available=?,updated_at=? WHERE source_key=?',[input.next_offset,input.total_available,now,'vilnius-events']);
      await conn.commit();return {added,updated,changedEventIds};
    }catch(cause){await conn.rollback();throw cause;}
  }finally{conn.release();}
}
import {createHash, timingSafeEqual} from 'node:crypto';
