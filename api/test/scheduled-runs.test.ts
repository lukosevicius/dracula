import test from 'node:test';
import assert from 'node:assert/strict';
import { saveScheduledRun } from '../dist/imports/scheduled-runs.js';

const run = {
  started_at: '2026-11-28T03:17:02.000Z', finished_at: '2026-11-28T03:21:40.000Z', origin: 'github', mode: 'daily',
  run_url: 'https://github.com/owner/dracula/actions/runs/123',
  steps: [{ name: 'Avilys import', status: 'completed', summary: 'added 9' }, { name: 'Artist matching', status: 'failed', summary: 'HTTP 502' }],
};

test('saves a scheduled run as failed when any step failed', async () => {
  const saved: unknown[][] = [];
  const pool = { execute: async (_sql: string, values: unknown[]) => { saved.push(values); return [[]]; } };
  await saveScheduledRun(pool as never, run);
  assert.equal(saved[0][4], 'failed');
  assert.equal(JSON.parse(String(saved[0][5])).length, 2);
});

test('rejects runs with a bad origin, step or link', async () => {
  const pool = { execute: async () => [[]] };
  for (const bad of [{ ...run, origin: 'laptop' }, { ...run, steps: [{ name: 'x', status: 'maybe', summary: '' }] }, { ...run, run_url: 'https://example.com/x' }, { ...run, started_at: 'yesterday' }]) {
    await assert.rejects(saveScheduledRun(pool as never, bad), /Invalid scheduled run/);
  }
});

test('lists the events a run or a job added, without listings matched to existing events', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { addedEvents } = await import('../dist/imports/scheduled-runs.js');
  const db = new DatabaseSync(':memory:');
  db.function('JSON_UNQUOTE', (value: unknown) => value as string);
  db.exec(`CREATE TABLE scheduled_runs(id INTEGER PRIMARY KEY,started_at TEXT,finished_at TEXT);
    CREATE TABLE jobs(id INTEGER PRIMARY KEY,started_at TEXT);
    CREATE TABLE events(id INTEGER PRIMARY KEY,title TEXT,event_date TEXT,event_time TEXT,venue TEXT,city TEXT,publication_status TEXT,review_status TEXT);
    CREATE TABLE event_history(event_id INTEGER,action TEXT,actor TEXT,context TEXT);
    INSERT INTO scheduled_runs VALUES(1,'2026-11-28T03:00:00.000Z','2026-11-28T03:30:00.000Z');
    INSERT INTO jobs VALUES(7,'2026-11-28T03:01:00.000Z'),(8,'2026-11-28T03:10:00.000Z'),(9,'2026-11-28T09:00:00.000Z');
    INSERT INTO events VALUES(1,'B','2026-12-02','20:00','Club','Vilnius','live','music'),(2,'A','2026-12-01',NULL,NULL,'Kaunas','draft','unsure'),
      (3,'Existing','2026-12-01',NULL,NULL,NULL,'live','music'),(4,'Later job','2026-12-03',NULL,NULL,NULL,'live','music');
    INSERT INTO event_history VALUES(1,'imported','Kakava','{"source_id":5,"job_id":8}'),(2,'imported','Avilys','{"source_id":6,"job_id":7}'),
      (3,'source_attached','Kakava','{"source_key":"kakava","job_id":8}'),(4,'imported','Kakava','{"job_id":9}'),(99,'imported','Kakava','{"job_id":8}');`);
  const pool = { execute: async (sql: string, params: import('node:sqlite').SQLInputValue[] = []) => [db.prepare(sql).all(...params)] } as unknown as import('mysql2/promise').Pool;
  try {
    const run = await addedEvents(pool, new URLSearchParams('run=1'));
    assert.deepEqual(run.jobs, [7, 8]);
    assert.deepEqual(run.events.map(event => [event.title, event.source]), [['A', 'Avilys'], ['B', 'Kakava']]);
    assert.deepEqual((await addedEvents(pool, new URLSearchParams('job=9'))).events.map(event => event.id), [4]);
    for (const bad of ['', 'run=1&job=9', 'job=abc']) await assert.rejects(addedEvents(pool, new URLSearchParams(bad)), { status: 400 });
    await assert.rejects(addedEvents(pool, new URLSearchParams('run=5')), { status: 404 });
  } finally { db.close(); }
});
