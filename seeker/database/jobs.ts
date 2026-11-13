import type { DatabaseSync } from 'node:sqlite';

export type JobSource = 'musicbrainz' | 'vilnius-events';
export type JobProgress = Record<string, number>;

export function createJobRunner(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY, source TEXT NOT NULL, action TEXT NOT NULL, status TEXT NOT NULL,
    started_at TEXT NOT NULL, finished_at TEXT, progress_json TEXT NOT NULL DEFAULT '{}', error_message TEXT
  )`);
  db.prepare("UPDATE jobs SET status='interrupted',finished_at=?,error_message='Seeker stopped before this job finished. Completed work is saved.' WHERE status IN ('queued','running')").run(new Date().toISOString());
  function start(source: JobSource, action: string, work: (progress: (value: JobProgress) => void) => Promise<unknown>): number {
    if(db.prepare("SELECT id FROM jobs WHERE source=? AND status IN ('queued','running')").get(source)) throw Object.assign(new Error('A job for this source is already running.'),{status:409});
    const id=Number(db.prepare("INSERT INTO jobs(source,action,status,started_at) VALUES(?,?,'queued',?)").run(source,action,new Date().toISOString()).lastInsertRowid);
    setImmediate(async()=>{
      db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(id);
      const progress=(value: JobProgress)=>{db.prepare('UPDATE jobs SET progress_json=? WHERE id=?').run(JSON.stringify(value),id);};
      try { const result=await work(progress); db.prepare("UPDATE jobs SET status='completed',finished_at=?,progress_json=? WHERE id=?").run(new Date().toISOString(),JSON.stringify(result ?? {}),id); }
      catch(error) { db.prepare("UPDATE jobs SET status='failed',finished_at=?,error_message=? WHERE id=?").run(new Date().toISOString(),error instanceof Error?error.message:String(error),id); }
    });
    return id;
  }
  return {start, list:()=>db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT 20').all()};
}
