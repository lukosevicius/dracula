import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const hash=value=>createHash('sha256').update(value).digest('hex');
const eventSource='vilnius-events', artistSource='musicbrainz-lithuania-artists', leaseMs=60000;
const counts=value=>{if(!value||!['fetched','added','updated'].every(k=>Number.isSafeInteger(value[k])&&value[k]>=0))throw fail(400,'Invalid progress.');const result={fetched:value.fetched,added:value.added,updated:value.updated};for(const key of ['completed','total','failed','cost_usd'])if(value[key]!==undefined){if(!Number.isFinite(value[key])||value[key]<0||(key!=='cost_usd'&&!Number.isSafeInteger(value[key])))throw fail(400,'Invalid progress.');result[key]=value[key];}return result;};

export function createJobs(pool) {
  async function locked(source,fn){const conn=await pool.getConnection();try{await conn.beginTransaction();try{const [rows]=await conn.execute('SELECT source_key FROM source_state WHERE source_key=? FOR UPDATE',[source]);if(rows.length!==1)throw fail(409,'Source state is missing.');const value=await fn(conn);await conn.commit();return value;}catch(cause){await conn.rollback();throw cause;}}finally{conn.release();}}
  return {
    async list(){const [rows]=await pool.execute('SELECT * FROM jobs ORDER BY id DESC LIMIT 20',[]);return rows;},
    async start(action,kind='vilnius-events',limit=0){
      if(!['vilnius-events','musicbrainz','ai-evaluation'].includes(kind))throw fail(400,'Invalid job source.');
      const source=kind==='musicbrainz'?artistSource:eventSource;
      if(kind==='musicbrainz'?(!['next','start','all'].includes(action)||(action!=='all'&&(!Number.isInteger(limit)||limit<1||limit>1000))):kind==='ai-evaluation'?action!=='analyze':!['next','start','sample','refresh','download-images','details','refresh-details','details-event','refresh-all-details'].includes(action))throw fail(400,'Invalid job action.');
      return locked(source,async conn=>{
        const [existing]=await conn.execute('SELECT * FROM job_leases WHERE source_key=? FOR UPDATE',[source]);
        const now=Date.now(),date=new Date(now).toISOString();
        if(existing.length && Number(existing[0].expires_at)>now)throw fail(409,'An event import is already running.');
        if(existing.length){const old=existing[0];await conn.execute("UPDATE jobs SET status='interrupted',finished_at=?,error_message=? WHERE id=? AND status IN ('queued','running')",[date,'Seeker stopped before the import finished. Completed pages are saved.',old.job_id]);await conn.execute("UPDATE vilnius_event_runs SET status='failed',finished_at=?,error_message=? WHERE id=? AND status='running'",[date,'Seeker stopped before the import finished. Completed pages are saved.',old.run_id]);await conn.execute("UPDATE import_runs SET status='failed',finished_at=?,error_message=? WHERE id=? AND status='running'",[date,'Seeker stopped before the import finished. Completed pages are saved.',old.import_run_id]);await conn.execute('DELETE FROM job_leases WHERE source_key=?',[source]);}
        const [job]=await conn.execute("INSERT INTO jobs(source,action,status,started_at,progress_json) VALUES(?,?,'running',?,'{}')",[kind,action,date]);
        let runId=null,importRunId=null;if(kind==='vilnius-events'&&['next','start','sample','refresh'].includes(action)){const [run]=await conn.execute("INSERT INTO vilnius_event_runs(started_at,status,fetched_count,added_count,updated_count) VALUES(?,'running',0,0,0)",[date]);runId=run.insertId;}else if(kind==='musicbrainz'){const [run]=await conn.execute("INSERT INTO import_runs(started_at,requested_limit,fetched_count,added_count,updated_count,status,mode) VALUES(?,?,0,0,0,'running',?)",[date,action==='all'?-1:limit,action]);importRunId=run.insertId;}
        const owner=randomBytes(32).toString('hex');await conn.execute('INSERT INTO job_leases(source_key,job_id,run_id,import_run_id,owner_hash,expires_at) VALUES(?,?,?,?,?,?)',[source,job.insertId,runId,importRunId,hash(owner),now+leaseMs]);
        return {id:job.insertId,owner};
      });
    },
    async update(id,input){
      if(!Number.isSafeInteger(id)||id<1||typeof input?.owner!=='string'||!/^[a-f0-9]{64}$/.test(input.owner)||!['running','completed','failed'].includes(input.status))throw fail(400,'Invalid job update.');
      const progress=counts(input.progress),message=input.status==='failed'?String(input.error||'Import failed.').slice(0,1000):null;
      const source=input.source==='musicbrainz'?artistSource:eventSource;
      await locked(source,async conn=>{const [rows]=await conn.execute('SELECT * FROM job_leases WHERE source_key=? FOR UPDATE',[source]);const lease=rows[0];
        if(!lease || Number(lease.job_id)!==id || Number(lease.expires_at)<=Date.now() || !timingSafeEqual(Buffer.from(lease.owner_hash),Buffer.from(hash(input.owner))))throw fail(409,'The import lease has expired.');
        const finished=input.status==='running'?null:new Date().toISOString();
        await conn.execute('UPDATE jobs SET status=?,finished_at=?,progress_json=?,error_message=? WHERE id=?',[input.status,finished,JSON.stringify(progress),message,id]);
        await conn.execute('UPDATE vilnius_event_runs SET status=?,finished_at=?,fetched_count=?,added_count=?,updated_count=?,error_message=? WHERE id=?',[input.status,finished,progress.fetched,progress.added,progress.updated,message,lease.run_id]);
        await conn.execute('UPDATE import_runs SET status=?,finished_at=?,fetched_count=?,added_count=?,updated_count=?,error_message=? WHERE id=?',[input.status,finished,progress.fetched,progress.added,progress.updated,message,lease.import_run_id]);
        if(finished)await conn.execute('DELETE FROM job_leases WHERE source_key=?',[source]);else await conn.execute('UPDATE job_leases SET expires_at=? WHERE source_key=?',[Date.now()+leaseMs,source]);
      });
    }
  };
}
