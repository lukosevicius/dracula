import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import {readFileSync} from 'node:fs';
import { AppModule } from '../dist/app.module.js';
import { CatalogueService } from '../dist/catalogue/catalogue.service.js';
import { APP_CONFIG, loadConfig } from '../dist/config/config.js';
import { DatabaseService } from '../dist/database/database.service.js';

const env = { DB_HOST:'127.0.0.1', DB_USER:'test', DB_PASSWORD:'test', DB_NAME:'test', PUBLIC_BASE_URL:'https://api.example.com', IMAGE_DIR:'/tmp/images' };
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE events(id INTEGER,title TEXT,event_date TEXT,event_end_date TEXT,event_time TEXT,venue TEXT,ticket_url TEXT,review_status TEXT);
    CREATE TABLE event_sources(id INTEGER PRIMARY KEY,event_id INTEGER,source_key TEXT,source_id TEXT,source_url TEXT,about_url TEXT,content_html TEXT,source_data_json TEXT);
    CREATE TABLE vilnius_events(source_id INTEGER,featured_media INTEGER);
    CREATE TABLE vilnius_images(media_id INTEGER,local_name TEXT);
    CREATE TABLE event_images(event_id INTEGER,local_name TEXT);
    CREATE TABLE event_prices(event_id INTEGER,price_text TEXT,price_type TEXT);
    CREATE TABLE event_artist_decisions(event_id INTEGER,artist_mbid TEXT,decision TEXT);
    CREATE TABLE artists(mbid TEXT,name TEXT);
    INSERT INTO events VALUES(1,'Upcoming','2026-11-20',NULL,'19:00','Club',NULL,'music'),(2,'Undated',NULL,NULL,NULL,NULL,NULL,'music'),(3,'Past','2026-11-01',NULL,NULL,NULL,NULL,'music'),(4,'Private','2026-11-20',NULL,NULL,NULL,NULL,'unsure');
    INSERT INTO event_sources SELECT id,id,'vilnius-events',CAST(id AS TEXT),'https://vilnius-events.lt/event',NULL,'<p>Hello &amp; welcome</p>',NULL FROM events;
    INSERT INTO vilnius_events VALUES(1,5); INSERT INTO vilnius_images VALUES(5,'5.jpg');
    INSERT INTO event_prices VALUES(1,'Nemokama','free'); INSERT INTO artists VALUES('artist-1','Artist');
    INSERT INTO event_artist_decisions VALUES(1,'artist-1','accepted');`);
  const pool={ execute: async (sql: string,params: import('node:sqlite').SQLInputValue[]) => [db.prepare(sql).all(...params)] };
  db.exec(`ALTER TABLE events ADD COLUMN interest_score INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE events ADD COLUMN city TEXT;
    ALTER TABLE events ADD COLUMN publication_status TEXT NOT NULL DEFAULT 'draft';
    ALTER TABLE events ADD COLUMN about_url_override TEXT;
    ALTER TABLE events ADD COLUMN description_override TEXT;
    UPDATE events SET publication_status='live' WHERE id IN (1,2,3)`);
  return { db, pool };
}

test('ongoing events appear in the relevant day and are ranked by score across pages', async () => {
  const {db,pool}=fixture();
  db.exec(`DELETE FROM event_sources; DELETE FROM events;
    INSERT INTO events(id,title,event_date,event_end_date,event_time,review_status,interest_score) VALUES
      (10,'Ongoing low','2026-11-19','2026-11-22',NULL,'music',1),
      (11,'Today high','2026-11-21',NULL,'20:00','music',5),
      (12,'Today middle','2026-11-21',NULL,'19:00','music',3),
      (13,'Tomorrow high','2026-11-22',NULL,NULL,'music',5),
      (14,'Undated',NULL,NULL,NULL,'music',5);
    UPDATE events SET publication_status='live';
    INSERT INTO event_sources SELECT id,id,'avilys',CAST(id AS TEXT),'https://example.com',NULL,'',NULL FROM events;`);
  const catalogue=new CatalogueService({pool} as unknown as DatabaseService,loadConfig(env));
  try {
    const options={offset:0,limit:2,filter:'upcoming' as const,from:'',to:''};
    const first=await catalogue.page(options,'2026-11-21');
    const second=await catalogue.page({...options,offset:2},'2026-11-21');
    assert.deepEqual(first.items.map(event=>event.id),[11,12]);
    assert.deepEqual(second.items.map(event=>event.id),[10,13]);
    const today=await catalogue.page({...options,filter:'today',limit:10},'2026-11-21');
    assert.deepEqual(today.items.map(event=>event.id),[11,12,10]);
    const tomorrow=await catalogue.page({...options,filter:'tomorrow',limit:10},'2026-11-21');
    assert.deepEqual(tomorrow.items.map(event=>event.id),[13,10]);
    const all=await catalogue.page({...options,filter:'all',limit:10},'2026-11-21');
    assert.deepEqual(all.items.map(event=>event.id),[11,12,10,13,14]);
  } finally { db.close(); }
});

test('past public event details and images remain accessible while private events stay hidden', async () => {
  const {db,pool}=fixture();
  db.exec("INSERT INTO event_images VALUES(3,'past.jpg'),(4,'private.jpg')");
  const catalogue=new CatalogueService({pool} as unknown as DatabaseService,loadConfig(env));
  try {
    db.exec("UPDATE events SET review_status='not_music' WHERE id=3; UPDATE events SET review_status='music' WHERE id=4");
    const past=await catalogue.get(3,'2026-11-15');
    assert.equal(past?.id,3);
    assert.equal(past?.image_url,'https://api.example.com/v1/images/past.jpg');
    assert.equal(await catalogue.hasImage('past.jpg','2026-11-15'),true);
    assert.equal(await catalogue.get(4,'2026-11-15'),null);
    assert.equal(await catalogue.hasImage('private.jpg','2026-11-15'),false);
  } finally { db.close(); }
});

test('Nest public endpoints preserve the existing API contract', async () => {
  const {db,pool} = fixture();
  const directory = await mkdtemp(join(tmpdir(),'dracula-nest-'));
  await writeFile(join(directory,'5.jpg'),'public-image');
  await writeFile(join(directory,'secret.jpg'),'private-image');
  await symlink(join(directory,'secret.jpg'),join(directory,'link.jpg'));
  const config=loadConfig({...env,IMAGE_DIR:directory});
  const nestCatalogue=new CatalogueService({pool} as unknown as DatabaseService,config);
  const fixed=(c: CatalogueService)=>({list:(after: number,limit: number)=>c.list(after,limit,'2026-11-15'),page:(options: import('../dist/catalogue/catalogue.service.js').PageOptions)=>c.page(options,'2026-11-15'),get:(id: number)=>c.get(id,'2026-11-15'),hasImage:(name: string)=>c.hasImage(name,'2026-11-15')});
  const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(APP_CONFIG).useValue(config)
    .overrideProvider(DatabaseService).useValue({pool}).overrideProvider(CatalogueService).useValue(fixed(nestCatalogue)).compile();
  const app=module.createNestApplication({logger:false});
  await app.listen(0,'127.0.0.1');
  try {
    const current=`http://127.0.0.1:${app.getHttpServer().address().port}`;
    const paths=['/v1/events','/v1/events?limit=1','/v1/events?after=1&limit=1','/v1/events?limit=101',
      ...['upcoming','today','tomorrow','weekend','all','past','unknown'].map(f=>`/v1/events?filter=${f}`),
      '/v1/events?filter=custom&from=2026-11-20&to=2026-11-21','/v1/events?filter=custom&from=2026-02-30',
      '/v1/events?filter=custom&from=2026-11-21&to=2026-11-20','/v1/events?filter=all&offset=1&limit=1',
      '/v1/events/1','/v1/events/4','/v1/events/garbage','/v1/images/5.jpg','/v1/images/secret.jpg','/v1/images/link.jpg'];
    const snapshots=JSON.parse(readFileSync(new URL('./fixtures/catalogue-contract.json',import.meta.url),'utf8'));
    assert.equal(snapshots.length,paths.length);
    for (const [i,path] of paths.entries()) {
      const expected=snapshots[i], response=await fetch(current+path);
      assert.equal(path,expected.path);assert.equal(response.status,expected.status,path);
      for(const [header,value] of Object.entries(expected.headers)) assert.equal(response.headers.get(header),value,`${path}: ${header}`);
      assert.equal(await response.text(),expected.body,path);
    }
    assert.equal((await fetch(current+'/v1/events',{method:'POST'})).status,405);

    db.exec(`UPDATE events SET city='Vilnius' WHERE id=1;
      UPDATE events SET city='Kaunas' WHERE id IN (2,4);
      INSERT INTO events(id,title,event_date,city,review_status,publication_status) VALUES
        (5,'Kaunas concert','2026-11-21','Kaunas','music','live'),
        (6,'Klaipėda concert','2026-11-21','Klaipėda','music','live');
      INSERT INTO event_sources SELECT id,id,'avilys',CAST(id AS TEXT),'https://example.com',NULL,'',NULL FROM events WHERE id IN (5,6);`);
    const kaunasFirst=await (await fetch(current+'/v1/events?filter=all&city=kaunas&limit=1')).json();
    assert.deepEqual(kaunasFirst.items.map((event: { id: number; city: string })=>[event.id,event.city]),[[5,'Kaunas']]);
    assert.equal(kaunasFirst.total,2);
    assert.equal(kaunasFirst.nextOffset,1);
    const kaunasSecond=await (await fetch(current+'/v1/events?filter=all&city=Kaunas&limit=1&offset=1')).json();
    assert.deepEqual(kaunasSecond.items.map((event: { id: number })=>event.id),[2]);
    assert.equal(kaunasSecond.nextOffset,null);
    const klaipeda=await (await fetch(current+'/v1/events?city='+encodeURIComponent('Klaipėda'))).json();
    assert.deepEqual(klaipeda.items.map((event: { id: number })=>event.id),[6]);
    const palanga=await (await fetch(current+'/v1/events?city=Palanga')).json();
    assert.deepEqual(palanga,{items:[],total:0,nextOffset:null});
    assert.equal((await fetch(current+'/v1/events?city=')).status,400);
  } finally { await app.close(); db.close(); await rm(directory,{recursive:true,force:true}); }
});
