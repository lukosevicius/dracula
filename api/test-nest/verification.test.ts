import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Pool } from 'mysql2/promise';
import { canAutoFill, evidenceText, parseFindings, sourceEvidence } from '../dist/verification/rules.js';
import { generate, manageProvider } from '../dist/verification/providers.js';
import { createVerificationWorker, editPublication, resolveFinding } from '../dist/verification/verification.js';

test('verification rejects invented evidence and preserves Avilys wall time', () => {
  const source = sourceEvidence({
    source_key: 'avilys', source_data_json: '{"startTime":"2026-11-23T19:00:00Z"}',
    content_html: '<p>Koncertas lapkričio 23 d. 2026 m. Pradžia 19:00.</p>',
  });
  assert.equal(source.local_start, '2026-11-23T19:00');
  const result = parseFindings({ findings: [
    { field: 'event_time', disposition: 'suggestion', proposed: '19:00', evidence: 'Pradžia 19:00.', reason: 'The listing gives a time.' },
    { field: 'venue', disposition: 'suggestion', proposed: 'Unknown club', evidence: 'Visit Unknown club', reason: 'An invented quote.' },
  ] }, evidenceText([source]));
  assert.equal(canAutoFill('event_time', '19:00', result[0].evidence), true);
  assert.equal(canAutoFill('event_time', '21:00', result[0].evidence), false);
  assert.equal(canAutoFill('event_date', '2026-11-23', 'lapkričio 23 d. 2026 m.'), true);
  assert.equal(canAutoFill('event_date', '2026-11-23', 'lapkričio 23 d.'), false);
  assert.equal(result[1].disposition, 'attention');
  assert.equal(result[1].proposed, '');
});

test('Gemini and OpenAI use structured provider responses with credentials in headers', async () => {
  for (const provider of ['gemini', 'openai'] as const) {
    const result = await generate({ id: 1, provider, key: 'stub-key', model: 'test-model' }, 'test', {type:'object'}, async (url, init) => {
      assert.doesNotMatch(String(url), /stub-key/);
      const headers = new Headers(init?.headers);
      const body = JSON.parse(String(init?.body));
      if (provider === 'gemini') {
        assert.equal(headers.get('x-goog-api-key'), 'stub-key');
        assert.equal(body.generationConfig.responseMimeType, 'application/json');
        return Response.json({candidates:[{content:{parts:[{text:'{"ok":true}'}]}}]});
      }
      assert.equal(headers.get('authorization'), 'Bearer stub-key');
      assert.equal(body.response_format.type, 'json_schema');
      return Response.json({choices:[{message:{content:'{"ok":true}'}}]});
    });
    assert.deepEqual(result, {ok:true});
  }
});

test('verification fills a missing time, publishes clean music, and records the human decisions on flagged drafts', async () => {
  const db = new DatabaseSync(':memory:');
  db.function('IF', (condition, yes, no) => condition ? yes : no);
  db.exec(`
    CREATE TABLE events(id INTEGER PRIMARY KEY,title TEXT,event_date TEXT,event_end_date TEXT,event_time TEXT,venue TEXT,city TEXT,ticket_url TEXT,
      review_status TEXT NOT NULL DEFAULT 'unsure', publication_status TEXT NOT NULL DEFAULT 'draft', interest_score INTEGER DEFAULT 1,
      publication_manual INTEGER DEFAULT 0, publication_review_required INTEGER DEFAULT 0, classification_manual INTEGER DEFAULT 0, manual_fields TEXT DEFAULT '[]',
      description_override TEXT,about_url_override TEXT,revision INTEGER DEFAULT 1,verification_status TEXT DEFAULT 'queued',needs_attention INTEGER DEFAULT 0);
    CREATE TABLE event_sources(id INTEGER,event_id INTEGER,source_key TEXT,source_id TEXT,source_url TEXT,about_url TEXT,content_html TEXT,source_data_json TEXT);
    CREATE TABLE event_images(event_id INTEGER,source_url TEXT,width INTEGER,height INTEGER);
    CREATE TABLE vilnius_events(source_id INTEGER,featured_media INTEGER);
    CREATE TABLE vilnius_images(media_id INTEGER,source_url TEXT,width INTEGER,height INTEGER);
    CREATE TABLE event_artist_decisions(event_id INTEGER,artist_mbid TEXT,decision TEXT);
    CREATE TABLE artists(mbid TEXT,name TEXT);
    CREATE TABLE event_prices(event_id INTEGER,price_type TEXT,price_text TEXT,manual INTEGER);
    CREATE TABLE event_history(id INTEGER PRIMARY KEY,event_id INTEGER,action TEXT,actor TEXT,occurred_at TEXT,changes TEXT,context TEXT);
    CREATE TABLE verification_jobs(id INTEGER PRIMARY KEY,profile_id INTEGER,provider TEXT,model TEXT,import_job_id INTEGER,allow_publish INTEGER);
    CREATE TABLE event_verifications(id INTEGER PRIMARY KEY,event_id INTEGER,job_id INTEGER,event_revision INTEGER,status TEXT,claim TEXT,lease_until TEXT,
      result TEXT,error_message TEXT,finished_at TEXT,attempts INTEGER DEFAULT 0);
    CREATE TABLE verification_findings(id INTEGER PRIMARY KEY,event_id INTEGER,verification_id INTEGER,field_name TEXT,finding TEXT,status TEXT DEFAULT 'open',resolved_by TEXT);
    CREATE TABLE job_leases(job_id INTEGER,expires_at INTEGER);
    CREATE TABLE verification_providers(id INTEGER PRIMARY KEY,name TEXT,provider TEXT,model TEXT,encrypted_key BLOB);
    CREATE TABLE seeker_settings(setting_key TEXT PRIMARY KEY,setting_value TEXT);
    INSERT INTO events(id,title,event_date,venue) VALUES(1,'Clean concert','2099-11-01','Music Club'),(2,'Conflicting concert','2099-11-02','Music Club'),(3,'Clay workshop','2099-11-03','Music Club');
    INSERT INTO event_sources SELECT id,id,'avilys',id,'https://avilys.app/',NULL,
      CASE id WHEN 2 THEN 'Koncertas 18:00 arba 20:00' WHEN 3 THEN 'Keramikos dirbtuvės 19:00' ELSE 'Koncertas 19:00' END,
      json_object('startTime',event_date||'T19:00:00Z','venueName',venue) FROM events;
    INSERT INTO verification_jobs VALUES(1,1,'gemini','stub-model',42,1);
    INSERT INTO job_leases VALUES(42,4102444800000);
    INSERT INTO event_verifications(id,event_id,job_id,event_revision,status) SELECT id,id,1,1,'queued' FROM events;
  `);
  const conn = {
    beginTransaction: async () => db.exec('BEGIN'), commit: async () => db.exec('COMMIT'), rollback: async () => db.exec('ROLLBACK'), release() {},
    async execute(sql: string, values: (SQLInputValue | boolean)[] = []) {
      const statement = sql.replace(/ FOR UPDATE$/, '').replaceAll('DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 120 SECOND)', "datetime('now','+120 seconds')")
        .replaceAll('UTC_TIMESTAMP(3)', 'CURRENT_TIMESTAMP').replaceAll('INSERT IGNORE', 'INSERT OR IGNORE');
      const params = values.map(value => typeof value === 'boolean' ? Number(value) : value);
      const query = db.prepare(statement);
      if (statement.startsWith('SELECT')) return [query.all(...params)];
      const result = query.run(...params);
      return [{ affectedRows: result.changes, insertId: Number(result.lastInsertRowid) }];
    },
  };
  const pool = { getConnection: async () => conn, execute: conn.execute } as unknown as Pool;
  const secret = 'a'.repeat(64);
  try {
    await manageProvider(pool, secret, { action:'save', name:'Stub', provider:'gemini', model:'stub-model', key:'test-provider-key' });
    let corrected = false;
    const worker = createVerificationWorker(pool, secret, async (_url, init) => {
      const choice = String(init?.body);
      const date = choice.includes('Conflicting concert') ? '2099-11-02' : choice.includes('Clay workshop') ? '2099-11-03' : '2099-11-01';
      const other = choice.includes('Clay workshop');
      const result = (field:string,proposed:string,evidence:string,disposition='suggestion') => ({field,proposed,evidence,disposition,reason:'The listing provides this evidence.'});
      const findings = [result('event_date',date,date,'confirmed'),result('venue','Music Club','Music Club','confirmed'),
        date.endsWith('02')
          ? corrected ? result('event_time','20:00','20:00','confirmed') : result('event_time','','18:00 arba 20:00','attention')
          : result('event_time','19:00','19:00'),
        result('review_status',other?'not_music':'music',other?'Keramikos dirbtuvės':'Koncertas')];
      return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({findings})}]}}]});
    });
    assert.equal(await worker(), false);
    db.exec('DELETE FROM job_leases');
    for (let i=0;i<3;i++) assert.equal(await worker(),true);
    const rows = db.prepare('SELECT id,event_time,review_status,publication_status,verification_status,needs_attention FROM events ORDER BY id').all();
    assert.deepEqual(rows.map(row=>Object.values(row)), [
      [1,'19:00','music','live','verified',0], [2,null,'music','draft','verified',1], [3,'19:00','not_music','draft','verified',0],
    ]);
    const finding = db.prepare("SELECT id FROM verification_findings WHERE event_id=2 AND status='open'").get()!;
    const revision = () => Number(db.prepare('SELECT revision FROM events WHERE id=2').get()!.revision);
    await resolveFinding(pool,2,Number(finding.id),{decision:'approve',value:'20:00',revision:revision()},'Seeker editor');
    assert.equal(db.prepare('SELECT publication_status FROM events WHERE id=2').get()!.publication_status,'draft');
    corrected = true;
    db.exec(`INSERT INTO verification_jobs VALUES(2,1,'gemini','stub-model',NULL,1);
      INSERT INTO event_verifications(id,event_id,job_id,event_revision,status) SELECT 4,id,2,revision,'queued' FROM events WHERE id=2;`);
    assert.equal(await worker(),true);
    assert.deepEqual(Object.values(db.prepare('SELECT publication_status,needs_attention FROM events WHERE id=2').get()!),['draft',0]);
    await editPublication(pool,2,{status:'live',revision:revision()},'Seeker editor');
    await assert.rejects(editPublication(pool,2,{status:'draft',revision:1},'Seeker editor'),{ status:409 });
    await editPublication(pool,2,{status:'draft',revision:revision()},'Seeker editor');
    assert.deepEqual(db.prepare('SELECT action FROM event_history WHERE event_id=2 ORDER BY id').all().map(row=>row.action),['verified','finding_approved','verified','published','unpublished']);
  } finally { db.close(); }
});
