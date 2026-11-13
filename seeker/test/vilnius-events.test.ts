import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { extractPageDetails, suggestArtists } from '../event-details.js';
import { createVilniusEvents } from '../vilnius-events.js';
import { matchesDate } from '../public/event-date-filters.js';

test('date fallback reads the event card and ignores other page dates', () => {
  const html='<div class="se-date-card"><div>Trečiadienis, lapkričio 11, 2026</div><div class="se-date-card__time">20:00</div></div><div>lapkričio 12, 2026</div>';
  assert.deepEqual(extractPageDetails(html), {event_date:'2026-11-11',event_end_date:null,event_time:'20:00',venue:null,ticket_url:null,ambiguous_dates:false});
  assert.equal(extractPageDetails('<div>lapkričio 11, 2026</div>').event_date,null);
  assert.equal(extractPageDetails(html+html).ambiguous_dates,true);
  assert.equal(extractPageDetails('<div class="se-date-card">vasario 31, 2026</div>').event_date,null);
});

test('unknown dates do not appear as upcoming', () => {
  assert.equal(matchesDate({event_date:null},'upcoming',null,'2026-11-13'),false);
  assert.equal(matchesDate({event_date:null},'unknown',null,'2026-11-13'),true);
  assert.equal(matchesDate({event_date:'2026-11-14'},'upcoming',null,'2026-11-13'),true);
});

test('artist suggestions include the text that caused a match', () => {
  const artists=[{mbid:'1',name:'Example Artist'}];
  const matches=suggestArtists({title:'A concert',content_html:'<p>Featuring Example Artist on guitar.</p>'},artists,new Set());
  assert.equal(matches[0].reason,'Description');
  assert.equal(matches[0].excerpt,'Featuring Example Artist on guitar.');
});

test('imports overlap safely and refresh unlocked fields without changing review decisions', async () => {
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE source_state (source_key TEXT PRIMARY KEY,next_offset INTEGER,total_available INTEGER,updated_at TEXT,last_request_at TEXT);
    CREATE TABLE artists (mbid TEXT PRIMARY KEY,name TEXT);`);
  const originalFetch=globalThis.fetch, originalNow=Date.now;
  let clock=Date.now(), calls=[], pageDate='2026-12-01';
  Date.now=()=>clock+=4000;
  const item={id:1,title:{rendered:'A concert'},link:'https://www.vilnius-events.lt/renginiai/concert/',content:{rendered:'<p>Music</p>'},categories:[4],date:'2026-11-01',modified:'2026-11-01'};
  globalThis.fetch=async (url)=>{
    const value=String(url); calls.push(value);
    if(value.includes('/wp-json/')) return new Response(JSON.stringify([item]), {headers:{'x-wp-totalpages':'3'}});
    return new Response(`<add-to-calendar-button startDate="${pageDate}" startTime="20:00"></add-to-calendar-button><div class="se-date-card__time">20:00</div><div class="se-location__address">Source venue</div>`);
  };
  try {
    const source=createVilniusEvents(db,'Seeker/test');
    await source.run(1,false);
    await source.enrich();
    source.updateEvent(1,{event_date:'2026-12-01',event_time:'20:00',venue:'My venue',review_status:'music'});
    item.modified='2026-11-02'; pageDate='2026-12-02';
    await source.run(1,false);
    await source.enrich();
    const saved=db.prepare('SELECT * FROM vilnius_events WHERE source_id=1').get();
    assert.equal(saved.venue,'My venue');
    assert.equal(saved.event_date,'2026-12-02');
    assert.equal(saved.review_status,'music');
    assert.deepEqual(JSON.parse(String(saved.manual_fields)),['venue']);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vilnius_events').get().n,1);
    assert.deepEqual(calls.filter(url=>url.includes('/wp-json/')).map(url=>new URL(url).searchParams.get('page')),['1','1','2']);
    assert.equal(source.state().nextPage,3);
    await source.run(1,false,false,true);
    assert.equal(source.state().nextPage,3);
    source.reviewEvent(1,'not_music');
    assert.equal(db.prepare('SELECT review_status FROM vilnius_events WHERE source_id=1').get().review_status,'not_music');
  } finally { globalThis.fetch=originalFetch; Date.now=originalNow; db.close(); }
});
