import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createAiEvaluation, matchPerformers } from '../database/ai-evaluation.js';

test('matches local names and aliases while retaining ambiguous matches',()=>{
 const artists=[{mbid:'1',name:'Žąsis',aliases_json:'[{"name":"Goose"}]'},{mbid:'2',name:'Goose',aliases_json:'[]'}];
 assert.deepEqual(matchPerformers([{name:'goose',evidence:'Goose plays'}],artists)[0].matches.map(x=>x.mbid),['1','2']);
 assert.equal(matchPerformers([{name:'Zasis',evidence:''}],artists)[0].matches[0].mbid,'1');
});

test('records results and spending without changing existing reviews; stops before exceeding the budget',async()=>{
 const db=new DatabaseSync(':memory:');db.exec(`CREATE TABLE artists(mbid TEXT,name TEXT,aliases_json TEXT); INSERT INTO artists VALUES('a','Žąsis','[]'); CREATE TABLE events(id INTEGER PRIMARY KEY,title TEXT,review_status TEXT); INSERT INTO events VALUES(1,'Žąsis','not_music'),(2,'Another','music'); CREATE TABLE event_artist_decisions(event_id INTEGER,artist_mbid TEXT,decision TEXT); CREATE TABLE event_sources(id INTEGER PRIMARY KEY,event_id INTEGER,content_html TEXT); INSERT INTO event_sources VALUES(1,1,'<p>Žąsis performs</p>'),(2,2,'<p>Another event</p>');`);
 const originalFetch=globalThis.fetch,previous=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='test-key';let generations=0;
 globalThis.fetch=async(input)=>{const path=String(input);if(path.includes('countTokens'))return Response.json({totalTokens:100});generations++;return Response.json({usageMetadata:{promptTokenCount:100,totalTokenCount:200},candidates:[{content:{parts:[{text:JSON.stringify({classification:'music',explanation:'Live music',performers:[{name:'Žąsis',evidence:'Žąsis performs'}]})}]}}]});};
 try {const ai=createAiEvaluation(db);await assert.rejects(ai.run(1,[1,2],['gemini-3.5-flash-lite'],0.0052,()=>{}),/Budget reached/);assert.equal(generations,1);const rows=ai.list();assert.equal(rows.length,1);assert.equal(rows[0].classification,'music');assert.equal(db.prepare('SELECT review_status FROM events WHERE id=1').get()?.review_status,'not_music');assert.equal(JSON.parse(String(rows[0].performers_json))[0].matches[0].mbid,'a');assert.equal(JSON.parse(String(rows[0].performers_json))[0].evidence_verified,true);}
 finally {globalThis.fetch=originalFetch;if(previous===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=previous;db.close();}
});
