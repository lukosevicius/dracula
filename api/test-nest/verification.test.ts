import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Pool } from 'mysql2/promise';
import { canAutoFill, evidenceText, parseFindings, reconcileStructuredFields, sourceEvidence } from '../dist/verification/rules.js';
import { reconcilePrices, ticketPriceValue } from '../dist/verification/prices.js';
import { generate, manageProvider } from '../dist/verification/providers.js';
import { estimatedTokenCost, usageWindow, verificationUsage } from '../dist/verification/usage.js';
import type { TokenUsage } from '../dist/verification/usage.js';
import { defaultRules, listRules, updateRules } from '../dist/verification/rule-settings.js';
import { planVerification, type VerificationInput } from '../dist/verification/verification-plan.js';
import { createVerificationWorker, editPublication, manualVerification, queueRulesPreview, resolveFinding, rulesPreview, verificationDetails } from '../dist/verification/verification.js';

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
  assert.equal(result[1].disposition, 'unknown');
  assert.equal(result[1].proposed, '');
});

test('structured values confirm sparse listings and only cited contradictions raise attention', () => {
  const avilys = sourceEvidence({
    source_key: 'avilys',
    source_data_json: { startTime: '2026-11-24T19:00:00Z', venueName: 'Šv. Kotrynos bažnyčia', city: 'Vilnius' },
    content_html: '<p>Koncertas prasidės 20:30.</p>',
  });
  const saved = { event_date: '2026-11-24', event_time: '19:00', venue: 'Šv. Kotrynos bažnyčia', city: 'Vilnius' };
  assert.deepEqual(avilys.structured_fields, saved);
  const model = { findings: [
    { field: 'event_time', disposition: 'attention', proposed: '20:30', evidence: 'Koncertas prasidės 20:30.', reason: 'Different start time.' },
    { field: 'venue', disposition: 'attention', proposed: 'Unknown club', evidence: 'Invented club', reason: 'It mentions a different venue.' },
    { field: 'city', disposition: 'unknown', proposed: '', evidence: '', reason: 'The description does not mention a city.' },
  ] };
  const result = reconcileStructuredFields(parseFindings(model, evidenceText([avilys])), [avilys], saved, []);
  assert.deepEqual(result.map(finding => [finding.field, finding.disposition, finding.proposed]), [
    ['event_date', 'confirmed', '2026-11-24'], ['event_time', 'attention', '20:30'],
    ['venue', 'confirmed', saved.venue], ['city', 'confirmed', 'Vilnius'],
  ]);
  const vilnius = sourceEvidence({
    source_key: 'vilnius-events',
    source_data_json: { structured_details: { event_date: '2026-11-24', event_time: '19:00', venue: 'Club' } },
    detail_evidence_json: { event_time: null, venue: 'New Club' },
  });
  assert.deepEqual(vilnius.structured_fields, { event_date: '2026-11-24', event_time: '19:00', venue: 'New Club', city: 'Vilnius' });
});

test('ticket pricing uses general admission, flags conflicts, and ignores optional charges or exemptions', () => {
  const listing = (description: string, metadata: Record<string, unknown> = {}) =>
    sourceEvidence({ source_key: 'avilys', source_data_json: metadata, content_html: description });
  const petunija = listing('Staliukų rezervacija nemokama.<br>Vaikai iki 10 metų įleidžiami nemokamai.<br>BILIETAI: 16 € | Bilietai brangs!', { free: false });
  assert.deepEqual(reconcilePrices([], [petunija], { price_type: 'paid' }).map(finding => [finding.field, finding.disposition, finding.proposed]), [
    ['price_text', 'suggestion', '16 €'], ['price_type', 'confirmed', 'paid'],
  ]);
  assert.equal(ticketPriceValue('From 16.50 EUR'), 'Nuo 16,5 €');
  assert.equal(ticketPriceValue('€16–€20'), '16–20 €');
  for (const description of ['Bilietai: 16 € / 20 €.', 'Bilietai: 16 € | prie durų 20 €.']) {
    const tiers = reconcilePrices([], [listing(description)], { price_type: 'paid' });
    assert.equal(tiers[0].disposition, 'attention');
  }
  const matching = reconcilePrices([], [listing('Bilietų kaina – nuo 16,50 €.', { priceFrom: 16.50 })], { price_type: 'paid', price_text: '16.50 EUR' });
  assert.equal(matching[0].disposition, 'confirmed');
  assert.deepEqual(reconcilePrices([], [listing('Staliukų rezervacija: 16 €. Vaikai iki 10 m. įleidžiami nemokamai.')], {}), []);
  const amounts = reconcilePrices([], [petunija, listing('Bilietai: 20 €.')], { price_type: 'paid' });
  assert.deepEqual(amounts.map(finding => [finding.field, finding.disposition]), [['price_text', 'attention'], ['price_type', 'confirmed']]);
  assert.deepEqual(reconcilePrices([], [petunija, listing('Įėjimas nemokamas.')], { price_type: 'paid' }).map(finding => [finding.field, finding.disposition]), [
    ['price_type', 'attention'],
  ]);
});

test('one clear value fills a blank on a live event and respects edits and review permissions', () => {
  const input: VerificationInput = {
    values: { event_date: '2099-11-25', event_time: null, venue: 'Tamsta Club', review_status: 'music' },
    sources: [{ title: 'Concert', description: 'Pradžia 19:30.' }],
    artistLinks: [], catalogue: new Map(), manualFields: [], priceManual: false, classificationManual: false,
    publication: { status: 'live', manual: false, reviewRequired: false }, similar: [], dismissed: [], externalFinding: false,
  };
  const time = { field: 'event_time', disposition: 'confirmed', proposed: '19:30', evidence: 'Pradžia 19:30.', reason: 'Listed start time.' } as const;
  const filled = planVerification(input, [time], defaultRules, false);
  assert.equal(filled.updated.event_time, '19:30');
  assert.deepEqual(filled.attention, []);
  const locked = planVerification({ ...input, manualFields: ['event_time'] }, [time], defaultRules, false);
  assert.equal(locked.updated.event_time, null);
  assert.deepEqual(locked.attention, []);
  const review = { ...defaultRules, permissions: { ...defaultRules.permissions, event_time: 'review' as const } };
  assert.equal(planVerification(input, [time], review, false).attention[0].proposed, '19:30');
  const conflicting = { ...time, proposed: '20:30', evidence: 'Pradžia 20:30.' };
  const ambiguous = planVerification(input, [time, conflicting], defaultRules, false);
  assert.equal(ambiguous.updated.event_time, null);
  assert.equal(ambiguous.attention.length, 2);
});

test('Gemini and OpenAI use structured provider responses with credentials in headers', async () => {
  for (const provider of ['gemini', 'openai'] as const) {
    let tokens: TokenUsage | null = null;
    const result = await generate({ id: 1, provider, key: 'stub-key', model: 'test-model' }, 'test', {type:'object'}, async (url, init) => {
      assert.doesNotMatch(String(url), /stub-key/);
      const headers = new Headers(init?.headers);
      const body = JSON.parse(String(init?.body));
      if (provider === 'gemini') {
        assert.equal(headers.get('x-goog-api-key'), 'stub-key');
        assert.equal(body.generationConfig.responseMimeType, 'application/json');
        return Response.json({candidates:[{content:{parts:[{text:'{"ok":true}'}]}}],
          usageMetadata:{promptTokenCount:200,cachedContentTokenCount:50,candidatesTokenCount:26,thoughtsTokenCount:4}});
      }
      assert.equal(headers.get('authorization'), 'Bearer stub-key');
      assert.equal(body.response_format.type, 'json_schema');
      return Response.json({choices:[{message:{content:'{"ok":true}'}}],
        usage:{prompt_tokens:200,prompt_tokens_details:{cached_tokens:50},completion_tokens:30}});
    }, undefined, usage => { tokens = usage; });
    assert.deepEqual(result, {ok:true});
    assert.deepEqual(tokens, {input:200,cached:50,output:30});
  }
  const usage = {input:200,cached:50,output:30};
  assert.equal(estimatedTokenCost('openai','gpt-6-luna',usage),0.0000305);
  assert.equal(estimatedTokenCost('openai','unknown-model',usage),null);
});

test('verification usage uses Vilnius midnight with Monday as the start of the week', () => {
  const springChange = new Date('2026-03-29T12:00:00Z');
  assert.deepEqual(usageWindow('today', springChange), ['2026-03-28 22:00:00.000', '2026-03-29 21:00:00.000']);
  const mondayInVilnius = new Date('2026-03-29T21:05:00Z');
  assert.deepEqual(usageWindow('week', mondayInVilnius), ['2026-03-29 21:00:00.000', '2026-04-05 21:00:00.000']);
  assert.deepEqual(usageWindow('month', springChange), ['2026-02-28 22:00:00.000', '2026-03-31 21:00:00.000']);
});

test('verification fills a missing time, publishes clean music, and records the human decisions on flagged drafts', async () => {
  const db = new DatabaseSync(':memory:');
  db.function('IF', (condition, yes, no) => condition ? yes : no);
  db.function('DATE_FORMAT', (time, _format) => time === null ? null : String(time).slice(0,19).replace(' ','T') + 'Z');
  db.exec(`
    CREATE TABLE events(id INTEGER PRIMARY KEY,title TEXT,event_date TEXT,event_end_date TEXT,event_time TEXT,venue TEXT,city TEXT,ticket_url TEXT,
      review_status TEXT NOT NULL DEFAULT 'unsure', publication_status TEXT NOT NULL DEFAULT 'draft', interest_score INTEGER DEFAULT 1,
      publication_manual INTEGER DEFAULT 0, publication_review_required INTEGER DEFAULT 0, classification_manual INTEGER DEFAULT 0, manual_fields TEXT DEFAULT '[]',
      description_override TEXT,about_url_override TEXT,revision INTEGER DEFAULT 1,verification_status TEXT DEFAULT 'queued',needs_attention INTEGER DEFAULT 0);
    CREATE TABLE event_sources(id INTEGER,event_id INTEGER,source_key TEXT,source_id TEXT,source_url TEXT,about_url TEXT,content_html TEXT,source_data_json TEXT);
    CREATE TABLE event_images(event_id INTEGER,source_url TEXT,width INTEGER,height INTEGER);
    CREATE TABLE vilnius_events(source_id INTEGER,featured_media INTEGER,title TEXT);
    CREATE TABLE vilnius_images(media_id INTEGER,source_url TEXT,width INTEGER,height INTEGER);
    CREATE TABLE event_artist_decisions(event_id INTEGER,artist_mbid TEXT,decision TEXT,PRIMARY KEY(event_id,artist_mbid));
    CREATE TABLE artists(mbid TEXT,name TEXT,disambiguation TEXT,aliases_json TEXT);
    CREATE TABLE event_prices(event_id INTEGER PRIMARY KEY,price_type TEXT,price_text TEXT,manual INTEGER,checked_at TEXT);
    CREATE TABLE event_history(id INTEGER PRIMARY KEY,event_id INTEGER,action TEXT,actor TEXT,occurred_at TEXT,changes TEXT,context TEXT);
    CREATE TABLE verification_jobs(id INTEGER PRIMARY KEY,profile_id INTEGER,provider TEXT,model TEXT,import_job_id INTEGER,allow_publish INTEGER,
      actor TEXT NOT NULL,request_key TEXT,request_hash TEXT,rules_version_id INTEGER,preview_rules TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,started_at TEXT);
    CREATE TABLE event_verifications(id INTEGER PRIMARY KEY,event_id INTEGER,job_id INTEGER,event_revision INTEGER,status TEXT DEFAULT 'queued',claim TEXT,lease_until TEXT,
      result TEXT,error_message TEXT,finished_at TEXT,attempts INTEGER DEFAULT 0,UNIQUE(job_id,event_id));
    CREATE TABLE verification_findings(id INTEGER PRIMARY KEY,event_id INTEGER,verification_id INTEGER,field_name TEXT,finding TEXT,status TEXT DEFAULT 'open',resolved_by TEXT);
    CREATE TABLE verification_provider_requests(id TEXT PRIMARY KEY,verification_id INTEGER,provider TEXT,model TEXT,requested_at TEXT,finished_at TEXT,
      input_tokens INTEGER,cached_input_tokens INTEGER,output_tokens INTEGER,estimated_cost_usd REAL);
    CREATE TABLE job_leases(job_id INTEGER,expires_at INTEGER);
    CREATE TABLE verification_providers(id INTEGER PRIMARY KEY,name TEXT,provider TEXT,model TEXT,encrypted_key BLOB);
    CREATE TABLE seeker_settings(setting_key TEXT PRIMARY KEY,setting_value TEXT);
    CREATE TABLE verification_rule_versions(id INTEGER PRIMARY KEY AUTOINCREMENT, rules TEXT, activated_by TEXT, activated_at TEXT);
    CREATE TABLE verification_rule_state(id INTEGER PRIMARY KEY, active_version_id INTEGER, draft TEXT, revision INTEGER DEFAULT 1);
    INSERT INTO verification_rule_state(id) VALUES(1);
    INSERT INTO verification_rule_versions(id,rules) VALUES(1,'{}');
    DELETE FROM verification_rule_versions WHERE id=1;
    INSERT INTO events(id,title,event_date,venue) VALUES(1,'Clean concert','2099-11-01','Music Club'),(2,'Conflicting concert','2099-11-02','Music Club'),(3,'Clay workshop','2099-11-03','Music Club');
    INSERT INTO event_sources SELECT id,id,'avilys',id,'https://avilys.app/',NULL,
      CASE id WHEN 2 THEN 'Koncertas prasidės 20:00' WHEN 3 THEN 'Keramikos dirbtuvės 19:00' ELSE 'Koncertas' END,
      json_object('startTime',event_date||'T19:00:00Z','venueName',venue) FROM events;
    INSERT INTO verification_jobs(id,profile_id,provider,model,import_job_id,allow_publish,actor) VALUES(1,1,'gemini','gemini-3.5-flash-lite',42,1,'import');
    INSERT INTO job_leases VALUES(42,4102444800000);
    INSERT INTO event_verifications(id,event_id,job_id,event_revision,status) SELECT id,id,1,1,'queued' FROM events;
  `);
  const conn = {
    beginTransaction: async () => db.exec('BEGIN'), commit: async () => db.exec('COMMIT'), rollback: async () => db.exec('ROLLBACK'), release() {},
    async execute(sql: string, values: (SQLInputValue | boolean)[] = []) {
      const statement = sql.replace(/ FOR UPDATE$/, '').replaceAll('DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 120 SECOND)', "datetime('now','+120 seconds')")
        .replaceAll('UTC_TIMESTAMP(3)', 'CURRENT_TIMESTAMP').replaceAll('INSERT IGNORE', 'INSERT OR IGNORE')
        .replace("ON DUPLICATE KEY UPDATE decision='accepted'", "ON CONFLICT(event_id,artist_mbid) DO UPDATE SET decision='accepted'")
        .replace("ON DUPLICATE KEY UPDATE event_revision=VALUES(event_revision)", "ON CONFLICT(job_id,event_id) DO UPDATE SET event_revision=excluded.event_revision")
        .replace("ON DUPLICATE KEY UPDATE price_type=VALUES(price_type),price_text=VALUES(price_text),manual=VALUES(manual),checked_at=VALUES(checked_at)",
          "ON CONFLICT(event_id) DO UPDATE SET price_type=excluded.price_type,price_text=excluded.price_text,manual=excluded.manual,checked_at=excluded.checked_at");
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
    await manageProvider(pool, secret, { action:'save', name:'Stub', provider:'gemini', model:'gemini-3.5-flash-lite', key:'test-provider-key' });
    let corrected = false;
    let invalidOutput = false;
    let lastPrompt = '';
    const worker = createVerificationWorker(pool, secret, async (_url, init) => {
      const choice = String(init?.body);
      lastPrompt = choice;
      const date = choice.includes('Conflicting concert') ? '2099-11-02' : choice.includes('Clay workshop') ? '2099-11-03' : '2099-11-01';
      const other = choice.includes('Clay workshop');
      const result = (field:string,proposed:string,evidence:string,disposition='suggestion') => ({field,proposed,evidence,disposition,reason:'The listing provides this evidence.'});
      const findings = [result('event_date','','','unknown'),result('venue','','Unknown Club','attention'),
        date.endsWith('02')
          ? corrected ? result('event_time','20:00','20:00','confirmed') : result('event_time','20:00','Koncertas prasidės 20:00','attention')
          : result('event_time','','','unknown'),
        result('review_status',other?'not_music':'music',other?'Keramikos dirbtuvės':'Koncertas')];
      if (choice.includes('PETUNIJOS AKUSTINIS')) {
        findings.push(
          result('description', '', '', 'attention'),
          result('cancellation', '', 'BILIETAI: 16 € | Bilietai brangs!', 'confirmed'),
          result('price_type', 'paid', 'Invented price-type quote', 'confirmed'),
          result('artists', 'Petunija', 'Petunija', 'confirmed'),
          result('artists', 'Kęstutis', 'Kartu su Kęstučiu, kuris skambins gitara.'),
        );
      }
      if (choice.includes('Petunia')) {
        findings.push(result('artists','Petunia','Koncertas · Petunia ir Duo, Unknown Act'));
        if (choice.includes('Unknown Act')) findings.push(result('artists','Unknown Act','Unknown Act'));
        if (choice.includes('Duo')) findings.push(result('artists','Duo','Duo'));
      }
      return Response.json({candidates:[{content:{parts:[{text:invalidOutput ? '{' : JSON.stringify({findings})}]}}],
        usageMetadata:{promptTokenCount:200,cachedContentTokenCount:50,candidatesTokenCount:26,thoughtsTokenCount:4}});
    });
    assert.equal(await worker(), false);
    db.exec('DELETE FROM job_leases');
    for (let i=0;i<3;i++) assert.equal(await worker(),true);
    const rows = db.prepare('SELECT id,event_time,review_status,publication_status,verification_status,needs_attention FROM events ORDER BY id').all();
    assert.deepEqual(rows.map(row=>Object.values(row)), [
      [1,'19:00','music','live','verified',0], [2,null,'music','draft','verified',1], [3,'19:00','not_music','draft','verified',0],
    ]);
    const finding = db.prepare("SELECT id FROM verification_findings WHERE event_id=2 AND status='open'").get()!;
    const conflictingTime = db.prepare('SELECT finding FROM verification_findings WHERE id=?').get(finding.id)!;
    assert.equal(JSON.parse(String(conflictingTime.finding)).evidence, 'Koncertas prasidės 20:00');
    const revision = () => Number(db.prepare('SELECT revision FROM events WHERE id=2').get()!.revision);
    await resolveFinding(pool,2,Number(finding.id),{decision:'approve',value:'20:00',revision:revision()},'Seeker editor');
    assert.equal(db.prepare('SELECT publication_status FROM events WHERE id=2').get()!.publication_status,'draft');
    corrected = true;
    db.exec(`INSERT INTO verification_jobs(id,profile_id,provider,model,import_job_id,allow_publish,actor) VALUES(2,1,'gemini','gemini-3.5-flash-lite',NULL,1,'editor');
      INSERT INTO event_verifications(id,event_id,job_id,event_revision,status) SELECT 4,id,2,revision,'queued' FROM events WHERE id=2;`);
    assert.equal(await worker(),true);
    assert.deepEqual(Object.values(db.prepare('SELECT publication_status,needs_attention FROM events WHERE id=2').get()!),['draft',0]);
    await editPublication(pool,2,{status:'live',revision:revision()},'Seeker editor');
    await assert.rejects(editPublication(pool,2,{status:'draft',revision:1},'Seeker editor'),{ status:409 });
    await editPublication(pool,2,{status:'draft',revision:revision()},'Seeker editor');
    assert.deepEqual(db.prepare('SELECT action FROM event_history WHERE event_id=2 ORDER BY id').all().map(row=>row.action),['verified','finding_approved','verified','published','unpublished']);
    invalidOutput = true;
    db.exec(`INSERT INTO verification_jobs(id,profile_id,provider,model,import_job_id,allow_publish,actor) VALUES(3,1,'gemini','gemini-3.5-flash-lite',NULL,1,'editor');
      INSERT INTO event_verifications(id,event_id,job_id,event_revision,status) SELECT 5,id,3,revision,'queued' FROM events WHERE id=2;`);
    assert.equal(await worker(),true);
    assert.equal(db.prepare('SELECT status FROM event_verifications WHERE id=5').get()!.status,'failed');
    const report = await verificationUsage(pool, new URLSearchParams({period:'month'}));
    assert.deepEqual(report.activity,{completed:4,failed:1,skipped:0,flagged:1});
    assert.deepEqual(report.runs.map(run => [run.id,run.events,run.flagged,run.import_job_id]), [[3,1,0,null],[2,1,0,null],[1,3,1,42]]);
    assert.ok(report.runs.every(run => run.started_at >= run.queued_at));
    assert.equal(report.usage.requests,5);
    assert.equal(report.usage.input_tokens,1000);
    assert.equal(report.usage.output_tokens,150);
    assert.equal(report.by_model[0].model,'gemini-3.5-flash-lite');
    assert.equal(report.usage.estimated_cost_usd?.toFixed(7),'0.0006075');
    invalidOutput = false;
    const basic = await listRules(pool);
    assert.equal(basic.active.id, 1);
    const actor = 'Seeker editor';
    const draft = { action:'save', revision:basic.revision, markdown:'# Test only', permissions:{ ...defaultRules.permissions, artists:'review', event_time:'disabled', publication_status:'review' } };
    await updateRules(pool, draft, actor);
    const saved = await listRules(pool);
    assert.equal(saved.active.markdown, defaultRules.markdown);
    assert.equal(saved.draft?.markdown, draft.markdown);
    await assert.rejects(updateRules(pool, { action:'activate', revision:basic.revision }, actor), { status:409 });

    db.exec(`INSERT INTO artists VALUES ('pet','Petunija',NULL,'["Petunia"]'), ('duo-1','Duo','Lithuanian band','[]'), ('duo-2','Duo','DJ duo','[]');
      INSERT INTO events(id,title,event_date,venue,verification_status) VALUES(6,'Petunia ir Duo','2099-11-01','Music Club','not_verified');
      INSERT INTO event_sources SELECT id,id,'avilys',id,'https://avilys.app/',NULL,
        'Koncertas · Petunia ir Duo, Unknown Act',json_object('startTime',event_date||'T19:00:00Z','venueName',venue) FROM events WHERE id=6;`);
    const previewInput = { event_id:6, profile_id:1, revision:saved.revision, request_key:'preview-rules' };
    const preview = await queueRulesPreview(pool,previewInput,actor);
    assert.deepEqual(await queueRulesPreview(pool,previewInput,actor),preview);
    await assert.rejects(queueRulesPreview(pool,{ ...previewInput, event_id:1 },actor), { status:409 });
    const beforePreview = db.prepare('SELECT * FROM events WHERE id=6').get();
    assert.equal(await worker(),true);
    assert.match(lastPrompt,/Test only/);
    assert.match(lastPrompt,/artist_catalogue_candidates.*Petunija/);
    const previewResult = await rulesPreview(pool, preview.id);
    assert.equal(previewResult.status,'completed');
    assert.equal(previewResult.draft_revision,saved.revision);
    assert.equal(previewResult.result?.actions.find(action => action.field==='event_time')?.status,'disabled');
    assert.equal(previewResult.result?.actions.find(action => action.proposed==='Petunia')?.status,'review');
    assert.deepEqual(db.prepare('SELECT * FROM events WHERE id=6').get(),beforePreview);
    assert.equal((await verificationDetails(pool,6)).last_run,null);
    assert.equal((await verificationDetails(pool,6)).log.length,0);

    const automatic = { ...draft, revision:saved.revision, markdown:'# Activate these rules', permissions:{ ...defaultRules.permissions, publication_status:'review' } };
    await updateRules(pool,automatic,actor);
    const newerDraft = await listRules(pool);
    await updateRules(pool,{ action:'activate',revision:newerDraft.revision },actor);
    const activated = await listRules(pool);
    assert.equal(activated.active.id,2);
    db.exec(`INSERT INTO events(id,title,event_date,event_time,venue,verification_status) VALUES
        (7,'Concert with publication review','2099-12-05','19:00','Music Club','not_verified'),
        (8,'Conflicting concert keep','2099-11-02','19:00','Music Club','not_verified');
      INSERT INTO event_sources SELECT id,id,'avilys',id,'https://avilys.app/',NULL,
        CASE WHEN id=8 THEN 'Koncertas prasidės 20:00' ELSE 'Koncertas' END,
        json_object('startTime',event_date||'T19:00:00Z','venueName',venue) FROM events WHERE id IN (7,8);
      UPDATE events SET title='Earlier concert' WHERE id=2;`);
    corrected = false;
    const run = await manualVerification(pool,{ event_ids:[6,7,8],profile_id:1,request_key:'active-rules' },actor);
    await updateRules(pool,{ action:'restore',revision:activated.revision,version_id:1 },actor);
    const restored = await listRules(pool);
    assert.equal(restored.draft?.markdown,defaultRules.markdown);
    await updateRules(pool,{ action:'activate',revision:restored.revision },actor);
    assert.equal(await worker(),true);
    assert.match(lastPrompt,/Activate these rules/);
    const evaluated = await verificationDetails(pool,6);
    assert.equal(evaluated.last_run?.job_id,run.id);
    assert.equal(evaluated.log[0].context.rules_version_id,2);
    assert.equal(evaluated.log[0].context.trigger,'manual');
    assert.equal(evaluated.log[0].context.actions?.find(action => action.proposed==='Petunia')?.status,'applied');
    assert.equal(db.prepare("SELECT artist_mbid FROM event_artist_decisions WHERE event_id=6").get()!.artist_mbid,'pet');
    const unmatched = evaluated.findings.find(finding => finding.proposed === 'Unknown Act')!;
    assert.equal(unmatched.reason,'Artist not in catalogue.');
    const ambiguous = evaluated.findings.find(finding => finding.proposed === 'Duo')!;
    assert.equal(ambiguous.candidates?.length,2);
    await assert.rejects(resolveFinding(pool,6,ambiguous.id,{decision:'approve',artist_id:'pet',revision:evaluated.revision},actor), { status:400 });
    await resolveFinding(pool,6,ambiguous.id,{decision:'approve',artist_id:'duo-2',revision:evaluated.revision},actor);
    assert.equal(db.prepare("SELECT decision FROM event_artist_decisions WHERE event_id=6 AND artist_mbid='duo-2'").get()!.decision,'accepted');

    assert.equal(await worker(),true);
    const publishReview = await verificationDetails(pool,7);
    assert.equal(publishReview.publication_status,'draft');
    const publication = publishReview.findings.find(finding => finding.field === 'publication_status')!;
    const approve = { decision:'approve', revision:publishReview.revision };
    await assert.rejects(resolveFinding(pool,7,publication.id,approve,actor,false), { status:403 });
    await resolveFinding(pool,7,publication.id,approve,actor);
    assert.equal((await verificationDetails(pool,7)).publication_status,'live');

    assert.equal(await worker(),true);
    const disputed = await verificationDetails(pool,8);
    const time = disputed.findings.find(finding => finding.field === 'event_time')!;
    assert.equal(time.current,'19:00');
    assert.equal(time.proposed,'20:00');
    await resolveFinding(pool,8,time.id,{decision:'dismiss',keep_current:true,revision:disputed.revision},actor);
    assert.deepEqual(Object.values(db.prepare("SELECT event_time,manual_fields FROM events WHERE id=8").get()!),['19:00','["event_time"]']);
    await manualVerification(pool,{event_ids:[8],profile_id:1,request_key:'recheck-time'},actor);
    assert.equal(await worker(),true);
    const rechecked = await verificationDetails(pool,8);
    assert.equal(rechecked.findings.length,0);
    assert.equal(rechecked.log[0].context.actions?.find(action => action.field==='event_time')?.status,'kept');

    db.exec(`INSERT INTO events(id,title,event_date,event_time,venue,review_status,publication_status,verification_status) VALUES
        (9,'PETUNIJOS AKUSTINIS', '2099-11-25','19:30','Tamsta Club','music','live','verified'),
        (10,'PETUNIJOS AKUSTINIS (manual price)', '2099-11-26','19:30','Tamsta Club','music','live','verified');
      INSERT INTO event_sources SELECT id,id,'avilys',id,'https://avilys.app/',NULL,
        'Petunija. Kartu su Kęstučiu, kuris skambins gitara.<br>Staliukų rezervacija nemokama.<br>Vaikai iki 10 metų įleidžiami nemokamai.<br>BILIETAI: 16 € | Bilietai brangs!',
        json_object('startTime',event_date||'T19:30:00Z','venueName',venue,'free',false) FROM events WHERE id IN (9,10);
      INSERT INTO event_prices(event_id,price_type,manual) VALUES(9,'paid',0),(10,'paid',1);
      INSERT INTO event_artist_decisions VALUES(9,'pet','accepted'),(10,'pet','accepted');
      UPDATE events SET needs_attention=1 WHERE id=9;
      INSERT INTO verification_findings(event_id,verification_id,field_name,finding) VALUES(9,1,'description','{}');`);
    await manualVerification(pool,{event_ids:[9,10],profile_id:1,request_key:'petunija-live-pricing'},actor);
    assert.equal(await worker(),true);
    assert.equal(await worker(),true);
    const petunija = await verificationDetails(pool,9);
    assert.equal(petunija.publication_status,'live');
    assert.equal(petunija.needs_attention,0);
    assert.equal(petunija.findings.length,0);
    assert.deepEqual(petunija.log[0].context.actions?.map(action => [action.status, action.field, action.proposed]), [
      ['observation','artists','Kęstutis'], ['applied','price_text','16 €'],
    ]);
    assert.deepEqual(petunija.log[0].changes,{price_text:{before:null,after:'16 €'}});
    assert.deepEqual(db.prepare('SELECT artist_mbid FROM event_artist_decisions WHERE event_id=9').all().map(row=>row.artist_mbid),['pet']);
    assert.equal(db.prepare('SELECT price_text FROM event_prices WHERE event_id=10').get()!.price_text,null);
    assert.equal((await verificationDetails(pool,10)).findings.length,0);



  } finally { db.close(); }
});
