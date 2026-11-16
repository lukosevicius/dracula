import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { createApp } from '../app.mjs';
import { createAdmin } from '../admin.mjs';
import { createCatalogue } from '../catalogue.mjs';
import { importVilniusPage } from '../import-vilnius.mjs';

// This deliberately refuses existing data and never targets staging or production.
test('MariaDB: authenticated edits, private reads and public pagination', {skip:process.env.RUN_MARIADB_INTEGRATION !== '1'}, async () => {
  const {MYSQL_TEST_HOST:host,MYSQL_TEST_PORT:port,MYSQL_TEST_USER:user,MYSQL_TEST_PASSWORD:password,MYSQL_TEST_DATABASE:database}=process.env;
  if (!host || !port || !user || !password || !database || !/^[A-Za-z0-9_]+_test$/.test(database)) throw new Error('Configure a disposable empty database ending in _test.');
  const pool=mysql.createPool({host,port:Number(port),user,password,database,charset:'utf8mb4',connectionLimit:5});
  let app;
  try {
    const [tables]=await pool.query('SHOW FULL TABLES');
    if(tables.length) throw new Error('Test database is not empty; refusing to alter it.');
    const schema=await readFile(new URL('../schema.sql',import.meta.url),'utf8');
    for(const statement of schema.split(';').map(s=>s.trim()).filter(Boolean)) await pool.query(statement);
    await pool.execute("INSERT INTO events(id,title,event_date,review_status,manual_fields,created_at,updated_at) VALUES(1,'Example','2099-11-20','unsure','[]','now','now')");
    await pool.execute("INSERT INTO vilnius_events(source_id,title,source_url,content_html,categories_json,first_seen_at,updated_at,event_date,details_manual,review_status,details_version,manual_fields) VALUES(11,'Example','https://example.com','Hello','[]','now','now','2099-11-20',0,'unsure',0,'[]')");
    await pool.execute("INSERT INTO event_sources(id,event_id,source_key,source_id,source_url,content_html,source_data_json) VALUES(1,1,'vilnius-events','11','https://example.com','Hello','{}')");
    await pool.execute("INSERT INTO source_state(source_key,next_offset,total_available,updated_at) VALUES('vilnius-events',0,NULL,'now')");
    const mbid='f5e813d7-0f2e-499a-9d07-9c38d955837d';
    await pool.execute("INSERT INTO artists(mbid,name,aliases_json,source_url,first_seen_at,updated_at) VALUES(?,'Artist','[]','https://example.com','now','now')",[mbid]);
    const token='0123456789abcdef0123456789abcdef';
    app=createApp(createCatalogue(pool,'https://api.example.com'),'/nonexistent',createAdmin(pool,token));
    await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
    const root=`http://127.0.0.1:${app.address().port}`;
    const headers={authorization:`Bearer ${token}`,'content-type':'application/json'};
    const post=(action,body)=>fetch(`${root}/v1/admin/events/1/${action}`,{method:'POST',headers,body:JSON.stringify(body)});
    assert.equal((await fetch(`${root}/v1/admin/events/1`)).status,401);
    assert.equal((await post('review',{review_status:'music'})).status,200);
    assert.equal((await post('details',{review_status:'music',event_date:'2099-11-20',event_end_date:'2099-11-21',venue:'Venue'})).status,200);
    assert.equal((await post('artist',{mbid,decision:'accepted'})).status,200);
    assert.equal((await post('price',{price_type:'free',price_text:'Nemokama'})).status,200);
    const result=await (await fetch(`${root}/v1/events?filter=custom&from=2099-11-20&to=2099-11-21&offset=0&limit=1`)).json();
    assert.equal(result.total,1); assert.equal(result.items[0].venue,'Venue');
    assert.equal(result.items[0].price_type,'free'); assert.equal(result.items[0].artists[0].mbid,mbid);
    const privateEvent=await (await fetch(`${root}/v1/admin/events/1`,{headers})).json();
    assert.equal(privateEvent.event.review_status,'music');
    const importUrl=`${root}/v1/admin/imports/vilnius-events/page`;
    const item={source_id:12,title:'New event',source_url:'https://www.vilnius-events.lt/test',content_html:'source',categories:[4],featured_media:null,published_at:null,modified_at:'one',details:{event_date:'2099-11-20',venue:'Original'}};
    const payload={items:[item],advance_cursor:true,expected_offset:0,next_offset:1,total_available:null};
    const importPage=body=>fetch(importUrl,{method:'POST',headers,body:JSON.stringify(body)});
    assert.deepEqual(await (await importPage(payload)).json(),{ok:true,added:1,updated:0});
    assert.equal((await importPage(payload)).status,409);
    const [[linked]]=await pool.execute("SELECT event_id FROM event_sources WHERE source_key='vilnius-events' AND source_id='12'");
    assert.equal((await fetch(`${root}/v1/admin/events/${linked.event_id}/details`,{method:'POST',headers,body:JSON.stringify({review_status:'music',event_date:'2099-11-20',venue:'Manual'})})).status,200);
    assert.equal((await importPage({...payload,advance_cursor:false,items:[{...item,modified_at:'two',content_html:'changed',details:{...item.details,venue:'Source update'}}]})).status,200);
    const [[preserved]]=await pool.execute('SELECT review_status,venue,manual_fields FROM events WHERE id=?',[linked.event_id]);
    assert.equal(preserved.review_status,'music'); assert.equal(preserved.venue,'Manual'); assert.ok(JSON.parse(preserved.manual_fields).includes('venue'));
    await pool.execute("INSERT INTO vilnius_events(source_id,title,source_url,content_html,categories_json,first_seen_at,updated_at,details_manual,review_status,details_version,manual_fields) VALUES(13,'Orphan','https://www.vilnius-events.lt/test','x','[]','now','now',0,'unsure',0,'[]')");
    const failed=await importPage({...payload,advance_cursor:false,items:[{...item,source_id:14},{...item,source_id:13}]});
    assert.equal(failed.status,409);
    const [[rolledBack]]=await pool.execute("SELECT COUNT(*) AS n FROM event_sources WHERE source_key='vilnius-events' AND source_id='14'");
    assert.equal(rolledBack.n,0);
    const concurrent={items:[],advance_cursor:true,expected_offset:1,next_offset:2,total_available:10};
    const attempts=await Promise.allSettled([importVilniusPage(pool,concurrent),importVilniusPage(pool,concurrent)]);
    assert.equal(attempts.filter(item=>item.status==='fulfilled').length,1);
    assert.equal(attempts.filter(item=>item.status==='rejected' && item.reason.status===409).length,1);
  } finally {
    if(app) await new Promise(resolve=>app.close(resolve));
    await pool.end();
  }
});
