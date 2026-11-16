import {createHash,timingSafeEqual} from 'node:crypto';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const fields=['event_date','event_end_date','event_time','venue','ticket_url'];
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;

export async function enrichEvent(pool,id,input){
  if(!Number.isSafeInteger(id)||id<1||!input||!input.details||fields.some(k=>input.details[k]!=null&&typeof input.details[k]!=='string')||!['free','paid','unknown'].includes(input.price_type)||(input.price_text!=null&&(typeof input.price_text!=='string'||input.price_text.length>300)))throw fail(400,'Invalid enrichment.');
  const d=input.details;if((d.event_date&&!validDate(d.event_date))||(d.event_end_date&&(!d.event_date||!validDate(d.event_end_date)||d.event_end_date<d.event_date))||(d.event_time&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(d.event_time))||(d.venue?.length||0)>300||(d.ticket_url?.length||0)>2048)throw fail(400,'Invalid event details.');
  for(const value of [d.ticket_url,input.about_url])if(value){try{if(typeof value!=='string'||value.length>2048||!['http:','https:'].includes(new URL(value).protocol))throw Error();}catch{throw fail(400,'Invalid URL.');}}
  if(typeof input.expected_source_url!=='string'||typeof input.expected_content_html!=='string')throw fail(400,'Missing source version.');
  const conn=await pool.getConnection();try{await conn.beginTransaction();try{
    const [state]=await conn.execute('SELECT source_key FROM source_state WHERE source_key=? FOR UPDATE',['vilnius-events']);if(!state.length)throw fail(409,'Source state is missing.');
    const [leases]=await conn.execute('SELECT job_id,owner_hash,expires_at FROM job_leases WHERE source_key=? FOR UPDATE',['vilnius-events']);
    const lease=leases[0],owner=input.job?.owner;if(!lease||!Number.isSafeInteger(input.job?.id)||input.job.id!==Number(lease.job_id)||typeof owner!=='string'||!/^[a-f0-9]{64}$/.test(owner)||Number(lease.expires_at)<=Date.now()||!timingSafeEqual(Buffer.from(lease.owner_hash),Buffer.from(createHash('sha256').update(owner).digest('hex'))))throw fail(409,'The import lease is invalid or has expired.');
    const [links]=await conn.execute("SELECT source_id,source_url,content_html FROM event_sources WHERE event_id=? AND source_key='vilnius-events' FOR UPDATE",[id]);if(links.length!==1)throw fail(404,'Event not found.');
    if(links[0].source_url!==input.expected_source_url||links[0].content_html!==input.expected_content_html)throw fail(409,'Source changed while details were fetched.');
    const sourceId=Number(links[0].source_id),[rows]=await conn.execute('SELECT * FROM vilnius_events WHERE source_id=? FOR UPDATE',[sourceId]);if(rows.length!==1)throw fail(409,'Event source is inconsistent.');
    const row=rows[0],manual=JSON.parse(row.manual_fields);if(!Array.isArray(manual))throw fail(409,'Event manual fields are inconsistent.');
    const values=fields.map(field=>manual.includes(field)?row[field]:(d[field]??row[field]));const now=new Date().toISOString();
    await conn.execute('UPDATE vilnius_events SET event_date=?,event_end_date=?,event_time=?,venue=?,ticket_url=?,details_checked_at=?,details_version=1 WHERE source_id=?',[...values,now,sourceId]);
    await conn.execute('UPDATE events SET event_date=?,event_end_date=?,event_time=?,venue=?,ticket_url=?,updated_at=? WHERE id=?',[...values,now,id]);
    await conn.execute("UPDATE event_sources SET about_url=?,about_checked_at=?,last_checked_at=? WHERE event_id=? AND source_key='vilnius-events'",[input.about_url||null,now,now,id]);
    await conn.execute('INSERT INTO event_prices(event_id,price_text,price_type,manual,checked_at) VALUES(?,?,?,0,?) ON DUPLICATE KEY UPDATE price_text=IF(manual=0,VALUES(price_text),price_text),price_type=IF(manual=0,VALUES(price_type),price_type),checked_at=IF(manual=0,VALUES(checked_at),checked_at)',[id,input.price_text||null,input.price_type,now]);
    await conn.commit();
  }catch(cause){await conn.rollback();throw cause;}}finally{conn.release();}
}
