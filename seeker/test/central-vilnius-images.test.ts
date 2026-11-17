import test from 'node:test';
import assert from 'node:assert/strict';
import type {createCentralApi} from '../central-api.js';
import {createCentralVilniusImages} from '../sources/central-vilnius-images.js';

test('central image importer validates the source and sends image bytes through the API',async()=>{
  let uploaded:Record<string,unknown>|undefined,calls=0;
  const api={reserveVilniusRequest:async()=>0,getImageInfo:async()=>null,uploadImage:async(value:Record<string,unknown>)=>{uploaded=value;}} as unknown as ReturnType<typeof createCentralApi>;
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
  const request=async()=>++calls===1?new Response(JSON.stringify({id:42,source_url:'https://www.vilnius-events.lt/wp-content/uploads/a.png',modified:'now',media_details:{width:1,height:1}})):new Response(image,{headers:{'content-type':'image/png'}});
  const ensure=createCentralVilniusImages(api,'Test/1',request as typeof fetch);
  assert.equal(await ensure(42),'downloaded');assert.equal(uploaded?.media_id,42);assert.equal(uploaded?.data,image.toString('base64'));assert.equal(calls,2);
});

test('central image importer rejects untrusted URLs before downloading',async()=>{
  const api={reserveVilniusRequest:async()=>0,getImageInfo:async()=>null} as unknown as ReturnType<typeof createCentralApi>;
  const request=async()=>new Response(JSON.stringify({id:42,source_url:'https://elsewhere.example/a.png',media_details:{}}));
  await assert.rejects(createCentralVilniusImages(api,'Test/1',request as typeof fetch)(42),/Unexpected image URL/);
});

test('central image importer avoids re-uploading unchanged media',async()=>{
  let requests=0;
  const api={reserveVilniusRequest:async()=>0,getImageInfo:async()=>({source_url:'https://www.vilnius-events.lt/wp-content/uploads/a.png',source_modified:'same'})} as unknown as ReturnType<typeof createCentralApi>;
  const request=async()=>{requests++;return new Response(JSON.stringify({id:42,source_url:'https://www.vilnius-events.lt/wp-content/uploads/a.png',modified:'same',media_details:{width:1,height:1}}));};
  assert.equal(await createCentralVilniusImages(api,'Test/1',request as typeof fetch)(42,true),'existing');assert.equal(requests,1);
});

test('identifies JPEG content even when the source labels it PNG',async()=>{
  let uploaded:Record<string,unknown>|undefined,calls=0;
  const api={reserveVilniusRequest:async()=>0,getImageInfo:async()=>null,uploadImage:async(value:Record<string,unknown>)=>{uploaded=value;}} as unknown as ReturnType<typeof createCentralApi>;
  const image=Buffer.from([0xff,0xd8,0xff,0xe0,0,0]);
  const request=async()=>++calls===1?new Response(JSON.stringify({id:42,source_url:'https://www.vilnius-events.lt/wp-content/uploads/a.png',media_details:{width:1,height:1}})):new Response(image,{headers:{'content-type':'image/png'}});
  assert.equal(await createCentralVilniusImages(api,'Test/1',request as typeof fetch)(42),'downloaded');
  assert.equal(uploaded?.mime_type,'image/jpeg');
});

test('rejects content that is not a supported image',async()=>{
  let calls=0;
  const api={reserveVilniusRequest:async()=>0,getImageInfo:async()=>null} as unknown as ReturnType<typeof createCentralApi>;
  const request=async()=>++calls===1?new Response(JSON.stringify({id:42,source_url:'https://www.vilnius-events.lt/wp-content/uploads/a.png',media_details:{width:1,height:1}})):new Response('not an image',{headers:{'content-type':'image/png'}});
  await assert.rejects(createCentralVilniusImages(api,'Test/1',request as typeof fetch)(42),/Unsupported image content/);
});
