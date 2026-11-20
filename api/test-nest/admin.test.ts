import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import {readFileSync} from 'node:fs';
import { AppModule } from '../dist/app.module.js';
import { APP_CONFIG, loadConfig } from '../dist/config/config.js';
import { DatabaseService } from '../dist/database/database.service.js';
import { AdminService } from '../dist/admin/admin.service.js';
import { ImportsService } from '../dist/imports/imports.service.js';
import { createAdmin } from '../dist/admin/admin.js';

const token='0123456789abcdef0123456789abcdef';
const env={ DB_HOST:'127.0.0.1', DB_USER:'test', DB_PASSWORD:'test', DB_NAME:'test', PUBLIC_BASE_URL:'https://api.example.com', IMAGE_DIR:'/tmp/images', ADMIN_TOKEN:token };
const backend={
  authorized: (header: string)=>header===`Bearer ${token}`,
  listEvents: async (q: URLSearchParams)=>({search:q.get('search')}), getEvent:async (id: number)=>({id}),
  getImage:async (id: number)=>id===5?{local_name:'5.jpg',mime_type:'image/jpeg',source_url:'https://example.com',source_modified:null}:id===6?{local_name:'6.jpg',mime_type:'image/jpeg'}:null,
  listMedia:async (after: number,limit: number)=>[after,limit], enrichmentCandidates:async (mode: string,after: number,id: number)=>[mode,after,id],
  artistsDashboard:async()=>({artists:[]}),review:async()=>{},details:async()=>{},artist:async()=>{},price:async()=>{},confirmAssistantReview:async()=>{},enrichEvent:async()=>{},
  importVilniusPage:async()=>({added:1}),importAvilysPage:async()=>({added:1}),importMusicBrainzPage:async()=>({added:1}),
  reserveVilniusRequest:async()=>({waitMs:0}),reserveMusicBrainz:async()=>({waitMs:0}),saveImage:async()=>({saved:true}),
  jobs:{list:async()=>[],start:async()=>({id:1}),update:async()=>{}},
  ai:{artists:async()=>[],list:async()=>[],eventIds:async()=>[1],event:async()=>({id:1}),save:async()=>{},decision:async()=>{}}
};

test('Nest admin routes match legacy authorization, requests and protected images', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'dracula-admin-'));
  await writeFile(join(dir,'5.jpg'),'image'); await symlink(join(dir,'5.jpg'),join(dir,'6.jpg'));
  const config=loadConfig({...env,IMAGE_DIR:dir});
  const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(APP_CONFIG).useValue(config)
    .overrideProvider(DatabaseService).useValue({pool:{}}).overrideProvider(AdminService).useValue({backend}).overrideProvider(ImportsService).useValue({jobs:backend.jobs,ai:backend.ai,vilnius:backend.importVilniusPage,avilys:backend.importAvilysPage,musicbrainz:backend.importMusicBrainzPage,reserveMusicBrainz:backend.reserveMusicBrainz,saveImage:backend.saveImage,enrich:backend.enrichEvent}).compile();
  const app=module.createNestApplication({logger:false,bodyParser:false});
  await app.listen(0,'127.0.0.1');
  const auth={authorization:`Bearer ${token}`};
  try {
    const current=`http://127.0.0.1:${app.getHttpServer().address().port}`;
    const requests: [string, RequestInit][]=[
      ['/v1/admin/events/1',{}],['/v1/admin/events/1',{headers:{authorization:'Bearer wrong'}}],
      ...['/v1/admin/events?search=abc','/v1/admin/events/1','/v1/admin/artists','/v1/admin/jobs','/v1/admin/media?after=1&limit=4','/v1/admin/enrichment?mode=all','/v1/admin/ai/artists','/v1/admin/ai/results','/v1/admin/ai/events?limit=2','/v1/admin/ai/events/1','/v1/admin/images/5','/v1/admin/images/5/info','/v1/admin/images/6'].map<[string, RequestInit]>(p=>[p,{headers:auth}]),
      ...['review','details','artist','price','confirm-assistant-review','enrich'].map<[string, RequestInit]>(action=>[`/v1/admin/events/1/${action}`,{method:'POST',headers:{...auth,'content-type':'application/json'},body:'{}'}]),
      ...['/v1/admin/imports/vilnius-events/page','/v1/admin/imports/avilys/page','/v1/admin/imports/musicbrainz/page','/v1/admin/imports/vilnius-events/reserve-request','/v1/admin/imports/musicbrainz/reserve-request','/v1/admin/jobs/start','/v1/admin/jobs/1','/v1/admin/images','/v1/admin/ai/results','/v1/admin/ai/results/1/decision'].map<[string, RequestInit]>(path=>[path,{method:'POST',headers:{...auth,'content-type':'application/json'},body:'{}'}]),
      ['/v1/admin/events/1/review',{method:'POST',headers:{...auth,'content-type':'text/plain'},body:'{}'}],
      ['/v1/admin/events/1/review',{method:'POST',headers:{...auth,'content-type':'application/json'},body:'{'}],
      ['/v1/admin/events/1/review',{method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify({padding:'x'.repeat(8192)})}],
      ['/v1/admin/events/0/review',{method:'POST',headers:{...auth,'content-type':'application/json'},body:'{}'}]
    ];
    const snapshots=JSON.parse(readFileSync(new URL('./fixtures/admin-contract.json',import.meta.url),'utf8'));
    assert.equal(snapshots.length,requests.length);
    for(const [i,[path,options]] of requests.entries()){
      const expected=snapshots[i],response=await fetch(current+path,options);
      assert.equal(response.status,expected.status,path);
      for(const [header,value] of Object.entries(expected.headers)) assert.equal(response.headers.get(header),value,`${path}: ${header}`);
      assert.equal(await response.text(),expected.body,path);
    }
  } finally {await app.close();await rm(dir,{recursive:true,force:true});}
});

test('Nest disables admin without a token and validates configured token',async()=>{
  const config=loadConfig({...env,ADMIN_TOKEN:''});
  const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(APP_CONFIG).useValue(config).overrideProvider(DatabaseService).useValue({pool:{}}).compile();
  const app=module.createNestApplication({logger:false,bodyParser:false});
  try {await app.listen(0,'127.0.0.1');const base=`http://127.0.0.1:${app.getHttpServer().address().port}`;assert.equal((await fetch(base+'/v1/admin/events/1',{headers:{authorization:`Bearer ${token}`}})).status,404);}
  finally {await app.close();}
  assert.throws(()=>createAdmin({} as unknown as import('mysql2/promise').Pool,'weak'),/at least 32 URL-safe/);
});

test('Nest admin edits persist both event records and reject invalid input', async()=>{
  const {DatabaseSync}=await import('node:sqlite');
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE events(id INTEGER PRIMARY KEY,review_status TEXT,title TEXT,event_date TEXT,event_end_date TEXT,event_time TEXT,venue TEXT,ticket_url TEXT,manual_fields TEXT);
    CREATE TABLE event_sources(id INTEGER PRIMARY KEY,event_id INTEGER,source_key TEXT,source_id TEXT);
    CREATE TABLE vilnius_events(source_id INTEGER PRIMARY KEY,review_status TEXT,event_date TEXT,event_end_date TEXT,event_time TEXT,venue TEXT,ticket_url TEXT,manual_fields TEXT,details_manual INTEGER);
    CREATE TABLE event_prices(event_id INTEGER PRIMARY KEY,price_text TEXT,price_type TEXT,manual INTEGER,checked_at TEXT);
    INSERT INTO events VALUES(1,'unsure','Concert','2026-11-20',NULL,NULL,NULL,NULL,'[]');
    INSERT INTO event_sources VALUES(1,1,'vilnius-events','99');
    INSERT INTO vilnius_events VALUES(99,'unsure','2026-11-20',NULL,NULL,NULL,NULL,'[]',0);`);
  db.exec('ALTER TABLE events ADD COLUMN interest_score INTEGER NOT NULL DEFAULT 1');
  const connection={async beginTransaction(){db.exec('BEGIN')},async commit(){db.exec('COMMIT')},async rollback(){db.exec('ROLLBACK')},release(){},async execute(sql: string,params: import('node:sqlite').SQLInputValue[]){const query=sql.replace(/ FOR UPDATE$/,'');const stmt=db.prepare(query);return [/^SELECT/i.test(query)?stmt.all(...params):stmt.run(...params)]}};
  const pool={getConnection:async()=>connection,execute:(sql: string,params: import('node:sqlite').SQLInputValue[])=>connection.execute(sql,params)};
  const config=loadConfig(env);
  const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(APP_CONFIG).useValue(config).overrideProvider(DatabaseService).useValue({pool}).compile();
  const app=module.createNestApplication({logger:false,bodyParser:false});
  try {
    await app.listen(0,'127.0.0.1');const base=`http://127.0.0.1:${app.getHttpServer().address().port}`;
    const post=(path: string,body: unknown,authorization=`Bearer ${token}`)=>fetch(base+path,{method:'POST',headers:{authorization,'content-type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await post('/v1/admin/events/1/review',{review_status:'music'},'Bearer wrong')).status,401);
    assert.equal(db.prepare('SELECT review_status FROM events').get()!.review_status,'unsure');
    assert.equal((await post('/v1/admin/events/1/review',{review_status:'music'})).status,200);
    assert.equal(db.prepare('SELECT review_status FROM events').get()!.review_status,'music');
    assert.equal(db.prepare('SELECT review_status FROM vilnius_events').get()!.review_status,'music');
    assert.equal((await post('/v1/admin/events/1/details',{review_status:'music',event_date:'2026-02-30'})).status,400);
    assert.equal((await post('/v1/admin/events/1/details',{review_status:'music',event_date:'2026-11-20',venue:' Club '})).status,200);
    assert.equal(db.prepare('SELECT venue FROM events').get()!.venue,'Club');
    assert.equal(db.prepare('SELECT venue FROM vilnius_events').get()!.venue,'Club');
    assert.equal((await post('/v1/admin/events/1/price',{price_type:'free',price_text:'Nemokama'})).status,200);
    assert.equal(db.prepare('SELECT price_type FROM event_prices').get()!.price_type,'free');
  } finally {await app.close();db.close();}
});
