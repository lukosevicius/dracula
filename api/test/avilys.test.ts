import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {importAvilysPage} from '../dist/imports/avilys.js';
import {createAdmin} from '../dist/admin/admin.js';
import {createCatalogue} from '../test-support/nest.ts';

test('Avilys imports are idempotent, reviewable, and preserve edits on refresh',async()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE events(id INTEGER PRIMARY KEY, title TEXT,event_date TEXT,event_end_date TEXT,event_time TEXT,venue TEXT,ticket_url TEXT,review_status TEXT,manual_fields TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE event_sources(id INTEGER PRIMARY KEY,event_id INTEGER,source_key TEXT,source_id TEXT,source_url TEXT,content_html TEXT,source_data_json TEXT,last_checked_at TEXT,about_url TEXT, UNIQUE(source_key,source_id));
    CREATE TABLE job_leases(source_key TEXT,job_id INTEGER,owner_hash TEXT,expires_at INTEGER);
    CREATE TABLE vilnius_events(source_id INTEGER,featured_media INTEGER);
    CREATE TABLE vilnius_images(media_id INTEGER,local_name TEXT);
    CREATE TABLE event_prices(event_id INTEGER,price_text TEXT,price_type TEXT,manual INTEGER,checked_at TEXT);
    CREATE TABLE event_artist_decisions(event_id INTEGER,artist_mbid TEXT,decision TEXT);
    CREATE TABLE artists(mbid TEXT,name TEXT);`);
  const owner='a'.repeat(64),job={id:1,owner};
  db.prepare('INSERT INTO job_leases VALUES(?,?,?,?)').run('vilnius-events',1,createHash('sha256').update(owner).digest('hex'),Date.now()+60000);
  const connection={async beginTransaction(){db.exec('BEGIN');},async commit(){db.exec('COMMIT');},async rollback(){db.exec('ROLLBACK');},release(){},async execute(sql,params){const q=sql.replace(/ FOR UPDATE$/,'');const stmt=db.prepare(q);if(/^SELECT/i.test(q))return [stmt.all(...params)];const result=stmt.run(...params);return [{insertId:Number(result.lastInsertRowid),affectedRows:Number(result.changes)}];}};
  const pool={getConnection:async()=>connection,execute:(sql,params)=>connection.execute(sql,params)};
  const admin=createAdmin(pool,'a'.repeat(32));const catalogue=createCatalogue(pool,'https://example.com');
  const event={id:10,title:'Concert',city:'Vilnius',categories:[{id:1,name:'Music'}],description:'Music <script>',startTime:'2026-11-25T19:00:00Z',venueName:'Club',sourceUrl:'https://example.org/event'};
  try {
    assert.deepEqual(await importAvilysPage(pool,{items:[event],job}),{added:1,updated:0});
    assert.equal(await catalogue.get(1,'2026-11-20'),null);
    await admin.details(1,{review_status:'music',event_date:'2026-11-25',event_time:'19:00',venue:'Edited'});
    assert.equal((await catalogue.get(1,'2026-11-20')).venue,'Edited');
    await admin.price(1,{price_type:'paid',price_text:'5 €'});
    assert.equal((await catalogue.get(1,'2026-11-20')).price_text,'5 €');
    assert.deepEqual(await importAvilysPage(pool,{items:[{...event,venueName:'Changed'}],job}),{added:0,updated:1});
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events').get().n,1);
    assert.equal(db.prepare('SELECT venue FROM events').get().venue,'Edited');
    assert.equal(db.prepare('SELECT price_text FROM event_prices').get().price_text,'5 €');
    assert.match(db.prepare('SELECT content_html FROM event_sources').get().content_html,/&lt;script&gt;/);
    await assert.rejects(importAvilysPage(pool,{items:[{...event,city:'Kaunas'}],job}),{status:400});
    await assert.rejects(importAvilysPage(pool,{items:[event],job:{id:1,owner:'b'.repeat(64)}}),{status:409});
  } finally {db.close();}
});
