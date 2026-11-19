import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { AppModule } from '../dist/app.module.js';
import { CatalogueService } from '../dist/catalogue/catalogue.service.js';
import { APP_CONFIG, loadConfig } from '../dist/config/config.js';
import { DatabaseService } from '../dist/database/database.service.js';
import { createApp } from '../app.mjs';
import { createCatalogue } from '../catalogue.mjs';

const env = { DB_HOST:'127.0.0.1', DB_USER:'test', DB_PASSWORD:'test', DB_NAME:'test', PUBLIC_BASE_URL:'https://api.example.com', IMAGE_DIR:'/tmp/images' };
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
  const pool={ execute: async (sql,params) => [db.prepare(sql).all(...params)] };
  return { db, pool };
}

test('Nest public endpoints preserve the existing API contract', async () => {
  const {db,pool} = fixture();
  const directory = await mkdtemp(join(tmpdir(),'dracula-nest-'));
  await writeFile(join(directory,'5.jpg'),'public-image');
  await writeFile(join(directory,'secret.jpg'),'private-image');
  await symlink(join(directory,'secret.jpg'),join(directory,'link.jpg'));
  const config=loadConfig({...env,IMAGE_DIR:directory});
  const nestCatalogue=new CatalogueService({pool},config);
  const oldCatalogue=createCatalogue(pool,config.publicBaseUrl);
  const fixed=c=>({list:(after,limit)=>c.list(after,limit,'2026-11-15'),page:options=>c.page(options,'2026-11-15'),get:id=>c.get(id,'2026-11-15'),hasImage:name=>c.hasImage(name,'2026-11-15')});
  const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(APP_CONFIG).useValue(config)
    .overrideProvider(DatabaseService).useValue({pool}).overrideProvider(CatalogueService).useValue(fixed(nestCatalogue)).compile();
  const app=module.createNestApplication({logger:false});
  const old=createApp(fixed(oldCatalogue),directory);
  await app.listen(0,'127.0.0.1');
  await new Promise(resolve=>old.listen(0,'127.0.0.1',resolve));
  try {
    const current=`http://127.0.0.1:${app.getHttpServer().address().port}`;
    const previous=`http://127.0.0.1:${old.address().port}`;
    const paths=['/v1/events','/v1/events?limit=1','/v1/events?after=1&limit=1','/v1/events?limit=101',
      ...['upcoming','today','tomorrow','weekend','all','past','unknown'].map(f=>`/v1/events?filter=${f}`),
      '/v1/events?filter=custom&from=2026-11-20&to=2026-11-21','/v1/events?filter=custom&from=2026-02-30',
      '/v1/events?filter=custom&from=2026-11-21&to=2026-11-20','/v1/events?filter=all&offset=1&limit=1',
      '/v1/events/1','/v1/events/4','/v1/events/garbage','/v1/images/5.jpg','/v1/images/secret.jpg','/v1/images/link.jpg'];
    for (const path of paths) {
      const [a,b]=await Promise.all([fetch(current+path),fetch(previous+path)]);
      assert.equal(a.status,b.status,path);
      for (const header of ['content-type','cache-control','access-control-allow-origin','x-content-type-options']) assert.equal(a.headers.get(header),b.headers.get(header),`${path}: ${header}`);
      assert.equal(await a.text(),await b.text(),path);
    }
    assert.equal((await fetch(current+'/v1/events',{method:'POST'})).status,405);
  } finally { await app.close(); await new Promise(resolve=>old.close(resolve)); db.close(); await rm(directory,{recursive:true,force:true}); }
});
