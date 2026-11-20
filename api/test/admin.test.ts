import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createAdmin } from '../dist/admin/admin.js';
import { createApp } from '../test-support/nest.ts';
import { createCatalogue } from '../test-support/nest.ts';

const token = '0123456789abcdef0123456789abcdef';
const artist = 'f5e813d7-0f2e-499a-9d07-9c38d955837d';

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE events(id INTEGER PRIMARY KEY,review_status TEXT,title TEXT,event_date TEXT,event_end_date TEXT,event_time TEXT,venue TEXT,ticket_url TEXT,manual_fields TEXT);
    CREATE TABLE event_sources(id INTEGER PRIMARY KEY,event_id INTEGER,source_key TEXT,source_id TEXT,source_url TEXT,about_url TEXT,content_html TEXT,last_checked_at TEXT);
    CREATE TABLE vilnius_events(source_id INTEGER PRIMARY KEY,review_status TEXT,featured_media INTEGER,event_date TEXT,event_end_date TEXT,event_time TEXT,venue TEXT,ticket_url TEXT,manual_fields TEXT,details_manual INTEGER);
    CREATE TABLE vilnius_images(media_id INTEGER,local_name TEXT);
    CREATE TABLE event_images(event_id INTEGER,source_key TEXT,source_id TEXT,source_url TEXT,local_name TEXT,mime_type TEXT,width INTEGER,height INTEGER);
    CREATE TABLE artists(mbid TEXT PRIMARY KEY,name TEXT);
    CREATE TABLE vilnius_event_artists(event_id INTEGER,artist_mbid TEXT,decision TEXT,PRIMARY KEY(event_id,artist_mbid));
    CREATE TABLE event_artist_decisions(event_id INTEGER,artist_mbid TEXT,decision TEXT,PRIMARY KEY(event_id,artist_mbid));
    CREATE TABLE event_prices(event_id INTEGER PRIMARY KEY,price_text TEXT,price_type TEXT,manual INTEGER,checked_at TEXT);
    CREATE TABLE assistant_event_reviews(event_id INTEGER,reviewed_at TEXT,confirmed_at TEXT,notes TEXT);
    CREATE TABLE source_state(source_key TEXT,next_offset INTEGER);
    CREATE TABLE vilnius_event_runs(id INTEGER);
    INSERT INTO events VALUES(1,'unsure','Tést &amp; show','2026-11-20',NULL,NULL,NULL,NULL,'[]'); INSERT INTO event_sources VALUES(1,1,'vilnius-events','99','https://example.com',NULL,'Description',NULL);
    INSERT INTO vilnius_events VALUES(99,'unsure',NULL,'2026-11-20',NULL,NULL,NULL,NULL,'[]',0); INSERT INTO artists VALUES('${artist}','Artist');`);
  db.exec('ALTER TABLE events ADD COLUMN interest_score INTEGER NOT NULL DEFAULT 1');
  const connection = {
    async beginTransaction() { db.exec('BEGIN'); }, async commit() { db.exec('COMMIT'); },
    async rollback() { db.exec('ROLLBACK'); }, release() {},
    async execute(sql: string, params: import('node:sqlite').SQLInputValue[]) {
      const query=sql.replace(/ FOR UPDATE$/, '');
      const statement=db.prepare(query);
      return [/^SELECT/i.test(query) ? statement.all(...params) : statement.run(...params)];
    }
  };
  const pool={getConnection:async()=>connection,execute:(sql: string,params: import('node:sqlite').SQLInputValue[])=>connection.execute(sql,params)} as unknown as import('mysql2/promise').Pool;
  return {db,admin:createAdmin(pool,token),catalogue:createCatalogue(pool,'https://api.example.com')};
}

test('admin edits update both representations and roll back on error', async () => {
  const {db,admin,catalogue}=setup();
  try {
    assert.equal(await catalogue.get(1,'2026-11-15'),null);
    await admin.review(1,{review_status:'music'});
    assert.equal((await catalogue.get(1,'2026-11-15')).title,'Tést &amp; show');
    const list=await admin.listEvents(new URLSearchParams({when:'all',search:'test &'}));
    assert.equal(list.total,1); assert.equal(list.events[0].id,1);
    assert.equal(db.prepare('SELECT review_status FROM events').get()!.review_status,'music');
    assert.equal(db.prepare('SELECT review_status FROM vilnius_events').get()!.review_status,'music');
    await admin.artist(1,{mbid:artist,decision:'accepted'});
    assert.equal(db.prepare('SELECT decision FROM event_artist_decisions').get()!.decision,'accepted');
    assert.equal(db.prepare('SELECT decision FROM vilnius_event_artists').get()!.decision,'accepted');
    db.exec("CREATE TRIGGER fail_artist BEFORE INSERT ON event_artist_decisions BEGIN SELECT RAISE(ABORT,'test failure'); END");
    await assert.rejects(admin.artist(1,{mbid:artist,decision:'dismissed'}));
    assert.equal(db.prepare('SELECT decision FROM event_artist_decisions').get()!.decision,'accepted');
    assert.equal(db.prepare('SELECT decision FROM vilnius_event_artists').get()!.decision,'accepted');
    await admin.price(1,{price_text:' Nemokama ',price_type:'free'});
    assert.equal(db.prepare('SELECT price_text FROM event_prices').get()!.price_text,'Nemokama');
    assert.equal((await catalogue.get(1,'2026-11-15')).price_type,'free');
    await assert.rejects(admin.details(1,{review_status:'music',event_date:'2026-02-30'}), {status:400});
    await admin.details(1,{review_status:'music',event_date:'2026-11-20',event_end_date:'2026-11-21',venue:' Club '});
    assert.equal(db.prepare('SELECT venue FROM events').get()!.venue,'Club');
    assert.equal(db.prepare('SELECT venue FROM vilnius_events').get()!.venue,'Club');
    assert.deepEqual(JSON.parse(String(db.prepare('SELECT manual_fields FROM events').get()!.manual_fields)),['event_end_date','venue']);
    assert.equal(db.prepare('SELECT details_manual FROM vilnius_events').get()!.details_manual,1);
    await assert.rejects(admin.review(1,{review_status:'invalid'}), {status:400});
  } finally {db.close();}
});

test('admin routes require a bearer token and validate requests', async () => {
  const {db,admin}=setup();
  const app=createApp({},'/nonexistent',admin);
  await new Promise<void>(resolve=>app.listen(0,'127.0.0.1',resolve));
  try {
    const url=`http://127.0.0.1:${app.address().port}/v1/admin/events/1/review`;
    const read=`http://127.0.0.1:${app.address().port}/v1/admin/events/1`;
    assert.equal((await fetch(read)).status,401);
    const privateEvent=await fetch(read,{headers:{authorization:`Bearer ${token}`}});
    assert.equal((await privateEvent.json()).event.review_status,'unsure');
    const missing=await fetch(`http://127.0.0.1:${app.address().port}/v1/admin/events/999`,{headers:{authorization:`Bearer ${token}`}});
    assert.equal(missing.status,404);
    const post=(authorization: string,body: string,contentType='application/json')=>fetch(url,{method:'POST',headers:{authorization,'content-type':contentType},body});
    assert.equal((await post('Bearer wrong',JSON.stringify({review_status:'music'}))).status,401);
    assert.equal(db.prepare('SELECT review_status FROM events').get()!.review_status,'unsure');
    assert.equal((await post(`Bearer ${token}`,'{}','text/plain')).status,415);
    assert.equal((await post(`Bearer ${token}`,'{')).status,400);
    assert.equal((await post(`Bearer ${token}`,JSON.stringify({review_status:'music',padding:'x'.repeat(8192)}))).status,413);
    assert.equal((await post(`Bearer ${token}`,JSON.stringify({review_status:'music'}))).status,200);
    assert.equal(db.prepare('SELECT review_status FROM events').get()!.review_status,'music');
  } finally {await new Promise<void>((resolve,reject)=>app.close(error=>error ? reject(error) : resolve()));db.close();}
});

test('admin endpoints are disabled without configuration', async () => {
  const app=createApp({},'/nonexistent');
  await new Promise<void>(resolve=>app.listen(0,'127.0.0.1',resolve));
  try {
    const response=await fetch(`http://127.0.0.1:${app.address().port}/v1/admin/events/1/review`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:'{"review_status":"music"}'});
    assert.equal(response.status,404);
    assert.throws(()=>createAdmin({} as unknown as import('mysql2/promise').Pool,'weak'),/at least 32 URL-safe/);
  } finally {await new Promise<void>((resolve,reject)=>app.close(error=>error ? reject(error) : resolve()));}
});
