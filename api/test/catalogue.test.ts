import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCatalogue } from '../test-support/nest.ts';
import { createApp } from '../test-support/nest.ts';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE events(id INTEGER,title TEXT,event_date TEXT,event_end_date TEXT,event_time TEXT,venue TEXT,ticket_url TEXT,review_status TEXT);
    CREATE TABLE event_sources(id INTEGER PRIMARY KEY,event_id INTEGER,source_key TEXT,source_id TEXT,source_url TEXT,about_url TEXT,content_html TEXT);
    CREATE TABLE vilnius_events(source_id INTEGER,featured_media INTEGER);
    CREATE TABLE vilnius_images(media_id INTEGER,local_name TEXT);
    CREATE TABLE event_prices(event_id INTEGER,price_text TEXT,price_type TEXT);
    CREATE TABLE event_artist_decisions(event_id INTEGER,artist_mbid TEXT,decision TEXT);
    CREATE TABLE artists(mbid TEXT,name TEXT);
    INSERT INTO events VALUES(1,'Upcoming','2026-11-20',NULL,'19:00','Club',NULL,'music'),(2,'Undated',NULL,NULL,NULL,NULL,NULL,'music'),(3,'Past','2026-11-01',NULL,NULL,NULL,NULL,'music'),(4,'Private','2026-11-20',NULL,NULL,NULL,NULL,'unsure');
    INSERT INTO event_sources SELECT id,id,'vilnius-events',CAST(id AS TEXT),'https://vilnius-events.lt/event',NULL,'<p>Hello &amp; welcome</p>' FROM events;
    INSERT INTO vilnius_events VALUES(1,5); INSERT INTO vilnius_images VALUES(5,'5.jpg');
    INSERT INTO event_prices VALUES(1,'Nemokama','free'); INSERT INTO artists VALUES('artist-1','Artist');
    INSERT INTO event_artist_decisions VALUES(1,'artist-1','accepted');`);
  return { db, catalogue:createCatalogue({execute:async (sql,params) => [db.prepare(sql).all(...params)]},'https://api.example.com') };
}

test('catalogue retains public details, prices and accepted artists, with bounded pages', async () => {
  const {db,catalogue}=fixture();
  try {
    const first=await catalogue.list(0,1,'2026-11-15');
    assert.equal(first.next,1);
    assert.equal(first.items[0].description,'Hello & welcome');
    assert.equal(first.items[0].image_url,'https://api.example.com/v1/images/5.jpg');
    assert.equal(first.items[0].price_type,'free');
    assert.deepEqual(first.items[0].artists,[{mbid:'artist-1',name:'Artist'}]);
    const second=await catalogue.list(1,1,'2026-11-15');
    assert.deepEqual(second.items.map(event => event.id),[2]);
    assert.equal(second.next,null);
    assert.equal(await catalogue.get(3,'2026-11-15'),null);
    assert.equal(await catalogue.get(4,'2026-11-15'),null);
    assert.equal(await catalogue.hasImage('5.jpg','2026-11-15'),true);
    assert.equal(await catalogue.hasImage('missing.jpg','2026-11-15'),false);
  } finally { db.close(); }
});

test('filtered pages apply date ranges before pagination', async () => {
  const {db,catalogue}=fixture();
  const page=(filter,from='',to='',offset=0)=>catalogue.page({filter,from,to,offset,limit:1},'2026-11-15');
  try {
    assert.deepEqual((await page('upcoming')).items.map(e=>e.id),[1]);
    assert.deepEqual((await page('unknown')).items.map(e=>e.id),[2]);
    assert.equal((await page('today')).total,0);
    assert.equal((await page('custom','2026-11-20')).total,1);
    assert.equal((await page('custom','2026-11-21')).total,0);
    assert.equal((await page('past')).total,0);
    const first=await page('all'); assert.equal(first.total,2); assert.equal(first.nextOffset,1);
    assert.equal((await page('all','','',1)).items[0].id,2);
  } finally {db.close();}
});

test('HTTP routes reject invalid pagination and never expose private events', async () => {
  const {db,catalogue}=fixture();
  // Fix the date so this test is independent of when it runs.
  const fixed={list:(after,limit)=>catalogue.list(after,limit,'2026-11-15'),page:options=>catalogue.page(options,'2026-11-15'),get:id=>catalogue.get(id,'2026-11-15'),hasImage:name=>catalogue.hasImage(name,'2026-11-15')};
  const app=createApp(fixed,'/nonexistent');
  await new Promise(resolve => app.listen(0,'127.0.0.1',resolve));
  try {
    const url=`http://127.0.0.1:${app.address().port}`;
    assert.equal((await fetch(`${url}/v1/events?limit=101`)).status,400);
    assert.equal((await fetch(`${url}/v1/events/4`)).status,404);
    assert.equal((await fetch(`${url}/v1/events`,{method:'POST'})).status,405);
    assert.equal((await fetch(`${url}/v1/images/no.jpg`)).status,404);
    assert.equal((await fetch(`${url}/v1/events?filter=custom&from=2026-02-30`)).status,400);
    assert.equal((await fetch(`${url}/v1/events?filter=unknown`)).status,200);
    const response=await fetch(`${url}/v1/events?limit=1`);
    assert.equal(response.headers.get('access-control-allow-origin'),'*');
    assert.equal((await response.json()).items[0].id,1);
  } finally { await new Promise(resolve=>app.close(resolve)); db.close(); }
});

test('image endpoint only serves files belonging to a public event', async () => {
  const {db,catalogue}=fixture();
  const directory=await mkdtemp(join(tmpdir(),'dracula-api-'));
  await writeFile(join(directory,'5.jpg'),'public-image');
  await writeFile(join(directory,'secret.jpg'),'not-public');
  const app=createApp({hasImage:name=>catalogue.hasImage(name,'2026-11-15')},directory);
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  try {
    const base=`http://127.0.0.1:${app.address().port}`;
    const image=await fetch(`${base}/v1/images/5.jpg`);
    assert.equal(image.status,200);
    assert.equal(image.headers.get('content-type'),'image/jpeg');
    assert.equal(await image.text(),'public-image');
    assert.equal((await fetch(`${base}/v1/images/secret.jpg`)).status,404);
    assert.equal((await fetch(`${base}/v1/images/%2e%2e%2fsecret.jpg`)).status,404);
  } finally { await new Promise(resolve=>app.close(resolve)); db.close(); await rm(directory,{recursive:true,force:true}); }
});
