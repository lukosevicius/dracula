import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { extractPageDetails, suggestArtists } from '../sources/event-details.js';
import { createVilniusEvents } from '../sources/vilnius-events.js';
import { matchesDate } from '../public/event-date-filters.js';
import { suggestEventMatches } from '../database/event-matching.js';

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

test('event match suggestions require the same title and date and never merge records', () => {
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE events(id INTEGER PRIMARY KEY,title TEXT,event_date TEXT,venue TEXT);
    INSERT INTO events VALUES(1,'ROSEYE','2026-12-09','Jazz Cellar 11');
    INSERT INTO events VALUES(2,'Roseye','2026-12-09','Jazz Cellar 11');
    INSERT INTO events VALUES(3,'ROSEYE','2026-12-10','Jazz Cellar 11');`);
  const matches=suggestEventMatches(db,1);
  assert.deepEqual(matches.map(match=>match.id),[2]);
  assert.equal(matches[0].venue_matches,true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events').get().n,3);
  db.close();
});

test('artist suggestions include the text that caused a match', () => {
  const artists=[{mbid:'1',name:'Example Artist'}];
  const matches=suggestArtists({title:'A concert',content_html:'<p>Featuring Example Artist on guitar.</p>'},artists,new Set());
  assert.equal(matches[0].reason,'Description');
  assert.equal(matches[0].excerpt,'Featuring Example Artist on guitar.');
});

test('migration preserves legacy event overrides and artist decisions and can be rerun', () => {
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE source_state(source_key TEXT PRIMARY KEY,next_offset INTEGER,total_available INTEGER,updated_at TEXT,last_request_at TEXT);
    CREATE TABLE artists(mbid TEXT PRIMARY KEY,name TEXT);
    INSERT INTO artists VALUES('artist-1','Test Artist');
    CREATE TABLE vilnius_events(source_id INTEGER PRIMARY KEY,title TEXT NOT NULL,source_url TEXT NOT NULL,content_html TEXT NOT NULL,categories_json TEXT NOT NULL,featured_media INTEGER,published_at TEXT,modified_at TEXT,first_seen_at TEXT NOT NULL,updated_at TEXT NOT NULL,event_date TEXT,event_end_date TEXT,event_time TEXT,venue TEXT,ticket_url TEXT,details_manual INTEGER NOT NULL DEFAULT 0,review_status TEXT NOT NULL DEFAULT 'unsure',details_checked_at TEXT,details_version INTEGER NOT NULL DEFAULT 0,manual_fields TEXT NOT NULL DEFAULT '[]');
    INSERT INTO vilnius_events(source_id,title,source_url,content_html,categories_json,first_seen_at,updated_at,event_date,venue,details_manual,review_status,details_checked_at,manual_fields) VALUES(123,'Concert','https://www.vilnius-events.lt/concert','<p>Original</p>','[4]','2026-01-01','2026-01-02','2026-12-01','Manual venue',1,'music','2026-01-02','["venue"]');
    CREATE TABLE vilnius_event_artists(event_id INTEGER NOT NULL,artist_mbid TEXT NOT NULL,decision TEXT NOT NULL,PRIMARY KEY(event_id,artist_mbid));
    INSERT INTO vilnius_event_artists VALUES(123,'artist-1','accepted');`);
  createVilniusEvents(db,'Seeker/test');
  createVilniusEvents(db,'Seeker/test');
  const saved=db.prepare('SELECT * FROM events').get();
  assert.equal(saved.venue,'Manual venue'); assert.equal(saved.review_status,'music');
  assert.deepEqual(JSON.parse(String(saved.manual_fields)),['venue']);
  assert.equal(db.prepare('SELECT source_id FROM event_sources').get().source_id,'123');
  assert.equal(db.prepare('SELECT content_html FROM event_sources').get().content_html,'<p>Original</p>');
  assert.equal(db.prepare('SELECT decision FROM event_artist_decisions').get().decision,'accepted');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events').get().n,1);
  db.close();
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
    const canonical=db.prepare("SELECT e.* FROM events e JOIN event_sources s ON s.event_id=e.id WHERE s.source_key='vilnius-events' AND s.source_id='1'").get();
    assert.equal(canonical.venue,'My venue');
    assert.equal(canonical.event_date,'2026-12-02');
    assert.equal(canonical.review_status,'music');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vilnius_events').get().n,1);
    assert.deepEqual(calls.filter(url=>url.includes('/wp-json/')).map(url=>new URL(url).searchParams.get('page')),['1','1','2']);
    assert.equal(source.state().nextPage,3);
    await source.run(1,false,false,true);
    assert.equal(source.state().nextPage,3);
    source.reviewEvent(1,'not_music');
    assert.equal(db.prepare('SELECT review_status FROM vilnius_events WHERE source_id=1').get().review_status,'not_music');
    assert.equal(db.prepare('SELECT review_status FROM events WHERE id=?').get(canonical.id).review_status,'not_music');
    db.prepare("INSERT INTO event_sources(event_id,source_key,source_id,source_url) VALUES(?,'another-source','one','https://example.com/event')").run(canonical.id);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM event_sources WHERE event_id=?').get(canonical.id).count,2);
  } finally { globalThis.fetch=originalFetch; Date.now=originalNow; db.close(); }
});
