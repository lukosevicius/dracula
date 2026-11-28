import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {importKakavaPage} from '../dist/imports/kakava.js';
import {createCatalogue, addMergeTables } from '../test-support/nest.ts';

const show={id:27822,eventId:8562,title:'Koncertas',slug:'koncertas',startTime:'2026-12-05T19:00',endTime:'2026-12-05T21:00',venueName:'Kablys',venueAddress:'Kauno g. 5, Vilnius, Lietuva',city:'Vilnius',description:'<p>Gyvai</p>',imageUrl:'https://res.cloudinary.com/kakavalt/image/fetch/x.jpg',priceFrom:26.6,status:['SELLING'],promoter:'Promo',sourceUrl:'https://kakava.lt/renginys/koncertas/8562'};

test('Kakava imports dated concerts, keep edits on refresh, and validate input',async()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE events(id INTEGER PRIMARY KEY, title TEXT,event_date TEXT,event_end_date TEXT,event_time TEXT,venue TEXT,ticket_url TEXT,city TEXT,review_status TEXT,manual_fields TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE event_sources(id INTEGER PRIMARY KEY,event_id INTEGER,source_key TEXT,source_id TEXT,source_url TEXT,content_html TEXT,source_data_json TEXT,last_checked_at TEXT,about_url TEXT, UNIQUE(source_key,source_id));
    CREATE TABLE job_leases(source_key TEXT,job_id INTEGER,owner_hash TEXT,expires_at INTEGER);
    CREATE TABLE vilnius_events(source_id INTEGER,featured_media INTEGER);
    CREATE TABLE vilnius_images(media_id INTEGER,local_name TEXT);
    CREATE TABLE event_images(event_id INTEGER,local_name TEXT);
    CREATE TABLE event_prices(event_id INTEGER PRIMARY KEY,price_text TEXT,price_type TEXT,manual INTEGER,checked_at TEXT);
    CREATE TABLE event_artist_decisions(event_id INTEGER,artist_mbid TEXT,decision TEXT);
    CREATE TABLE artists(mbid TEXT,name TEXT);
    CREATE TABLE jobs(id INTEGER PRIMARY KEY,source TEXT);
    CREATE TABLE removed_listings(source_key TEXT,source_id TEXT);
    INSERT INTO jobs VALUES(1,'kakava'),(2,'avilys');`);
  try { db.exec('ALTER TABLE events ADD COLUMN needs_attention INTEGER NOT NULL DEFAULT 0'); } catch { /* added by the merge tables */ }
  db.exec(`ALTER TABLE events ADD COLUMN interest_score INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE events ADD COLUMN publication_status TEXT NOT NULL DEFAULT 'draft';
    ALTER TABLE events ADD COLUMN publication_manual INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE events ADD COLUMN classification_manual INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE events ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE events ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'not_verified';
    ALTER TABLE events ADD COLUMN about_url_override TEXT;
    ALTER TABLE events ADD COLUMN description_override TEXT;
    CREATE TABLE event_history(event_id INTEGER,action TEXT,actor TEXT,occurred_at TEXT,changes TEXT,context TEXT)`);
  addMergeTables(db);
  db.function('IF',(condition, yes, no) => condition ? yes : no);
  const owner='a'.repeat(64),job={id:1,owner};
  db.prepare('INSERT INTO job_leases VALUES(?,?,?,?)').run('vilnius-events',1,createHash('sha256').update(owner).digest('hex'),Date.now()+60000);
  const connection={async beginTransaction(){db.exec('BEGIN');},async commit(){db.exec('COMMIT');},async rollback(){db.exec('ROLLBACK');},release(){},async execute(sql: string,params: import('node:sqlite').SQLInputValue[]){const q=sql.replace(/ FOR UPDATE$/,'').replaceAll('UTC_TIMESTAMP(3)','CURRENT_TIMESTAMP')
      .replace(/ON DUPLICATE KEY UPDATE ([^`]*)$/,(_match: string,updates: string)=>`ON CONFLICT(event_id) DO UPDATE SET ${updates.replace(/VALUES\((\w+)\)/g,'excluded.$1')}`);const stmt=db.prepare(q);if(/^SELECT/i.test(q))return [stmt.all(...params)];const result=stmt.run(...params);return [{insertId:Number(result.lastInsertRowid),affectedRows:Number(result.changes)}];}};
  const pool={getConnection:async()=>connection,execute:(sql: string,params: import('node:sqlite').SQLInputValue[])=>connection.execute(sql,params)} as unknown as import('mysql2/promise').Pool;
  const catalogue=createCatalogue(pool,'https://example.com');
  try {
    assert.deepEqual(await importKakavaPage(pool,{verify_after_import:false,items:[show],job}),{added:1,updated:0,attached:0,skipped:0});
    const row=db.prepare('SELECT * FROM events').get()!;
    assert.equal(row.event_date,'2026-12-05');assert.equal(row.event_time,'19:00');assert.equal(row.event_end_time,'21:00');
    assert.equal(row.venue,'Kablys');assert.equal(row.city,'Vilnius');assert.equal(row.ticket_url,show.sourceUrl);
    assert.equal(db.prepare('SELECT price_text FROM event_prices').get()!.price_text,'Nuo 26,6 €');
    const source=db.prepare("SELECT * FROM event_sources WHERE source_key='kakava'").get()!;
    assert.equal(source.source_id,'27822');assert.equal(source.source_url,show.sourceUrl);
    assert.equal(JSON.parse(String(source.source_data_json)).imageUrl,show.imageUrl);
    // Dated imports go live, like Avilys.
    assert.equal((await catalogue.get(1,'2026-12-01')).id,1);
    // A refresh does not overwrite an edited venue, and does not add a second event.
    db.exec("UPDATE events SET venue='Edited'");
    assert.deepEqual(await importKakavaPage(pool,{verify_after_import:false,items:[{...show,venueName:'Other'}],job}),{added:0,updated:1,attached:0,skipped:0});
    assert.equal(db.prepare('SELECT venue FROM events').get()!.venue,'Edited');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events').get()!.n,1);
    // Kakava moves the show: an unedited event follows, with a history note.
    await importKakavaPage(pool,{verify_after_import:false,items:[{...show,startTime:'2026-12-12T20:00',endTime:'2026-12-12T22:00'}],job});
    const moved=db.prepare('SELECT event_date,event_time,event_end_time,needs_attention FROM events WHERE id=1').get()!;
    assert.deepEqual({...moved},{event_date:'2026-12-12',event_time:'20:00',event_end_time:'22:00',needs_attention:0});
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM event_history WHERE action='source_moved'").get()!.n,1);
    // Once an editor set the date by hand, a move only flags the event.
    db.exec(`UPDATE events SET manual_fields='["event_date"]' WHERE id=1`);
    await importKakavaPage(pool,{verify_after_import:false,items:[{...show,startTime:'2026-12-19T20:00',endTime:'2026-12-19T22:00'}],job});
    const flagged=db.prepare('SELECT event_date,needs_attention FROM events WHERE id=1').get()!;
    assert.deepEqual({...flagged},{event_date:'2026-12-12',needs_attention:1});
    // An unchanged show is not treated as moved again.
    await importKakavaPage(pool,{verify_after_import:false,items:[{...show,startTime:'2026-12-19T20:00',endTime:'2026-12-19T22:00'}],job});
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM event_history WHERE action='source_moved'").get()!.n,2);
    // A multi-day festival keeps its end date.
    await importKakavaPage(pool,{verify_after_import:false,items:[{...show,id:5,title:'Festivalis',startTime:'2027-05-20T18:00',endTime:'2027-05-23T21:00'}],job});
    const festival=db.prepare("SELECT e.* FROM events e JOIN event_sources s ON s.event_id=e.id WHERE s.source_id='5'").get()!;
    assert.equal(festival.event_end_date,'2027-05-23');assert.equal(festival.event_end_time,null);
    // A removed listing stays removed.
    db.exec("INSERT INTO removed_listings VALUES('kakava','6')");
    assert.deepEqual(await importKakavaPage(pool,{verify_after_import:false,items:[{...show,id:6,title:'Removed'}],job}),{added:0,updated:0,attached:0,skipped:1});
    for(const bad of [{...show,sourceUrl:'https://evil.example/renginys/koncertas/8562'},{...show,startTime:'2026-12-05T19:00:00Z'},{...show,endTime:'2026-12-04T10:00'},{...show,priceFrom:-1},{...show,imageUrl:'http://x.example/a.jpg'}])
      await assert.rejects(importKakavaPage(pool,{verify_after_import:false,items:[bad],job}),{status:400});
    await assert.rejects(importKakavaPage(pool,{verify_after_import:false,items:[show],job:{id:1,owner:'b'.repeat(64)}}),{status:409});
    db.prepare('UPDATE job_leases SET job_id=2').run();
    await assert.rejects(importKakavaPage(pool,{verify_after_import:false,items:[show],job:{id:2,owner}}),/not a Kakava import/);
  } finally {db.close();}
});
