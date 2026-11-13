import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createJobRunner } from '../database/jobs.js';

test('jobs start in background, report progress and reject duplicate source jobs', async () => {
  const db = new DatabaseSync(':memory:');
  const runner = createJobRunner(db);
  let finish: (() => void) | undefined;
  const id = runner.start('vilnius-events','next',async progress=>{
    progress({fetched:10});
    await new Promise<void>(resolve=>{finish=resolve;});
    return {fetched:10,added:3};
  });
  assert.throws(()=>runner.start('vilnius-events','next',async()=>({})),/already running/);
  await new Promise(resolve=>setImmediate(resolve));
  let job=db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
  assert.equal(job.status,'running');
  assert.deepEqual(JSON.parse(String(job.progress_json)),{fetched:10});
  finish!();
  await new Promise(resolve=>setImmediate(resolve));
  job=db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
  assert.equal(job.status,'completed');
  assert.deepEqual(JSON.parse(String(job.progress_json)),{fetched:10,added:3});
  db.close();
});

test('unfinished jobs are marked interrupted after restart', () => {
  const db=new DatabaseSync(':memory:');
  createJobRunner(db);
  db.prepare("INSERT INTO jobs(source,action,status,started_at) VALUES('musicbrainz','all','running',?)").run(new Date().toISOString());
  createJobRunner(db);
  assert.equal(db.prepare('SELECT status FROM jobs').get().status,'interrupted');
  db.close();
});
