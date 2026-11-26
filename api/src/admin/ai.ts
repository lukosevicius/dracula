import {createHash,timingSafeEqual} from 'node:crypto';
import type {Pool, RowDataPacket, ResultSetHeader} from 'mysql2/promise';
import { eventTypes } from '../events/types.js';
interface Input { job?: {id: number; owner: string}; event_id: number; model: string; classification?: string; explanation?: string; performers: unknown[]; input_tokens: number; output_tokens: number; cost_usd: number; status: string; error_message?: string }
interface Lease extends RowDataPacket {job_id: number; owner_hash: string; expires_at: number | string; source: string}
const fail=(status: number,message: string)=>Object.assign(new Error(message),{status});
const source='vilnius-events';
export function createAi(pool: Pool){
  return {
    async eventIds(limit: number){if(!Number.isSafeInteger(limit)||limit<1||limit>5000)throw fail(400,'Invalid limit.');const [rows]=await pool.execute<RowDataPacket[]>('SELECT id FROM events ORDER BY event_date IS NULL,event_date,event_time IS NULL,event_time,id LIMIT ?',[limit]);return rows.map(row=>Number(row.id));},
    async artists(){const [rows]=await pool.execute<RowDataPacket[]>('SELECT mbid,name,aliases_json FROM artists',[]);return rows;},
    async event(id: number){const [rows]=await pool.execute<RowDataPacket[]>('SELECT e.title,s.content_html FROM events e JOIN event_sources s ON s.id=(SELECT id FROM event_sources WHERE event_id=e.id ORDER BY id LIMIT 1) WHERE e.id=?',[id]);return rows[0]||null;},
    async list(){const [rows]=await pool.execute<RowDataPacket[]>('SELECT a.*,e.title,e.review_status FROM ai_evaluations a JOIN events e ON e.id=a.event_id ORDER BY a.id DESC LIMIT 1000',[]);if(!rows.length)return rows;const ids=[...new Set(rows.map(row=>row.event_id))];const [decisions]=await pool.execute<RowDataPacket[]>(`SELECT event_id,artist_mbid AS mbid,decision FROM event_artist_decisions WHERE event_id IN (${ids.map(()=>'?').join(',')})`,ids);return rows.map(row=>({...row,artist_decisions_json:JSON.stringify(decisions.filter(d=>d.event_id===row.event_id).map(({mbid,decision})=>({mbid,decision})))}));},
    async decision(id: number,decision: unknown){if(!Number.isSafeInteger(id)||id<1||(typeof decision!=='string'||!['accepted','dismissed'].includes(decision)))throw fail(400,'Invalid decision.');const [result]=await pool.execute<ResultSetHeader>('UPDATE ai_evaluations SET review_decision=? WHERE id=?',[decision,id]);if(!result.affectedRows)throw fail(404,'Result not found.');},
    async save(input: unknown){
      const {job,event_id,model,classification,explanation,performers,input_tokens,output_tokens,cost_usd,status,error_message}=(input||{}) as Input;
      if(!Number.isSafeInteger(event_id)||event_id<1||!['gemini-3.5-flash-lite','gemini-4-hydrogen'].includes(model)||!['completed','failed'].includes(status)||!Number.isSafeInteger(input_tokens)||input_tokens<0||!Number.isSafeInteger(output_tokens)||output_tokens<0||!Number.isFinite(cost_usd)||cost_usd<0||!Array.isArray(performers)||JSON.stringify(performers).length>200000||(status==='completed'&&((typeof classification!=='string'||!(eventTypes as readonly string[]).includes(classification))||typeof explanation!=='string'))||(explanation!=null&&(typeof explanation!=='string'||explanation.length>20000))||(error_message!=null&&(typeof error_message!=='string'||error_message.length>1000)))throw fail(400,'Invalid AI result.');
      const conn=await pool.getConnection();try{await conn.beginTransaction();try{
        const [state]=await conn.execute<RowDataPacket[]>('SELECT source_key FROM source_state WHERE source_key=? FOR UPDATE',[source]);if(!state.length)throw fail(409,'Source state is missing.');
        const [leases]=await conn.execute<Lease[]>('SELECT l.job_id,l.owner_hash,l.expires_at,j.source FROM job_leases l JOIN jobs j ON j.id=l.job_id WHERE l.source_key=? FOR UPDATE',[source]);const lease=leases[0],owner=job?.owner;
        if(!lease||lease.source!=='ai-evaluation'||!job||job.id!==Number(lease.job_id)||typeof owner!=='string'||!/^[a-f0-9]{64}$/.test(owner)||Number(lease.expires_at)<=Date.now()||!timingSafeEqual(Buffer.from(lease.owner_hash),Buffer.from(createHash('sha256').update(owner).digest('hex'))))throw fail(409,'The evaluation lease has expired.');
        await conn.execute('INSERT INTO ai_evaluations(job_id,event_id,model,created_at,classification,explanation,performers_json,input_tokens,output_tokens,cost_usd,status,error_message,review_decision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',[job.id,event_id,model,new Date().toISOString(),classification||null,explanation||null,JSON.stringify(performers),input_tokens,output_tokens,cost_usd,status,error_message||null,'pending']);await conn.commit();
      }catch(error){await conn.rollback();throw error;}}finally{conn.release();}
    }
  };
}
