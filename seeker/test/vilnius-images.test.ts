import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createVilniusImages, selectImage } from '../sources/vilnius-images.js';

test('selects suitable size while avoiding cropped variants',()=>{
 const result=selectImage({id:1,source_url:'https://www.vilnius-events.lt/wp-content/uploads/full.jpg',media_details:{width:2000,height:1200,sizes:{medium:{width:1000,height:600,source_url:'medium'},square:{width:1200,height:1200,source_url:'cropped'},large:{width:1400,height:840,source_url:'large'}}}});
 assert.equal(result.url,'large');
});

test('downloads once and stores metadata without source alt text',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'seeker-image-test-'));const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE source_state(source_key TEXT PRIMARY KEY,last_request_at TEXT);INSERT INTO source_state VALUES('vilnius-events',NULL);");
 const original=globalThis.fetch,now=Date.now;let clock=Date.now(),calls=0;Date.now=()=>clock+=4000;
 globalThis.fetch=async(url)=>{calls++;return String(url).includes('/wp-json/')?Response.json({id:5,source_url:'https://www.vilnius-events.lt/wp-content/uploads/test.jpg',alt_text:'not saved',media_details:{width:700,height:420}}):new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/jpeg'}});};
 try{const images=createVilniusImages(db,dir,'test');assert.equal(await images.ensure(5),'downloaded');assert.equal(await images.ensure(5),'existing');assert.equal(calls,2);assert.deepEqual([...await readFile(join(dir,'images/vilnius-events/5.jpg'))],[1,2,3]);assert.equal(db.prepare('SELECT * FROM vilnius_images').get()?.source_url,'https://www.vilnius-events.lt/wp-content/uploads/test.jpg');assert.equal(db.prepare('PRAGMA table_info(vilnius_images)').all().some(row=>row.name==='alt_text'),false);}finally{globalThis.fetch=original;Date.now=now;db.close();await rm(dir,{recursive:true,force:true});}
});
