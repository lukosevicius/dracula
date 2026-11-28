import { validateImportClaim } from '../verification/agents.js';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const eventSource = 'vilnius-events', artistSource = 'musicbrainz-lithuania-artists', leaseMs = 60000;
interface Lease extends RowDataPacket { job_id: number; run_id: number | null; import_run_id: number | null; owner_hash: string; expires_at: number | string }
type Progress = { fetched: number; added: number; updated: number; completed?: number; total?: number; failed?: number; cost_usd?: number; images?:number; image_failed?:number };
const progressKeys = ['completed','total','failed','cost_usd','images','image_failed'] as const;
function counts(value: unknown): Progress {
  if (!value || typeof value !== 'object') throw fail(400,'Invalid progress.');
  const data = value as Record<string, unknown>;
  const number = (key: string): number => {
    const item = data[key];
    if (typeof item !== 'number' || !Number.isSafeInteger(item) || item < 0) throw fail(400,'Invalid progress.');
    return item;
  };
  const result: Progress = {fetched:number('fetched'),added:number('added'),updated:number('updated')};
  for (const key of progressKeys) {
    const item = data[key];
    if (item !== undefined) {
      if (typeof item !== 'number' || !Number.isFinite(item) || item < 0 || (key !== 'cost_usd' && !Number.isSafeInteger(item))) throw fail(400,'Invalid progress.');
      result[key] = item;
    }
  }
  return result;
}
export function createJobs(pool: Pool) {
  async function locked<T>(source: string, fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
    const conn=await pool.getConnection();
    try {
      await conn.beginTransaction();
      try {
        const [rows]=await conn.execute<RowDataPacket[]>('SELECT source_key FROM source_state WHERE source_key=? FOR UPDATE',[source]);
        if(rows.length!==1)throw fail(409,'Source state is missing.');
        const value=await fn(conn);await conn.commit();return value;
      } catch(cause) { await conn.rollback();throw cause; }
    } finally {conn.release();}
  }
  return {
    async list() { const [rows]=await pool.execute<RowDataPacket[]>('SELECT * FROM jobs ORDER BY id DESC LIMIT 20',[]);return rows; },
    async start(action: unknown, kind: unknown='vilnius-events', limit: unknown=0, request?: unknown) {
      if(typeof kind!=='string'||!['vilnius-events','avilys','kakava','musicbrainz','ai-evaluation'].includes(kind))throw fail(400,'Invalid job source.');
      const source=kind==='musicbrainz'?artistSource:eventSource;
      if(typeof action!=='string'||(kind==='musicbrainz'?(!['next','start','all'].includes(action)||(action!=='all'&&(typeof limit!=='number'||!Number.isInteger(limit)||limit<1||limit>1000))):kind==='ai-evaluation'?action!=='analyze':kind==='avilys'?(action!=='import'||typeof limit!=='number'||!Number.isInteger(limit)||limit<1||limit>200):kind==='kakava'?(action!=='import'||typeof limit!=='number'||!Number.isInteger(limit)||limit<1||limit>1000):!['next','start','sample','refresh','download-images','details','refresh-details','details-event','refresh-all-details','refresh-upcoming-details'].includes(action)))throw fail(400,'Invalid job action.');
      return locked(source,async conn=>{
        const [existing]=await conn.execute<Lease[]>('SELECT * FROM job_leases WHERE source_key=? FOR UPDATE',[source]);
        const now=Date.now(),date=new Date(now).toISOString();
        if(existing.length && Number(existing[0].expires_at)>now)throw fail(409,'An event import is already running.');
        if(existing.length){const old=existing[0];await conn.execute("UPDATE jobs SET status='interrupted',finished_at=?,error_message=? WHERE id=? AND status IN ('queued','running')",[date,'Seeker stopped before the import finished. Completed pages are saved.',old.job_id]);await conn.execute("UPDATE vilnius_event_runs SET status='failed',finished_at=?,error_message=? WHERE id=? AND status='running'",[date,'Seeker stopped before the import finished. Completed pages are saved.',old.run_id]);await conn.execute("UPDATE import_runs SET status='failed',finished_at=?,error_message=? WHERE id=? AND status='running'",[date,'Seeker stopped before the import finished. Completed pages are saved.',old.import_run_id]);await conn.execute('DELETE FROM job_leases WHERE source_key=?',[source]);}
        const requestId=await validateImportClaim(conn,request,kind,action);
        const [job]=await conn.execute<ResultSetHeader>("INSERT INTO jobs(source,action,status,started_at,progress_json) VALUES(?,?,'running',?,'{}')",[kind,action,date]);
        let runId: number | null=null,importRunId: number | null=null;
        if(kind==='vilnius-events'&&['next','start','sample','refresh'].includes(action)){const [run]=await conn.execute<ResultSetHeader>("INSERT INTO vilnius_event_runs(started_at,status,fetched_count,added_count,updated_count) VALUES(?,'running',0,0,0)",[date]);runId=run.insertId;}
        else if(kind==='musicbrainz'){const [run]=await conn.execute<ResultSetHeader>("INSERT INTO import_runs(started_at,requested_limit,fetched_count,added_count,updated_count,status,mode) VALUES(?,?,0,0,0,'running',?)",[date,action==='all'?-1:limit as number,action]);importRunId=run.insertId;}
        const owner=randomBytes(32).toString('hex');await conn.execute('INSERT INTO job_leases(source_key,job_id,run_id,import_run_id,owner_hash,expires_at) VALUES(?,?,?,?,?,?)',[source,job.insertId,runId,importRunId,hash(owner),now+leaseMs]);
        if(requestId)await conn.execute('UPDATE seeker_import_requests SET job_id=?,claim=NULL,lease_until=NULL WHERE id=?',[job.insertId,requestId]);
        return {id:job.insertId,owner};
      });
    },
    async update(id: number,input: Record<string, unknown>) {
      if(!Number.isSafeInteger(id)||id<1||typeof input?.owner!=='string'||!/^[a-f0-9]{64}$/.test(input.owner)||typeof input.status!=='string'||!['running','completed','failed'].includes(input.status))throw fail(400,'Invalid job update.');
      const owner=input.owner,status=input.status,progress=counts(input.progress),message=input.status==='failed'?String(input.error||'Import failed.').slice(0,1000):null;
      const source=input.source==='musicbrainz'?artistSource:eventSource;
      await locked(source,async conn=>{const [rows]=await conn.execute<Lease[]>('SELECT * FROM job_leases WHERE source_key=? FOR UPDATE',[source]);const lease=rows[0];
        if(!lease || Number(lease.job_id)!==id || Number(lease.expires_at)<=Date.now() || !timingSafeEqual(Buffer.from(lease.owner_hash),Buffer.from(hash(owner))))throw fail(409,'The import lease has expired.');
        const finished=input.status==='running'?null:new Date().toISOString();
        await conn.execute('UPDATE jobs SET status=?,finished_at=?,progress_json=?,error_message=? WHERE id=?',[status,finished,JSON.stringify(progress),message,id]);
        await conn.execute('UPDATE vilnius_event_runs SET status=?,finished_at=?,fetched_count=?,added_count=?,updated_count=?,error_message=? WHERE id=?',[status,finished,progress.fetched,progress.added,progress.updated,message,lease.run_id]);
        await conn.execute('UPDATE import_runs SET status=?,finished_at=?,fetched_count=?,added_count=?,updated_count=?,error_message=? WHERE id=?',[status,finished,progress.fetched,progress.added,progress.updated,message,lease.import_run_id]);
        if(finished)await conn.execute('DELETE FROM job_leases WHERE source_key=?',[source]);else await conn.execute('UPDATE job_leases SET expires_at=? WHERE source_key=?',[Date.now()+leaseMs,source]);
      });
    }
  };
}
