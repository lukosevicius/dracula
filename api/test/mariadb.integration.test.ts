import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { createVerificationWorker } from '../dist/verification/verification.js';
import { importVilniusPage } from '../dist/imports/vilnius.js';
import { loadMigrations, migrate } from '../dist/migrate.js';

// This deliberately refuses existing data and never targets staging or production.
test('MariaDB: authenticated edits, private reads and public pagination', {skip:process.env.RUN_MARIADB_INTEGRATION !== '1'}, async () => {
  const {MYSQL_TEST_HOST:host,MYSQL_TEST_PORT:port,MYSQL_TEST_USER:user,MYSQL_TEST_PASSWORD:password,MYSQL_TEST_DATABASE:database}=process.env;
  if (!host || !port || !user || !password || !database || !/^[A-Za-z0-9_]+_test$/.test(database)) throw new Error('Configure a disposable empty database ending in _test.');
  const pool=mysql.createPool({host,port:Number(port),user,password,database,charset:'utf8mb4',connectionLimit:5,multipleStatements:true});
  let imageDir, nest;
  try {
    const [tables]=await pool.query<RowDataPacket[]>('SHOW FULL TABLES');
    if(tables.length) throw new Error('Test database is not empty; refusing to alter it.');
    const schema=await readFile(new URL('../schema.sql',import.meta.url),'utf8');
    for(const statement of schema.split(';').map(s=>s.trim()).filter(Boolean)) await pool.query(statement);
    await pool.execute("INSERT INTO events(id,title,event_date,review_status,manual_fields,created_at,updated_at) VALUES(1,'Example','2099-11-20','unsure','[]','now','now')");
    await pool.execute("INSERT INTO vilnius_events(source_id,title,source_url,content_html,categories_json,first_seen_at,updated_at,event_date,details_manual,review_status,details_version,manual_fields) VALUES(11,'Example','https://example.com','Hello','[]','now','now','2099-11-20',0,'unsure',0,'[]')");
    await pool.execute("INSERT INTO event_sources(id,event_id,source_key,source_id,source_url,content_html,source_data_json) VALUES(1,1,'vilnius-events','11','https://example.com','Hello','{}')");
    await pool.execute("INSERT INTO source_state(source_key,next_offset,total_available,updated_at) VALUES('vilnius-events',0,NULL,'now')");
    await pool.execute("INSERT INTO source_state(source_key,next_offset,total_available,updated_at) VALUES('musicbrainz-lithuania-artists',0,NULL,'now')");
    const mbid='f5e813d7-0f2e-499a-9d07-9c38d955837d';
    await pool.execute("INSERT INTO artists(mbid,name,aliases_json,source_url,first_seen_at,updated_at) VALUES(?,'Artist','[]','https://example.com','now','now')",[mbid]);
    await pool.execute("INSERT INTO assistant_event_reviews(event_id,reviewed_at,notes) VALUES(1,'now','test')");
    await pool.execute("INSERT INTO vilnius_images(media_id,source_url,local_name,mime_type,downloaded_at) VALUES(42,'https://example.com','42.jpg','image/jpeg','now')");
    await pool.execute('UPDATE vilnius_events SET featured_media=42 WHERE source_id=11');
    imageDir=await mkdtemp(join(tmpdir(),'dracula-api-test-')); await writeFile(join(imageDir,'42.jpg'),Buffer.from([1,2,3]));
    const token='0123456789abcdef0123456789abcdef';
    const aiEncryptionKey='a'.repeat(64);
    let root: string;
    const headers={authorization:`Bearer ${token}`,'content-type':'application/json'};
    const post=(action: string,body: unknown)=>fetch(`${root}/v1/admin/events/1/${action}`,{method:'POST',headers,body:JSON.stringify(body)});
    // Run the Nest server with its real connection pool against the same disposable fixture.
    const {Test}=await import('@nestjs/testing');
    const {AppModule}=await import('../dist/app.module.js');
    const {APP_CONFIG}=await import('../dist/config/config.js');
    const nestModule=await Test.createTestingModule({imports:[AppModule]})
      .overrideProvider(APP_CONFIG).useValue({dbHost:host,dbPort:Number(port),dbUser:user,dbPassword:password,dbName:database,publicBaseUrl:'https://api.example.com',imageDir,port:3000,adminToken:token,aiEncryptionKey,disableVerificationWorker:true}).compile();
    nest=nestModule.createNestApplication({logger:false,bodyParser:false});
    {
      await nest.listen(0,'127.0.0.1');
      const nestRoot=`http://127.0.0.1:${nest.getHttpServer().address().port}`;
      assert.deepEqual(await (await fetch(`${nestRoot}/health`)).json(),{status:'ok'});
      assert.equal((await fetch(`${nestRoot}/v1/admin/events/1`)).status,401);
      const settingsUrl=`${nestRoot}/v1/admin/seeker/settings`;
      const saveSetting=(key: string,value: string | boolean)=>fetch(settingsUrl,{method:'POST',headers,body:JSON.stringify({key,value})});
      assert.equal((await saveSetting('start_page','/avilys.html')).status,200);
      for (const verifyAfterImport of [false,true]) {
        assert.equal((await saveSetting('verify_after_import',verifyAfterImport)).status,200);
        const preferences=await fetch(settingsUrl,{headers});
        assert.equal(preferences.status,200);
        assert.deepEqual(await preferences.json(),{settings:{start_page:'/avilys.html',verify_after_import:verifyAfterImport}});
      }
      const nestPost=(action: string,body: unknown)=>fetch(`${nestRoot}/v1/admin/events/1/${action}`,{method:'POST',headers,body:JSON.stringify(body)});
      assert.equal((await nestPost('review',{review_status:'invalid'})).status,400);
      assert.equal((await nestPost('review',{review_status:'music'})).status,200);
      assert.equal((await nestPost('details',{review_status:'music',event_date:'2099-11-20',event_end_date:'2099-11-21',venue:'Venue'})).status,200);
      assert.equal((await nestPost('artist',{mbid,decision:'accepted'})).status,200);
      assert.equal((await nestPost('price',{price_type:'free',price_text:'Nemokama'})).status,200);
      const adminList=async (query: string) => (await fetch(`${nestRoot}/v1/admin/events?when=all&${query}`,{headers})).json();
      assert.equal((await adminList('time=unknown&price=free')).total,1);
      assert.equal((await adminList('time=known')).total,0);
      assert.equal((await adminList('price=unknown')).total,0);
      await pool.execute("UPDATE events SET event_time='19:00' WHERE id=1");
      assert.equal((await adminList('time=known')).total,1);
      await pool.execute('UPDATE events SET event_time=NULL WHERE id=1');
      assert.equal((await fetch(`${nestRoot}/v1/events/1`)).status,404);
      const eventVersion=await (await fetch(`${nestRoot}/v1/seeker/events/1/verification`,{headers})).json();
      const publish=await fetch(`${nestRoot}/v1/seeker/events/1/publication`,{method:'POST',headers,body:JSON.stringify({status:'live',revision:eventVersion.revision})});
      assert.equal(publish.status,200);
      const filtered=await fetch(`${nestRoot}/v1/events?filter=custom&from=2099-11-20&to=2099-11-21&offset=0&limit=1`);
      assert.equal(filtered.status,200);const page=await filtered.json();
      assert.equal(page.total,1);assert.equal(page.items[0].venue,'Venue');assert.equal(page.items[0].price_type,'free');assert.equal(page.items[0].artists[0].mbid,mbid);
      const details=await (await fetch(`${nestRoot}/v1/admin/events/1`,{headers})).json();assert.equal(details.event.review_status,'music');
      const publicImage=await fetch(`${nestRoot}/v1/images/42.jpg`);assert.equal(publicImage.status,200);assert.deepEqual([...new Uint8Array(await publicImage.arrayBuffer())],[1,2,3]);
      const privateImage=await fetch(`${nestRoot}/v1/admin/images/42`,{headers});assert.equal(privateImage.status,200);assert.deepEqual([...new Uint8Array(await privateImage.arrayBuffer())],[1,2,3]);
      root=nestRoot;
    }
    const result=await (await fetch(`${root}/v1/events?filter=custom&from=2099-11-20&to=2099-11-21&offset=0&limit=1`)).json();
    assert.equal(result.total,1); assert.equal(result.items[0].venue,'Venue');
    assert.equal(result.items[0].price_type,'free'); assert.equal(result.items[0].artists[0].mbid,mbid);
    const privateEvent=await (await fetch(`${root}/v1/admin/events/1`,{headers})).json();
    assert.equal(privateEvent.event.review_status,'music');
    const artistDashboard=await (await fetch(`${root}/v1/admin/artists`,{headers})).json();assert.equal(artistDashboard.totalArtists,1);assert.equal(artistDashboard.artists[0].mbid,mbid);
    const media=await (await fetch(`${root}/v1/admin/media?after=0&limit=1`,{headers})).json();assert.deepEqual(media.ids,[42]);
    assert.equal(privateEvent.vilnius_event.source_id,11); assert.equal(privateEvent.image.media_id,42); assert.equal(privateEvent.available_artists[0].mbid,mbid);
    assert.equal((await fetch(`${root}/v1/admin/images/42`)).status,401);
    const image=await fetch(`${root}/v1/admin/images/42`,{headers}); assert.equal(image.status,200); assert.equal(image.headers.get('content-type'),'image/jpeg'); assert.deepEqual([...new Uint8Array(await image.arrayBuffer())],[1,2,3]);
    const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
    const upload= (body: unknown)=>fetch(`${root}/v1/admin/images`,{method:'POST',headers,body:JSON.stringify(body)});
    const imagePayload={media_id:42,source_url:'https://www.vilnius-events.lt/wp-content/uploads/a.png',mime_type:'image/png',data:png,width:1,height:1};
    assert.equal((await upload({...imagePayload,data:Buffer.from('<html>').toString('base64')})).status,400);
    assert.equal((await upload({...imagePayload,media_id:999})).status,404);
    const uploaded=await upload(imagePayload);assert.equal(uploaded.status,200);const imageName=(await uploaded.json()).name;
    const imageAfter=await fetch(`${root}/v1/admin/images/42`,{headers});assert.equal(imageAfter.status,200);assert.equal(imageAfter.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await imageAfter.arrayBuffer()),Buffer.from(png,'base64'));
    const info=await (await fetch(`${root}/v1/admin/images/42/info`,{headers})).json();assert.equal(info.source_url,imagePayload.source_url);assert.equal(info.source_modified,null);
    assert.equal((await fetch(`${root}/v1/images/${imageName}`)).status,200);
    assert.equal((await post('confirm-assistant-review',{})).status,200); assert.equal((await post('confirm-assistant-review',{})).status,404);
    const reserve=()=>fetch(`${root}/v1/admin/imports/vilnius-events/reserve-request`,{method:'POST',headers,body:'{}'});
    const reservations=await Promise.all([reserve(),reserve()]);
    const slots=await Promise.all(reservations.map(response=>response.json()));
    assert.equal(slots.filter(slot=>slot.waitMs===0).length,1);assert.equal(slots.filter(slot=>slot.waitMs>0).length,1);
    const importUrl=`${root}/v1/admin/imports/vilnius-events/page`;
    const item={source_id:12,title:'New event',source_url:'https://www.vilnius-events.lt/test',content_html:'source',categories:[4],featured_media:null,published_at:null,modified_at:'one',details:{event_date:'2099-11-20',venue:'Original'}};
    const payload={items:[item],verify_after_import:false,advance_cursor:true,expected_offset:0,next_offset:1,total_available:null};
    const importPage= (body: unknown)=>fetch(importUrl,{method:'POST',headers,body:JSON.stringify(body)});
    const imported=await (await importPage(payload)).json();
    assert.equal(imported.added,1); assert.equal(imported.changedEventIds.length,1);
    assert.equal((await importPage(payload)).status,409);
    const [[linked]]=await pool.execute<RowDataPacket[]>("SELECT s.event_id,e.city FROM event_sources s JOIN events e ON e.id=s.event_id WHERE s.source_key='vilnius-events' AND s.source_id='12'");
    assert.equal(linked.city,'Vilnius');
    await pool.execute('UPDATE events SET city=NULL WHERE id=?',[linked.event_id]);
    assert.equal((await fetch(`${root}/v1/admin/events/${linked.event_id}/details`,{method:'POST',headers,body:JSON.stringify({review_status:'music',event_date:'2099-11-20',venue:'Manual'})})).status,200);
    assert.equal((await importPage({...payload,advance_cursor:false,items:[{...item,modified_at:'two',content_html:'changed',details:{...item.details,venue:'Source update'}}]})).status,200);
    const [[preserved]]=await pool.execute<RowDataPacket[]>('SELECT review_status,venue,manual_fields,city FROM events WHERE id=?',[linked.event_id]);
    assert.equal(preserved.review_status,'music'); assert.equal(preserved.venue,'Manual'); assert.ok(JSON.parse(preserved.manual_fields).includes('venue'));
    assert.equal(preserved.city,'Vilnius');
    await pool.execute("INSERT INTO vilnius_events(source_id,title,source_url,content_html,categories_json,first_seen_at,updated_at,details_manual,review_status,details_version,manual_fields) VALUES(13,'Orphan','https://www.vilnius-events.lt/test','x','[]','now','now',0,'unsure',0,'[]')");
    const failed=await importPage({...payload,advance_cursor:false,items:[{...item,source_id:14},{...item,source_id:13}]});
    assert.equal(failed.status,409);
    const [[rolledBack]]=await pool.execute<RowDataPacket[]>("SELECT COUNT(*) AS n FROM event_sources WHERE source_key='vilnius-events' AND source_id='14'");
    assert.equal(rolledBack.n,0);
    const concurrent={items:[],advance_cursor:true,expected_offset:1,next_offset:2,total_available:10};
    const attempts=await Promise.allSettled([importVilniusPage(pool,concurrent),importVilniusPage(pool,concurrent)]);
    assert.equal(attempts.filter(item=>item.status==='fulfilled').length,1);
    assert.equal(attempts.filter(item=>item.status==='rejected' && item.reason.status===409).length,1);
    const startJob=()=>fetch(`${root}/v1/admin/jobs/start`,{method:'POST',headers,body:JSON.stringify({action:'sample'})});
    const starts=await Promise.all([startJob(),startJob()]);assert.deepEqual(starts.map(r=>r.status).sort(),[200,409]);
    const job=await starts.find(r=>r.status===200)!.json();
    const avilysItem={id:987654,title:'Avilys music',city:'vilnius',categories:[{id:1}],description:'Concert',startTime:'2099-11-20T19:00:00Z',venueName:'Club'};
    const avilys= (body: Record<string,unknown>)=>fetch(`${root}/v1/admin/imports/avilys/page`,{method:'POST',headers,body:JSON.stringify({verify_after_import:false,...body})});
    assert.deepEqual(await (await avilys({job:{id:job.id,owner:job.owner},items:[avilysItem]})).json(),{ok:true,added:1,updated:0,attached:0});
    assert.deepEqual(await (await avilys({job:{id:job.id,owner:job.owner},items:[avilysItem]})).json(),{ok:true,added:0,updated:1,attached:0});
    const [[avilysEvent]]=await pool.execute<RowDataPacket[]>("SELECT e.id,e.review_status,e.city,e.event_time FROM events e JOIN event_sources s ON s.event_id=e.id WHERE s.source_key='avilys' AND s.source_id='987654'");
    assert.equal(avilysEvent.review_status,'unsure');
    assert.equal(avilysEvent.city,'Vilnius');
    assert.equal(avilysEvent.event_time,'19:00');
    await pool.execute("UPDATE events SET event_time=NULL,manual_fields='[]' WHERE id=?",[avilysEvent.id]);
    await avilys({job:{id:job.id,owner:job.owner},items:[avilysItem]});
    const [[backfilled]]=await pool.execute<RowDataPacket[]>('SELECT event_time FROM events WHERE id=?',[avilysEvent.id]);
    assert.equal(backfilled.event_time,'19:00');
    await pool.execute("UPDATE events SET event_time=NULL,manual_fields='[\"event_time\"]' WHERE id=?",[avilysEvent.id]);
    await avilys({job:{id:job.id,owner:job.owner},items:[avilysItem]});
    const [[manual]]=await pool.execute<RowDataPacket[]>('SELECT event_time FROM events WHERE id=?',[avilysEvent.id]);
    assert.equal(manual.event_time,null);
    await pool.execute("UPDATE events SET event_time='18:00',manual_fields='[]' WHERE id=?",[avilysEvent.id]);
    await avilys({job:{id:job.id,owner:job.owner},items:[avilysItem]});
    const [[existingTime]]=await pool.execute<RowDataPacket[]>('SELECT event_time FROM events WHERE id=?',[avilysEvent.id]);
    assert.equal(existingTime.event_time,'18:00');
    assert.equal((await upload(imagePayload)).status,409);
    assert.equal((await upload({...imagePayload,job:{id:job.id,owner:job.owner}})).status,200);
    const candidates=await (await fetch(`${root}/v1/admin/enrichment?mode=event&eventId=1`,{headers})).json();assert.equal(candidates.events.length,1);
    const enrichInput={job:{id:job.id,owner:job.owner},expected_source_url:'https://example.com',expected_content_html:'Hello',details:{event_date:'2099-11-20',event_end_date:'2099-11-21',venue:'Source venue'},about_url:'https://example.com/event',price_type:'paid',price_text:'20 €'};
    const enrich= (body: unknown)=>fetch(`${root}/v1/admin/events/1/enrich`,{method:'POST',headers,body:JSON.stringify(body)});
    assert.equal((await enrich({...enrichInput,expected_content_html:'stale'})).status,409);
    assert.equal((await enrich(enrichInput)).status,200);
    const [[reviewed]]=await pool.execute<RowDataPacket[]>('SELECT e.venue,p.price_type,s.about_url FROM events e JOIN event_prices p ON p.event_id=e.id JOIN event_sources s ON s.event_id=e.id WHERE e.id=1');assert.equal(reviewed.venue,'Venue');assert.equal(reviewed.price_type,'free');assert.equal(reviewed.about_url,'https://example.com/event');
    const fixture={...payload,advance_cursor:false,items:[{...item,source_id:15}]};
    assert.equal((await importPage(fixture)).status,409);
    assert.equal((await importPage({...fixture,job:{id:job.id,owner:job.owner}})).status,200);
    const update=(status: string,owner=job.owner)=>fetch(`${root}/v1/admin/jobs/${job.id}`,{method:'POST',headers,body:JSON.stringify({status,owner,progress:{fetched:1,added:1,updated:0}})});
    assert.equal((await update('running','a'.repeat(64))).status,409);
    assert.equal((await update('completed')).status,200);
    assert.equal((await importPage({...fixture,job:{id:job.id,owner:job.owner}})).status,409);
    const listed=await (await fetch(`${root}/v1/admin/jobs`,{headers})).json();assert.equal(listed.jobs[0].status,'completed');
    const old=await (await startJob()).json();await pool.execute('UPDATE job_leases SET expires_at=? WHERE source_key=?',[Date.now()-1,'vilnius-events']);
    const replacement=await (await startJob()).json();
    assert.equal((await importPage({...fixture,job:{id:old.id,owner:old.owner}})).status,409);
    const [interrupted]=await pool.execute<RowDataPacket[]>('SELECT status FROM jobs WHERE id=?',[old.id]);assert.equal(interrupted[0].status,'interrupted');
    assert.equal((await fetch(`${root}/v1/admin/jobs/${replacement.id}`,{method:'POST',headers,body:JSON.stringify({status:'completed',owner:replacement.owner,progress:{fetched:0,added:0,updated:0}})})).status,200);
    const artistStart=await fetch(`${root}/v1/admin/jobs/start`,{method:'POST',headers,body:JSON.stringify({source:'musicbrainz',action:'next',limit:2})});assert.equal(artistStart.status,200);const artistJob=await artistStart.json();
    const artistPayload={job:{id:artistJob.id,owner:artistJob.owner},expected_offset:0,next_offset:2,total_available:null,artists:[{id:mbid,name:'Updated artist',country:'LT',aliases:['Alias']}]};
    const artistImport= (body: unknown)=>fetch(`${root}/v1/admin/imports/musicbrainz/page`,{method:'POST',headers,body:JSON.stringify(body)});
    assert.equal((await artistImport({...artistPayload,job:{id:artistJob.id,owner:'0'.repeat(64)}})).status,409);
    assert.deepEqual(await (await artistImport(artistPayload)).json(),{ok:true,added:0,updated:1});assert.equal((await artistImport(artistPayload)).status,409);
    assert.equal((await fetch(`${root}/v1/admin/jobs/${artistJob.id}`,{method:'POST',headers,body:JSON.stringify({source:'musicbrainz',status:'completed',owner:artistJob.owner,progress:{fetched:1,added:0,updated:1}})})).status,200);
    const [[artistRun]]=await pool.execute<RowDataPacket[]>('SELECT status,updated_count FROM import_runs ORDER BY id DESC LIMIT 1');assert.equal(artistRun.status,'completed');assert.equal(artistRun.updated_count,1);
    const aiStart=await fetch(`${root}/v1/admin/jobs/start`,{method:'POST',headers,body:JSON.stringify({source:'ai-evaluation',action:'analyze'})});assert.equal(aiStart.status,200);const aiJob=await aiStart.json();
    const aiSave= (body: unknown)=>fetch(`${root}/v1/admin/ai/results`,{method:'POST',headers,body:JSON.stringify(body)});
    const aiResult={job:{id:aiJob.id,owner:aiJob.owner},event_id:1,model:'gemini-3.5-flash-lite',classification:'music',explanation:'Test',performers:[],input_tokens:10,output_tokens:5,cost_usd:0.0001,status:'completed',error_message:null};
    assert.equal((await aiSave({...aiResult,job:{id:aiJob.id,owner:'0'.repeat(64)}})).status,409);assert.equal((await aiSave(aiResult)).status,200);
    const aiList=await (await fetch(`${root}/v1/admin/ai/results`,{headers})).json();assert.equal(aiList.results[0].classification,'music');
    assert.equal((await fetch(`${root}/v1/admin/ai/results/${aiList.results[0].id}/decision`,{method:'POST',headers,body:JSON.stringify({decision:'accepted'})})).status,200);
    assert.equal((await fetch(`${root}/v1/admin/jobs/${aiJob.id}`,{method:'POST',headers,body:JSON.stringify({source:'ai-evaluation',status:'completed',owner:aiJob.owner,progress:{fetched:1,added:1,updated:0,completed:1,total:1,failed:0,cost_usd:0.0001}})})).status,200);
    const [[aiProgress]]=await pool.execute<RowDataPacket[]>('SELECT progress_json FROM jobs WHERE id=?',[aiJob.id]);assert.equal(JSON.parse(aiProgress.progress_json).cost_usd,0.0001);

    const workflow = (path: string, value?: unknown, auth = headers) => fetch(`${root}/v1/seeker${path}`, {headers:auth,...(value===undefined?{}:{method:'POST',body:JSON.stringify(value)})});
    assert.equal((await workflow('/providers',{action:'save',name:'Test Gemini',provider:'gemini',model:'test-model',key:'test-provider-key'})).status,200);
    const provider = (await (await workflow('/providers')).json()).profiles[0];
    assert.equal('encrypted_key' in provider,false);
    const started = await (await startJob()).json();
    const imports = [
      {source_id:30,title:'Test concert 30',event_time:null,description:'Gyvos muzikos koncertas 19:30'},
      {source_id:31,title:'Test concert 31',event_time:null,description:'Gyvos muzikos koncertas 18:30 arba 20:30'},
      {source_id:32,title:'Test workshop',event_time:'20:00',description:'Keramikos dirbtuvės 20:00'},
    ];
    const saved=await (await importPage({...payload,verify_after_import:true,advance_cursor:false,job:{id:started.id,owner:started.owner},
      items:imports.map(e=>({...item,source_id:e.source_id,title:e.title,content_html:e.description,details:{event_date:'2099-11-20',event_time:e.event_time,venue:'Club'}}))})).json();
    const [clean, flagged, workshop]=saved.changedEventIds as number[];
    const worker=createVerificationWorker(pool,aiEncryptionKey,async (_url,request) => {
      const body=String(request?.body);
      const uncertain=body.includes('Test concert 31');
      const nonMusic=body.includes('Test workshop');
      const confirmed=(field:string,proposed:string,evidence=proposed)=>({field,disposition:'confirmed',proposed,evidence,reason:'Source agrees.'});
      const findings=[
        confirmed('event_date','2099-11-20'),
        uncertain?{field:'event_time',disposition:'attention',proposed:'',evidence:'18:30 arba 20:30',reason:'The source gives two times.'}
          :nonMusic?confirmed('event_time','20:00'):{field:'event_time',disposition:'suggestion',proposed:'19:30',evidence:'19:30',reason:'The description states the time.'},
        confirmed('venue','Club'),
        {field:'review_status',disposition:'suggestion',proposed:nonMusic?'not_music':'music',evidence:nonMusic?'Keramikos dirbtuvės':'Gyvos muzikos koncertas',reason:'Source describes the activity.'},
      ];
      return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({findings})}]}}],
        usageMetadata:{promptTokenCount:200,candidatesTokenCount:30}});
    });
    assert.equal(await worker(),false,'verification waits for the import lease');
    assert.equal((await (await workflow(`/events/${clean}/verification`)).json()).publication_status,'draft');
    assert.equal((await fetch(`${root}/v1/admin/jobs/${started.id}`,{method:'POST',headers,body:JSON.stringify({status:'completed',owner:started.owner,progress:{fetched:3,added:3,updated:0}})})).status,200);
    for(let i=0;i<3;i++) assert.equal(await worker(),true);
    const cleanResult=await (await workflow(`/events/${clean}/verification`)).json();
    assert.equal(cleanResult.publication_status,'live');
    const [[filled]]=await pool.execute<RowDataPacket[]>('SELECT event_time FROM events WHERE id=?',[clean]);
    assert.equal(filled.event_time,'19:30');
    assert.deepEqual(cleanResult.log.map((entry:{action:string})=>entry.action),['published','verified','imported']);
    const flaggedResult=await (await workflow(`/events/${flagged}/verification`)).json();
    assert.equal(flaggedResult.publication_status,'draft');
    assert.equal(flaggedResult.findings.length,1);
    assert.equal((await workflow(`/events/${flagged}/findings/${flaggedResult.findings[0].id}`,{decision:'approve',revision:flaggedResult.revision,value:'20:30'})).status,200);
    const approved=await (await workflow(`/events/${flagged}/verification`)).json();
    assert.equal(approved.findings.length,0);
    assert.equal(approved.publication_status,'draft');
    assert.equal((await workflow(`/events/${flagged}/publication`,{status:'live',revision:approved.revision})).status,200);
    const nowLive=await (await workflow(`/events/${flagged}/verification`)).json();
    assert.equal((await workflow(`/events/${flagged}/publication`,{status:'draft',revision:nowLive.revision})).status,200);
    assert.equal((await fetch(`${root}/v1/events/${flagged}`)).status,404);
    assert.equal((await (await workflow(`/events/${flagged}/verification`)).json()).log[0].action,'unpublished');
    const notMusic=await (await workflow(`/events/${workshop}`)).json();
    assert.equal(notMusic.event.review_status,'not_music');
    assert.equal(notMusic.event.publication_status,'draft');
    const usageResponse = await workflow('/verification/usage?period=month');
    assert.equal(usageResponse.status,200);
    const usage = await usageResponse.json();
    assert.deepEqual(usage.activity,{completed:3,failed:0,skipped:0,flagged:1});
    assert.deepEqual(usage.by_model,[{provider:'gemini',model:'test-model',requests:3,missing_usage:0,unpriced:3,
      input_tokens:600,cached_input_tokens:0,output_tokens:90,estimated_cost_usd:null}]);
    const run = usage.runs.find((entry:{import_job_id:number})=>entry.import_job_id===started.id);
    assert.equal(run.events,3);
    assert.equal(run.flagged,1);
    assert.match(run.started_at,/Z$/);
    const runEvents = await (await workflow(`/verification/jobs/${run.id}`)).json();
    assert.ok(runEvents.events.some((event:{event_id:number;title:string;flagged:number})=>event.event_id===flagged && event.title==='Test concert 31' && event.flagged===1));
    assert.equal((await workflow('/verification/usage?period=invalid')).status,400);
    const agent=(await (await workflow('/agents',{action:'create',name:'Read-only',scopes:['events:read']})).json());
    const agentHeaders={...headers,authorization:`Bearer ${agent.token}`};
    assert.equal((await workflow('/events?when=all&review=not_music',undefined,agentHeaders)).status,200);
    assert.equal((await workflow('/verification/usage',undefined,agentHeaders)).status,403);
    assert.equal((await workflow(`/events/${clean}/publication`,{status:'draft',revision:cleanResult.revision},agentHeaders)).status,403);
    assert.equal((await workflow('/agents',{action:'revoke',id:agent.id})).status,200);
    assert.equal((await workflow('/events',undefined,agentHeaders)).status,401);

    const obsoleteFinding = JSON.stringify({field:'event',reason:'No saved value was available to confirm.'});
    const currentFinding = JSON.stringify({field:'event_time',reason:'The source lists a different start time.'});
    await pool.execute(`INSERT INTO verification_findings(event_id,verification_id,field_name,finding)
      VALUES(?,?,'event',?),(?,?,'event',?),(?,?,'event_time',?)`, [
      clean,cleanResult.last_run.id,obsoleteFinding,
      flagged,flaggedResult.last_run.id,obsoleteFinding,
      flagged,flaggedResult.last_run.id,currentFinding,
    ]);
    await pool.execute('UPDATE events SET needs_attention=1 WHERE id IN (?,?)',[clean,flagged]);
    const cleanup = await readFile(new URL('../migrations/017-clear-ai-event-log.sql',import.meta.url),'utf8');
    const cleanupDb = await pool.getConnection();
    try { await cleanupDb.query(cleanup); } finally { cleanupDb.release(); }
    const cleared = await (await workflow(`/events/${clean}/verification`)).json();
    assert.deepEqual(cleared.log.map((entry:{action:string})=>entry.action),['imported']);
    assert.deepEqual(cleared.findings,[]);
    assert.equal(cleared.needs_attention,0);
    assert.equal(cleared.publication_status,'live');
    assert.equal(cleared.last_run.id,cleanResult.last_run.id);
    const stillFlagged = await (await workflow(`/events/${flagged}/verification`)).json();
    assert.deepEqual(stillFlagged.log.map((entry:{action:string})=>entry.action),['unpublished','published','finding_approved','imported']);
    assert.deepEqual(stillFlagged.findings.map((finding:{reason:string})=>finding.reason),[JSON.parse(currentFinding).reason]);
    assert.equal(stillFlagged.needs_attention,1);
    await pool.execute("INSERT INTO event_history(event_id,action,actor,changes,context) VALUES(?,'verified','AI verification','{}','{}')",[clean]);
    const afterCleanup = await (await workflow(`/events/${clean}/verification`)).json();
    assert.deepEqual(afterCleanup.log.map((entry:{action:string})=>entry.action),['verified','imported']);

    // Recreate the pre-city, pre-preferences and pre-score schema to exercise migrations.
    await pool.query('DROP TABLE event_redirects,event_duplicate_dismissals');
    await pool.query('ALTER TABLE event_sources DROP COLUMN is_secondary');
    await pool.query('DROP TABLE verification_provider_requests,verification_findings,event_verifications,verification_jobs,verification_rule_state,verification_rule_versions,verification_providers,event_history,seeker_agent_keys,seeker_import_requests');
    await pool.query('ALTER TABLE event_sources DROP COLUMN detail_evidence_json');
    await pool.query(`ALTER TABLE events DROP COLUMN city, DROP COLUMN interest_score,
      DROP INDEX idx_events_public_date, DROP INDEX idx_events_verification, DROP INDEX idx_events_attention,
      DROP COLUMN publication_status, DROP COLUMN publication_manual, DROP COLUMN publication_review_required,
      DROP COLUMN classification_manual, DROP COLUMN description_override, DROP COLUMN about_url_override,
      DROP COLUMN revision, DROP COLUMN verification_status, DROP COLUMN needs_attention`);
    await pool.query('DROP TABLE event_images, seeker_saved_events, seeker_settings');
    await pool.query(`INSERT INTO events(id,title,review_status,manual_fields,created_at,updated_at)
      VALUES(10001,'Kaunas fixture','unsure','[]','now','now'),(10002,'Unknown city fixture','unsure','[]','now','now');
      INSERT INTO event_sources(event_id,source_key,source_id,source_url,content_html,source_data_json)
      VALUES(10001,'avilys','10001','https://example.com','','{"city":" Kaunas "}'),(10002,'avilys','10002','https://example.com','','{broken');`);

    // Exercise the backfill, baseline, idempotence, checksum protection, and a partial DDL failure.
    const migrationDir=await mkdtemp(join(tmpdir(),'dracula-migrations-'));
    const migrationDb=await pool.getConnection();
    try {
      await assert.rejects(migrate(migrationDb,'up'),/not baselined/);
      await assert.rejects(migrate(migrationDb,'check'),/Pending migrations/);
      await migrate(migrationDb,'baseline');
      await assert.rejects(migrate(migrationDb,'check'),/Pending migrations/);
      await migrate(migrationDb,'up');
      await migrate(migrationDb,'check');
      await migrate(migrationDb,'up');
      const rules = await (await workflow('/verification/rules')).json();
      assert.equal(rules.active.id,2);
      assert.match(rules.active.markdown,/Use the advertised general admission price/);
      assert.ok(!rules.actions.some((action: { key: string }) => action.key === 'description'));
      const [[scoreColumn]]=await migrationDb.query<RowDataPacket[]>('SELECT interest_score FROM events WHERE id=1');
      assert.equal(scoreColumn.interest_score,1);
      const [migrated]=await migrationDb.query<RowDataPacket[]>('SELECT publication_status FROM events WHERE id IN (1,10001) ORDER BY id');
      assert.deepEqual(migrated.map(row=>row.publication_status),['live','draft']);
      const [cities]=await migrationDb.query<RowDataPacket[]>('SELECT city FROM events WHERE id IN (?) ORDER BY id',[[1,avilysEvent.id,10001,10002]]);
      assert.deepEqual(cities.map(row=>row.city),['Vilnius','Vilnius','Kaunas',null]);

      // Account identifiers and session hashes must be unique, and account deletion cascades.
      await migrationDb.execute("INSERT INTO users (display_name) VALUES ('Test user'), ('Second user')");
      const [users]=await migrationDb.query<RowDataPacket[]>("SELECT id FROM users ORDER BY id");
      const [userId, otherId]=users.map(row=>row.id);
      await migrationDb.execute('INSERT INTO user_followed_artists(user_id,artist_mbid) VALUES (?,?)',[userId,mbid]);
      await migrationDb.execute("INSERT INTO user_identities (user_id,provider,provider_subject) VALUES (?, 'google', 'CaseSensitive')",[userId]);
      await assert.rejects(migrationDb.execute("INSERT INTO user_identities (user_id,provider,provider_subject) VALUES (?, 'google', 'CaseSensitive')",[otherId]),{code:'ER_DUP_ENTRY'});
      await migrationDb.execute("INSERT INTO user_identities (user_id,provider,provider_subject) VALUES (?, 'google', 'casesensitive')",[otherId]);
      const sessionHash=Buffer.alloc(32,1);
      await migrationDb.execute("INSERT INTO user_sessions (user_id,session_hash,expires_at) VALUES (?,?,?)",[userId,sessionHash,'2099-01-01 00:00:00']);
      await assert.rejects(migrationDb.execute("INSERT INTO user_sessions (user_id,session_hash,expires_at) VALUES (?,?,?)",[otherId,sessionHash,'2099-01-01 00:00:00']),{code:'ER_DUP_ENTRY'});
      await migrationDb.execute('DELETE FROM users WHERE id=?',[userId]);
      const [[remainingFollows]]=await migrationDb.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM user_followed_artists WHERE user_id=?',[userId]);
      assert.equal(Number(remainingFollows.n),0);
      const [[remainingIdentities]]=await migrationDb.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM user_identities WHERE user_id=?',[userId]);
      const [[remainingSessions]]=await migrationDb.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM user_sessions WHERE user_id=?',[userId]);
      assert.equal(remainingIdentities.n,0); assert.equal(remainingSessions.n,0);

      // Exercise real sessions and nonce consumption with a stubbed Google verifier.
      const { AuthService } = await import('../dist/auth/auth.service.js');
      const { DatabaseService } = await import('../dist/database/database.service.js');
      const { loadConfig } = await import('../dist/config/config.js');
      const authConfig=loadConfig({DB_HOST:host,DB_PORT:port,DB_USER:user,DB_PASSWORD:password,DB_NAME:database,PUBLIC_BASE_URL:'http://localhost:3000',IMAGE_DIR:imageDir,GOOGLE_CLIENT_ID:'123-test.apps.googleusercontent.com',AUTH_ORIGINS:'http://localhost:8081'});
      const authModule=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(APP_CONFIG).useValue(authConfig).overrideProvider(DatabaseService).useValue({pool}).compile();
      const authApp=authModule.createNestApplication({logger:false,bodyParser:false});
      const authService=authApp.get(AuthService);
      let googleNonce='';
      Object.assign(authService, {google:{verifyIdToken:async ({idToken}: {idToken:string})=>{
        if(idToken!=='valid') throw new Error('Invalid token');
        return {getPayload:()=>({sub:'google-test-subject',name:'Test name',nonce:googleNonce})};
      }}});
      await authApp.listen(0,'127.0.0.1');
      try {
        const authRoot=`http://127.0.0.1:${authApp.getHttpServer().address().port}`;
        const origin='http://localhost:8081';
        const challenge=async()=>{const response=await fetch(`${authRoot}/v1/auth/challenge`,{method:'POST',headers:{origin}});assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),origin);assert.equal(response.headers.get('access-control-allow-credentials'),'true');assert.equal(response.headers.get('cache-control'),'no-store');const result=await response.json();googleNonce=result.nonce;return response.headers.getSetCookie()[0].split(';')[0];};
        const login=(challengeCookie:string,credential='valid',requestOrigin=origin)=>fetch(`${authRoot}/v1/auth/google`,{method:'POST',headers:{origin:requestOrigin,cookie:challengeCookie,'content-type':'application/json'},body:JSON.stringify({credential})});
        assert.equal((await fetch(`${authRoot}/v1/auth/challenge`,{method:'POST',headers:{origin:'https://attacker.example'}})).status,403);
        const preflight=await fetch(`${authRoot}/v1/me`,{method:'OPTIONS',headers:{origin,'access-control-request-method':'PATCH'}});
        assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);assert.equal(preflight.headers.get('access-control-allow-credentials'),'true');
        const challengeCookie=await challenge();
        assert.equal((await login(challengeCookie,'invalid')).status,401);
        const signedIn=await login(challengeCookie);assert.equal(signedIn.status,200);
        const authCookies=signedIn.headers.getSetCookie();
        const sessionCookie=authCookies.find(value=>value.startsWith('dracula_session='));assert.ok(sessionCookie);assert.match(sessionCookie,/HttpOnly/);assert.match(sessionCookie,/SameSite=Lax/);
        const session=sessionCookie.split(';')[0];
        assert.equal((await login(challengeCookie)).status,401);
        assert.equal((await fetch(`${authRoot}/v1/me`,{headers:{cookie:session}})).status,200);
        const profileBody=JSON.stringify({displayName:'Edited name'});
        assert.equal((await fetch(`${authRoot}/v1/me`,{method:'PATCH',headers:{origin:'https://attacker.example',cookie:session,'content-type':'application/json'},body:profileBody})).status,403);
        const profile=await fetch(`${authRoot}/v1/me`,{method:'PATCH',headers:{origin,cookie:session,'content-type':'application/json'},body:profileBody});
        assert.equal(profile.status,200);assert.equal((await profile.json()).user.displayName,'Edited name');
        assert.equal((await fetch(`${authRoot}/v1/auth/logout`,{method:'POST',headers:{origin,cookie:session}})).status,200);
        assert.equal((await fetch(`${authRoot}/v1/me`,{headers:{cookie:session}})).status,401);
        const expired=await challenge();await pool.query('UPDATE auth_challenges SET expires_at=DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND)');
        assert.equal((await login(expired)).status,401);
        const firstLogin=await login(await challenge());assert.equal(firstLogin.status,200);
        const firstSession=firstLogin.headers.getSetCookie().find(value=>value.startsWith('dracula_session='))!.split(';')[0];
        const secondLogin=await login(await challenge());assert.equal(secondLogin.status,200);
        const secondSession=secondLogin.headers.getSetCookie().find(value=>value.startsWith('dracula_session='))!.split(';')[0];
        const accountId=(await firstLogin.json()).user.id;
        assert.equal((await fetch(`${authRoot}/v1/me`,{method:'DELETE',headers:{origin:'https://attacker.example',cookie:firstSession}})).status,403);
        assert.equal((await fetch(`${authRoot}/v1/me`,{method:'DELETE',headers:{origin}})).status,401);
        const deleted=await fetch(`${authRoot}/v1/me`,{method:'DELETE',headers:{origin,cookie:firstSession}});
        assert.equal(deleted.status,200);assert.match(deleted.headers.getSetCookie().join(';'),/dracula_session=;/);
        assert.equal((await fetch(`${authRoot}/v1/me`,{headers:{cookie:secondSession}})).status,401);
        const [[accountRows]]=await pool.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM users WHERE id=?',[accountId]);
        const [[identityRows]]=await pool.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM user_identities WHERE user_id=?',[accountId]);
        const [[sessionRows]]=await pool.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM user_sessions WHERE user_id=?',[accountId]);
        assert.equal(accountRows.n,0);assert.equal(identityRows.n,0);assert.equal(sessionRows.n,0);
        await pool.execute("INSERT INTO user_sessions (user_id,session_hash,expires_at,revoked_at) VALUES (?,?,DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE),NULL),(?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY),UTC_TIMESTAMP(3))",[otherId,Buffer.alloc(32,2),otherId,Buffer.alloc(32,3)]);
        await challenge();
        const [[expiredSessionRows]]=await pool.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM user_sessions WHERE user_id=?',[otherId]);assert.equal(expiredSessionRows.n,0);
        await pool.execute("UPDATE auth_rate_limits SET attempts=300, window_start=UTC_TIMESTAMP(3) WHERE bucket='challenge'");
        assert.equal((await fetch(`${authRoot}/v1/auth/challenge`,{method:'POST',headers:{origin}})).status,429);
        await pool.execute("UPDATE auth_rate_limits SET window_start=DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 MINUTE) WHERE bucket='challenge'");
        await challenge();
      } finally {await authApp.close();}

      // A listing from a second source joins the existing event; duplicates merge into one event with a redirect.
      {
        const { listDuplicates, dismissDuplicate } = await import('../dist/events/duplicates.js');
        const { mergeEvents, mergeConfidentDuplicates, previewMerge } = await import('../dist/events/merge.js');
        const { createCatalogue } = await import('../test-support/nest.ts');
        const catalogue = createCatalogue(pool, 'https://api.example.com');
        const addEvent = async (id: number, title: string, venue: string, sourceKey: string, publication = 'live') => {
          await pool.execute(`INSERT INTO events(id,title,event_date,event_time,venue,city,review_status,publication_status,manual_fields,created_at,updated_at)
            VALUES(?,?,'2099-12-03','20:00',?,'Vilnius','music',?,'[]','now','now')`, [id, title, venue, publication]);
          await pool.execute("INSERT INTO event_sources(event_id,source_key,source_id,source_url,content_html,source_data_json) VALUES(?,?,?,'https://example.com','Listing','{}')", [id, sourceKey, String(id)]);
        };
        await addEvent(20001, 'Pavel Arakelian trio', 'Jazz Cellar 11', 'avilys');
        await pool.execute("UPDATE events SET ticket_url=NULL,event_end_date=NULL WHERE id=20001");
        await pool.query("DELETE FROM job_leases WHERE source_key='vilnius-events'");
        const listing = { source_id: 7001, title: 'PAVEL ARAKELIAN TRIO (sold out)', source_url: 'https://www.vilnius-events.lt/renginiai/pavel', content_html: 'Vilnius Events listing', categories: [1],
          details: { event_date: '2099-12-03', event_time: '20:00', venue: 'Aušros Vartų 11, Vilnius', ticket_url: 'https://tickets.example.com' } };
        const page = (item: typeof listing) => importVilniusPage(pool, { verify_after_import: false, items: [item], advance_cursor: false, expected_offset: 0, next_offset: 0, total_available: null });
        assert.deepEqual(await page(listing), { added: 0, updated: 0, attached: 1, changedEventIds: [20001] });
        const [attachedSources] = await pool.execute<RowDataPacket[]>('SELECT source_key,is_secondary FROM event_sources WHERE event_id=20001 ORDER BY id');
        assert.deepEqual(attachedSources.map(row => [row.source_key, Number(row.is_secondary)]), [['avilys', 0], ['vilnius-events', 1]]);
        const [[joined]] = await pool.execute<RowDataPacket[]>('SELECT title,venue,ticket_url FROM events WHERE id=20001');
        assert.deepEqual({ ...joined }, { title: 'Pavel Arakelian trio', venue: 'Jazz Cellar 11', ticket_url: 'https://tickets.example.com' });
        // Refreshing the secondary listing never overwrites the event's own values.
        assert.equal((await page({ ...listing, title: 'Changed title', content_html: 'Changed', details: { ...listing.details, venue: 'Elsewhere' } })).updated, 1);
        const [[refreshed]] = await pool.execute<RowDataPacket[]>('SELECT title,venue FROM events WHERE id=20001');
        assert.deepEqual({ ...refreshed }, { title: 'Pavel Arakelian trio', venue: 'Jazz Cellar 11' });
        const [[attachLog]] = await pool.execute<RowDataPacket[]>("SELECT COUNT(*) AS n FROM event_history WHERE event_id=20001 AND action='source_attached'");
        assert.equal(Number(attachLog.n), 1);

        // Existing duplicates: the live, older event survives and receives everything from the other one.
        await addEvent(20002, 'ROSEYE', 'Jazz Cellar 11', 'vilnius-events');
        await addEvent(20003, 'Roseye', 'Aušros Vartų 11, Vilnius, Lithuania', 'avilys', 'draft');
        await addEvent(20004, 'Roseye', 'Kablys', 'avilys', 'draft');
        await pool.execute("UPDATE events SET event_time=NULL WHERE id=20004");
        await pool.execute("UPDATE events SET venue=NULL WHERE id=20002");
        await pool.execute("INSERT INTO event_prices(event_id,price_text,price_type,manual,checked_at) VALUES(20003,'15 €','paid',0,'now')");
        await pool.execute("INSERT INTO event_artist_decisions(event_id,artist_mbid,decision) VALUES(20003,?,'accepted')", [mbid]);
        await pool.execute('INSERT INTO user_saved_events(user_id,event_id) VALUES(?,20003)', [otherId]);
        await pool.execute('INSERT INTO seeker_saved_events(event_id) VALUES(20003)');
        const pairs = await listDuplicates(pool, '2099-12-01');
        // Without a matching time or venue, the Kablys listing is a question for a person, not an automatic merge.
        assert.deepEqual(pairs.map(pair => [pair.level, pair.mergeable, pair.event_ids]), [['confident', true, [20002, 20003]], ['likely', true, [20002, 20004]], ['likely', false, [20003, 20004]]]);
        await dismissDuplicate(pool, [20003, 20002]);
        assert.deepEqual((await listDuplicates(pool, '2099-12-01')).map(pair => pair.event_ids), [[20002, 20004], [20003, 20004]]);
        await pool.query('DELETE FROM event_duplicate_dismissals');
        await assert.rejects(mergeEvents(pool, 20001, 20004, 'Test'), { status: 409 });
        assert.deepEqual(await mergeEvents(pool, 20003, 20002, 'Test'), { event_id: 20002, merged_event_id: 20003 });
        const [[kept]] = await pool.execute<RowDataPacket[]>('SELECT event_time,venue,publication_status FROM events WHERE id=20002');
        assert.deepEqual({ ...kept }, { event_time: '20:00', venue: 'Aušros Vartų 11, Vilnius, Lithuania', publication_status: 'live' });
        const [[gone]] = await pool.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM events WHERE id=20003');
        assert.equal(Number(gone.n), 0);
        const counts = async (table: string) => Number(((await pool.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${table} WHERE event_id=20002`))[0])[0].n);
        assert.deepEqual(await Promise.all(['event_sources', 'event_prices', 'event_artist_decisions', 'user_saved_events', 'seeker_saved_events'].map(counts)), [2, 1, 1, 1, 1]);
        assert.equal((await catalogue.get(20003, '2099-12-01')).id, 20002);
        const [[mergeLog]] = await pool.execute<RowDataPacket[]>("SELECT COUNT(*) AS n FROM event_history WHERE event_id=20002 AND action='merged'");
        assert.equal(Number(mergeLog.n), 1);
        // Chained merges keep old links working, and bulk merging only takes confident pairs.
        await addEvent(20005, 'Tribute to Erykah Badu', 'Jazz Cellar 11', 'avilys');
        await addEvent(20006, 'Tribute to Erykah Badu', 'Jazz Cellar 11', 'vilnius-events', 'draft');
        const bulk = await mergeConfidentDuplicates(pool, '2099-12-01', 'Test');
        assert.deepEqual(bulk, { merged: [{ event_id: 20005, merged_event_id: 20006 }], skipped: [] });
        assert.equal((await catalogue.get(20006, '2099-12-01')).id, 20005);
        // Differing prices are left for review in bulk, and a chosen value from the other event is protected.
        await addEvent(20007, 'Jam session', 'Jazz Cellar 11', 'vilnius-events');
        await addEvent(20008, 'Jam Session', 'Aušros Vartų 11, Vilnius, Lithuania', 'avilys');
        await pool.execute("INSERT INTO event_prices(event_id,price_text,price_type,manual,checked_at) VALUES(20007,'Nuo 10 €','paid',0,'now'),(20008,NULL,'free',0,'now')");
        const conflicted = await mergeConfidentDuplicates(pool, '2099-12-01', 'Test');
        assert.deepEqual(conflicted, { merged: [], skipped: [{ event_ids: [20007, 20008], error: 'Values differ. Review this pair.' }] });
        const preview = await previewMerge(pool, 20008, 20007);
        assert.deepEqual([preview.kept.id, preview.kept.sources, preview.removed.sources, preview.conflicts], [20007, ['Vilnius Events'], ['Avilys'], true]);
        assert.deepEqual(await mergeEvents(pool, 20007, 20008, 'Test', { price: 20008, title: 20008 }), { event_id: 20007, merged_event_id: 20008 });
        const [[chosen]] = await pool.execute<RowDataPacket[]>('SELECT e.title,e.venue,e.manual_fields,p.price_type,p.manual FROM events e JOIN event_prices p ON p.event_id=e.id WHERE e.id=20007');
        assert.deepEqual({ ...chosen, manual_fields: JSON.parse(chosen.manual_fields) }, { title: 'Jam Session', venue: 'Jazz Cellar 11', manual_fields: ['title'], price_type: 'free', manual: 1 });
        await pool.query('DELETE FROM user_saved_events'); await pool.query('DELETE FROM seeker_saved_events'); await pool.query('DELETE FROM event_prices WHERE event_id>=20001');
        await pool.query('DELETE FROM event_artist_decisions WHERE event_id>=20001');
        await pool.query('DELETE FROM event_sources WHERE event_id>=20001'); await pool.query('DELETE FROM events WHERE id>=20001');
      }

      const migrations = await loadMigrations();
      for (const {name} of migrations) await copyFile(new URL(`../migrations/${name}`,import.meta.url),join(migrationDir,name));
      await writeFile(join(migrationDir,'004-event-city.sql'),'SELECT 1;');
      await assert.rejects(migrate(migrationDb,'status',migrationDir),/Checksum mismatch/);
      await copyFile(new URL('../migrations/004-event-city.sql',import.meta.url),join(migrationDir,'004-event-city.sql'));
      const nextVersion = Number(migrations.at(-1)!.name.slice(0, 3)) + 1;
      assert.ok(nextVersion <= 999, 'No migration version available for the failure fixture');
      await writeFile(join(migrationDir,`${String(nextVersion).padStart(3,'0')}-failure.sql`),'CREATE TABLE migration_partial (id INT); INVALID SQL;');
      await assert.rejects(migrate(migrationDb,'up',migrationDir),/syntax/i);
      await assert.rejects(migrate(migrationDb,'up',migrationDir),/is applying/);
    } finally { migrationDb.release(); await rm(migrationDir,{recursive:true,force:true}); }

  } finally {
    if(nest) await nest.close();
    await pool.end();
    if(imageDir)await rm(imageDir,{recursive:true,force:true});
  }
});
