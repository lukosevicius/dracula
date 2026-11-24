import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { CatalogueService } from '../dist/catalogue/catalogue.service.js';
import { AuthController } from '../dist/auth/auth.controller.js';

const id='12345678-1234-1234-1234-123456789abc', other='12345678-1234-1234-1234-123456789def';
test('artist events only include accepted upcoming public matches and are paginated',async()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE artists(mbid TEXT,name TEXT); CREATE TABLE events(id INTEGER,title TEXT,event_date TEXT,event_end_date TEXT,event_time TEXT,venue TEXT,ticket_url TEXT,interest_score INTEGER,review_status TEXT); CREATE TABLE event_sources(id INTEGER,event_id INTEGER,source_key TEXT,source_id TEXT,source_url TEXT,about_url TEXT,content_html TEXT,source_data_json TEXT); CREATE TABLE vilnius_events(source_id INTEGER,featured_media INTEGER); CREATE TABLE vilnius_images(media_id INTEGER,local_name TEXT); CREATE TABLE event_images(event_id INTEGER,local_name TEXT); CREATE TABLE event_prices(event_id INTEGER,price_text TEXT,price_type TEXT); CREATE TABLE event_artist_decisions(event_id INTEGER,artist_mbid TEXT,decision TEXT);
  INSERT INTO artists VALUES('${id}','Band'),('${other}','Other');
  INSERT INTO events VALUES(1,'Public','2026-12-01',NULL,NULL,NULL,NULL,1,'music'),(2,'Past','2026-10-01',NULL,NULL,NULL,NULL,1,'music'),(3,'Private','2026-12-01',NULL,NULL,NULL,NULL,1,'unsure'),(4,'Dismissed','2026-12-02',NULL,NULL,NULL,NULL,1,'music'),(5,'Another','2026-12-03',NULL,NULL,NULL,NULL,1,'music');
  INSERT INTO event_sources SELECT id,id,'avilys',id,'https://example.com',NULL,'',NULL FROM events;
  INSERT INTO event_artist_decisions VALUES(1,'${id}','accepted'),(2,'${id}','accepted'),(3,'${id}','accepted'),(4,'${id}','dismissed'),(5,'${id}','accepted'),(1,'${other}','accepted');`);
  db.exec(`ALTER TABLE events ADD COLUMN publication_status TEXT NOT NULL DEFAULT 'draft';
    ALTER TABLE events ADD COLUMN about_url_override TEXT;
    ALTER TABLE events ADD COLUMN description_override TEXT;
    UPDATE events SET publication_status='live' WHERE id IN (1,2,4,5)`);
  const pool={execute:async(sql:string,params:import('node:sqlite').SQLInputValue[])=>[db.prepare(sql).all(...params)]};
  const service=new CatalogueService({pool} as never,{publicBaseUrl:'https://api.example.com'} as never);
  try {
    assert.deepEqual(await service.artist(id),{mbid:id,name:'Band'});
    assert.equal(await service.artist('missing'),null);
    const options={offset:0,limit:1,filter:'upcoming' as const,from:'',to:'',artists:[id,other]};
    const first=await service.page(options,'2026-11-21');
    assert.equal(first.total,2); assert.equal(first.items[0].id,1); assert.equal(first.nextOffset,1);
    const second=await service.page({...options,offset:1},'2026-11-21');
    assert.equal(second.items[0].id,5); assert.equal(second.nextOffset,null);
  } finally {db.close();}
});

test('account follows use the signed-in user, validate origin and accept only valid IDs',async()=>{
  const calls:{sql:string;params:unknown[]}[]=[];
  const auth={current:async(session:string)=>{if(session!=='valid')throw Error('unauthorized');return {id:7};}};
  const db={pool:{execute:async(sql:string,params:unknown[])=>{calls.push({sql,params});return [[]];}}};
  const controller=new AuthController(auth as never,{publicBaseUrl:'https://api.example.com',authOrigins:['https://app.example.com']} as never,db as never,{} as never);
  const request=(body:unknown,origin='https://app.example.com',cookie='__Host-dracula_session=valid')=>({headers:{origin,cookie,'content-type':'application/json'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body));}});
  await assert.rejects(()=>controller.followArtists(request({ids:[id]},'https://evil.example') as never));
  await assert.rejects(()=>controller.followArtists(request({ids:['invalid']}) as never));
  await assert.rejects(()=>controller.followedArtists(request(null,undefined,'') as never));
  await controller.followArtists(request({ids:[id,id,other]}) as never);
  assert.deepEqual(calls[0].params,[7,id,other]);
  await controller.unfollowArtist({...request(null),params:{id}} as never);
  assert.deepEqual(calls[1].params,[7,id]);
});
